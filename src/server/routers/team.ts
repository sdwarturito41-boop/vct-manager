import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, saveProcedure } from "../trpc";
import { VCT_TEAMS } from "@/constants/teams";
import { initializeSeasonForTeam } from "@/server/schedule/generate";
import {
  getPercentileCache,
  computeAttributes,
  computeOverall,
  inferPlaystyleRole,
  synthesizeMissingStats,
} from "@/server/mercato/attributes";
import type { PlayerRaw } from "@/server/mercato/attributeTypes";
import { ALL_ATTR_KEYS } from "@/constants/role-weights";

export const teamRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const team = await ctx.prisma.team.findUnique({
      where: { userId: ctx.userId },
      include: { players: { where: { isActive: true } } },
    });

    if (!team) {
      throw new TRPCError({ code: "NOT_FOUND", message: "You don't have a team yet." });
    }

    return team;
  }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(2).max(30),
        tag: z.string().min(2).max(5),
        region: z.enum(["EMEA", "Americas", "Pacific", "China"]),
        templateTeamName: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Check if user already has a team
      const existing = await ctx.prisma.team.findUnique({
        where: { userId: ctx.userId },
      });

      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "You already have a team." });
      }

      // Find the VCT template from DB to get budget/prestige/logo
      const dbTemplate = await ctx.prisma.vctTeamTemplate.findFirst({
        where: { name: input.templateTeamName },
      });
      const constTemplate = VCT_TEAMS.find((t) => t.name === input.templateTeamName);
      const budget = dbTemplate?.budget ?? constTemplate?.budget ?? 1000000;
      const prestige = dbTemplate?.prestige ?? constTemplate?.prestige ?? 50;
      const logoUrl = dbTemplate?.logoUrl ?? null;

      // If an AI team with the same template name already exists (from seed), delete it
      // and reassign its players to the new user team.
      // AI teams are owned by ghost users with emails starting with "ai-"
      const existingAiTeam = await ctx.prisma.team.findFirst({
        where: {
          name: input.templateTeamName,
          user: { email: { startsWith: "ai-" } },
        },
        include: { players: true, user: true },
      });

      // Create the user team
      const team = await ctx.prisma.team.create({
        data: {
          name: input.name,
          tag: input.tag,
          region: input.region,
          userId: ctx.userId,
          budget,
          prestige,
          logoUrl,
        },
      });

      if (existingAiTeam) {
        // Transfer players from AI team to user team
        await ctx.prisma.player.updateMany({
          where: { teamId: existingAiTeam.id },
          data: { teamId: team.id },
        });
        const ghostUserId = existingAiTeam.userId;
        // Delete the AI team then its ghost user (if any — userId is now nullable)
        await ctx.prisma.team.delete({ where: { id: existingAiTeam.id } });
        if (ghostUserId) {
          await ctx.prisma.user.delete({ where: { id: ghostUserId } }).catch(() => {});
        }
      } else {
        // Fallback: assign by currentTeam name for orphan players
        await ctx.prisma.player.updateMany({
          where: { currentTeam: input.templateTeamName, teamId: null },
          data: { teamId: team.id },
        });
      }

      // Initialize AI teams + match schedule
      await initializeSeasonForTeam(
        ctx.prisma,
        team.id,
        input.templateTeamName,
        input.region,
      );

      return ctx.prisma.team.findUniqueOrThrow({
        where: { id: team.id },
        include: { players: true },
      });
    }),

  getTemplates: protectedProcedure
    .input(z.object({ region: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.vctTeamTemplate.findMany({
        where: { region: input.region as "EMEA" | "Americas" | "Pacific" | "China" },
        orderBy: { prestige: "desc" },
      });
    }),

  hasTeam: protectedProcedure.query(async ({ ctx }) => {
    const team = await ctx.prisma.team.findUnique({
      where: { userId: ctx.userId },
      select: { id: true },
    });
    return { hasTeam: !!team };
  }),

  getAll: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.team.findMany({
      include: { players: true },
      orderBy: [{ champPts: "desc" }, { wins: "desc" }],
    });
  }),

  togglePlayerActive: protectedProcedure
    .input(
      z.object({
        playerId: z.string(),
        isActive: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const team = await ctx.prisma.team.findUnique({
        where: { userId: ctx.userId },
      });

      if (!team) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
      }

      const player = await ctx.prisma.player.findUnique({
        where: { id: input.playerId },
      });

      if (!player || player.teamId !== team.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Player is not on your team." });
      }

      return ctx.prisma.player.update({
        where: { id: input.playerId },
        data: { isActive: input.isActive },
      });
    }),

  updateBudget: protectedProcedure
    .input(
      z.object({
        amount: z.number().int(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const team = await ctx.prisma.team.findUnique({
        where: { userId: ctx.userId },
      });

      if (!team) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
      }

      const newBudget = team.budget + input.amount;
      if (newBudget < 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Insufficient budget." });
      }

      return ctx.prisma.team.update({
        where: { id: team.id },
        data: { budget: newBudget },
      });
    }),

  // ── Mercato V4.1 — aggregated team attributes for Team Overview ──
  attributeOverview: saveProcedure.query(async ({ ctx }) => {
    const team = await ctx.prisma.team.findUnique({
      where: { userId: ctx.userId },
      include: {
        players: { where: { isActive: true, isRetired: false } },
      },
    });
    if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
    if (team.players.length === 0) {
      return {
        teamOverall: 0,
        bestAttribute: null,
        worstAttribute: null,
        byAttribute: [] as Array<{ key: string; avg: number }>,
        byPlayer: [] as Array<{ id: string; ign: string; overall: number; playstyleRole: string | null }>,
      };
    }

    const cache = await getPercentileCache(ctx.prisma);
    const perPlayer = team.players.map((p) => {
      const raw: PlayerRaw = {
        id: p.id, role: p.role, rating: p.rating, acs: p.acs, kd: p.kd, adr: p.adr,
        kast: p.kast, hs: p.hs, kpr: p.kpr, apr: p.apr, fkpr: p.fkpr, fdpr: p.fdpr,
        clPct: p.clPct, clTotal: p.clTotal, kills: p.kills, deaths: p.deaths,
        vlrAssists: p.vlrAssists, fk: p.fk, fd: p.fd, vlrRounds: p.vlrRounds,
        agentStats: p.agentStats, isIgl: p.isIgl,
      };
      const synthesized = synthesizeMissingStats(raw);
      const role = p.playstyleRole ?? inferPlaystyleRole(synthesized);
      const attrs = computeAttributes(synthesized, cache);
      return { player: p, role, attrs, overall: computeOverall(attrs, role) };
    });

    // Team-average per attribute
    const byAttribute = ALL_ATTR_KEYS.map((key) => {
      const sum = perPlayer.reduce((s, pp) => s + pp.attrs[key], 0);
      return { key, avg: sum / perPlayer.length };
    });
    byAttribute.sort((a, b) => b.avg - a.avg);

    const teamOverall =
      perPlayer.reduce((s, pp) => s + pp.overall, 0) / perPlayer.length;

    return {
      teamOverall,
      bestAttribute: byAttribute[0] ?? null,
      worstAttribute: byAttribute[byAttribute.length - 1] ?? null,
      byAttribute,
      byPlayer: perPlayer.map((pp) => ({
        id: pp.player.id,
        ign: pp.player.ign,
        overall: pp.overall,
        playstyleRole: pp.role,
      })),
    };
  }),
});
