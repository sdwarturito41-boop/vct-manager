import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, saveProcedure } from "@/server/trpc";
import { z } from "zod";
import type { TrainingFocus } from "@/generated/prisma/client";

const MAX_SESSIONS_PER_WEEK = 3;
const SESSION_COST = 5000;

const FOCUS_VALUES = ["AGENT_MASTERY", "MAP_FACTOR", "TEAM_SYNERGY", "AIM", "UTILITY"] as const;

export const trainingRouter = router({
  // ── List this week's training sessions for the user's team ──
  listMyTrainings: saveProcedure.query(async ({ ctx }) => {
    const team = await ctx.prisma.team.findUnique({ where: { userId: ctx.userId } });
    if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });

    const season = await ctx.prisma.season.findFirst({ where: { isActive: true, saveId: ctx.save.id } });
    if (!season) throw new TRPCError({ code: "NOT_FOUND", message: "No active season." });

    const sessions = await ctx.prisma.trainingSession.findMany({
      where: {
        teamId: team.id,
        season: season.number,
        week: season.currentWeek,
      },
      orderBy: { createdAt: "desc" },
    });

    const playerIds = [...new Set(sessions.map((s) => s.playerId))];
    const players = await ctx.prisma.player.findMany({
      where: { id: { in: playerIds } },
      select: { id: true, ign: true, role: true, imageUrl: true },
    });
    const playerMap = new Map(players.map((p) => [p.id, p]));

    return sessions.map((s) => ({
      ...s,
      player: playerMap.get(s.playerId) ?? { id: s.playerId, ign: "Unknown", role: "Flex", imageUrl: null },
    }));
  }),

  // ── How many training sessions are left this week ──
  getTrainingSlots: saveProcedure.query(async ({ ctx }) => {
    const team = await ctx.prisma.team.findUnique({ where: { userId: ctx.userId } });
    if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });

    const season = await ctx.prisma.season.findFirst({ where: { isActive: true, saveId: ctx.save.id } });
    if (!season) return { used: 0, max: MAX_SESSIONS_PER_WEEK, week: 0 };

    const used = await ctx.prisma.trainingSession.count({
      where: {
        teamId: team.id,
        season: season.number,
        week: season.currentWeek,
      },
    });

    return { used, max: MAX_SESSIONS_PER_WEEK, week: season.currentWeek };
  }),

  // ── Legacy: bulk allocate training points (keep for compatibility) ──
  allocate: saveProcedure
    .input(
      z.object({
        aim: z.number().min(0).max(10),
        utility: z.number().min(0).max(10),
        teamplay: z.number().min(0).max(10),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.aim + input.utility + input.teamplay > 10) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot allocate more than 10 training points" });
      }

      const team = await ctx.prisma.team.findUnique({
        where: { userId: ctx.userId },
      });
      if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "No team found" });

      const season = await ctx.prisma.season.findFirst({ where: { isActive: true, saveId: ctx.save.id } });
      if (!season) throw new TRPCError({ code: "NOT_FOUND", message: "No active season" });

      if (team.lastTrainedWeek >= season.currentWeek) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Already trained this week. Training resets next week.",
        });
      }

      return ctx.prisma.team.update({
        where: { id: team.id },
        data: {
          skillAim: Math.min(100, team.skillAim + input.aim * 3),
          skillUtility: Math.min(100, team.skillUtility + input.utility * 3),
          skillTeamplay: Math.min(100, team.skillTeamplay + input.teamplay * 3),
          lastTrainedWeek: season.currentWeek,
        },
      });
    }),

  // ── Create an individual training session with instant effect ──
  createTraining: saveProcedure
    .input(
      z.object({
        playerId: z.string(),
        focus: z.enum(FOCUS_VALUES),
        agentName: z.string().optional(),
        mapName: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const team = await ctx.prisma.team.findUnique({
        where: { userId: ctx.userId },
        include: { coach: true },
      });
      if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });

      const season = await ctx.prisma.season.findFirst({ where: { isActive: true, saveId: ctx.save.id } });
      if (!season) throw new TRPCError({ code: "NOT_FOUND", message: "No active season." });

      // Slot check
      const used = await ctx.prisma.trainingSession.count({
        where: {
          teamId: team.id,
          season: season.number,
          week: season.currentWeek,
        },
      });
      if (used >= MAX_SESSIONS_PER_WEEK) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `No training slots remaining this week (max ${MAX_SESSIONS_PER_WEEK}).`,
        });
      }

      // Budget check
      if (team.budget < SESSION_COST) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Insufficient budget. Training costs $${SESSION_COST.toLocaleString()}.`,
        });
      }

      // Verify player is on team
      const player = await ctx.prisma.player.findUnique({ where: { id: input.playerId } });
      if (!player || player.teamId !== team.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Player is not on your team." });
      }

      // Coach multiplier: only applies above 50
      const trainingEff = team.coach?.trainingEff ?? 50;
      const coachMult = trainingEff > 50 ? trainingEff / 50 : 1.0;

      const focus = input.focus as TrainingFocus;

      // Apply effect based on focus
      if (focus === "AGENT_MASTERY") {
        if (!input.agentName || !input.mapName) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "AGENT_MASTERY training requires agentName and mapName.",
          });
        }
        const baseDelta = 0.1 + Math.random() * 0.1; // 0.1 to 0.2
        const delta = baseDelta * coachMult;

        const existing = await ctx.prisma.playerAgentPool.findUnique({
          where: {
            playerId_agentName_mapName: {
              playerId: input.playerId,
              agentName: input.agentName,
              mapName: input.mapName,
            },
          },
        });
        if (existing) {
          const newStars = Math.min(5, existing.stars + delta);
          await ctx.prisma.playerAgentPool.update({
            where: { id: existing.id },
            data: { stars: newStars },
          });
        } else {
          await ctx.prisma.playerAgentPool.create({
            data: {
              playerId: input.playerId,
              agentName: input.agentName,
              mapName: input.mapName,
              stars: Math.min(5, 1 + delta),
            },
          });
        }
      } else if (focus === "MAP_FACTOR") {
        if (!input.mapName) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "MAP_FACTOR training requires mapName.",
          });
        }
        const baseDelta = 0.01 + Math.random() * 0.02; // 0.01 to 0.03
        const delta = baseDelta * coachMult;
        const factors = (player.mapFactors ?? {}) as Record<string, number>;
        const current = factors[input.mapName] ?? 1.0;
        const next = Math.min(1.4, Math.max(0.6, current + delta));
        factors[input.mapName] = next;
        await ctx.prisma.player.update({
          where: { id: player.id },
          data: { mapFactors: factors },
        });
      } else if (focus === "AIM") {
        const baseDelta = 1 + Math.floor(Math.random() * 3); // 1-3
        const delta = Math.max(1, Math.round(baseDelta * coachMult));
        await ctx.prisma.team.update({
          where: { id: team.id },
          data: { skillAim: Math.min(100, team.skillAim + delta) },
        });
      } else if (focus === "UTILITY") {
        const baseDelta = 1 + Math.floor(Math.random() * 3); // 1-3
        const delta = Math.max(1, Math.round(baseDelta * coachMult));
        await ctx.prisma.team.update({
          where: { id: team.id },
          data: { skillUtility: Math.min(100, team.skillUtility + delta) },
        });
      } else if (focus === "TEAM_SYNERGY") {
        const baseDelta = 0.5;
        const delta = baseDelta * coachMult;
        await ctx.prisma.team.update({
          where: { id: team.id },
          data: { skillTeamplay: Math.min(100, team.skillTeamplay + delta) },
        });
      }

      // Deduct budget + create session record
      await ctx.prisma.team.update({
        where: { id: team.id },
        data: { budget: { decrement: SESSION_COST } },
      });

      const created = await ctx.prisma.trainingSession.create({
        data: {
          teamId: team.id,
          playerId: input.playerId,
          focus,
          agentName: input.agentName ?? null,
          mapName: input.mapName ?? null,
          week: season.currentWeek,
          season: season.number,
        },
      });

      return created;
    }),
});
