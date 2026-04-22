import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, saveProcedure } from "../trpc";

export const leagueRouter = router({
  standings: saveProcedure.query(async ({ ctx }) => {
    const userTeam = await ctx.prisma.team.findUnique({
      where: { userId: ctx.userId },
    });

    if (!userTeam) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
    }

    return ctx.prisma.team.findMany({
      where: { region: userTeam.region },
      orderBy: [{ champPts: "desc" }, { wins: "desc" }],
      include: {
        _count: {
          select: {
            matchesAsTeam1: true,
            matchesAsTeam2: true,
          },
        },
      },
    });
  }),

  champPoints: saveProcedure
    .input(z.object({ teamId: z.string() }))
    .query(async ({ ctx, input }) => {
      const team = await ctx.prisma.team.findUnique({
        where: { id: input.teamId },
      });

      if (!team) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
      }

      // Get all played matches for this team to build a stage-by-stage breakdown
      const matches = await ctx.prisma.match.findMany({
        where: {
          isPlayed: true,
          OR: [{ team1Id: input.teamId }, { team2Id: input.teamId }],
        },
        orderBy: [{ season: "asc" }, { week: "asc" }, { day: "asc" }],
      });

      // Group wins by stage
      const stageWins: Record<string, number> = {};
      const stageLosses: Record<string, number> = {};

      for (const match of matches) {
        const stage = match.stageId;
        if (!stageWins[stage]) stageWins[stage] = 0;
        if (!stageLosses[stage]) stageLosses[stage] = 0;

        if (match.winnerId === input.teamId) {
          stageWins[stage]++;
        } else {
          stageLosses[stage]++;
        }
      }

      return {
        teamId: team.id,
        teamName: team.name,
        totalChampPts: team.champPts,
        stageBreakdown: Object.keys(stageWins).map((stage) => ({
          stage,
          wins: stageWins[stage] ?? 0,
          losses: stageLosses[stage] ?? 0,
        })),
      };
    }),
});
