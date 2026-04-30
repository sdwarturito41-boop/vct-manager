import type { PrismaClient, Player, Team } from "@/generated/prisma/client";
import { playerRating } from "./marketRate";
import { effectiveBuyoutClause, stateFromScore } from "./happiness";

const MIN_INTEREST = 35;
const MAX_OFFERS_PER_TEAM_PER_WEEK = 2;
const OFFER_DEADLINE_HOURS = 72;

/**
 * Healthy teams shouldn't be churning their roster every week. Real org
 * mercato is need-driven: gaps, weak links, or losing records prompt moves.
 * A team that's winning with a full balanced roster sits the week out.
 *
 * Returns true ONLY when the team has a concrete reason to add a player.
 */
function teamNeedsRecruitment(
  team: Team & {
    players: Pick<Player, "role" | "acs" | "kd" | "adr">[];
  },
): boolean {
  // 1. Roster gap — must recruit to fill the 5-active-roster slot
  if (team.players.length < 5) return true;

  // 2. Role gap — comp is unbalanced, recruit to cover a missing role
  const rolesPresent = new Set(team.players.map((p) => p.role));
  // 4 distinct roles is the minimum for a sensible Valorant comp
  // (Duelist/Initiator/Sentinel/Controller; IGL is often a flex of one of these).
  if (rolesPresent.size < 4) return true;

  // 3. Weak link — there's a player notably below the rest of the squad,
  //    so the team would shop for an upgrade
  const ratings = team.players.map((p) => playerRating(p));
  const avg = ratings.reduce((s, r) => s + r, 0) / ratings.length;
  const min = Math.min(...ratings);
  if (avg > 0 && min < avg * 0.80) return true;

  // 4. Losing record — once enough games are in the books, struggling teams
  //    shake things up
  const games = team.wins + team.losses;
  if (games >= 3 && team.wins / games < 0.4) return true;

  // Otherwise the squad is healthy — sit the week out
  return false;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function rand(lo: number, hi: number): number {
  return lo + Math.random() * (hi - lo);
}

/**
 * Returns a roster-need multiplier for a player's role on the given team.
 * - 1.0 if team has 0 players in that role
 * - 0.7 if 1 player with low rating (<50)
 * - 0.3 if 1 with higher rating
 * - 0.1 if 2+ in that role
 */
function needRoleMultiplier(
  team: Team & { players: Pick<Player, "role" | "acs" | "kd" | "adr">[] },
  role: Player["role"],
): number {
  const sameRole = team.players.filter((p) => p.role === role);
  if (sameRole.length === 0) return 1.0;
  if (sameRole.length >= 2) return 0.1;
  const r = playerRating(sameRole[0]);
  return r < 0.5 ? 0.7 : 0.3;
}

/**
 * Main scoring function — B (fit) with A (score) as base.
 * Returns an interest value 0-100+.
 */
function computeInterest(
  team: Team & { players: Pick<Player, "role" | "acs" | "kd" | "adr">[] },
  target: Pick<Player, "role" | "region" | "acs" | "kd" | "adr">,
  offerUpfront: number,
  happinessBonus: number,
): number {
  const rating = playerRating(target);
  const need = needRoleMultiplier(team, target.role);
  const affordability = clamp((team.budget - offerUpfront) / Math.max(1, team.budget), 0, 1);
  const base = rating * need * affordability * 100;
  const regionBonus = team.region === target.region ? 0.15 : 0;
  return base * (1 + regionBonus) + happinessBonus;
}

/**
 * Generates the full set of terms for an IA offer. For buyouts, fee is
 * keyed to effective clause (discounted if player WANTS_TRANSFER). Salary
 * is always above the player's demand threshold (current × 1.2).
 */
function generateTerms(
  target: Pick<Player, "salary" | "buyoutClause" | "baseBuyoutClause" | "happiness">,
  offerType: "BUYOUT" | "FREE_AGENT_SIGNING",
  interest: number,
): {
  transferFee: number;
  proposedSalary: number;
  contractLengthWeeks: number;
  signingBonus: number;
  sellOnPercentage: number;
  loyaltyBonus: number;
} {
  const effClause = effectiveBuyoutClause(target);
  const transferFee =
    offerType === "BUYOUT" ? Math.round(effClause * rand(0.85, 1.05)) : 0;
  const proposedSalary = Math.round(target.salary * rand(1.2, 1.35));
  const contractLengthWeeks = Math.random() < 0.7 ? 52 : 104;
  const signingBonus =
    interest > 70 ? Math.round(effClause * rand(0.1, 0.3)) : 0;
  const sellOnPercentage = Math.round(rand(0, 10) * 10) / 10;
  const loyaltyBonus = Math.round(proposedSalary * rand(5, 10));
  return {
    transferFee,
    proposedSalary,
    contractLengthWeeks,
    signingBonus,
    sellOnPercentage,
    loyaltyBonus,
  };
}

/**
 * Builds a set of "team|player" keys for pairs currently on cooldown.
 * A single query replaces per-pair findFirsts (was O(teams × players)).
 */
async function buildCooldownSet(
  prisma: PrismaClient,
  saveId: string,
  currentWeek: number,
  currentSeason: number,
): Promise<Set<string>> {
  const cutoffAbs = currentSeason * 52 + currentWeek - 4;
  const recent = await prisma.transferOffer.findMany({
    where: {
      saveId,
      status: { in: ["REJECTED", "EXPIRED"] },
    },
    select: { fromTeamId: true, playerId: true, week: true, season: true },
  });
  const set = new Set<string>();
  for (const o of recent) {
    if (o.season * 52 + o.week >= cutoffAbs) {
      set.add(`${o.fromTeamId}|${o.playerId}`);
    }
  }
  return set;
}

/**
 * Runs weekly IA transfer activity for a save. For each AI team, scans the
 * market, scores candidates, and creates up to 2 offers. Respects budget
 * soft cap and cooldowns.
 */
export async function runAiTransferActivity(
  prisma: PrismaClient,
  saveId: string,
  currentWeek: number,
  currentSeason: number,
): Promise<{ offersCreated: number }> {
  const aiTeams = await prisma.team.findMany({
    where: { saveId, isPlayerTeam: false },
    include: {
      players: {
        where: { isActive: true },
        select: { role: true, acs: true, kd: true, adr: true },
      },
    },
  });

  // Pool of potential targets: free agents + contracted non-user players.
  // Only select the fields the scoring + offer-generation pipeline actually
  // reads. The full Player row carries 5 heavy Json columns (attributes,
  // roleScores, agentStats, mapFactors, happinessTags) that aren't used here —
  // pulling them across all ~290 players blows up the wire payload.
  const allTargets = await prisma.player.findMany({
    where: {
      isRetired: false,
      isActive: true,
      team: { saveId },
    },
    select: {
      id: true, region: true, role: true, teamId: true, currentTeam: true,
      acs: true, kd: true, adr: true, salary: true,
      happiness: true, isTransferListed: true,
      buyoutClause: true, baseBuyoutClause: true,
      wantsTransferSinceWeek: true, wantsTransferSinceSeason: true,
    },
  });
  type SlimTarget = (typeof allTargets)[number];

  // Pre-compute all cooldowns in a single query (was O(teams × players))
  const cooldownSet = await buildCooldownSet(
    prisma,
    saveId,
    currentWeek,
    currentSeason,
  );

  // Pre-compute all pending upfronts per team in a single query
  const pendingAgg = await prisma.transferOffer.findMany({
    where: { saveId, status: "PENDING" },
    select: {
      fromTeamId: true,
      offerType: true,
      transferFee: true,
      proposedSalary: true,
      signingBonus: true,
    },
  });
  const pendingUpfrontByTeam = new Map<string, number>();
  for (const o of pendingAgg) {
    const up =
      o.offerType === "BUYOUT"
        ? o.transferFee + o.signingBonus
        : o.offerType === "FREE_AGENT_SIGNING"
          ? o.proposedSalary * 4 + o.signingBonus
          : o.signingBonus;
    pendingUpfrontByTeam.set(
      o.fromTeamId,
      (pendingUpfrontByTeam.get(o.fromTeamId) ?? 0) + up,
    );
  }

  // Buffer all offers and flush in one createMany at the end. Previously each
  // offer was its own sequential `await prisma.transferOffer.create` round-trip,
  // so a busy week with ~50 IA teams × up to 5 offers = up to 250 sequential RTs
  // against Neon's pooler — easily several seconds.
  const offersToCreate: Array<{
    saveId: string;
    playerId: string;
    fromTeamId: string;
    toTeamId: string | null;
    offerType: "BUYOUT" | "FREE_AGENT_SIGNING";
    transferFee: number;
    proposedSalary: number;
    contractLengthWeeks: number;
    signingBonus: number;
    sellOnPercentage: number;
    loyaltyBonus: number;
    status: "PENDING";
    week: number;
    season: number;
    deadlineAt: Date;
    negotiationRound: number;
  }> = [];
  let offersCreated = 0;

  for (const team of aiTeams) {
    // Skip healthy teams entirely — they don't shop the market when nothing
    // is broken. Cuts the typical week's transfer churn from ~15 moves to a
    // handful tied to actual roster needs.
    if (!teamNeedsRecruitment(team)) continue;

    let offersThisWeek = 0;
    let upfrontCommitted = pendingUpfrontByTeam.get(team.id) ?? 0;

    // Filter targets: exclude own players + cooldowned players (in-memory lookups)
    const eligibleTargets: SlimTarget[] = allTargets.filter(
      (t) => t.teamId !== team.id && !cooldownSet.has(`${team.id}|${t.id}`),
    );

    // Score + sort
    const scored = eligibleTargets
      .map((target) => {
        const offerType: "BUYOUT" | "FREE_AGENT_SIGNING" =
          target.teamId === null && target.currentTeam === null
            ? "FREE_AGENT_SIGNING"
            : "BUYOUT";
        const effClause = effectiveBuyoutClause(target);
        const approxUpfront =
          offerType === "BUYOUT" ? effClause : target.salary * 4;
        // Happiness drives IA interest bonus: unhappy players are easier to poach.
        const state = stateFromScore(target.happiness);
        const happinessBonus =
          state === "WANTS_TRANSFER" ? 25 : state === "UNHAPPY" ? 10 : 0;
        // TRANSFER_LISTED players get an additional +40% interest boost.
        const listBonus = target.isTransferListed ? 40 : 0;
        const interest =
          computeInterest(team, target, approxUpfront, happinessBonus + listBonus);
        return { target, offerType, approxUpfront, interest };
      })
      .filter((c) => c.interest >= MIN_INTEREST)
      .sort((a, b) => b.interest - a.interest)
      .slice(0, 10);

    for (const cand of scored) {
      if (offersThisWeek >= MAX_OFFERS_PER_TEAM_PER_WEEK) break;

      // Soft budget cap: committed + approxUpfront must fit in team.budget
      if (upfrontCommitted + cand.approxUpfront > team.budget) continue;

      // Probabilistic gate based on interest
      if (Math.random() > cand.interest / 100) continue;

      const terms = generateTerms(cand.target, cand.offerType, cand.interest);
      const realUpfront =
        cand.offerType === "BUYOUT"
          ? terms.transferFee + terms.signingBonus
          : terms.proposedSalary * 4 + terms.signingBonus;
      if (upfrontCommitted + realUpfront > team.budget) continue;

      const deadline = new Date(Date.now() + OFFER_DEADLINE_HOURS * 3600 * 1000);

      offersToCreate.push({
        saveId,
        playerId: cand.target.id,
        fromTeamId: team.id,
        toTeamId: cand.offerType === "BUYOUT" ? cand.target.teamId : null,
        offerType: cand.offerType,
        transferFee: terms.transferFee,
        proposedSalary: terms.proposedSalary,
        contractLengthWeeks: terms.contractLengthWeeks,
        signingBonus: terms.signingBonus,
        sellOnPercentage: terms.sellOnPercentage,
        loyaltyBonus: terms.loyaltyBonus,
        status: "PENDING",
        week: currentWeek,
        season: currentSeason,
        deadlineAt: deadline,
        negotiationRound: 1,
      });

      upfrontCommitted += realUpfront;
      offersThisWeek += 1;
      offersCreated += 1;
    }
  }

  if (offersToCreate.length > 0) {
    await prisma.transferOffer.createMany({ data: offersToCreate });
  }

  return { offersCreated };
}

/**
 * Expires stale pending offers whose deadlineAt has passed. Called daily
 * from advanceDay. EXPIRED triggers the same 4-week cooldown as REJECTED.
 */
export async function expireStaleOffers(prisma: PrismaClient): Promise<number> {
  const res = await prisma.transferOffer.updateMany({
    where: {
      status: "PENDING",
      deadlineAt: { lt: new Date() },
    },
    data: { status: "EXPIRED" },
  });
  return res.count;
}
