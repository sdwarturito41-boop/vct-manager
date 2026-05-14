import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, saveProcedure } from "../trpc";

/**
 * Scouting V1 — progressive revelation of hidden player attributes.
 *
 * Add a player to your shortlist → after 4 weeks of weekly ticks, their
 * `potentialRevealed` flag flips to true and the potential rating shows
 * in UI. (The weekly tick runs in season.advanceDay on Mondays.)
 *
 * Future V2 will add an analyst skill level that speeds this up + reveal
 * progressive ranges instead of binary visible/hidden.
 */

export const SCOUTING_REVEAL_WEEKS = 4;

export const scoutingRouter = router({
  list: saveProcedure.query(async ({ ctx }) => {
    const team = await ctx.prisma.team.findFirst({
      where: { saveId: ctx.save.id, isPlayerTeam: true },
      select: { id: true },
    });
    if (!team) return [];
    return ctx.prisma.shortlist.findMany({
      where: { teamId: team.id },
      include: {
        player: {
          select: {
            id: true,
            ign: true,
            role: true,
            acs: true,
            kd: true,
            kast: true,
            overall: true,
            potential: true,
            potentialRevealed: true,
            teamId: true,
            currentTeam: true,
            buyoutClause: true,
            salary: true,
          },
        },
      },
      orderBy: { addedWeek: "desc" },
    });
  }),

  add: saveProcedure
    .input(z.object({ playerId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const team = await ctx.prisma.team.findFirst({
        where: { saveId: ctx.save.id, isPlayerTeam: true },
        select: { id: true },
      });
      if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
      const season = await ctx.prisma.season.findFirst({
        where: { saveId: ctx.save.id, isActive: true },
        select: { number: true, currentWeek: true },
      });
      const absWeek = season ? season.number * 52 + season.currentWeek : 0;

      try {
        await ctx.prisma.shortlist.create({
          data: {
            saveId: ctx.save.id,
            teamId: team.id,
            playerId: input.playerId,
            addedWeek: absWeek,
          },
        });
      } catch {
        // Already shortlisted — idempotent no-op.
      }
      return { ok: true };
    }),

  remove: saveProcedure
    .input(z.object({ playerId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const team = await ctx.prisma.team.findFirst({
        where: { saveId: ctx.save.id, isPlayerTeam: true },
        select: { id: true },
      });
      if (!team) return { ok: false };
      await ctx.prisma.shortlist.deleteMany({
        where: { teamId: team.id, playerId: input.playerId },
      });
      return { ok: true };
    }),

  isShortlisted: saveProcedure
    .input(z.object({ playerId: z.string() }))
    .query(async ({ ctx, input }) => {
      const team = await ctx.prisma.team.findFirst({
        where: { saveId: ctx.save.id, isPlayerTeam: true },
        select: { id: true },
      });
      if (!team) return false;
      const r = await ctx.prisma.shortlist.findUnique({
        where: { teamId_playerId: { teamId: team.id, playerId: input.playerId } },
      });
      return r !== null;
    }),
});
