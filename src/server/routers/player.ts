import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";

export const playerRouter = router({
  roster: protectedProcedure.query(async ({ ctx }) => {
    const team = await ctx.prisma.team.findUnique({
      where: { userId: ctx.userId },
    });

    if (!team) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
    }

    return ctx.prisma.player.findMany({
      where: { teamId: team.id, isActive: true },
      orderBy: { acs: "desc" },
    });
  }),

  rosterAll: protectedProcedure.query(async ({ ctx }) => {
    const team = await ctx.prisma.team.findUnique({
      where: { userId: ctx.userId },
    });

    if (!team) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
    }

    return ctx.prisma.player.findMany({
      where: { teamId: team.id },
      orderBy: [{ isActive: "desc" }, { acs: "desc" }],
    });
  }),

  market: protectedProcedure
    .input(
      z
        .object({
          region: z.enum(["EMEA", "Americas", "Pacific", "China"]).optional(),
          role: z.enum(["IGL", "Duelist", "Initiator", "Sentinel", "Controller"]).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = { teamId: null, isActive: true, isRetired: false };

      if (input?.region) where.region = input.region;
      if (input?.role) where.role = input.role;

      return ctx.prisma.player.findMany({
        where,
        orderBy: { acs: "desc" },
      });
    }),

  buy: protectedProcedure
    .input(
      z.object({
        playerId: z.string(),
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

      if (!player) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Player not found." });
      }

      if (player.teamId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Player is not a free agent." });
      }

      const cost = player.salary * 4;
      if (team.budget < cost) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Insufficient budget. Need $${cost.toLocaleString()}, have $${team.budget.toLocaleString()}.`,
        });
      }

      // Deduct budget and assign player in a transaction
      const [updatedTeam, updatedPlayer] = await ctx.prisma.$transaction([
        ctx.prisma.team.update({
          where: { id: team.id },
          data: { budget: { decrement: cost } },
        }),
        ctx.prisma.player.update({
          where: { id: input.playerId },
          data: { teamId: team.id },
        }),
      ]);

      return { team: updatedTeam, player: updatedPlayer };
    }),

  sell: protectedProcedure
    .input(
      z.object({
        playerId: z.string(),
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

      if (!player) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Player not found." });
      }

      if (player.teamId !== team.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This player is not on your team." });
      }

      const recovery = player.salary * 2;

      const [updatedTeam, updatedPlayer] = await ctx.prisma.$transaction([
        ctx.prisma.team.update({
          where: { id: team.id },
          data: { budget: { increment: recovery } },
        }),
        ctx.prisma.player.update({
          where: { id: input.playerId },
          data: { teamId: null },
        }),
      ]);

      return { team: updatedTeam, player: updatedPlayer };
    }),

  getById: protectedProcedure
    .input(z.object({ playerId: z.string() }))
    .query(async ({ ctx, input }) => {
      const player = await ctx.prisma.player.findUnique({
        where: { id: input.playerId },
        include: { team: true },
      });

      if (!player) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Player not found." });
      }

      return player;
    }),
});
