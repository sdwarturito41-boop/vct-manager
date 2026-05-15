import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getQueryCount } from "@/lib/prisma";
import { router, protectedProcedure, saveProcedure } from "../trpc";
import { simulateMatch } from "@/server/simulation/engine";
import { applyStatRollingUpdatesBatch, type MatchStatInput } from "@/server/simulation/statRolling";
import type { SimTeam } from "@/server/simulation/engine";
import type { Player, Team, Region } from "@/generated/prisma/client";
import {
  progressBracket,
  initializeMasters,
  progressSwiss,
  progressMastersBracket,
  initializeRegionalStage,
  progressRegionalStage,
  progressRegionalPlayoffs,
  initializeInternationalEvent,
  generateMetaPatch,
  rollOffSeason,
} from "@/server/schedule/generate";
import {
  initializeEwcQualifierS1,
  progressEwcQualifierS1,
  initializeEwcQualifierS2,
  progressEwcQualifierS2,
  initializeEwcMainFromQualifiers,
  progressEwcMain,
} from "@/server/schedule/ewc-qualifier";
import { dayOfWeek } from "@/lib/game-date";
import { MASTERS_FORMAT } from "@/constants/masters-format";
import { applyPatchToMeta } from "@/constants/meta";
import {
  allocateSeasonBudget,
  debitWages,
  needsInitialSplit,
  totalAvailable,
} from "@/server/finance/budgets";
import { reconcileDebt } from "@/server/finance/investor";
import {
  computeWeeklyRevenue,
  computeQuarterlyBundle,
  quarterIndex,
  isQuarterStartWeek,
} from "@/server/finance/revenue";
import { computeWeeklyOperationalCost } from "@/server/finance/operations";
import { SCOUTING_REVEAL_WEEKS } from "@/server/routers/scouting";
import { runAiOfferResolutions, evaluateFreeAgentDecisions } from "./transfer";
import { evaluatePendingStaffHires } from "./staff";
import { invalidateSponsorOffersCache } from "./sponsor";
import { invalidateCoachOffersCache } from "./coach";
import { runAiTransferActivity, expireStaleOffers } from "@/server/mercato/iaOffers";
import { recomputeHappinessAll, generateHappinessMessages } from "@/server/mercato/happiness";
import {
  runRelationshipsTick,
  applyMentorStatGrowth,
  loadActivePairMaps,
} from "@/server/mercato/relationships";
import { snapshotPlayerStats } from "@/server/mercato/attributes";

// Minimal shape needed by the simulation engine. Avoids depending on the full
// Prisma Team/Player types so callers can pass slimmed-down selects.
type SimTeamInput = {
  id: string;
  name: string;
  tag: string;
  skillAim: number;
  skillUtility: number;
  skillTeamplay: number;
  playstyle: Team["playstyle"];
  ecoDiscipline?: number;
  mapPrep?: unknown;
  adaptationRating?: number;
  players: Pick<Player, "id" | "ign" | "acs" | "kd" | "adr" | "kast" | "hs" | "role" | "overall" | "formMomentum">[];
};

function buildSimTeam(team: SimTeamInput): SimTeam {
  // Only use top 5 players by ACS (active roster limit)
  const top5 = [...team.players].sort((a, b) => b.acs - a.acs).slice(0, 5);
  return {
    id: team.id,
    name: team.name,
    tag: team.tag,
    players: top5.map((p) => ({
      id: p.id,
      ign: p.ign,
      acs: p.acs,
      kd: p.kd,
      adr: p.adr,
      kast: p.kast,
      hs: p.hs,
      role: p.role,
      overall: p.overall,
      formMomentum: p.formMomentum,
    })),
    skillAim: team.skillAim,
    skillUtility: team.skillUtility,
    skillTeamplay: team.skillTeamplay,
    playstyle: team.playstyle,
    ecoDiscipline: team.ecoDiscipline,
    mapPrep: (team.mapPrep ?? {}) as Record<string, number>,
    adaptationRating: team.adaptationRating,
  };
}

