import type { PrismaClient } from "@/generated/prisma/client";
import { allocateSeasonBudget, totalAvailable } from "./budgets";

/**
 * End-of-season financial rollover. Runs inside `rollOffSeason` after stats
 * have been read but BEFORE wins/losses are reset.
 *
 * Two systems applied per team:
 *
 *   1. Bundle revenue recompute — fan engagement reacts to competitive
 *      results. Reached Masters / Champions → up. Eliminated in Kickoff →
 *      down. Star roster (≥1 player overall 88+) → small bump per star.
 *      Clamped to [$25k, $1.5M] annual to avoid runaway.
 *
 *   2. Investor injection — board refills transferBudget + wageBudgetSeason
 *      to a prestige-scaled target. Unspent transferBudget from the past
 *      season rolls into operational `budget` (the org gets the leftover
 *      as a refund, not a free transfer-pool top-up).
 *
 * Returns a summary per team so the caller can write inbox messages.
 */
export interface SeasonRolloverSummary {
  teamId: string;
  teamName: string;
  oldBundle: number;
  newBundle: number;
  multiplierBreakdown: string[];
  transferInjection: number;
  wageInjection: number;
}

const BUNDLE_FLOOR = 25_000;
const BUNDLE_CEIL = 1_500_000;

export async function applyOffSeasonFinancials(
  prisma: PrismaClient,
  saveId: string,
  currentSeasonNumber: number,
): Promise<SeasonRolloverSummary[]> {
  const summaries: SeasonRolloverSummary[] = [];

  // Detect each team's competitive milestones via the played-stage map.
  // We need: reached Masters? reached Champions? won Masters/Champions?
  // For now a single query gathering all relevant stage participations.
  const teams = await prisma.team.findMany({
    where: { saveId },
    select: {
      id: true,
      name: true,
      prestige: true,
      wins: true,
      losses: true,
      bundleRevenueAnnual: true,
      transferBudget: true,
      wageBudgetSeason: true,
      budget: true,
      players: {
        where: { isActive: true, isRetired: false },
        select: { overall: true },
      },
    },
  });

  for (const team of teams) {
    // Stages this team played in this season.
    const stageHits = await prisma.match.findMany({
      where: {
        saveId,
        season: currentSeasonNumber,
        OR: [{ team1Id: team.id }, { team2Id: team.id }],
      },
      select: { stageId: true, winnerId: true, isPlayed: true },
    });

    const reachedKickoff = stageHits.some((m) => m.stageId.startsWith("KICKOFF"));
    const reachedMasters = stageHits.some((m) => m.stageId.startsWith("MASTERS_"));
    const reachedChampions = stageHits.some((m) => m.stageId.startsWith("CHAMPIONS"));
    const wonMastersGF = stageHits.some(
      (m) => m.stageId.endsWith("_GF") && m.stageId.startsWith("MASTERS_") && m.winnerId === team.id,
    );
    const eliminatedKickoff = reachedKickoff && !reachedMasters && !reachedChampions;
    const noInternational = !reachedMasters && !reachedChampions;
    const games = team.wins + team.losses;
    const winrate = games > 0 ? team.wins / games : 0.5;
    const bottomStandings = games >= 3 && winrate < 0.4;
    const stars = team.players.filter((p) => (p.overall ?? 0) >= 88).length;

    let bundle = team.bundleRevenueAnnual;
    const breakdown: string[] = [];

    if (wonMastersGF) {
      bundle *= 1.30;
      breakdown.push("won Masters ×1.30");
    } else if (reachedChampions) {
      bundle *= 1.25;
      breakdown.push("reached Champions ×1.25");
    } else if (reachedMasters) {
      bundle *= 1.15;
      breakdown.push("reached Masters ×1.15");
    }
    if (stars > 0) {
      const starMul = 1 + stars * 0.05;
      bundle *= starMul;
      breakdown.push(`${stars} star roster ×${starMul.toFixed(2)}`);
    }
    // Negatives
    if (eliminatedKickoff) {
      bundle *= 0.80;
      breakdown.push("eliminated Kickoff ×0.80");
    } else if (noInternational) {
      bundle *= 0.85;
      breakdown.push("no international ×0.85");
    }
    if (bottomStandings) {
      bundle *= 0.88;
      breakdown.push("bottom standings ×0.88");
    }

    const newBundle = Math.round(
      Math.max(BUNDLE_FLOOR, Math.min(BUNDLE_CEIL, bundle)),
    );

    // Investor injection — prestige-scaled. Anchor: prestige 50 = $2M total
    // (split via allocateSeasonBudget). Linear scale, clamped to [$500k, $5M].
    const target = Math.round(500_000 + ((Math.max(10, Math.min(95, team.prestige)) - 10) / 85) * 4_500_000);
    const split = allocateSeasonBudget({ totalCapital: target });
    const transferInjection = split.transferBudget;
    const wageInjection = split.wageBudgetSeason;
    // Unspent transferBudget from last season rolls into operational.
    const refundToOperational = team.transferBudget + team.wageBudgetSeason;

    await prisma.team.update({
      where: { id: team.id },
      data: {
        bundleRevenueAnnual: newBundle,
        transferBudget: transferInjection,
        wageBudgetSeason: wageInjection,
        budget: { increment: refundToOperational },
        seasonStartBudget: target + team.budget + refundToOperational,
        // Reset bundle quarter pointer so the new season's Q1 fires fresh.
        lastBundleQuarter: 0,
      },
    });

    summaries.push({
      teamId: team.id,
      teamName: team.name,
      oldBundle: team.bundleRevenueAnnual,
      newBundle,
      multiplierBreakdown: breakdown,
      transferInjection,
      wageInjection,
    });
  }

  return summaries;
}
