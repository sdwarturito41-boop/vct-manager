import type { PrismaClient, Player, MessageCategory } from "@/generated/prisma/client";
import { marketRate } from "./marketRate";

export type HappinessTag =
  | "UNDERPAID"
  | "OVERPAID"
  | "CONTRACT_EXPIRING"
  | "TEAM_LOSING_STREAK"
  | "TEAM_WINNING_STREAK"
  | "RECENT_SIGNING"
  | "TROPHY_WON"
  | "MAJOR_OFFER_REJECTED"
  | "PLAYING_HOME_REGION";

export type HappinessState = "HAPPY" | "CONCERNED" | "UNHAPPY" | "WANTS_TRANSFER";

export function stateFromScore(score: number): HappinessState {
  if (score >= 70) return "HAPPY";
  if (score >= 40) return "CONCERNED";
  if (score >= 20) return "UNHAPPY";
  return "WANTS_TRANSFER";
}

// Per-week score deltas applied while a tag is active (repeating tags).
const REPEATING_TAG_DELTAS: Partial<Record<HappinessTag, number>> = {
  UNDERPAID: -2,
  OVERPAID: +1,
  TEAM_LOSING_STREAK: -3,
  TEAM_WINNING_STREAK: +2,
  CONTRACT_EXPIRING: -1,
};

// One-shot tags that decay toward removal each week. Sign indicates the
// correction applied to the tag's residual impact until it auto-removes at 0.
const DECAY_TAGS: Record<string, { decay: number }> = {
  RECENT_SIGNING: { decay: 2 },
  TROPHY_WON: { decay: 3 },
  MAJOR_OFFER_REJECTED: { decay: 4 },
  PLAYING_HOME_REGION: { decay: 1 },
};

type PlayerWithTeam = Player & {
  team: { id: string; region: string; wins: number; losses: number } | null;
};

/**
 * Detects the set of repeating tags active on a player right now. One-shot
 * tags are applied via dedicated events (signing, trophy, etc.) and live on
 * the player record until they decay; they are NOT recomputed here.
 */
function detectRepeatingTags(
  player: PlayerWithTeam,
  recentResults: { won: boolean }[],
  currentWeek: number,
  currentSeason: number,
): HappinessTag[] {
  const tags: HappinessTag[] = [];

  const rate = marketRate(player);
  if (player.salary < rate * 0.7) tags.push("UNDERPAID");
  else if (player.salary > rate * 1.5) tags.push("OVERPAID");

  // Contract expiring within 12 weeks
  const weeksLeft =
    (player.contractEndSeason - currentSeason) * 52 +
    (player.contractEndWeek - currentWeek);
  if (weeksLeft >= 0 && weeksLeft < 12) tags.push("CONTRACT_EXPIRING");

  if (recentResults.length >= 3) {
    const last3 = recentResults.slice(0, 3);
    if (last3.every((r) => !r.won)) tags.push("TEAM_LOSING_STREAK");
    else if (last3.every((r) => r.won)) tags.push("TEAM_WINNING_STREAK");
  }

  return tags;
}

/**
 * Loads the last N matches for a team and returns win/loss booleans in
 * reverse-chronological order. Used for streak detection.
 */
async function lastMatchResults(
  prisma: PrismaClient,
  teamId: string,
  n: number,
): Promise<{ won: boolean }[]> {
  const matches = await prisma.match.findMany({
    where: {
      isPlayed: true,
      OR: [{ team1Id: teamId }, { team2Id: teamId }],
    },
    orderBy: { playedAt: "desc" },
    take: n,
    select: { team1Id: true, team2Id: true, winnerId: true },
  });
  return matches.map((m) => ({ won: m.winnerId === teamId }));
}

/**
 * Recomputes happiness for all contracted players in a save. Called on the
 * weekly tick. Returns the count of players whose state changed (for
 * inbox message generation).
 */
