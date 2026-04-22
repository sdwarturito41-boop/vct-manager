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
      // Verify the logged-in user still exists in the DB (stale cookie after
      // DB reset would otherwise fail on the Save FK constraint).
      const user = await ctx.prisma.user.findUnique({ where: { id: ctx.userId } });
      if (!user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Your session is stale — please log out and log in again.",
        });
      }

      const existing = await ctx.prisma.save.findUnique({ where: { userId: ctx.userId } });
      if (existing) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "You already have a save. Delete it first." });
      }
      const save = await ctx.prisma.save.create({
        data: { userId: ctx.userId },
      });
      try {
        await initializeSaveWorld(ctx.prisma, save.id, {
          teamName: input.teamName,
          teamTag: input.teamTag,
          region: input.region,
        });
      } catch (err) {
        // Rollback: delete the orphaned save so the user can retry.
        await ctx.prisma.save.delete({ where: { id: save.id } }).catch(() => {});
        throw err;
      }
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
