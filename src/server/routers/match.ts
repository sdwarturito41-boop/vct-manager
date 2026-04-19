import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { simulateMatch, simulateMap as simulateMapEngine } from "@/server/simulation/engine";
import type { SimTeam } from "@/server/simulation/engine";
import type { Player, Team, Region } from "@/generated/prisma/client";
import { progressBracket } from "@/server/schedule/generate";

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

export const matchRouter = router({
  simulate: protectedProcedure
    .input(z.object({ matchId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const match = await ctx.prisma.match.findUnique({
        where: { id: input.matchId },
        include: {
          team1: { include: { players: { where: { isActive: true } } } },
          team2: { include: { players: { where: { isActive: true } } } },
        },
      });

      if (!match) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Match not found." });
      }

      if (match.isPlayed) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Match already played." });
      }

      if (match.team1.players.length === 0 || match.team2.players.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Both teams must have active players to simulate a match.",
        });
      }

      const simTeam1 = buildSimTeam(match.team1);
      const simTeam2 = buildSimTeam(match.team2);

      const result = simulateMatch(simTeam1, simTeam2, match.format);

      // Update the match record
      const updatedMatch = await ctx.prisma.match.update({
        where: { id: match.id },
        data: {
          isPlayed: true,
          playedAt: new Date(),
          winnerId: result.winnerId,
          score: { team1: result.score.team1, team2: result.score.team2 },
          maps: result.maps.map((m) => ({ ...m })) as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
        },
      });

      // Update team win/loss records
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

      return updatedMatch;
    }),

  simulateWithVeto: protectedProcedure
    .input(z.object({ matchId: z.string(), selectedMaps: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const match = await ctx.prisma.match.findUnique({
        where: { id: input.matchId },
        include: {
          team1: { include: { players: { where: { isActive: true } } } },
          team2: { include: { players: { where: { isActive: true } } } },
        },
      });

      if (!match) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Match not found." });
      }

      if (match.isPlayed) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Match already played." });
      }

      // Verify this is the user's match
      const userTeam = await ctx.prisma.team.findUnique({
        where: { userId: ctx.userId },
      });

      if (!userTeam || (match.team1Id !== userTeam.id && match.team2Id !== userTeam.id)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This is not your team's match." });
      }

      if (match.team1.players.length === 0 || match.team2.players.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Both teams must have active players to simulate a match.",
        });
      }

      const simTeam1 = buildSimTeam(match.team1);
      const simTeam2 = buildSimTeam(match.team2);

      const result = simulateMatch(simTeam1, simTeam2, match.format, input.selectedMaps);

      const updatedMatch = await ctx.prisma.match.update({
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

      return updatedMatch;
    }),

  getById: protectedProcedure
    .input(z.object({ matchId: z.string() }))
    .query(async ({ ctx, input }) => {
      const match = await ctx.prisma.match.findUnique({
        where: { id: input.matchId },
        include: {
          team1: true,
          team2: true,
        },
      });

      if (!match) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Match not found." });
      }

      return match;
    }),

  listByTeam: protectedProcedure
    .input(z.object({ teamId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.match.findMany({
        where: {
          OR: [{ team1Id: input.teamId }, { team2Id: input.teamId }],
        },
        include: { team1: true, team2: true },
        orderBy: [{ week: "asc" }, { day: "asc" }],
      });
    }),

  simulateMap: protectedProcedure
    .input(
      z.object({
        matchId: z.string(),
        mapName: z.string(),
        side: z.enum(["attack", "defense"]),
        playerAgents: z
          .array(z.object({ playerId: z.string(), agentName: z.string() }))
          .length(5),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const match = await ctx.prisma.match.findUnique({
        where: { id: input.matchId },
        include: {
          team1: { include: { players: { where: { isActive: true } } } },
          team2: { include: { players: { where: { isActive: true } } } },
        },
      });

      if (!match) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Match not found." });
      }

      if (match.isPlayed) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Match already played." });
      }

      // Determine which team belongs to the user
      const userTeam = await ctx.prisma.team.findUnique({
        where: { userId: ctx.userId },
      });

      if (!userTeam || (match.team1Id !== userTeam.id && match.team2Id !== userTeam.id)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This is not your team's match." });
      }

      if (match.team1.players.length === 0 || match.team2.players.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Both teams must have active players to simulate a map.",
        });
      }

      const isUserTeam1 = match.team1Id === userTeam.id;

      // If user picks attack, their team should be team1 (attacks first half).
      // If user picks defense, swap so opponent attacks first half.
      let simTeam1: SimTeam;
      let simTeam2: SimTeam;

      if (
        (isUserTeam1 && input.side === "attack") ||
        (!isUserTeam1 && input.side === "defense")
      ) {
        simTeam1 = buildSimTeam(match.team1);
        simTeam2 = buildSimTeam(match.team2);
      } else {
        simTeam1 = buildSimTeam(match.team2);
        simTeam2 = buildSimTeam(match.team1);
      }

      const mapResult = simulateMapEngine(simTeam1, simTeam2, input.mapName);

      // If we swapped teams, swap the scores back so score1 always = match.team1
      const swapped =
        (isUserTeam1 && input.side === "defense") ||
        (!isUserTeam1 && input.side === "attack");

      if (swapped) {
        return {
          map: mapResult.map,
          score1: mapResult.score2,
          score2: mapResult.score1,
          playerStats: mapResult.playerStats,
          highlights: mapResult.highlights,
        };
      }

      return mapResult;
    }),

  finalizeMatch: protectedProcedure
    .input(
      z.object({
        matchId: z.string(),
        maps: z.array(
          z.object({
            map: z.string(),
            score1: z.number(),
            score2: z.number(),
          })
        ),
        winnerId: z.string(),
        score: z.object({
          team1: z.number(),
          team2: z.number(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const match = await ctx.prisma.match.findUnique({
        where: { id: input.matchId },
        include: {
          team1: { select: { id: true, region: true } },
          team2: { select: { id: true } },
        },
      });

      if (!match) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Match not found." });
      }

      if (match.isPlayed) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Match already played." });
      }

      // Verify the user owns one of the teams
      const userTeam = await ctx.prisma.team.findUnique({
        where: { userId: ctx.userId },
      });

      if (!userTeam || (match.team1Id !== userTeam.id && match.team2Id !== userTeam.id)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This is not your team's match." });
      }

      // 1. Update the match record
      const updatedMatch = await ctx.prisma.match.update({
        where: { id: match.id },
        data: {
          isPlayed: true,
          playedAt: new Date(),
          winnerId: input.winnerId,
          score: { team1: input.score.team1, team2: input.score.team2 },
          maps: input.maps.map((m) => ({ ...m })) as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
        },
      });

      // 2. Update team wins/losses
      const loserId = input.winnerId === match.team1Id ? match.team2Id : match.team1Id;

      await ctx.prisma.$transaction([
        ctx.prisma.team.update({
          where: { id: input.winnerId },
          data: { wins: { increment: 1 } },
        }),
        ctx.prisma.team.update({
          where: { id: loserId },
          data: { losses: { increment: 1 } },
        }),
      ]);

      // 3. Check bracket progression
      const season = await ctx.prisma.season.findFirst({ where: { isActive: true } });

      if (season) {
        const allRoundMatches = await ctx.prisma.match.findMany({
          where: { stageId: match.stageId, season: season.number },
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
            await progressBracket(
              ctx.prisma,
              match.stageId,
              region as Region,
              season.number,
              season.currentDay
            );
          }
        }
      }

      return updatedMatch;
    }),
});