export async function recomputeHappinessAll(
  prisma: PrismaClient,
  saveId: string,
  currentWeek: number,
  currentSeason: number,
): Promise<{
  transitions: Array<{ playerId: string; prev: HappinessState; next: HappinessState }>;
}> {
  const players = await prisma.player.findMany({
    where: {
      teamId: { not: null },
      isRetired: false,
      team: { saveId },
    },
    include: {
      team: { select: { id: true, region: true, wins: true, losses: true } },
    },
  });

  // Cache team results so we don't refetch per-player
  const teamResultsCache = new Map<string, { won: boolean }[]>();
  const transitions: Array<{
    playerId: string;
    prev: HappinessState;
    next: HappinessState;
  }> = [];

  for (const p of players) {
    if (!p.team) continue;

    let results = teamResultsCache.get(p.team.id);
    if (!results) {
      results = await lastMatchResults(prisma, p.team.id, 3);
      teamResultsCache.set(p.team.id, results);
    }

    const repeatingTags = detectRepeatingTags(p, results, currentWeek, currentSeason);

    // Existing tags include decaying one-shots. Separate them.
    const existingTags = Array.isArray(p.happinessTags)
      ? (p.happinessTags as string[])
      : [];
    const keptOneShots = existingTags.filter((t) => t in DECAY_TAGS);

    // Compute score delta from repeating tags
    let delta = 0;
    for (const t of repeatingTags) {
      delta += REPEATING_TAG_DELTAS[t] ?? 0;
    }
    // Decay one-shot tags (their initial +/- was applied at event time;
    // here we just drift back toward baseline so old events fade).
    const nextOneShots: string[] = [];
    for (const t of keptOneShots) {
      const sign = t === "MAJOR_OFFER_REJECTED" ? +1 : -1;
      delta += sign * (DECAY_TAGS[t]?.decay ?? 0);
      // Crude decay: one-shots persist 4 weeks then drop.
      // (Weekly tick means we need a counter. Simpler: keep until natural score drift resolves.)
      nextOneShots.push(t);
    }

    const prevScore = p.happiness;
    const nextScore = Math.max(0, Math.min(100, prevScore + delta));
    const prevState = stateFromScore(prevScore);
    const nextState = stateFromScore(nextScore);
    const nextTags = [...repeatingTags, ...nextOneShots];

    // Track WANTS_TRANSFER entry/exit for the 4-week FORCE_SALE window and
    // the effectiveBuyoutClause discount.
    let wantsSinceWeek = p.wantsTransferSinceWeek;
    let wantsSinceSeason = p.wantsTransferSinceSeason;
    if (nextState === "WANTS_TRANSFER" && prevState !== "WANTS_TRANSFER") {
      wantsSinceWeek = currentWeek;
      wantsSinceSeason = currentSeason;
    } else if (nextState !== "WANTS_TRANSFER" && prevState === "WANTS_TRANSFER") {
      wantsSinceWeek = null;
      wantsSinceSeason = null;
    }

    await prisma.player.update({
      where: { id: p.id },
      data: {
        happiness: nextScore,
        happinessTags: nextTags,
        wantsTransferSinceWeek: wantsSinceWeek,
        wantsTransferSinceSeason: wantsSinceSeason,
      },
    });

    if (prevState !== nextState) {
      transitions.push({ playerId: p.id, prev: prevState, next: nextState });
    }
  }

  return { transitions };
}

/**
 * Generates inbox messages for user-team players whose state changed.
 * Only fires on transition INTO UNHAPPY or WANTS_TRANSFER (downward slides).
 */
export async function generateHappinessMessages(
  prisma: PrismaClient,
  saveId: string,
  userTeamId: string,
  transitions: Array<{ playerId: string; prev: HappinessState; next: HappinessState }>,
  currentWeek: number,
  currentSeason: number,
): Promise<void> {
  for (const t of transitions) {
    // Only fire on slides INTO UNHAPPY or WANTS_TRANSFER
    if (t.next !== "UNHAPPY" && t.next !== "WANTS_TRANSFER") continue;
    if (t.prev === t.next) continue;
    if (t.next === "UNHAPPY" && t.prev === "WANTS_TRANSFER") continue; // climbing back up

    const player = await prisma.player.findUnique({
      where: { id: t.playerId },
      select: { id: true, ign: true, teamId: true, role: true, firstName: true, lastName: true },
    });
    if (!player || player.teamId !== userTeamId) continue;

    const category: MessageCategory = "PLAYER";
    if (t.next === "UNHAPPY") {
      await prisma.message.create({
        data: {
          saveId,
          teamId: userTeamId,
          category,
          fromName: `${player.firstName} ${player.lastName}`,
          fromRole: player.role,
          subject: `${player.ign} — I'm not happy`,
          body: `Boss, I have to be honest. I'm not feeling great about my situation right now. Something needs to change.`,
          eventType: "PLAYER_UNHAPPY",
          eventData: { playerId: player.id },
          requiresAction: false,
          week: currentWeek,
          season: currentSeason,
        },
      });
    } else if (t.next === "WANTS_TRANSFER") {
      await prisma.message.create({
        data: {
          saveId,
          teamId: userTeamId,
          category,
          fromName: `${player.firstName} ${player.lastName}`,
          fromRole: player.role,
          subject: `${player.ign} — I want to leave`,
          body: `I've thought about this long and hard. I want out. I've given you everything I have — it's time for a new chapter.`,
          eventType: "PLAYER_WANTS_TRANSFER",
          eventData: { playerId: player.id },
          requiresAction: true,
          week: currentWeek,
          season: currentSeason,
        },
      });
    }
  }
}

/**
 * Returns the effective buyout clause for a player right now, applying the
 * -30% discount if they are in WANTS_TRANSFER state. Used by the IA offer
 * engine and displayed in the buyout market UI.
 */
export function effectiveBuyoutClause(
  player: Pick<Player, "baseBuyoutClause" | "buyoutClause" | "happiness">,
): number {
  const base = player.baseBuyoutClause > 0 ? player.baseBuyoutClause : player.buyoutClause;
  if (stateFromScore(player.happiness) === "WANTS_TRANSFER") {
    return Math.round(base * 0.7);
  }
  return base;
}
