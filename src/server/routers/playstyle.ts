import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "@/server/trpc";
import { z } from "zod";

const PLAYSTYLE_COST = 50000;
const PLAYSTYLES = ["Aggressive", "Tactical", "Defensive", "Balanced", "Flex"] as const;

export const playstyleRouter = router({
  getMyPlaystyle: protectedProcedure.query(async ({ ctx }) => {
    const team = await ctx.prisma.team.findUnique({
      where: { userId: ctx.userId },
      select: { id: true, playstyle: true, budget: true },
    });
    if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });

    const season = await ctx.prisma.season.findFirst({ where: { isActive: true } });

    // Has the team changed playstyle during the current stage?
    // We track this by looking for a training session flagged via focus? No dedicated model.
    // Use a lightweight check: look at any TrainingSession with focus=TEAM_SYNERGY and agentName="__playstyle_change__"
    // Instead, we'll allow this freely but count uses via team-level field if possible.
    // Simpler: we use lastTrainedWeek logic-ish and gate by recent MetaPatch rows → easiest: use a marker on TrainingSession.
    let changedThisStage = false;
    if (season) {
      const marker = await ctx.prisma.trainingSession.findFirst({
        where: {
          teamId: team.id,
          season: season.number,
          focus: "TEAM_SYNERGY",
          agentName: "__playstyle_change__",
          mapName: season.currentStage,
        },
      });
      changedThisStage = !!marker;
    }

    return {
      playstyle: team.playstyle,
      budget: team.budget,
      cost: PLAYSTYLE_COST,
      changedThisStage,
      options: PLAYSTYLES,
    };
  }),

  setMyPlaystyle: protectedProcedure
    .input(
      z.object({
        playstyle: z.enum(PLAYSTYLES),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const team = await ctx.prisma.team.findUnique({ where: { userId: ctx.userId } });
      if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });

      const season = await ctx.prisma.season.findFirst({ where: { isActive: true } });
      if (!season) throw new TRPCError({ code: "NOT_FOUND", message: "No active season." });

      if (team.playstyle === input.playstyle) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Already using that playstyle." });
      }

      // Once-per-stage limit
      const marker = await ctx.prisma.trainingSession.findFirst({
        where: {
          teamId: team.id,
          season: season.number,
          focus: "TEAM_SYNERGY",
          agentName: "__playstyle_change__",
          mapName: season.currentStage,
        },
      });
      if (marker) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Playstyle already changed this stage.",
        });
      }

      if (team.budget < PLAYSTYLE_COST) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Insufficient budget. Changing playstyle costs $${PLAYSTYLE_COST.toLocaleString()}.`,
        });
      }

      // Apply — need a player on the team for the session marker (FK on trainingSession)
      const anyPlayer = await ctx.prisma.player.findFirst({
        where: { teamId: team.id },
        select: { id: true },
      });

      await ctx.prisma.team.update({
        where: { id: team.id },
        data: {
          playstyle: input.playstyle,
          budget: { decrement: PLAYSTYLE_COST },
        },
      });

      if (anyPlayer) {
        await ctx.prisma.trainingSession.create({
          data: {
            teamId: team.id,
            playerId: anyPlayer.id,
            focus: "TEAM_SYNERGY",
            agentName: "__playstyle_change__",
            mapName: season.currentStage,
            week: season.currentWeek,
            season: season.number,
          },
        });
      }

      return { playstyle: input.playstyle };
    }),
});
