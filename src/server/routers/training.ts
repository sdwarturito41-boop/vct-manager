import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "@/server/trpc";
import { z } from "zod/v4";

export const trainingRouter = router({
  allocate: protectedProcedure
    .input(
      z.object({
        aim: z.number().min(0).max(10),
        utility: z.number().min(0).max(10),
        teamplay: z.number().min(0).max(10),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (input.aim + input.utility + input.teamplay > 10) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot allocate more than 10 training points" });
      }

      const team = await ctx.prisma.team.findUnique({
        where: { userId: ctx.userId },
      });
      if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "No team found" });

      const season = await ctx.prisma.season.findFirst({ where: { isActive: true } });
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
});
