import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";

export const messageRouter = router({
  list: protectedProcedure
    .input(z.object({ onlyUnread: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const team = await ctx.prisma.team.findUnique({ where: { userId: ctx.userId } });
      if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
      return ctx.prisma.message.findMany({
        where: {
          teamId: team.id,
          ...(input?.onlyUnread ? { isRead: false } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      });
    }),

  unreadCount: protectedProcedure.query(async ({ ctx }) => {
    const team = await ctx.prisma.team.findUnique({ where: { userId: ctx.userId } });
    if (!team) return 0;
    return ctx.prisma.message.count({
      where: { teamId: team.id, isRead: false },
    });
  }),

  markRead: protectedProcedure
    .input(z.object({ messageId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const team = await ctx.prisma.team.findUnique({ where: { userId: ctx.userId } });
      if (!team) throw new TRPCError({ code: "NOT_FOUND" });
      await ctx.prisma.message.update({
        where: { id: input.messageId },
        data: { isRead: true },
      });
    }),

  markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
    const team = await ctx.prisma.team.findUnique({ where: { userId: ctx.userId } });
    if (!team) throw new TRPCError({ code: "NOT_FOUND" });
    await ctx.prisma.message.updateMany({
      where: { teamId: team.id, isRead: false },
      data: { isRead: true },
    });
  }),

  resolveAction: protectedProcedure
    .input(z.object({ messageId: z.string(), result: z.enum(["accepted", "rejected", "ignored"]) }))
    .mutation(async ({ ctx, input }) => {
      const team = await ctx.prisma.team.findUnique({ where: { userId: ctx.userId } });
      if (!team) throw new TRPCError({ code: "NOT_FOUND" });
      const msg = await ctx.prisma.message.findUnique({ where: { id: input.messageId } });
      if (!msg || msg.teamId !== team.id) throw new TRPCError({ code: "FORBIDDEN" });

      // Apply side-effects based on eventType
      if (input.result === "accepted" && msg.eventType === "player_raise_request" && msg.eventData) {
        const data = msg.eventData as { playerId: string; proposedSalary: number };
        await ctx.prisma.player.update({
          where: { id: data.playerId },
          data: { salary: data.proposedSalary },
        });
      }
      // Other event types could get their own resolutions here

      await ctx.prisma.message.update({
        where: { id: input.messageId },
        data: { isRead: true, actionResolved: true, actionResult: input.result },
      });
    }),

  delete: protectedProcedure
    .input(z.object({ messageId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const team = await ctx.prisma.team.findUnique({ where: { userId: ctx.userId } });
      if (!team) throw new TRPCError({ code: "NOT_FOUND" });
      const msg = await ctx.prisma.message.findUnique({ where: { id: input.messageId } });
      if (!msg || msg.teamId !== team.id) throw new TRPCError({ code: "FORBIDDEN" });
      await ctx.prisma.message.delete({ where: { id: input.messageId } });
    }),
});