export const seasonRouter = router({
  getCurrent: saveProcedure.query(async ({ ctx }) => {
    const season = await ctx.prisma.season.findFirst({ where: { isActive: true, saveId: ctx.save.id } });
    if (!season) throw new TRPCError({ code: "NOT_FOUND", message: "No active season." });
    return season;
  }),

  advanceDay: saveProcedure.mutation(async ({ ctx }) => {
    // Per-section timing instrumentation — visible in Vercel logs to identify
    // which phase eats the wall-clock time. mark() logs immediately so that
    // even if the function times out mid-flight we still see how far it got
    // (the final summary log would otherwise never emit).
    const t0 = Date.now();
    const queryAt0 = getQueryCount();
    const marks: Array<{ label: string; ms: number; queries: number }> = [];
    let lastT = t0;
    let lastQ = queryAt0;
    const mark = (label: string) => {
      const now = Date.now();
      const q = getQueryCount();
      const ms = now - lastT;
      const queries = q - lastQ;
      marks.push({ label, ms, queries });
      console.log(`[advanceDay·step] +${ms}ms · ${queries}q · ${label} (total ${now - t0}ms)`);
      lastT = now;
      lastQ = q;
    };

    const season = await ctx.prisma.season.findFirst({ where: { isActive: true, saveId: ctx.save.id } });
    if (!season) throw new TRPCError({ code: "NOT_FOUND", message: "No active season." });

    // Block only if user has an unplayed match on or BEFORE current day (in the past).
    // If the match is scheduled for today or future, advance is allowed — when newDay
    // reaches the match day, the Play Match button will appear.
    const userTeam = await ctx.prisma.team.findFirst({
      where: { saveId: ctx.save.id, isPlayerTeam: true },
    });
    const newDay = season.currentDay + 1;
    if (userTeam) {
      const pendingMatch = await ctx.prisma.match.findFirst({
        where: {
          saveId: ctx.save.id,
          isPlayed: false,
          day: { gt: 0, lte: season.currentDay }, // only past/today matches block
          OR: [{ team1Id: userTeam.id }, { team2Id: userTeam.id }],
        },
      });
      if (pendingMatch) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "You have a match to play! Complete the veto first.",
        });
      }
    }

    const newWeek = Math.ceil(newDay / 7);

    await ctx.prisma.season.update({
      where: { id: season.id },
      data: { currentDay: newDay, currentWeek: newWeek },
    });

    // Load active patch (if any) and apply buffs/nerfs to the live meta table
    const activePatch = await ctx.prisma.metaPatch.findFirst({
      where: { season: season.number, stage: season.currentStage },
      orderBy: { createdAt: "desc" },
    });
    if (activePatch) {
      const buffs = Array.isArray(activePatch.buffs) ? (activePatch.buffs as string[]) : [];
      const nerfs = Array.isArray(activePatch.nerfs) ? (activePatch.nerfs as string[]) : [];
      applyPatchToMeta(buffs, nerfs);
    } else {
      applyPatchToMeta([], []);
    }

    // Find ALL matches up to and including this day that are unplayed (catch-up logic).
    // This covers the case where matches were scheduled in the past (stage init during
    // an earlier advance) — they'll get simulated on the next advance.
    const stagePrefix = season.currentStage;
    // Slim the player payload to only the fields buildSimTeam reads.
    // The full Player row includes 4 heavy Json columns (attributes, roleScores,
    // agentStats, mapFactors, happinessTags) — fetching them for every player on
    // every team playing today added megabytes of unused data per advanceDay
    // call. Restricting to scalars cuts the wire payload by ~95%.
    const playerSelect = {
      id: true, ign: true, acs: true, kd: true, adr: true, kast: true,
      hs: true, role: true, overall: true, formMomentum: true,
    } as const;
    const teamScalars = {
      id: true, name: true, tag: true, logoUrl: true, region: true,
      skillAim: true, skillUtility: true, skillTeamplay: true, playstyle: true,
      ecoDiscipline: true, mapPrep: true, adaptationRating: true,
    } as const;
    const todaysMatches = await ctx.prisma.match.findMany({
      where: {
        saveId: ctx.save.id,
        day: { gt: 0, lte: newDay },
        season: season.number,
        isPlayed: false,
        OR: [
          { stageId: { startsWith: stagePrefix } },
          { stageId: stagePrefix },
          // EWC qualifier matches run in PARALLEL with regional Stage 1/2:
          //   S1 Qualifier — during Stage 1 group + PO
          //   S2 Qualifier — straddles Stage 1 PO end → Masters 2 → Stage 2
          // The stage-prefix gate above misses them because `EWC_QUAL_*`
          // doesn't start with `STAGE_1` / `MASTERS_2` etc. Without this
          // extra branch, qualifier matches stay stuck and the whole chain
          // freezes.
          { stageId: { startsWith: "EWC_QUAL_" } },
        ],
      },
      select: {
        id: true, stageId: true, format: true, day: true, week: true,
        season: true, team1Id: true, team2Id: true,
        team1: {
          select: {
            ...teamScalars,
            players: { where: { isActive: true }, select: playerSelect },
            coach: { select: { utilityBoost: true, scoutingSkill: true, trainingEff: true } },
          },
        },
        team2: {
          select: {
            ...teamScalars,
            players: { where: { isActive: true }, select: playerSelect },
            coach: { select: { utilityBoost: true, scoutingSkill: true, trainingEff: true } },
          },
        },
      },
    });

    const simulatedResults: Array<{
      matchId: string;
      team1Id: string;
      team2Id: string;
      team1Name: string;
      team2Name: string;
      team1Tag: string;
      team2Tag: string;
      team1LogoUrl: string | null;
      team2LogoUrl: string | null;
      winnerId: string;
      score: { team1: number; team2: number };
      isUserMatch: boolean;
      stageId: string;
      needsVeto: boolean;
    }> = [];

    // V3 — pre-fetch all pair maps for the teams playing today in 1 query.
    const todaysTeamIds = Array.from(
      new Set(todaysMatches.flatMap((m) => [m.team1Id, m.team2Id])),
    );
    const pairMaps = await loadActivePairMaps(
      ctx.prisma,
      ctx.save.id,
      todaysTeamIds,
    );

    // Track which rounds completed (for bracket progression)
    const completedRounds = new Set<string>();

    // Phase 1 — simulate all AI matches in memory (CPU only). User matches are
    // queued for veto and skipped. This used to be a sequential await-loop
    // that fired ~6 round-trips per match against Neon; on 16 matches/day
    // that totalled ~100 sequential queries (4-8 s on the pooler).
    type AiResult = {
      matchId: string;
      team1Id: string;
      team2Id: string;
      stageId: string;
      winnerId: string;
      loserId: string;
      score: { team1: number; team2: number };
      maps: Array<Record<string, unknown>>;
      team1Name: string;
      team2Name: string;
      team1Tag: string;
      team2Tag: string;
      team1LogoUrl: string | null;
      team2LogoUrl: string | null;
      isStage12Group: boolean;
    };
    const aiResults: AiResult[] = [];
    const pendingStatUpdates: MatchStatInput[] = [];

    for (const match of todaysMatches) {
      if (match.team1.players.length === 0 || match.team2.players.length === 0) continue;

      const isUserMatch =
        userTeam !== null &&
        (match.team1Id === userTeam.id || match.team2Id === userTeam.id);

      if (isUserMatch) {
        simulatedResults.push({
          matchId: match.id,
          team1Id: match.team1Id,
          team2Id: match.team2Id,
          team1Name: match.team1.name,
          team2Name: match.team2.name,
          team1Tag: match.team1.tag,
          team2Tag: match.team2.tag,
          team1LogoUrl: match.team1.logoUrl,
          team2LogoUrl: match.team2.logoUrl,
          winnerId: "",
          score: { team1: 0, team2: 0 },
          isUserMatch: true,
          stageId: match.stageId,
          needsVeto: true,
        });
        continue;
      }

      const simTeam1 = buildSimTeam(match.team1);
      const simTeam2 = buildSimTeam(match.team2);
      const result = simulateMatch(
        simTeam1,
        simTeam2,
        match.format,
        undefined,
        undefined,
        {
          team1CoachBoost: match.team1.coach?.utilityBoost,
          team2CoachBoost: match.team2.coach?.utilityBoost,
          team1CoachAdaptation: match.team1.coach?.scoutingSkill,
          team2CoachAdaptation: match.team2.coach?.scoutingSkill,
          team1CoachMental: match.team1.coach?.trainingEff,
          team2CoachMental: match.team2.coach?.trainingEff,
          team1Pairs: pairMaps.get(match.team1Id),
          team2Pairs: pairMaps.get(match.team2Id),
        },
      );

      const loserId = result.winnerId === match.team1Id ? match.team2Id : match.team1Id;
      const isStage12Group =
        match.stageId === "STAGE_1_ALPHA" ||
        match.stageId === "STAGE_1_OMEGA" ||
        match.stageId === "STAGE_2_ALPHA" ||
        match.stageId === "STAGE_2_OMEGA";

      aiResults.push({
        matchId: match.id,
        team1Id: match.team1Id,
        team2Id: match.team2Id,
        stageId: match.stageId,
        winnerId: result.winnerId,
        loserId,
        score: result.score,
        maps: result.maps.map((m) => ({ ...m })),
        team1Name: match.team1.name,
        team2Name: match.team2.name,
        team1Tag: match.team1.tag,
        team2Tag: match.team2.tag,
        team1LogoUrl: match.team1.logoUrl,
        team2LogoUrl: match.team2.logoUrl,
        isStage12Group,
      });
      completedRounds.add(match.stageId);

      // Collect stat-rolling updates — applied in a single batch after the loop
      // so we don't pay ~4 sequential round-trips per (player × map).
      for (const map of result.maps) {
        const team1WonMap = map.score1 > map.score2;
        for (const stat of map.playerStats) {
          pendingStatUpdates.push({
            playerId: stat.playerId,
            acs: stat.acs,
            kills: stat.kills,
            deaths: stat.deaths,
            assists: stat.assists,
            won: stat.teamId === match.team1Id ? team1WonMap : !team1WonMap,
          });
        }
      }
    }

    mark("sim AI matches");
    await applyStatRollingUpdatesBatch(ctx.prisma, pendingStatUpdates);
    mark("stat rolling batch");

    // Phase 2 — collapse ALL today's writes (match updates + per-team
    // win/loss/champPts/budget deltas) into ONE transaction. Includes:
    //   - match.update for each played match
    //   - wins/losses + group-stage champPts
    //   - finals placement champPts (KICKOFF_UB_FINAL, GRAND_FINAL, etc.)
    //   - prize money payouts (Masters/Champions/Stage 2)
    //
    // Previously these were 3 separate phases firing dozens of sequential
    // transactions: one per match for placement + one per match for prize,
    // burning ~30-60 round-trips. Aggregating into one transaction keeps
    // latency at a single round-trip regardless of match count.
    const playedAt = new Date();
    const finalsPointsConfig: Record<string, { winner: number; loser: number }> = {
      "KICKOFF_UB_FINAL":      { winner: 4, loser: 0 },
      "KICKOFF_MID_FINAL":     { winner: 3, loser: 0 },
      "KICKOFF_LB_FINAL":      { winner: 2, loser: 1 },
      "MASTERS_1_GRAND_FINAL": { winner: 4, loser: 3 },
      "MASTERS_1_LB_FINAL":    { winner: 0, loser: 2 },
      "MASTERS_1_LB_SF":       { winner: 0, loser: 1 },
      "MASTERS_2_GRAND_FINAL": { winner: 4, loser: 3 },
      "MASTERS_2_LB_FINAL":    { winner: 0, loser: 2 },
      "MASTERS_2_LB_SF":       { winner: 0, loser: 1 },
      // Stage 1 PO → 6/4/3/2 pts. Top 3 → Masters London. 1st → EWC direct slot.
      "STAGE_1_PO_GF":         { winner: 6, loser: 4 },
      "STAGE_1_PO_LB_GF":      { winner: 0, loser: 3 }, // 3rd
      "STAGE_1_PO_LB_FINAL":   { winner: 0, loser: 2 }, // 4th (LB SF loser)
      // Stage 2 PO → 8/6/5/4 pts. Top 2 → Champions Shanghai.
      "STAGE_2_PO_GF":         { winner: 8, loser: 6 },
      "STAGE_2_PO_LB_GF":      { winner: 0, loser: 5 }, // 3rd
      "STAGE_2_PO_LB_FINAL":   { winner: 0, loser: 4 }, // 4th
    };
    const prizePayouts: Record<string, { winner: number; loser: number }> = {
      "STAGE_2_PO_GF":         { winner: 100_000, loser: 65_000 },
      "STAGE_2_PO_LB_GF":      { winner: 0, loser: 40_000 }, // 3rd place
      "STAGE_2_PO_LB_FINAL":   { winner: 0, loser: 25_000 }, // 4th place
      "STAGE_2_PO_LB_R2":      { winner: 0, loser: 10_000 },
      "MASTERS_1_GRAND_FINAL": { winner: 175_000, loser: 100_000 },
      "MASTERS_1_LB_FINAL":    { winner: 0, loser: 62_500 },
      "MASTERS_1_LB_SF":       { winner: 0, loser: 37_500 },
      "MASTERS_1_LB_R2":       { winner: 0, loser: 25_000 },
      "MASTERS_1_LB_R1":       { winner: 0, loser: 17_500 },
      "MASTERS_2_GRAND_FINAL": { winner: 350_000, loser: 200_000 },
      "MASTERS_2_LB_FINAL":    { winner: 0, loser: 125_000 },
      "MASTERS_2_LB_SF":       { winner: 0, loser: 75_000 },
      "MASTERS_2_LB_R2":       { winner: 0, loser: 50_000 },
      "MASTERS_2_LB_R1":       { winner: 0, loser: 35_000 },
      "CHAMPIONS_GRAND_FINAL": { winner: 1_000_000, loser: 400_000 },
      "CHAMPIONS_LB_FINAL":    { winner: 0, loser: 250_000 },
      "CHAMPIONS_LB_SF":       { winner: 0, loser: 130_000 },
      "CHAMPIONS_LB_R2":       { winner: 0, loser: 85_000 },
      "CHAMPIONS_LB_R1":       { winner: 0, loser: 50_000 },
    };
    if (aiResults.length > 0) {
      const writes: import("@/generated/prisma/client").Prisma.PrismaPromise<unknown>[] = [];
      for (const r of aiResults) {
        writes.push(
          ctx.prisma.match.update({
            where: { id: r.matchId },
            data: {
              isPlayed: true,
              playedAt,
              winnerId: r.winnerId,
              score: { team1: r.score.team1, team2: r.score.team2 },
              maps: r.maps as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
            },
          }),
        );
      }
      const teamDeltas = new Map<
        string,
        { wins: number; losses: number; champPts: number; budget: number }
      >();
      const ensure = (id: string) => {
        let d = teamDeltas.get(id);
        if (!d) {
          d = { wins: 0, losses: 0, champPts: 0, budget: 0 };
          teamDeltas.set(id, d);
        }
        return d;
      };
      for (const r of aiResults) {
        ensure(r.winnerId).wins += 1;
        ensure(r.loserId).losses += 1;
        if (r.isStage12Group) ensure(r.winnerId).champPts += 1;
        const fp = finalsPointsConfig[r.stageId];
        if (fp) {
          if (fp.winner > 0) ensure(r.winnerId).champPts += fp.winner;
          if (fp.loser > 0) ensure(r.loserId).champPts += fp.loser;
        }
        const pz = prizePayouts[r.stageId];
        if (pz) {
          if (pz.winner > 0) ensure(r.winnerId).budget += pz.winner;
          if (pz.loser > 0) ensure(r.loserId).budget += pz.loser;
        }
      }
      for (const [teamId, d] of teamDeltas) {
        const data: {
          wins?: { increment: number };
          losses?: { increment: number };
          champPts?: { increment: number };
          budget?: { increment: number };
        } = {};
        if (d.wins) data.wins = { increment: d.wins };
        if (d.losses) data.losses = { increment: d.losses };
        if (d.champPts) data.champPts = { increment: d.champPts };
        if (d.budget) data.budget = { increment: d.budget };
        writes.push(
          ctx.prisma.team.update({
            where: { id: teamId },
            data,
          }),
        );
      }
      // Same trick as stat rolling batch: $transaction serializes each UPDATE
      // on the connection. Chunk into parallel groups instead — same writes,
      // but Prisma's pool fans them out (~10× faster on Neon at 50ms RTT).
      // Atomicity isn't load-bearing here: a partial failure is recoverable by
      // re-running advanceDay (the matches stay isPlayed and dedup via id).
      const CHUNK = 10;
      for (let i = 0; i < writes.length; i += CHUNK) {
        await Promise.all(writes.slice(i, i + CHUNK));
      }
    }

    for (const r of aiResults) {
      simulatedResults.push({
        matchId: r.matchId,
        team1Id: r.team1Id,
        team2Id: r.team2Id,
        team1Name: r.team1Name,
        team2Name: r.team2Name,
        team1Tag: r.team1Tag,
        team2Tag: r.team2Tag,
        team1LogoUrl: r.team1LogoUrl,
        team2LogoUrl: r.team2LogoUrl,
        winnerId: r.winnerId,
        score: r.score,
        isUserMatch: false,
        stageId: r.stageId,
        needsVeto: false,
      });
    }

    mark("write match results (phase 2 tx)");
    // Progress bracket/Swiss — check completion PER REGION for Kickoff, globally for international
    // Each unique stageId in `completedRounds` is independent — progressing
    // KICKOFF_UB_R1 doesn't touch the same rows as KICKOFF_MID_R1 etc. Fan out
    // the outer loop so the per-stage queries overlap. Inside, per-region
    // progression for regional stages also fans out (4 regions, independent
    // team sets). Each progressXxx still does its own sequential queries, but
    // overlapping 4 of them roughly quarters the wall-clock cost.
    await Promise.all(
      [...completedRounds].map(async (roundId) => {
        const isSwiss = roundId.includes("_SWISS_R");
        const isEwcMain =
          roundId.startsWith("EWC_GROUP_") ||
          roundId === "EWC_QF" ||
          roundId === "EWC_SF" ||
          roundId === "EWC_GRAND_FINAL";
        const isMastersBracket =
          (roundId.startsWith("MASTERS_") ||
            roundId.startsWith("EWC_") ||
            roundId.startsWith("CHAMPIONS_")) &&
          !isSwiss &&
          !isEwcMain;

        if (isSwiss) {
          const swissRoundMatches = await ctx.prisma.match.findMany({
            where: { saveId: ctx.save.id, stageId: roundId, season: season.number },
          });
          const allPlayed = swissRoundMatches.length > 0 && swissRoundMatches.every((m) => m.isPlayed);
          if (allPlayed) {
            await progressSwiss(ctx.prisma, ctx.save.id, roundId, season.number, newDay);
          }
          return;
        }
        if (isEwcMain) {
          const ewcMatches = await ctx.prisma.match.findMany({
            where: { saveId: ctx.save.id, stageId: roundId, season: season.number },
          });
          const allPlayed = ewcMatches.length > 0 && ewcMatches.every((m) => m.isPlayed);
          if (allPlayed) {
            await progressEwcMain(ctx.prisma, ctx.save.id, roundId, season.number, newDay);
          }
          return;
        }
        if (isMastersBracket) {
          const bracketMatches = await ctx.prisma.match.findMany({
            where: { saveId: ctx.save.id, stageId: roundId, season: season.number },
          });
          const allPlayed = bracketMatches.length > 0 && bracketMatches.every((m) => m.isPlayed);
          if (allPlayed) {
            await progressMastersBracket(ctx.prisma, ctx.save.id, roundId, season.number, newDay);
          }
          return;
        }

        // Regional (Kickoff / Stage groups / Stage playoffs / EWC quals)
        const allRoundMatches = await ctx.prisma.match.findMany({
          where: { saveId: ctx.save.id, stageId: roundId, season: season.number },
          include: { team1: { select: { region: true } } },
        });
        const byRegion = new Map<string, { played: number; total: number }>();
        for (const m of allRoundMatches) {
          const r = m.team1.region;
          const cur = byRegion.get(r) ?? { played: 0, total: 0 };
          cur.total++;
          if (m.isPlayed) cur.played++;
          byRegion.set(r, cur);
        }

        await Promise.all(
          [...byRegion.entries()].map(async ([region, counts]) => {
            if (counts.played !== counts.total || counts.total === 0) return;
            if (roundId.startsWith("KICKOFF")) {
              await progressBracket(ctx.prisma, ctx.save.id, roundId, region as Region, season.number, newDay);
            }
            if (roundId === "STAGE_1_ALPHA" || roundId === "STAGE_1_OMEGA") {
              await progressRegionalStage(ctx.prisma, ctx.save.id, "STAGE_1", region as Region, season.number, newDay);
              await initializeEwcQualifierS1(ctx.prisma, ctx.save.id, region as Region, season.number, newDay);
            }
            if (roundId === "STAGE_2_ALPHA" || roundId === "STAGE_2_OMEGA") {
              await progressRegionalStage(ctx.prisma, ctx.save.id, "STAGE_2", region as Region, season.number, newDay);
            }
            if (roundId.includes("_PO_")) {
              await progressRegionalPlayoffs(ctx.prisma, ctx.save.id, roundId, region as Region, season.number, newDay);
              // When the Stage 1 PO GF completes, the regional PO #1 becomes
              // known. That's a precondition for `initializeEwcQualifierS2`
              // (so the qualifier seeds aren't polluted by the eventual direct
              // EWC qualifier). Try to fire it here — idempotent, so a no-op
              // if S1 LB Final hasn't created the S2 yet.
              if (roundId === "STAGE_1_PO_GF") {
                await initializeEwcQualifierS2(ctx.prisma, ctx.save.id, region as Region, season.number, newDay);
              }
            }
            if (roundId.startsWith("EWC_QUAL_S1_")) {
              await progressEwcQualifierS1(ctx.prisma, ctx.save.id, roundId, region as Region, season.number, newDay);
              if (roundId === "EWC_QUAL_S1_LB_FINAL") {
                await initializeEwcQualifierS2(ctx.prisma, ctx.save.id, region as Region, season.number, newDay);
              }
            }
            if (roundId.startsWith("EWC_QUAL_S2_")) {
              await progressEwcQualifierS2(ctx.prisma, ctx.save.id, roundId, region as Region, season.number, newDay);
            }
          }),
        );
      }),
    );

    // Final-placement champPts + prize money are now applied in the Phase 2
    // mega-transaction above (via teamDeltas). No separate loops needed.
    mark("progress brackets");

    // ═══════════════════════════════════════════════════════════
    // Stage transitions
    // ═══════════════════════════════════════════════════════════

    // KICKOFF → MASTERS_1
    if (season.currentStage === "KICKOFF") {
      const kickoffFinals = await ctx.prisma.match.findMany({
        where: {
          saveId: ctx.save.id,
          stageId: { in: ["KICKOFF_UB_FINAL", "KICKOFF_MID_FINAL", "KICKOFF_LB_FINAL"] },
          season: season.number,
        },
      });
      const allFinalsPlayed = kickoffFinals.length >= 12 && kickoffFinals.every((m) => m.isPlayed);
      if (allFinalsPlayed) {
        await ctx.prisma.season.update({
          where: { id: season.id },
          data: { currentStage: "MASTERS_1" },
        });
        // Initialize Masters Swiss R1
        await initializeMasters(ctx.prisma, ctx.save.id, season.number, "MASTERS_1", "KICKOFF");
        await generateMetaPatch(ctx.prisma, season.number, "MASTERS_1");
      }
    }

    // MASTERS_1 → STAGE_1
    if (season.currentStage === "MASTERS_1") {
      const grandFinal = await ctx.prisma.match.findFirst({
        where: { saveId: ctx.save.id, stageId: "MASTERS_1_GRAND_FINAL", season: season.number, isPlayed: true },
      });
      if (grandFinal) {
        await ctx.prisma.season.update({
          where: { id: season.id },
          data: { currentStage: "STAGE_1" },
        });
        await initializeRegionalStage(ctx.prisma, ctx.save.id, season.number, "STAGE_1");
        await generateMetaPatch(ctx.prisma, season.number, "STAGE_1");
      }
    }

    // STAGE_1 → MASTERS_2
    // Transition when all 4 regional Grand Finals are played (one per region)
    if (season.currentStage === "STAGE_1") {
      const gfMatches = await ctx.prisma.match.findMany({
        where: { saveId: ctx.save.id, stageId: "STAGE_1_PO_GF", season: season.number },
      });
      // We need 4 GFs (one per region) all played
      const allGfDone = gfMatches.length >= 4 && gfMatches.every((m) => m.isPlayed);
      if (allGfDone) {
        await ctx.prisma.season.update({
          where: { id: season.id },
          data: { currentStage: "MASTERS_2" },
        });
        await initializeMasters(ctx.prisma, ctx.save.id, season.number, "MASTERS_2", "STAGE_1");
        await generateMetaPatch(ctx.prisma, season.number, "MASTERS_2");
      }
    }

    // MASTERS_2 → STAGE_2
    if (season.currentStage === "MASTERS_2") {
      const grandFinal = await ctx.prisma.match.findFirst({
        where: { saveId: ctx.save.id, stageId: "MASTERS_2_GRAND_FINAL", season: season.number, isPlayed: true },
      });
      if (grandFinal) {
        await ctx.prisma.season.update({
          where: { id: season.id },
          data: { currentStage: "STAGE_2" },
        });
        await initializeRegionalStage(ctx.prisma, ctx.save.id, season.number, "STAGE_2");
        await generateMetaPatch(ctx.prisma, season.number, "STAGE_2");
      }
    }

    // STAGE_2 → EWC
    if (season.currentStage === "STAGE_2") {
      const gfMatches = await ctx.prisma.match.findMany({
        where: { saveId: ctx.save.id, stageId: "STAGE_2_PO_GF", season: season.number },
      });
      const allDone = gfMatches.length >= 4 && gfMatches.every((m) => m.isPlayed);
      if (allDone) {
        await ctx.prisma.season.update({
          where: { id: season.id },
          data: { currentStage: "EWC" },
        });
        // EWC main = 3 qualifiers par région issus du Stage 2 Qualifier
        // (2 UB R2 winners + 1 LB Final winner). Si le Stage 2 Qualifier
        // n'est pas complet, fallback au pull top 3 du Stage 1.
        const ewcMainRes = await initializeEwcMainFromQualifiers(
          ctx.prisma, ctx.save.id, season.number,
        );
        if (ewcMainRes.matchesScheduled === 0) {
          await initializeInternationalEvent(
            ctx.prisma, ctx.save.id, season.number, "EWC", 3, "STAGE_1",
          );
        }
        await generateMetaPatch(ctx.prisma, season.number, "EWC");
      }
    }

    // EWC → CHAMPIONS
    if (season.currentStage === "EWC") {
      const grandFinal = await ctx.prisma.match.findFirst({
        where: { saveId: ctx.save.id, stageId: "EWC_GRAND_FINAL", season: season.number, isPlayed: true },
      });
      if (grandFinal) {
        // Defending champion : reset tous les flags + set le winner.
        // Bypassera le qualifier l'année prochaine.
        if (grandFinal.winnerId) {
          await ctx.prisma.team.updateMany({
            where: { saveId: ctx.save.id, isEwcDefendingChampion: true },
            data: { isEwcDefendingChampion: false },
          });
          await ctx.prisma.team.update({
            where: { id: grandFinal.winnerId },
            data: { isEwcDefendingChampion: true },
          });
        }

        await ctx.prisma.season.update({
          where: { id: season.id },
          data: { currentStage: "CHAMPIONS" },
        });
        // Champions: 4 teams per region
        await initializeInternationalEvent(ctx.prisma, ctx.save.id, season.number, "CHAMPIONS", 4, "STAGE_2");
        await generateMetaPatch(ctx.prisma, season.number, "CHAMPIONS");
      }
    }

    // CHAMPIONS → OFFSEASON
    let justEnteredOffseason = false;
    if (season.currentStage === "CHAMPIONS") {
      const grandFinal = await ctx.prisma.match.findFirst({
        where: { saveId: ctx.save.id, stageId: "CHAMPIONS_GRAND_FINAL", season: season.number, isPlayed: true },
      });
      if (grandFinal) {
        await ctx.prisma.season.update({
          where: { id: season.id },
          data: { currentStage: "OFFSEASON" },
        });
        justEnteredOffseason = true;
      }
    }

    // ═══════════════════════════════════════════════════════════
    // OFFSEASON hooks — contract expiry + AI FA signings
    // ═══════════════════════════════════════════════════════════

    // On transition into OFFSEASON: expire all contracts that have run out
    if (justEnteredOffseason) {
      await ctx.prisma.player.updateMany({
        where: {
          teamId: { not: null },
          isRetired: false,
          OR: [
            { contractEndSeason: { lt: season.number } },
            {
              contractEndSeason: season.number,
              contractEndWeek: { lte: newWeek },
            },
          ],
        },
        data: { teamId: null },
      });
    }

    // During OFFSEASON: AI teams sign free agents with good stats at random
    if (season.currentStage === "OFFSEASON" || justEnteredOffseason) {
      // FAs in this save are players without a team but whose previous team belonged
      // to this save. After contract expiry above we set teamId=null, so we have to
      // identify "this save's FAs" via their region + the templates that exist here.
      // Simpler: take FAs from the global pool but restrict signing to this save's teams.
      const freeAgents = await ctx.prisma.player.findMany({
        where: { teamId: null, isRetired: false },
        orderBy: { acs: "desc" },
        take: 30,
      });
      // Up to 3 FA signings per advanceDay tick during offseason
      const maxSigns = 3;
      let signs = 0;
      for (const fa of freeAgents) {
        if (signs >= maxSigns) break;
        if (Math.random() > 0.35) continue; // ~35% chance per tick per FA

        // Pick a random AI team in this save + same region with budget + <7 players
        const aiTeams = await ctx.prisma.team.findMany({
          where: {
            saveId: ctx.save.id,
            region: fa.region,
            isPlayerTeam: false,
          },
          include: { players: true },
        });
        const candidates = aiTeams.filter(
          (t: { id: string; budget: number; players: unknown[] }) =>
            t.budget >= fa.salary * 4 && (t.players as unknown[]).length < 7,
        );
        if (candidates.length === 0) continue;
        const aiTeam = candidates[Math.floor(Math.random() * candidates.length)];

        // Commit the signing
        const totalWeeks = newWeek + 52;
        const contractEndSeason = season.number + Math.floor(totalWeeks / 52);
        const contractEndWeek = totalWeeks % 52 === 0 ? 52 : totalWeeks % 52;
        await ctx.prisma.$transaction([
          ctx.prisma.team.update({
            where: { id: aiTeam.id },
            data: { budget: { decrement: fa.salary * 4 } },
          }),
          ctx.prisma.player.update({
            where: { id: fa.id },
            data: {
              teamId: aiTeam.id,
              contractEndSeason,
              contractEndWeek,
              buyoutClause: Math.ceil(fa.salary * 30),
              joinedWeek: newWeek,
            },
          }),
          ctx.prisma.transferOffer.create({
            data: {
              playerId: fa.id,
              fromTeamId: aiTeam.id,
              toTeamId: null,
              offerType: "FREE_AGENT_SIGNING",
              transferFee: 0,
              proposedSalary: fa.salary,
              contractLengthWeeks: 52,
              status: "ACCEPTED",
              week: newWeek,
              season: season.number,
            },
          }),
        ]);
        signs++;
      }
    }

    // ═══════════════════════════════════════════════════════════
    // OFFSEASON → new season roll-over after 8 weeks
    // ═══════════════════════════════════════════════════════════
    let seasonRolledOver: null | {
      newSeasonNumber: number;
      retiredCount: number;
      rookiesCreated: number;
      matchesScheduled: number;
    } = null;
    if (season.currentStage === "OFFSEASON") {
      // Track the start of off-season by finding the earliest day with stage=OFFSEASON.
      // Off-season duration is 8 weeks (56 days) per VCT_STAGES.
      // Approximation: if we've been in OFFSEASON for >= 56 days relative to previous stage end,
      // roll over. Since we don't track off-season start, use season.currentWeek since transition.
      // Simpler/robust: check if any CHAMPIONS_GRAND_FINAL exists with a day and whether newDay is
      // at least 56 days after that.
      const finalMatch = await ctx.prisma.match.findFirst({
        where: {
          saveId: ctx.save.id,
          stageId: "CHAMPIONS_GRAND_FINAL",
          season: season.number,
          isPlayed: true,
        },
        orderBy: { day: "desc" },
      });
      const finalDay = finalMatch?.day ?? 0;
      if (finalDay > 0 && newDay - finalDay >= 56) {
        seasonRolledOver = await rollOffSeason(ctx.prisma, ctx.save.id, season.id, season.number);
      }
    }

    mark("stage transitions + offseason");
    // ═══════════════════════════════════════════════════════════
    // Mercato V1 ticks — expire stale offers (daily), recompute happiness +
    // run IA transfer activity on weekly tick (first day of a new week).
    //
    // The TransferOffer chain (expire → run IA → evaluate FA) must stay
    // sequential — each step's writes feed the next read. Staff hires touch
    // a different table and are safe to run in parallel with that chain.
    // ═══════════════════════════════════════════════════════════
    await Promise.all([
      (async () => {
        await expireStaleOffers(ctx.prisma);
        await runAiOfferResolutions({ prisma: ctx.prisma, save: { id: ctx.save.id } });
        await evaluateFreeAgentDecisions({ prisma: ctx.prisma, save: { id: ctx.save.id } });
      })(),
      evaluatePendingStaffHires(ctx.prisma, ctx.save.id, newDay),
    ]);

    const prevWeek = Math.ceil(season.currentDay / 7);
    const isNewWeekTick = newWeek > prevWeek;
    // Form momentum decay quotidien — 0.1 par advance day vers 0.
    // Les joueurs qui ont matché aujourd'hui auront leur momentum réécrit
    // par applyStatRollingUpdate juste après — pas de race condition.
    // Sur 10 jours sans match, perd 1 point. 3 semaines de blessure ≈ -2.1.
    await ctx.prisma.$executeRaw`
      UPDATE "Player"
      SET "formMomentum" = CASE
        WHEN "formMomentum" > 0.1 THEN "formMomentum" - 0.1
        WHEN "formMomentum" < -0.1 THEN "formMomentum" + 0.1
        ELSE 0
      END
      WHERE "formMomentum" != 0
        AND "teamId" IN (SELECT id FROM "Team" WHERE "saveId" = ${ctx.save.id})
    `;

    if (isNewWeekTick) {
      const { transitions } = await recomputeHappinessAll(
        ctx.prisma,
        ctx.save.id,
        newWeek,
        season.number,
      );
      if (userTeam) {
        await generateHappinessMessages(
          ctx.prisma,
          ctx.save.id,
          userTeam.id,
          transitions,
          newWeek,
          season.number,
        );
      }

      // Mercato V3 — relationships tick + mentor stat growth
      await runRelationshipsTick(ctx.prisma, ctx.save.id, newWeek, season.number);
      await applyMentorStatGrowth(ctx.prisma, ctx.save.id);

      // Mercato V4 — recomputeAllOveralls is intentionally disabled now that
      // attributes/overall/playstyleRole come from the imported sheet (source
      // of truth). Re-running it every week was both expensive (~290 UPDATEs)
      // and destructive (it overwrote the manager's chosen playstyle role
      // with a percentile-derived guess). Mentor stat bumps still surface in
      // base stats; overall is recomputed on-demand by player.attributes.

      // V4.1 — weekly snapshot of player stats for historical variance
      await snapshotPlayerStats(ctx.prisma, ctx.save.id, newWeek, season.number);

      // ── Riot in-game bundle quarterly payout ──
      // Fires on weeks 1 / 14 / 27 / 40. Each team gets bundleRevenueAnnual/4,
      // split 35% transferBudget / 65% operational. Tracking via
      // `lastBundleQuarter` ensures idempotency: even if a quarter Monday is
      // advanced past (e.g. multi-day advance), it pays out exactly once.
      if (isQuarterStartWeek(newWeek)) {
        const qIdx = quarterIndex(season.number, newWeek);
        const eligibleTeams = await ctx.prisma.team.findMany({
          where: {
            saveId: ctx.save.id,
            bundleRevenueAnnual: { gt: 0 },
            lastBundleQuarter: { lt: qIdx },
          },
          select: { id: true, bundleRevenueAnnual: true },
        });
        if (eligibleTeams.length > 0) {
          await ctx.prisma.$transaction(
            eligibleTeams.map((t) => {
              const payout = computeQuarterlyBundle(t.bundleRevenueAnnual);
              return ctx.prisma.team.update({
                where: { id: t.id },
                data: {
                  transferBudget: { increment: payout.toTransfer },
                  budget: { increment: payout.toOperational },
                  lastBundleQuarter: qIdx,
                },
              });
            }),
          );
        }
      }

      const before = userTeam
        ? await ctx.prisma.transferOffer.findMany({
            where: { toTeamId: userTeam.id, status: "PENDING" },
            select: { id: true },
          })
        : [];
      const beforeIds = new Set(before.map((o) => o.id));

      await runAiTransferActivity(ctx.prisma, ctx.save.id, newWeek, season.number);

      // Inbox notifs for newly created IA → user offers — batched in one
      // createMany so a busy mercato week doesn't fire N sequential creates.
      if (userTeam) {
        const after = await ctx.prisma.transferOffer.findMany({
          where: { toTeamId: userTeam.id, status: "PENDING" },
          include: {
            player: { select: { id: true, ign: true } },
            fromTeam: { select: { name: true, tag: true } },
          },
          orderBy: { createdAt: "desc" },
        });
        const newMessages = after
          .filter((o) => !beforeIds.has(o.id))
          .map((o) => ({
            saveId: ctx.save.id,
            teamId: userTeam.id,
            category: "MARKET" as const,
            fromName: o.fromTeam?.name ?? "Unknown",
            fromRole: "GM",
            subject: `${o.fromTeam?.tag ?? "???"} want ${o.player?.ign ?? "your player"}`,
            body: `We've put an offer on the table. Fee $${o.transferFee.toLocaleString()}, salary $${o.proposedSalary.toLocaleString()}/wk for ${o.contractLengthWeeks} weeks.`,
            eventType: "BUYOUT_RECEIVED",
            eventData: { offerId: o.id } as import("@/generated/prisma/client").Prisma.InputJsonValue,
            requiresAction: true,
            week: newWeek,
            season: season.number,
          }));
        if (newMessages.length > 0) {
          await ctx.prisma.message.createMany({ data: newMessages });
        }
      }
    }

    // ── Sponsor win bonuses for completed (AI) matches played today ──
    const winnersToday = new Set<string>();
    for (const r of simulatedResults) {
      if (r.winnerId && !r.isUserMatch) winnersToday.add(r.winnerId);
    }
    if (winnersToday.size > 0) {
      const winningTeams = await ctx.prisma.team.findMany({
        where: { id: { in: Array.from(winnersToday) } },
        include: { sponsors: { where: { isActive: true }, select: { winBonus: true } } },
      });
      const winBonusUpdates: Array<ReturnType<typeof ctx.prisma.team.update>> = [];
      for (const t of winningTeams) {
        const totalBonus = t.sponsors.reduce((sum, s) => sum + s.winBonus, 0);
        if (totalBonus > 0) {
          winBonusUpdates.push(
            ctx.prisma.team.update({
              where: { id: t.id },
              data: { budget: { increment: totalBonus } },
            }),
          );
        }
      }
      if (winBonusUpdates.length > 0) {
        await ctx.prisma.$transaction(winBonusUpdates);
      }
    }

    mark("mercato daily ticks");
    // ── Sponsor champPts bonuses when finals are decided ──
    // Batched: 1 findMany (all involved teams + sponsors) + 1 transaction.
    // Used to be N teams × 2 queries each (findUnique + update) sequentially.
    {
      const ptsByTeam = new Map<string, number>();
      for (const result of simulatedResults) {
        const pointsCfg = finalsPointsConfig[result.stageId];
        if (!pointsCfg || !result.winnerId) continue;
        const loserId = result.winnerId === result.team1Id ? result.team2Id : result.team1Id;
        if (pointsCfg.winner > 0) {
          ptsByTeam.set(result.winnerId, (ptsByTeam.get(result.winnerId) ?? 0) + pointsCfg.winner);
        }
        if (pointsCfg.loser > 0) {
          ptsByTeam.set(loserId, (ptsByTeam.get(loserId) ?? 0) + pointsCfg.loser);
        }
      }
      if (ptsByTeam.size > 0) {
        const teams = await ctx.prisma.team.findMany({
          where: { id: { in: [...ptsByTeam.keys()] } },
          select: {
            id: true,
            sponsors: { where: { isActive: true }, select: { champPtsBonus: true } },
          },
        });
        const bonusWrites: import("@/generated/prisma/client").Prisma.PrismaPromise<unknown>[] = [];
        for (const t of teams) {
          const pts = ptsByTeam.get(t.id) ?? 0;
          const bonus = t.sponsors.reduce((s, sp) => s + sp.champPtsBonus * pts, 0);
          if (bonus > 0) {
            bonusWrites.push(
              ctx.prisma.team.update({
                where: { id: t.id },
                data: { budget: { increment: bonus } },
              }),
            );
          }
        }
        if (bonusWrites.length > 0) {
          await ctx.prisma.$transaction(bonusWrites);
        }
      }
    }

    // Weekly budget flow on Mondays: player salaries + coach salary - sponsor income
    let salaryDeductions: Array<{
      teamId: string;
      teamName: string;
      totalSalary: number;
      coachSalary: number;
      sponsorIncome: number;
      newBudget: number;
    }> = [];
    if (dayOfWeek(newDay, season.year) === 1) {
      const allTeams = await ctx.prisma.team.findMany({
        where: { saveId: ctx.save.id },
        include: {
          players: { where: { isActive: true }, select: { salary: true } },
          coach: { select: { salary: true } },
          staff: { select: { salary: true } },
          sponsors: { where: { isActive: true }, select: { weeklyPayment: true } },
        },
      });
      const investorEvents: Array<{ teamId: string; teamName: string; kind: "INVESTOR_WARNING" | "ORG_BANKRUPTCY"; debt: number }> = [];

      const budgetUpdates: Array<ReturnType<typeof ctx.prisma.team.update>> = [];
      for (const t of allTeams) {
        const totalSalary = t.players.reduce((sum, p) => sum + p.salary, 0);
        const coachSalary = t.coach?.salary ?? 0;
        // FM-style staff wages — sum across Manager / Analyst / Fitness /
        // additional Coaches stored in the unified Staff table.
        const staffSalary = t.staff.reduce((sum, s) => sum + s.salary, 0);
        const sponsorIncome = t.sponsors.reduce((sum, s) => sum + s.weeklyPayment, 0);
        const totalWageOut = totalSalary + coachSalary + staffSalary;
        if (totalWageOut === 0 && sponsorIncome === 0) continue;

        // Lazy migration — if a team still has the legacy single-budget
        // state, split into the 3 buckets before applying this week's flow.
        let snapshot = {
          budget: t.budget,
          transferBudget: t.transferBudget,
          wageBudgetSeason: t.wageBudgetSeason,
          seasonStartBudget: t.seasonStartBudget,
        };
        let extraSplitFields: { seasonStartBudget?: number } = {};
        if (needsInitialSplit(snapshot)) {
          const split = allocateSeasonBudget({ totalCapital: t.budget });
          snapshot = {
            budget: split.budget,
            transferBudget: split.transferBudget,
            wageBudgetSeason: split.wageBudgetSeason,
            seasonStartBudget: split.seasonStartBudget,
          };
          extraSplitFields = { seasonStartBudget: split.seasonStartBudget };
        }

        // Phase 4 — weekly Riot stipend + merch revenue, on top of sponsors.
        const weeklyRev = computeWeeklyRevenue({ prestige: t.prestige });
        const totalIncome = sponsorIncome + weeklyRev.total;
        // All income → operational (budget). Phase 3 slider lets the board
        // skim a portion off the top for transferBudget refill.
        const afterIncome = {
          ...snapshot,
          budget: snapshot.budget + totalIncome,
        };
        // Wages drain wageBudgetSeason first, fall back to operational.
        const afterWages = debitWages(afterIncome, totalWageOut);

        // Phase 5 — operational outflows (facility + bootcamp). Decrement
        // bootcampWeeksLeft if active.
        const opsCost = computeWeeklyOperationalCost({
          facilityTier: t.facilityTier,
          bootcampWeeksLeft: t.bootcampWeeksLeft,
        });
        afterWages.budget -= opsCost.total;
        const newBootcampWeeks = Math.max(0, t.bootcampWeeksLeft - 1);

        // Phase 2 — debt reconciliation. If operational dropped below 0,
        // accumulate debt; if surplus exists, pay down debt. Fires investor
        // warning at 50% patience, bankruptcy at 100%.
        const reconciled = reconcileDebt(
          {
            budget: afterWages.budget,
            debt: t.debt,
            investorPatience: t.investorPatience,
            isBankrupt: t.isBankrupt,
            lastWarningWeek: t.lastWarningWeek,
          },
          newWeek,
        );
        if (reconciled.event) {
          investorEvents.push({
            teamId: t.id,
            teamName: t.name,
            kind: reconciled.event.kind,
            debt: reconciled.event.debt,
          });
        }

        budgetUpdates.push(
          ctx.prisma.team.update({
            where: { id: t.id },
            data: {
              budget: reconciled.budget,
              transferBudget: afterWages.transferBudget,
              wageBudgetSeason: afterWages.wageBudgetSeason,
              debt: reconciled.debt,
              isBankrupt: reconciled.isBankrupt,
              lastWarningWeek: reconciled.lastWarningWeek,
              bootcampWeeksLeft: newBootcampWeeks,
              ...extraSplitFields,
            },
          }),
        );
        salaryDeductions.push({
          teamId: t.id,
          teamName: t.name,
          totalSalary,
          coachSalary,
          sponsorIncome,
          newBudget: totalAvailable(afterWages),
        });
      }
      // Batch all team-budget writes in a single round-trip instead of one
      // sequential round-trip per team.
      if (budgetUpdates.length > 0) {
        await ctx.prisma.$transaction(budgetUpdates);
      }

      // Investor events → inbox messages. Only fire for the user's team
      // (AI bankruptcies trigger separately at the league level).
      if (investorEvents.length > 0) {
        const userTeam = await ctx.prisma.team.findFirst({
          where: { saveId: ctx.save.id, isPlayerTeam: true },
          select: { id: true },
        });
        if (userTeam) {
          const userEvents = investorEvents.filter((e) => e.teamId === userTeam.id);
          if (userEvents.length > 0) {
            await ctx.prisma.message.createMany({
              data: userEvents.map((e) => ({
                saveId: ctx.save.id,
                teamId: userTeam.id,
                category: "BOARD" as const,
                fromName: "Board",
                fromRole: "Investor",
                subject:
                  e.kind === "ORG_BANKRUPTCY"
                    ? "Investor pulling out — bankruptcy"
                    : "Investor warning — debt rising",
                body:
                  e.kind === "ORG_BANKRUPTCY"
                    ? `Your accumulated debt of $${e.debt.toLocaleString()} has exceeded the limit. The investor is exiting the org. You have one season to recover.`
                    : `Your debt has reached $${e.debt.toLocaleString()}. The investor is concerned about sustainability — bring the books closer to balance before next quarter.`,
                eventType: e.kind,
                requiresAction: e.kind === "ORG_BANKRUPTCY",
                week: newWeek,
                season: season.number,
              })),
            });
          }
        }
      }

      // ── Scouting V1 — auto-reveal potential for shortlisted players ──
      // Reveal delay scales with the user team's best Analyst skill1
      // (scoutingSpeed). Base = 4 weeks. At skill 100 → 1 week. At skill 0 →
      // 5 weeks. Each team's shortlist uses its OWN analyst, not a global.
      const absWeek = season.number * 52 + newWeek;
      const allShortlists = await ctx.prisma.shortlist.findMany({
        where: {
          saveId: ctx.save.id,
          player: { potentialRevealed: false },
        },
        select: { playerId: true, teamId: true, addedWeek: true },
      });
      if (allShortlists.length > 0) {
        // Pre-compute per-team reveal threshold via best Analyst skill1.
        const teamIds = Array.from(new Set(allShortlists.map((s) => s.teamId)));
        const analysts = await ctx.prisma.staff.findMany({
          where: { teamId: { in: teamIds }, role: "ANALYST" },
          select: { teamId: true, skill1: true },
        });
        const bestAnalystByTeam = new Map<string, number>();
        for (const a of analysts) {
          if (!a.teamId) continue;
          const cur = bestAnalystByTeam.get(a.teamId) ?? 0;
          if (a.skill1 > cur) bestAnalystByTeam.set(a.teamId, a.skill1);
        }
        const playersToReveal: string[] = [];
        for (const s of allShortlists) {
          const skill = bestAnalystByTeam.get(s.teamId) ?? 0;
          // skill 0 → 5w, skill 50 → 3w, skill 100 → 1w. Linear.
          const requiredWeeks = Math.max(1, Math.round(5 - (skill / 100) * 4));
          if (absWeek - s.addedWeek >= requiredWeeks) {
            playersToReveal.push(s.playerId);
          }
        }
        if (playersToReveal.length > 0) {
          await ctx.prisma.player.updateMany({
            where: { id: { in: playersToReveal } },
            data: { potentialRevealed: true },
          });
        }
      }
    }

    // ── Stage transition: clear sponsor + coach offer caches ──
    // Fetch latest season (post-transition) and compare
    const latestSeason = await ctx.prisma.season.findFirst({ where: { isActive: true, saveId: ctx.save.id } });
    if (latestSeason && latestSeason.currentStage !== season.currentStage) {
      invalidateSponsorOffersCache();
      invalidateCoachOffersCache();
    }

    // ── Random events + injury recovery for user team ──
    if (userTeam) {
      const { runRandomEvents, clearExpiredInjuries } = await import("@/server/events/generator");
      await clearExpiredInjuries(ctx.prisma, { season: season.number, week: newWeek });
      await runRandomEvents(ctx.prisma, {
        teamId: userTeam.id,
        season: season.number,
        week: newWeek,
        currentDay: newDay,
      });
    }

    // ── Self-heal bracket progression ──
    // Belt-and-suspenders: scan every stage that's 100% played and re-run its
    // progress function. The progress functions are idempotent (early-return
    // when the successor stage already exists), so this is safe to call every
    // tick. Catches edge cases where the per-resolve dispatch missed a round
    // (older saves, races, code paths bypassing the dispatcher).
    //
    // Perf gate: even though each progressXxx early-returns when the successor
    // exists, it still fires 3-5 queries per fully-played stage just to make
    // that determination. Mid-season we have ~50+ played stages → 200+ queries
    // every advance day for ~zero work. Gate to Mondays + stage transitions so
    // we still cover edge cases without burning 29s/day on idle scans.
    const latestStageEarly = await ctx.prisma.season.findFirst({
      where: { id: season.id },
      select: { currentStage: true },
    });
    const stageJustTransitioned =
      latestStageEarly != null && latestStageEarly.currentStage !== season.currentStage;
    const isMondayTick = dayOfWeek(newDay, season.year) === 1;
    const shouldSelfHeal =
      completedRounds.size > 0 && (stageJustTransitioned || isMondayTick);
    if (shouldSelfHeal) {
      const allMatches = await ctx.prisma.match.findMany({
        where: { saveId: ctx.save.id, season: season.number },
        select: {
          stageId: true,
          isPlayed: true,
          team1: { select: { region: true } },
        },
      });
      // International stages (Masters / EWC / Champions, Swiss + bracket) are
      // cross-region — every match has a different team1.region. Aggregating
      // by (stage, region) would split a single 4-match round into 4 single-
      // match shards and fire `progressSwiss` with partial state. Track those
      // globally by stageId. Regional stages (Kickoff / Stage groups / Stage
      // playoffs) still aggregate per-region because each match belongs to one
      // region's bracket.
      const intlCounts = new Map<string, { played: number; total: number }>();
      const regionalCounts = new Map<string, { played: number; total: number; region: string }>();
      for (const m of allMatches) {
        const stageId = m.stageId;
        const isInternationalStage =
          stageId.startsWith("MASTERS_") ||
          stageId.startsWith("EWC_") ||
          stageId.startsWith("CHAMPIONS_");
        if (isInternationalStage) {
          const cur = intlCounts.get(stageId) ?? { played: 0, total: 0 };
          cur.total++;
          if (m.isPlayed) cur.played++;
          intlCounts.set(stageId, cur);
        } else {
          const key = `${stageId}::${m.team1.region}`;
          const cur = regionalCounts.get(key) ?? { played: 0, total: 0, region: m.team1.region };
          cur.total++;
          if (m.isPlayed) cur.played++;
          regionalCounts.set(key, cur);
        }
      }
      // International progression — one call per fully-played stage.
      for (const [stageId, c] of intlCounts) {
        if (c.played !== c.total || c.total === 0) continue;
        const isSwiss = stageId.includes("_SWISS_R");
        try {
          if (isSwiss) {
            await progressSwiss(ctx.prisma, ctx.save.id, stageId, season.number, newDay);
          } else {
            await progressMastersBracket(ctx.prisma, ctx.save.id, stageId, season.number, newDay);
          }
        } catch {
          // Ignore — a single bad stage shouldn't break the whole advance-day.
        }
      }
      // Regional progression — one call per (stage, region) fully played.
      for (const [key, c] of regionalCounts) {
        if (c.played !== c.total || c.total === 0) continue;
        const [stageId] = key.split("::");
        try {
          if (stageId.startsWith("KICKOFF")) {
            await progressBracket(ctx.prisma, ctx.save.id, stageId, c.region as Region, season.number, newDay);
          } else if (stageId === "STAGE_1_ALPHA" || stageId === "STAGE_1_OMEGA") {
            await progressRegionalStage(ctx.prisma, ctx.save.id, "STAGE_1", c.region as Region, season.number, newDay);
          } else if (stageId === "STAGE_2_ALPHA" || stageId === "STAGE_2_OMEGA") {
            await progressRegionalStage(ctx.prisma, ctx.save.id, "STAGE_2", c.region as Region, season.number, newDay);
          } else if (stageId.includes("_PO_")) {
            await progressRegionalPlayoffs(ctx.prisma, ctx.save.id, stageId, c.region as Region, season.number, newDay);
          }
        } catch {
          // Ignore — a single bad round shouldn't break the whole advance-day.
        }
      }
    }

    mark("end-of-tick (weekly + rounds replay)");
    const totalMs = Date.now() - t0;
    const totalQueries = getQueryCount() - queryAt0;
    const breakdown = marks
      .map((m) => `${m.label} ${m.ms}ms/${m.queries}q`)
      .join(" | ");
    console.log(
      `[advanceDay] day ${newDay} · ${totalMs}ms · ${totalQueries} queries · ${breakdown}`,
    );

    return {
      day: newDay,
      week: newWeek,
      stage: season.currentStage,
      matchesSimulated: simulatedResults.length,
      userMatchPending: simulatedResults.some((r) => r.isUserMatch),
      results: simulatedResults,
      salaryDeductions,
      seasonRolledOver,
      // Server-side timing breakdown — surfaced so the client can console.log
      // it in the browser (avoids having to hunt through Vercel function logs).
      debug: {
        totalMs,
        totalQueries,
        sections: marks,
      },
    };
  }),

  getSchedule: saveProcedure
    .input(z.object({ stage: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const season = await ctx.prisma.season.findFirst({ where: { isActive: true, saveId: ctx.save.id } });
      if (!season) throw new TRPCError({ code: "NOT_FOUND", message: "No active season." });

      // Allow callers to peek at a specific stage (Kickoff, Stage 1 playoffs, an
      // older Masters, etc.) — used by the league page when navigating from the
      // season recap. Falls back to the current stage when no stage is asked.
      const targetStage = input?.stage ?? season.currentStage;
      let matches = await ctx.prisma.match.findMany({
        where: {
          saveId: ctx.save.id,
          season: season.number,
          stageId: { startsWith: targetStage },
        },
        include: {
          team1: { select: { id: true, name: true, tag: true, logoUrl: true, region: true } },
          team2: { select: { id: true, name: true, tag: true, logoUrl: true, region: true } },
        },
        orderBy: [{ day: "asc" }],
      });

      if (matches.length === 0 && !input?.stage) {
        matches = await ctx.prisma.match.findMany({
          where: { saveId: ctx.save.id, season: season.number },
          include: {
            team1: { select: { id: true, name: true, tag: true, logoUrl: true, region: true } },
            team2: { select: { id: true, name: true, tag: true, logoUrl: true, region: true } },
          },
          orderBy: [{ day: "asc" }],
        });
      }

      return matches;
    }),

  /**
   * Season recap — top 3 qualifiés par "split" régional (Kickoff / Stage 1 /
   * Stage 2) pour la région du user + top 2 (finalistes) de chaque tournoi
   * international (Masters 1 / Masters 2 / Champions).
   *
   * Pour les splits régionaux :
   *   - Kickoff : winners de UB Final / MID Final / LB Final
   *   - Stage 1/2 : UB Final winner (#1), GF winner (#2), GF loser (#3)
   *
   * Pour les Masters/Champions : GF winner (#1), GF loser (#2).
   *
   * Renvoie les seasons précédentes aussi pour avoir l'historique.
   */
  recap: saveProcedure.query(async ({ ctx }) => {
    const season = await ctx.prisma.season.findFirst({
      where: { saveId: ctx.save.id, isActive: true },
    });

    type TeamMini = {
      id: string;
      name: string;
      tag: string;
      logoUrl: string | null;
      region: string;
    };

    type SectionRegionalPodium = {
      kind: "REGIONAL_PODIUM";
      title: string;
      regions: Record<string, TeamMini[]>; // top 3 par région
      /** Stage prefix understood by /league?stage=… (e.g. "KICKOFF"). */
      stagePrefix: string;
    };
    type SectionInternationalFinal = {
      kind: "INTERNATIONAL_FINAL";
      title: string;
      city: string | null;
      finalists: TeamMini[]; // [winner, loser]
      stagePrefix: string;
    };
    type SectionQualifiers = {
      kind: "QUALIFIERS";
      title: string;
      subtitle: string;
      regions: Record<string, TeamMini[]>;
      stagePrefix: string;
    };
    type Section = SectionRegionalPodium | SectionInternationalFinal | SectionQualifiers;

    if (!season) {
      return {
        seasonNumber: 0,
        seasonYear: 2026,
        userRegion: "EMEA" as const,
        sections: [] as Section[],
      };
    }

    const userTeam = await ctx.prisma.team.findFirst({
      where: { saveId: ctx.save.id, isPlayerTeam: true },
      select: { region: true },
    });
    const userRegion = userTeam?.region ?? "EMEA";
    const ALL_REGIONS = ["EMEA", "Americas", "Pacific", "China"] as const;

    const teamMiniSelect = {
      id: true, name: true, tag: true, logoUrl: true, region: true,
    } as const;

    /** Winner + loser d'un seul match identifié par stageId (+région optionnelle). */
    async function findFinal(stageId: string, region?: string) {
      const m = await ctx.prisma.match.findFirst({
        where: {
          saveId: ctx.save.id,
          season: season!.number,
          stageId,
          isPlayed: true,
          winnerId: { not: null },
          ...(region ? { team1: { region: region as "EMEA" | "Americas" | "Pacific" | "China" } } : {}),
        },
        include: {
          team1: { select: teamMiniSelect },
          team2: { select: teamMiniSelect },
        },
      });
      if (!m || !m.winnerId) return null;
      const winner = (m.winnerId === m.team1.id ? m.team1 : m.team2) as TeamMini;
      const loser = (m.winnerId === m.team1.id ? m.team2 : m.team1) as TeamMini;
      return { winner, loser };
    }

    /** Top 3 d'un Kickoff régional (UB Final / MID Final / LB Final winners). */
    async function kickoffTop3(region: string): Promise<TeamMini[]> {
      const podium: TeamMini[] = [];
      for (const sid of ["KICKOFF_UB_FINAL", "KICKOFF_MID_FINAL", "KICKOFF_LB_FINAL"]) {
        const r = await findFinal(sid, region);
        if (r?.winner) podium.push(r.winner);
      }
      return podium;
    }

    /** Top 3 d'un Stage régional (PO UB Final winner / GF winner / GF loser). */
    async function stageTop3(stageId: string, region: string): Promise<TeamMini[]> {
      // 1st = GF winner, 2nd = GF loser, 3rd = LB-GF loser (the LB-Final
      // match where the UB-Final loser was dropped down). Falls back to UB
      // Final winner when the GF hasn't been played yet so the section still
      // surfaces the leading team mid-stage.
      const gf = await findFinal(`${stageId}_PO_GF`, region);
      const lbGf = await findFinal(`${stageId}_PO_LB_GF`, region);
      const ubF = await findFinal(`${stageId}_PO_UB_FINAL`, region);
      const podium: TeamMini[] = [];
      if (gf?.winner) podium.push(gf.winner);
      else if (ubF?.winner) podium.push(ubF.winner);
      if (gf?.loser) podium.push(gf.loser);
      if (lbGf?.loser) podium.push(lbGf.loser);
      return podium;
    }

    /** Équipes ayant participé à un tournoi international (groupé par région). */
    async function tournamentQualifiers(stagePrefix: string): Promise<Record<string, TeamMini[]>> {
      const matches = await ctx.prisma.match.findMany({
        where: {
          saveId: ctx.save.id,
          season: season!.number,
          stageId: { startsWith: stagePrefix },
        },
        select: {
          team1: { select: teamMiniSelect },
          team2: { select: teamMiniSelect },
        },
      });
      const byRegion: Record<string, Map<string, TeamMini>> = {
        EMEA: new Map(), Americas: new Map(), Pacific: new Map(), China: new Map(),
      };
      for (const m of matches) {
        for (const t of [m.team1, m.team2] as TeamMini[]) {
          if (t && byRegion[t.region]) byRegion[t.region].set(t.id, t);
        }
      }
      return Object.fromEntries(
        Object.entries(byRegion).map(([reg, map]) => [reg, Array.from(map.values())]),
      );
    }

    const sections: Section[] = [];

    // 1. Kickoff regional podiums
    const kickoffRegions: Record<string, TeamMini[]> = {};
    for (const r of ALL_REGIONS) kickoffRegions[r] = await kickoffTop3(r);
    if (Object.values(kickoffRegions).some((v) => v.length > 0)) {
      sections.push({ kind: "REGIONAL_PODIUM", title: "Kickoff — Top 3 régional", regions: kickoffRegions, stagePrefix: "KICKOFF" });
    }

    // 2. Masters 1 finalists
    const m1 = await findFinal("MASTERS_1_GRAND_FINAL");
    if (m1) {
      sections.push({
        kind: "INTERNATIONAL_FINAL",
        title: `Masters ${season.masters1City}`,
        city: season.masters1City,
        finalists: [m1.winner, m1.loser],
        stagePrefix: "MASTERS_1",
      });
    }

    // 3. Stage 1 regional podiums
    const s1Regions: Record<string, TeamMini[]> = {};
    for (const r of ALL_REGIONS) s1Regions[r] = await stageTop3("STAGE_1", r);
    if (Object.values(s1Regions).some((v) => v.length > 0)) {
      sections.push({ kind: "REGIONAL_PODIUM", title: "Stage 1 — Top 3 régional", regions: s1Regions, stagePrefix: "STAGE_1" });
    }

    // 4. EWC qualifiers (par région) — équipes ayant joué au moins 1 match EWC_*
    const ewcQuals = await tournamentQualifiers("EWC_");
    if (Object.values(ewcQuals).some((v) => v.length > 0)) {
      sections.push({
        kind: "QUALIFIERS",
        title: "Qualifiés Esports World Cup",
        subtitle: "Sortis du Stage 2 vers Riyadh",
        regions: ewcQuals,
        stagePrefix: "EWC_QUAL",
      });
    }

    // 5. Masters 2 finalists
    const m2 = await findFinal("MASTERS_2_GRAND_FINAL");
    if (m2) {
      sections.push({
        kind: "INTERNATIONAL_FINAL",
        title: `Masters ${season.masters2City}`,
        city: season.masters2City,
        finalists: [m2.winner, m2.loser],
        stagePrefix: "MASTERS_2",
      });
    }

    // 6. Champions qualifiers (par région) — équipes ayant joué Champions
    const championsQuals = await tournamentQualifiers("CHAMPIONS_");
    if (Object.values(championsQuals).some((v) => v.length > 0)) {
      sections.push({
        kind: "QUALIFIERS",
        title: "Qualifiés Champions",
        subtitle: `Direction ${season.championsCity}`,
        regions: championsQuals,
        stagePrefix: "STAGE_2",
      });
    }

    // 7. Champions finalists
    const champ = await findFinal("CHAMPIONS_GRAND_FINAL");
    if (champ) {
      sections.push({
        kind: "INTERNATIONAL_FINAL",
        title: `Champions ${season.championsCity}`,
        city: season.championsCity,
        finalists: [champ.winner, champ.loser],
        stagePrefix: "CHAMPIONS",
      });
    }

    // 8. EWC finalists
    const ewc = await findFinal("EWC_GRAND_FINAL");
    if (ewc) {
      sections.push({
        kind: "INTERNATIONAL_FINAL",
        title: "Esports World Cup",
        city: "Riyadh",
        finalists: [ewc.winner, ewc.loser],
        stagePrefix: "EWC",
      });
    }

    return {
      seasonNumber: season.number,
      seasonYear: season.year,
      userRegion,
      sections,
    };
  }),
});
