import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { initializeSaveWorld } from "../schedule/generate";

export const saveRouter = router({
  /** Return the current user's save (or null if they haven't created one yet). */
  current: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.save.findUnique({
      where: { userId: ctx.userId },
      include: {
        seasons: { orderBy: { number: "desc" }, take: 1 },
      },
    });
  }),

  /** List all available VCT teams for save creation (grouped by region). */
  availableTeams: protectedProcedure.query(async ({ ctx }) => {
    return ctx.prisma.vctTeamTemplate.findMany({
      orderBy: [{ region: "asc" }, { name: "asc" }],
    });
  }),

  /**
   * Create a new save for the current user. Requires playerTeamName/tag/region
   * so we know which preset team becomes the player's team and which are AI.
   */
  create: protectedProcedure
    .input(
      z.object({
        teamName: z.string().min(1),
        teamTag: z.string().min(1),
        region: z.enum(["EMEA", "Americas", "Pacific", "China"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.prisma.save.findUnique({ where: { userId: ctx.userId } });
      if (existing) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You already have a save. Delete it first." });
      }
      const save = await ctx.prisma.save.create({
        data: { userId: ctx.userId },
      });
      await initializeSaveWorld(ctx.prisma, save.id, {
        teamName: input.teamName,
        teamTag: input.teamTag,
        region: input.region,
      });
      return save;
    }),

  /** Delete the current user's save (cascades to everything). */
  delete: protectedProcedure.mutation(async ({ ctx }) => {
    const save = await ctx.prisma.save.findUnique({ where: { userId: ctx.userId } });
    if (!save) {
      throw new TRPCError({ code: "NOT_FOUND", message: "No save to delete." });
    }
    await ctx.prisma.save.delete({ where: { id: save.id } });
    return { ok: true };
  }),
});
