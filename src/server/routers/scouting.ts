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

  /**
   * Recommended targets — looks at the user team's role gaps + budget and
   * surfaces N candidates (free agents preferred, then affordable buyouts).
   * Renders on the dashboard ticker so the user always has a next-move hint.
   */
  recommended: saveProcedure.query(async ({ ctx }) => {
    const team = await ctx.prisma.team.findFirst({
      where: { saveId: ctx.save.id, isPlayerTeam: true },
      include: {
        players: {
          where: { isActive: true, isRetired: false, isReserve: false },
          select: { role: true, overall: true },
        },
      },
    });
    if (!team) return [];

    // Determine which role is the weakest / most under-staffed.
    const ROLES = ["Duelist", "Initiator", "Sentinel", "Controller", "Flex", "IGL"] as const;
    const rolesPresent = new Set(team.players.map((p) => p.role));
    const missingRoles = ROLES.filter((r) => !rolesPresent.has(r));
    const teamAvg = team.players.length > 0
      ? team.players.reduce((s, p) => s + (p.overall ?? 10), 0) / team.players.length
      : 10;

    // Pool of candidates: free agents + listed players the user can afford.
    const transferEnvelope = team.transferBudget + team.budget;
    const candidates = await ctx.prisma.player.findMany({
      where: {
        isRetired: false,
        isActive: true,
        OR: [
          { teamId: null }, // free agents
          { isTransferListed: true },
        ],
        NOT: { teamId: team.id },
      },
      select: {
        id: true,
        ign: true,
        role: true,
        overall: true,
        acs: true,
        kd: true,
        salary: true,
        teamId: true,
        buyoutClause: true,
        potential: true,
        potentialRevealed: true,
        currentTeam: true,
      },
      orderBy: { overall: "desc" },
      take: 100,
    });

    // Score: weight by (a) fills a missing role, (b) above team avg, (c)
    // affordable. Return top 5.
    type Cand = typeof candidates[number] & { score: number; reason: string };
    const scored: Cand[] = candidates.map((c) => {
      let score = (c.overall ?? 10) * 5;
      let reason = "Upgrade candidate";
      if (missingRoles.includes(c.role as typeof ROLES[number])) {
        score += 50;
        reason = `Fills ${c.role} gap`;
      }
      if ((c.overall ?? 10) > teamAvg + 1) {
        score += 20;
      }
      // Affordability: free agent salary*4 vs operational, buyout clause vs envelope
      const upfront = c.teamId == null ? c.salary * 4 : (c.buyoutClause ?? c.salary * 30);
      if (upfront <= transferEnvelope) {
        score += 15;
      } else {
        score -= 30; // expensive — push down but keep visible
      }
      if (c.teamId == null) reason = reason === "Upgrade candidate" ? "Free agent" : `${reason} (FA)`;
      return { ...c, score, reason };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 5);
  }),
});
