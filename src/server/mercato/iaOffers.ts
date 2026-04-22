import type { PrismaClient, Player, Team } from "@/generated/prisma/client";
import { playerRating } from "./marketRate";
import { effectiveBuyoutClause, stateFromScore } from "./happiness";

const MIN_INTEREST = 35;
const MAX_OFFERS_PER_TEAM_PER_WEEK = 2;
const OFFER_DEADLINE_HOURS = 72;

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
  target: Player,
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
  target: Player,
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
 * Returns sum of pending upfront commitments (buyout fees + FA signing
 * bonuses × 4 weeks) for a team. Used by the soft budget cap.
 */
async function pendingUpfrontCost(
  prisma: PrismaClient,
  teamId: string,
): Promise<number> {
  const offers = await prisma.transferOffer.findMany({
    where: { fromTeamId: teamId, status: "PENDING" },
    select: { offerType: true, transferFee: true, proposedSalary: true, signingBonus: true },
  });
  return offers.reduce((sum, o) => {
    const upfront =
      o.offerType === "BUYOUT"
        ? o.transferFee + o.signingBonus
        : o.proposedSalary * 4 + o.signingBonus;
    return sum + upfront;
  }, 0);
}

/**
 * Cooldown check — after REJECT/EXPIRED, the same (team, player) pair is
 * locked for 4 weeks. Prevents spam-re-offering.
 */
async function isOnCooldown(
  prisma: PrismaClient,
  teamId: string,
  playerId: string,
  currentWeek: number,
  currentSeason: number,
): Promise<boolean> {
  const last = await prisma.transferOffer.findFirst({
    where: {
      fromTeamId: teamId,
      playerId,
      status: { in: ["REJECTED", "EXPIRED"] },
    },
    orderBy: { createdAt: "desc" },
    select: { week: true, season: true },
  });
  if (!last) return false;
  const weeksSince =
    (currentSeason - last.season) * 52 + (currentWeek - last.week);
  return weeksSince < 4;
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
  // (IA teams don't poach from the user's team automatically here —
  // their interest is computed against ALL non-self players; user players
  // included, which is what makes the market lively.)
  const allTargets = await prisma.player.findMany({
    where: {
      isRetired: false,
      isActive: true,
      team: { saveId },
    },
  });

  let offersCreated = 0;

  for (const team of aiTeams) {
    let offersThisWeek = 0;
    let upfrontCommitted = await pendingUpfrontCost(prisma, team.id);

    // Filter targets: exclude own players + cooldowned players
    const eligibleTargets: Player[] = [];
    for (const t of allTargets) {
      if (t.teamId === team.id) continue;
      const onCd = await isOnCooldown(prisma, team.id, t.id, currentWeek, currentSeason);
      if (onCd) continue;
      eligibleTargets.push(t);
    }

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

      await prisma.transferOffer.create({
        data: {
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
        },
      });

      upfrontCommitted += realUpfront;
      offersThisWeek += 1;
      offersCreated += 1;
    }
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
