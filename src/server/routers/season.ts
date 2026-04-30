import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, saveProcedure } from "../trpc";
import { simulateMatch } from "@/server/simulation/engine";
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
import { dayOfWeek } from "@/lib/game-date";
import { MASTERS_FORMAT } from "@/constants/masters-format";
import { applyPatchToMeta } from "@/constants/meta";
import { runAiOfferResolutions } from "./transfer";
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

function buildSimTeam(team: Team & { players: Player[] }): SimTeam {
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
    })),
    skillAim: team.skillAim,
    skillUtility: team.skillUtility,
    skillTeamplay: team.skillTeamplay,
    playstyle: team.playstyle,
  };
}

export const seasonRouter = router({
  getCurrent: saveProcedure.query(async ({ ctx }) => {
    const season = await ctx.prisma.season.findFirst({ where: { isActive: true, saveId: ctx.save.id } });
    if (!season) throw new TRPCError({ code: "NOT_FOUND", message: "No active season." });
    return season;
  }),

  advanceDay: saveProcedure.mutation(async ({ ctx }) => {
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
    const todaysMatches = await ctx.prisma.match.findMany({
      where: {
        saveId: ctx.save.id,
        day: { gt: 0, lte: newDay },
        season: season.number,
        isPlayed: false,
        OR: [
          { stageId: { startsWith: stagePrefix } },
          { stageId: stagePrefix },
        ],
      },
      include: {
        team1: { include: { players: { where: { isActive: true } }, coach: true } },
        team2: { include: { players: { where: { isActive: true } }, coach: true } },
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
    }

    // Phase 2 — collapse all of today's match writes into ONE transaction.
    // Previously this was N parallel transactions (3 statements each), so ~3
    // round-trips × N matches against Neon's pooler. One mega-transaction caps
    // the latency at a single round-trip regardless of match count.
    const playedAt = new Date();
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
      // Aggregate per-team win/loss/champPts across all matches today, then
      // emit one update per team. Collapses the 2-update-per-match pattern into
      // ~equal-or-fewer rows total (a team rarely plays >1 match per day, but
      // when they do this dedupes the writes too).
      const teamDeltas = new Map<
        string,
        { wins: number; losses: number; champPts: number }
      >();
      const ensure = (id: string) => {
        let d = teamDeltas.get(id);
        if (!d) {
          d = { wins: 0, losses: 0, champPts: 0 };
          teamDeltas.set(id, d);
        }
        return d;
      };
      for (const r of aiResults) {
        const w = ensure(r.winnerId);
        w.wins += 1;
        if (r.isStage12Group) w.champPts += 1;
        const l = ensure(r.loserId);
        l.losses += 1;
      }
      for (const [teamId, d] of teamDeltas) {
        const data: { wins?: { increment: number }; losses?: { increment: number }; champPts?: { increment: number } } = {};
        if (d.wins) data.wins = { increment: d.wins };
        if (d.losses) data.losses = { increment: d.losses };
        if (d.champPts) data.champPts = { increment: d.champPts };
        writes.push(
          ctx.prisma.team.update({
            where: { id: teamId },
            data,
          }),
        );
      }
      await ctx.prisma.$transaction(writes);
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

    // Progress bracket/Swiss — check completion PER REGION for Kickoff, globally for international
    for (const roundId of completedRounds) {
      const isInternational = roundId.startsWith("MASTERS_") || roundId.startsWith("EWC_") || roundId.startsWith("CHAMPIONS_");
      const isSwiss = roundId.includes("_SWISS_R");
      const isMastersBracket = (roundId.startsWith("MASTERS_") || roundId.startsWith("EWC_") || roundId.startsWith("CHAMPIONS_"))
        && !isSwiss;

      if (isSwiss) {
        // Swiss progression: check if all matches in this round are done
        const swissRoundMatches = await ctx.prisma.match.findMany({
          where: { saveId: ctx.save.id, stageId: roundId, season: season.number },
        });
        const allPlayed = swissRoundMatches.length > 0 && swissRoundMatches.every((m) => m.isPlayed);
        if (allPlayed) {
          await progressSwiss(ctx.prisma, ctx.save.id, roundId, season.number, newDay);
        }
      } else if (isMastersBracket) {
        // International bracket progression (Masters/EWC/Champions)
        const bracketMatches = await ctx.prisma.match.findMany({
          where: { saveId: ctx.save.id, stageId: roundId, season: season.number },
        });
        const allPlayed = bracketMatches.length > 0 && bracketMatches.every((m) => m.isPlayed);
        if (allPlayed) {
          await progressMastersBracket(ctx.prisma, ctx.save.id, roundId, season.number, newDay);
        }
      } else {
        // Kickoff: regional bracket progression — check completion PER REGION
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

        for (const [region, counts] of byRegion) {
          if (counts.played === counts.total && counts.total > 0) {
            // Kickoff bracket progression
            if (roundId.startsWith("KICKOFF")) {
              await progressBracket(ctx.prisma, ctx.save.id, roundId, region as Region, season.number, newDay);
            }
            // Regional stage group phase completion → create playoffs
            if (roundId === "STAGE_1_ALPHA" || roundId === "STAGE_1_OMEGA") {
              await progressRegionalStage(ctx.prisma, ctx.save.id, "STAGE_1", region as Region, season.number, newDay);
            }
            if (roundId === "STAGE_2_ALPHA" || roundId === "STAGE_2_OMEGA") {
              await progressRegionalStage(ctx.prisma, ctx.save.id, "STAGE_2", region as Region, season.number, newDay);
            }
            // Regional playoffs round progression
            if (roundId.includes("_PO_")) {
              await progressRegionalPlayoffs(ctx.prisma, ctx.save.id, roundId, region as Region, season.number, newDay);
            }
          }
        }
      }
    }

    // VCT 2026 Championship Points — max 4 per placement, group stages give 1pt per win.
    // EWC + Champions give NO points.
    // Only award at final elimination — no double-counting.
    const finalsPointsConfig: Record<string, { winner: number; loser: number }> = {
      // Kickoff — triple elim: each final WINNER is awarded their placement.
      // Losers of UB_FINAL and MID_FINAL continue to lower brackets — no double-award.
      // Only LB_FINAL loser gets a placement (4th) since they're fully eliminated.
      "KICKOFF_UB_FINAL": { winner: 4, loser: 0 }, // 1st (loser → MID_FINAL)
      "KICKOFF_MID_FINAL": { winner: 3, loser: 0 }, // 2nd (loser → LB_FINAL)
      "KICKOFF_LB_FINAL": { winner: 2, loser: 1 }, // 3rd / 4th (full elimination)
      // Masters 1: GF = 1st/2nd, LB Final loser = 3rd, LB SF loser = 4th
      "MASTERS_1_GRAND_FINAL": { winner: 4, loser: 3 },
      "MASTERS_1_LB_FINAL": { winner: 0, loser: 2 }, // 3rd place
      "MASTERS_1_LB_SF": { winner: 0, loser: 1 }, // 4th place
      // Masters 2: same
      "MASTERS_2_GRAND_FINAL": { winner: 4, loser: 3 },
      "MASTERS_2_LB_FINAL": { winner: 0, loser: 2 },
      "MASTERS_2_LB_SF": { winner: 0, loser: 1 },
      // Stage 1 playoffs (8-team bracket):
      //   GF → 1st/2nd, LB Final loser → 3rd, LB R2 loser → 4th
      //   LB R1 losers (7th/8th from 4th group seeds) → no points
      "STAGE_1_PO_GF": { winner: 4, loser: 3 },
      "STAGE_1_PO_LB_FINAL": { winner: 0, loser: 2 }, // 3rd
      "STAGE_1_PO_LB_R2": { winner: 0, loser: 1 }, // 4th
      "STAGE_2_PO_GF": { winner: 4, loser: 3 },
      "STAGE_2_PO_LB_FINAL": { winner: 0, loser: 2 },
      "STAGE_2_PO_LB_R2": { winner: 0, loser: 1 },
    };
    for (const result of simulatedResults) {
      const pointsCfg = finalsPointsConfig[result.stageId];
      if (pointsCfg && result.winnerId) {
        const loserId = result.winnerId === result.team1Id ? result.team2Id : result.team1Id;
        const updates = [];
        if (pointsCfg.winner > 0) {
          updates.push(ctx.prisma.team.update({
            where: { id: result.winnerId },
            data: { champPts: { increment: pointsCfg.winner } },
          }));
        }
        if (pointsCfg.loser > 0) {
          updates.push(ctx.prisma.team.update({
            where: { id: loserId },
            data: { champPts: { increment: pointsCfg.loser } },
          }));
        }
        if (updates.length > 0) {
          await ctx.prisma.$transaction(updates);
        }
      }
    }

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
        await initializeInternationalEvent(ctx.prisma, ctx.save.id, season.number, "EWC", 2, "STAGE_2");
        await generateMetaPatch(ctx.prisma, season.number, "EWC");
      }
    }

    // EWC → CHAMPIONS
    if (season.currentStage === "EWC") {
      const grandFinal = await ctx.prisma.match.findFirst({
        where: { saveId: ctx.save.id, stageId: "EWC_GRAND_FINAL", season: season.number, isPlayed: true },
      });
      if (grandFinal) {
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

    // ═══════════════════════════════════════════════════════════
    // Mercato V1 ticks — expire stale offers (daily), recompute happiness +
    // run IA transfer activity on weekly tick (first day of a new week).
    // ═══════════════════════════════════════════════════════════
    await expireStaleOffers(ctx.prisma);

    // Daily: AI resolves pending transfer offers (buyouts etc.)
    await runAiOfferResolutions({ prisma: ctx.prisma, save: { id: ctx.save.id } });

    const prevWeek = Math.ceil(season.currentDay / 7);
    const isNewWeekTick = newWeek > prevWeek;
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

      const before = userTeam
        ? await ctx.prisma.transferOffer.findMany({
            where: { toTeamId: userTeam.id, status: "PENDING" },
            select: { id: true },
          })
        : [];
      const beforeIds = new Set(before.map((o) => o.id));

      await runAiTransferActivity(ctx.prisma, ctx.save.id, newWeek, season.number);

      // Inbox notifs for newly created IA → user offers
      if (userTeam) {
        const after = await ctx.prisma.transferOffer.findMany({
          where: { toTeamId: userTeam.id, status: "PENDING" },
          include: {
            player: { select: { id: true, ign: true } },
            fromTeam: { select: { name: true, tag: true } },
          },
          orderBy: { createdAt: "desc" },
        });
        for (const o of after) {
          if (beforeIds.has(o.id)) continue;
          await ctx.prisma.message.create({
            data: {
              saveId: ctx.save.id,
              teamId: userTeam.id,
              category: "MARKET",
              fromName: o.fromTeam?.name ?? "Unknown",
              fromRole: "GM",
              subject: `${o.fromTeam?.tag ?? "???"} want ${o.player?.ign ?? "your player"}`,
              body: `We've put an offer on the table. Fee $${o.transferFee.toLocaleString()}, salary $${o.proposedSalary.toLocaleString()}/wk for ${o.contractLengthWeeks} weeks.`,
              eventType: "BUYOUT_RECEIVED",
              eventData: { offerId: o.id },
              requiresAction: true,
              week: newWeek,
              season: season.number,
            },
          });
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

    // ── Sponsor champPts bonuses when finals are decided ──
    for (const result of simulatedResults) {
      const pointsCfg = finalsPointsConfig[result.stageId];
      if (!pointsCfg || !result.winnerId) continue;
      const loserId = result.winnerId === result.team1Id ? result.team2Id : result.team1Id;
      const payments: Array<[string, number]> = [];
      if (pointsCfg.winner > 0) payments.push([result.winnerId, pointsCfg.winner]);
      if (pointsCfg.loser > 0) payments.push([loserId, pointsCfg.loser]);
      for (const [teamId, pts] of payments) {
        const t = await ctx.prisma.team.findUnique({
          where: { id: teamId },
          include: {
            sponsors: { where: { isActive: true }, select: { champPtsBonus: true } },
          },
        });
        if (!t) continue;
        const bonus = t.sponsors.reduce((s, sp) => s + sp.champPtsBonus * pts, 0);
        if (bonus > 0) {
          await ctx.prisma.team.update({
            where: { id: teamId },
            data: { budget: { increment: bonus } },
          });
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
    if (dayOfWeek(newDay) === 1) {
      const allTeams = await ctx.prisma.team.findMany({
        where: { saveId: ctx.save.id },
        include: {
          players: { where: { isActive: true }, select: { salary: true } },
          coach: { select: { salary: true } },
          sponsors: { where: { isActive: true }, select: { weeklyPayment: true } },
        },
      });

      const budgetUpdates: Array<ReturnType<typeof ctx.prisma.team.update>> = [];
      for (const t of allTeams) {
        const totalSalary = t.players.reduce((sum, p) => sum + p.salary, 0);
        const coachSalary = t.coach?.salary ?? 0;
        const sponsorIncome = t.sponsors.reduce((sum, s) => sum + s.weeklyPayment, 0);
        const net = sponsorIncome - totalSalary - coachSalary;
        if (net === 0) continue;
        const newBudget = Math.max(0, t.budget + net);
        budgetUpdates.push(
          ctx.prisma.team.update({
            where: { id: t.id },
            data: { budget: newBudget },
          }),
        );
        salaryDeductions.push({
          teamId: t.id,
          teamName: t.name,
          totalSalary,
          coachSalary,
          sponsorIncome,
          newBudget,
        });
      }
      // Batch all team-budget writes in a single round-trip instead of one
      // sequential round-trip per team.
      if (budgetUpdates.length > 0) {
        await ctx.prisma.$transaction(budgetUpdates);
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
    // Perf gate: skip the scan entirely on idle days. If nothing completed
    // today, no successor needs creating — running it anyway costs a full
    // season-wide findMany for nothing.
    if (completedRounds.size > 0) {
      const allMatches = await ctx.prisma.match.findMany({
        where: { saveId: ctx.save.id, season: season.number },
        select: {
          stageId: true,
          isPlayed: true,
          team1: { select: { region: true } },
        },
      });
      const counts = new Map<string, { played: number; total: number; region: string }>();
      for (const m of allMatches) {
        const key = `${m.stageId}::${m.team1.region}`;
        const cur = counts.get(key) ?? { played: 0, total: 0, region: m.team1.region };
        cur.total++;
        if (m.isPlayed) cur.played++;
        counts.set(key, cur);
      }
      for (const [key, c] of counts) {
        if (c.played !== c.total || c.total === 0) continue;
        const [stageId] = key.split("::");
        const isInternational =
          stageId.startsWith("MASTERS_") ||
          stageId.startsWith("EWC_") ||
          stageId.startsWith("CHAMPIONS_");
        const isSwiss = stageId.includes("_SWISS_R");
        try {
          if (isSwiss) {
            await progressSwiss(ctx.prisma, ctx.save.id, stageId, season.number, newDay);
          } else if (isInternational && !isSwiss) {
            await progressMastersBracket(ctx.prisma, ctx.save.id, stageId, season.number, newDay);
          } else if (stageId.startsWith("KICKOFF")) {
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

    return {
      day: newDay,
      week: newWeek,
      stage: season.currentStage,
      matchesSimulated: simulatedResults.length,
      userMatchPending: simulatedResults.some((r) => r.isUserMatch),
      results: simulatedResults,
      salaryDeductions,
      seasonRolledOver,
    };
  }),

  getSchedule: saveProcedure.query(async ({ ctx }) => {
    const season = await ctx.prisma.season.findFirst({ where: { isActive: true, saveId: ctx.save.id } });
    if (!season) throw new TRPCError({ code: "NOT_FOUND", message: "No active season." });

    // Try current stage first, fall back to showing all matches if none found
    let matches = await ctx.prisma.match.findMany({
      where: {
        saveId: ctx.save.id,
        season: season.number,
        stageId: { startsWith: season.currentStage },
      },
      include: {
        team1: { select: { id: true, name: true, tag: true, logoUrl: true, region: true } },
        team2: { select: { id: true, name: true, tag: true, logoUrl: true, region: true } },
      },
      orderBy: [{ day: "asc" }],
    });

    if (matches.length === 0) {
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
});
