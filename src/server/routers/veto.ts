import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { getActiveMapPool } from "@/constants/maps";
import { AGENT_META, getSynergyFactor, MAP_FACTOR } from "@/constants/meta";

export const vetoRouter = router({
  // Get veto state for a match
  getVetoState: protectedProcedure
    .input(z.object({ matchId: z.string() }))
    .query(async ({ ctx, input }) => {
      const match = await ctx.prisma.match.findUnique({
        where: { id: input.matchId },
        include: {
          team1: {
            select: {
              id: true, name: true, tag: true, logoUrl: true,
              players: {
                where: { isActive: true },
                select: { id: true, ign: true, role: true, imageUrl: true, acs: true },
                orderBy: { acs: "desc" },
                take: 5,
              },
            },
          },
          team2: {
            select: {
              id: true, name: true, tag: true, logoUrl: true,
              players: {
                where: { isActive: true },
                select: { id: true, ign: true, role: true, imageUrl: true, acs: true },
                orderBy: { acs: "desc" },
                take: 5,
              },
            },
          },
        },
      });
      if (!match) throw new TRPCError({ code: "NOT_FOUND" });

      const userTeam = await ctx.prisma.team.findUnique({
        where: { userId: ctx.userId },
      });
      if (!userTeam) throw new TRPCError({ code: "NOT_FOUND" });

      const isTeam1 = match.team1Id === userTeam.id;
      if (!isTeam1 && match.team2Id !== userTeam.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Not your match" });
      }

      // Check if veto already done (maps field populated)
      if (match.maps && Array.isArray(match.maps) && match.maps.length > 0) {
        return { done: true as const, maps: match.maps, match };
      }

      // Get current season stage to determine active map pool
      const season = await ctx.prisma.season.findFirst({ where: { isActive: true } });
      const mapPool = getActiveMapPool(season?.currentStage ?? "KICKOFF");

      return {
        done: false as const,
        mapPool,
        match,
        isTeam1,
        format: match.format,
      };
    }),

  // Execute veto: store the final map selection on the match
  executeVeto: protectedProcedure
    .input(
      z.object({
        matchId: z.string(),
        actions: z.array(
          z.object({
            type: z.enum(["ban", "pick"]),
            map: z.string(),
            team: z.enum(["team1", "team2"]),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const match = await ctx.prisma.match.findUnique({
        where: { id: input.matchId },
      });
      if (!match || match.isPlayed) {
        throw new TRPCError({ code: "BAD_REQUEST" });
      }

      // Derive final maps from veto actions
      const pickedMaps = input.actions
        .filter((a) => a.type === "pick")
        .map((a) => a.map);
      const bannedMaps = input.actions
        .filter((a) => a.type === "ban")
        .map((a) => a.map);
      // Get current season stage to determine active map pool
      const season = await ctx.prisma.season.findFirst({ where: { isActive: true } });
      const currentPool = getActiveMapPool(season?.currentStage ?? "KICKOFF");

      const remaining = currentPool.filter(
        (m) => !bannedMaps.includes(m) && !pickedMaps.includes(m)
      );

      const mapCount = match.format === "BO5" ? 5 : 3;
      const finalMaps = [...pickedMaps, ...remaining].slice(0, mapCount);

      // Store veto data on the match score field temporarily
      await ctx.prisma.match.update({
        where: { id: input.matchId },
        data: {
          score: { veto: input.actions, maps: finalMaps },
        },
      });

      return { maps: finalMaps, actions: input.actions };
    }),

  mapWinProbabilities: protectedProcedure
    .input(z.object({ matchId: z.string() }))
    .query(async ({ ctx, input }) => {
      const match = await ctx.prisma.match.findUnique({
        where: { id: input.matchId },
        include: {
          team1: { include: { players: { where: { isActive: true }, select: { id: true, acs: true, kd: true, adr: true, kast: true, mapFactors: true } } } },
          team2: { include: { players: { where: { isActive: true }, select: { id: true, acs: true, kd: true, adr: true, kast: true, mapFactors: true } } } },
        },
      });
      if (!match) throw new TRPCError({ code: "NOT_FOUND" });

      const userTeam = await ctx.prisma.team.findUnique({ where: { userId: ctx.userId } });
      if (!userTeam) throw new TRPCError({ code: "NOT_FOUND" });
      const isTeam1 = match.team1Id === userTeam.id;

      const season = await ctx.prisma.season.findFirst({ where: { isActive: true } });
      const mapPool = getActiveMapPool(season?.currentStage ?? "KICKOFF");

      function teamMapScore(players: Array<{ acs: number; kast: number; adr: number; kd: number; mapFactors: unknown }>, mapName: string): number {
        if (players.length === 0) return 50;
        let total = 0;
        for (const p of players.slice(0, 5)) {
          const base = p.acs * 0.35 + p.kast * 0.25 + p.adr * 0.20 + p.kd * 0.20;
          const factors = (p.mapFactors ?? {}) as Record<string, number>;
          const mf = factors[mapName] ?? 0.80;
          total += base * mf;
        }
        return total / Math.min(players.length, 5);
      }

      const probabilities: Record<string, number> = {};
      for (const mapName of mapPool) {
        const s1 = teamMapScore(match.team1.players, mapName);
        const s2 = teamMapScore(match.team2.players, mapName);
        const total = s1 + s2;
        const prob1 = total > 0 ? Math.round((s1 / total) * 100) : 50;
        probabilities[mapName] = isTeam1 ? prob1 : 100 - prob1;
      }

      return probabilities;
    }),
});
