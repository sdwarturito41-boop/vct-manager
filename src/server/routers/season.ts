import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { simulateMatch } from "@/server/simulation/engine";
import type { SimTeam } from "@/server/simulation/engine";
import type { Player, Team, Region } from "@/generated/prisma/client";
import { progressBracket } from "@/server/schedule/generate";
import { dayOfWeek } from "@/lib/game-date";

function buildSimTeam(team: Team & { players: Player[] }): SimTeam {
  return {
    id: team.id,
    name: team.name,
    tag: team.tag,
    players: team.players.map((p) => ({
      id: p.id,
      ign: p.ign,
      acs: p.acs,
      kd: p.kd,
      adr: p.adr,
      kast: p.kast,
      hs: p.hs,
      role: p.role,
    })),
    skillAim: team.skillAim,
    skillUtility: team.skillUtility,
    skillTeamplay: team.skillTeamplay,
  };
}

export const seasonRouter = router({
  getCurrent: protectedProcedure.query(async ({ ctx }) => {
    const season = await ctx.prisma.season.findFirst({ where: { isActive: true } });
    if (!season) throw new TRPCError({ code: "NOT_FOUND", message: "No active season." });
    return season;
  }),

  advanceDay: protectedProcedure.mutation(async ({ ctx }) => {
    const season = await ctx.prisma.season.findFirst({ where: { isActive: true } });
    if (!season) throw new TRPCError({ code: "NOT_FOUND", message: "No active season." });

    // Block if user has unplayed matches (needs to do veto first)
    const userTeam = await ctx.prisma.team.findUnique({ where: { userId: ctx.userId } });
    if (userTeam) {
      const pendingMatch = await ctx.prisma.match.findFirst({
        where: {
          isPlayed: false,
          day: { gt: 0, lte: season.currentDay },
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

    const newDay = season.currentDay + 1;
    const newWeek = Math.ceil(newDay / 7);

    await ctx.prisma.season.update({
      where: { id: season.id },
      data: { currentDay: newDay, currentWeek: newWeek },
    });

    // Find ALL matches for this day (any stageId starting with current stage prefix)
    const stagePrefix = season.currentStage; // e.g. "KICKOFF"
    const todaysMatches = await ctx.prisma.match.findMany({
      where: {
        day: newDay,
        season: season.number,
        isPlayed: false,
        stageId: { startsWith: stagePrefix },
      },
      include: {
        team1: { include: { players: { where: { isActive: true } } } },
        team2: { include: { players: { where: { isActive: true } } } },
      },
    });

    const simulatedResults: Array<{
      matchId: string;
      team1Id: string;
      team2Id: string;
      team1Name: string;
      team2Name: string;
      winnerId: string;
      score: { team1: number; team2: number };
      isUserMatch: boolean;
      stageId: string;
      needsVeto: boolean;
    }> = [];

    // Track which rounds completed (for bracket progression)
    const completedRounds = new Set<string>();

    for (const match of todaysMatches) {
      if (match.team1.players.length === 0 || match.team2.players.length === 0) continue;

      const isUserMatch =
        userTeam !== null &&
        (match.team1Id === userTeam.id || match.team2Id === userTeam.id);

      if (isUserMatch) {
        // Don't auto-simulate user matches - they need veto first
        simulatedResults.push({
          matchId: match.id,
          team1Id: match.team1Id,
          team2Id: match.team2Id,
          team1Name: match.team1.name,
          team2Name: match.team2.name,
          winnerId: "",
          score: { team1: 0, team2: 0 },
          isUserMatch: true,
          stageId: match.stageId,
          needsVeto: true,
        });
        continue; // Skip simulation for this match
      }

      const simTeam1 = buildSimTeam(match.team1);
      const simTeam2 = buildSimTeam(match.team2);
      const result = simulateMatch(simTeam1, simTeam2, match.format);

      await ctx.prisma.match.update({
        where: { id: match.id },
        data: {
          isPlayed: true,
          playedAt: new Date(),
          winnerId: result.winnerId,
          score: { team1: result.score.team1, team2: result.score.team2 },
          maps: result.maps.map((m) => ({ ...m })) as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
        },
      });

      const loserId = result.winnerId === match.team1Id ? match.team2Id : match.team1Id;
      await ctx.prisma.$transaction([
        ctx.prisma.team.update({
          where: { id: result.winnerId },
          data: { wins: { increment: 1 } },
        }),
        ctx.prisma.team.update({
          where: { id: loserId },
          data: { losses: { increment: 1 } },
        }),
      ]);

      completedRounds.add(match.stageId);

      simulatedResults.push({
        matchId: match.id,
        team1Id: match.team1Id,
        team2Id: match.team2Id,
        team1Name: match.team1.name,
        team2Name: match.team2.name,
        winnerId: result.winnerId,
        score: result.score,
        isUserMatch: false,
        stageId: match.stageId,
        needsVeto: false,
      });
    }

    // Progress bracket — check completion PER REGION, not globally
    for (const roundId of completedRounds) {
      // Get all matches for this round, grouped by region
      const allRoundMatches = await ctx.prisma.match.findMany({
        where: { stageId: roundId, season: season.number },
        include: { team1: { select: { region: true } } },
      });

      // Group by region
      const byRegion = new Map<string, { played: number; total: number }>();
      for (const m of allRoundMatches) {
        const r = m.team1.region;
        const cur = byRegion.get(r) ?? { played: 0, total: 0 };
        cur.total++;
        if (m.isPlayed) cur.played++;
        byRegion.set(r, cur);
      }

      // Progress each region whose round is fully complete
      for (const [region, counts] of byRegion) {
        if (counts.played === counts.total && counts.total > 0) {
          await progressBracket(ctx.prisma, roundId, region as Region, season.number, newDay);
        }
      }
    }

    // Award championship points for completed Kickoff finals
    const finalsPointsConfig: Record<string, { winner: number; loser: number }> = {
      "KICKOFF_UB_FINAL": { winner: 4, loser: 3 },
      "KICKOFF_MID_FINAL": { winner: 3, loser: 2 },
      "KICKOFF_LB_FINAL": { winner: 2, loser: 1 },
    };
    for (const result of simulatedResults) {
      const pointsCfg = finalsPointsConfig[result.stageId];
      if (pointsCfg) {
        const loserId = result.winnerId === result.team1Id ? result.team2Id : result.team1Id;
        await ctx.prisma.$transaction([
          ctx.prisma.team.update({
            where: { id: result.winnerId },
            data: { champPts: { increment: pointsCfg.winner } },
          }),
          ctx.prisma.team.update({
            where: { id: loserId },
            data: { champPts: { increment: pointsCfg.loser } },
          }),
        ]);
      }
    }

    // Check if all Kickoff finals are done (4 regions x 3 finals = 12 finals)
    if (season.currentStage === "KICKOFF") {
      const kickoffFinals = await ctx.prisma.match.findMany({
        where: {
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
      }
    }

    // Weekly salary deduction on Mondays
    let salaryDeductions: Array<{ teamId: string; teamName: string; totalSalary: number; newBudget: number }> = [];
    if (dayOfWeek(newDay) === 1) {
      const allTeams = await ctx.prisma.team.findMany({
        include: { players: { where: { isActive: true }, select: { salary: true } } },
      });

      for (const t of allTeams) {
        const totalSalary = t.players.reduce((sum, p) => sum + p.salary, 0);
        if (totalSalary === 0) continue;
        const newBudget = Math.max(0, t.budget - totalSalary);
        await ctx.prisma.team.update({
          where: { id: t.id },
          data: { budget: newBudget },
        });
        salaryDeductions.push({
          teamId: t.id,
          teamName: t.name,
          totalSalary,
          newBudget,
        });
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
    };
  }),

  getSchedule: protectedProcedure.query(async ({ ctx }) => {
    const season = await ctx.prisma.season.findFirst({ where: { isActive: true } });
    if (!season) throw new TRPCError({ code: "NOT_FOUND", message: "No active season." });

    // Try current stage first, fall back to showing all matches if none found
    let matches = await ctx.prisma.match.findMany({
      where: {
        season: season.number,
        stageId: { startsWith: season.currentStage },
      },
      include: {
        team1: { select: { id: true, name: true, tag: true, logoUrl: true, region: true } },
        team2: { select: { id: true, name: true, tag: true, logoUrl: true, region: true } },
      },
      orderBy: [{ day: "asc" }],
    });

    // If no matches for current stage, show the last completed stage (Kickoff)
    if (matches.length === 0) {
      matches = await ctx.prisma.match.findMany({
        where: { season: season.number },
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
