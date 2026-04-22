import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, saveProcedure } from "../trpc";
import { simulateMatch, simulateMap as simulateMapEngine } from "@/server/simulation/engine";
import { applyMasteryUpdate, applyPassiveDecay } from "@/server/simulation/mastery";
import type { SimTeam, AgentPick } from "@/server/simulation/engine";
import { VALORANT_AGENTS } from "@/constants/agents";
import type { Player, Team, Region } from "@/generated/prisma/client";
import { progressBracket } from "@/server/schedule/generate";

function buildSimTeam(team: Team & { players: Player[] }): SimTeam {
  const top5 = [...team.players].sort((a, b) => b.acs - a.acs).slice(0, 5);
  return {
    id: team.id,
    name: team.name,
    tag: team.tag,
    players: top5.map((p) => ({
      id: p.id,
      ign: p.ign,
      acs: p.acs,
      kd: p.kd,
      adr: p.adr,
      kast: p.kast,
      hs: p.hs,
      role: p.role,
    })),
    skillAim: team.skillAim,
    skillUtility: team.skillUtility,
    skillTeamplay: team.skillTeamplay,
    playstyle: team.playstyle,
  };
}

async function applyActivePatch(
  prisma: import("@/generated/prisma/client").PrismaClient,
  saveId: string,
): Promise<void> {
  const { applyPatchToMeta } = await import("@/constants/meta");
  const season = await prisma.season.findFirst({ where: { isActive: true, saveId } });
  if (!season) return;
  const patch = await prisma.metaPatch.findFirst({
    where: { season: season.number, stage: season.currentStage },
    orderBy: { createdAt: "desc" },
  });
  if (patch) {
    const buffs = Array.isArray(patch.buffs) ? (patch.buffs as string[]) : [];
    const nerfs = Array.isArray(patch.nerfs) ? (patch.nerfs as string[]) : [];
    applyPatchToMeta(buffs, nerfs);
  } else {
    applyPatchToMeta([], []);
  }
}

export const matchRouter = router({
  simulate: saveProcedure
    .input(z.object({ matchId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const match = await ctx.prisma.match.findUnique({
        where: { id: input.matchId },
        include: {
          team1: { include: { players: { where: { isActive: true } } } },
          team2: { include: { players: { where: { isActive: true } } } },
        },
      });

      if (!match) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Match not found." });
      }

      if (match.isPlayed) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Match already played." });
      }

      if (match.team1.players.length === 0 || match.team2.players.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Both teams must have active players to simulate a match.",
        });
      }

      const simTeam1 = buildSimTeam(match.team1);
      const simTeam2 = buildSimTeam(match.team2);

      await applyActivePatch(ctx.prisma, ctx.save.id);
      const result = simulateMatch(simTeam1, simTeam2, match.format);

      // Update the match record
      const updatedMatch = await ctx.prisma.match.update({
        where: { id: match.id },
        data: {
          isPlayed: true,
          playedAt: new Date(),
          winnerId: result.winnerId,
          score: { team1: result.score.team1, team2: result.score.team2 },
          maps: result.maps.map((m) => ({ ...m })) as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
        },
      });

      // Update team win/loss records
      const loserId = result.winnerId === match.team1Id ? match.team2Id : match.team1Id;

      await ctx.prisma.$transaction([
        ctx.prisma.team.update({
          where: { id: result.winnerId },
          data: { wins: { increment: 1 } },
        }),
        ctx.prisma.team.update({
          where: { id: loserId },
          data: { losses: { increment: 1 } },
        }),
      ]);

      // Group stage champ pt (+1 per win)
      if (
        match.stageId === "STAGE_1_ALPHA" || match.stageId === "STAGE_1_OMEGA" ||
        match.stageId === "STAGE_2_ALPHA" || match.stageId === "STAGE_2_OMEGA"
      ) {
        await ctx.prisma.team.update({
          where: { id: result.winnerId },
          data: { champPts: { increment: 1 } },
        });
      }

      // Sponsor win bonus for the winner
      const winSponsors = await ctx.prisma.sponsor.findMany({
        where: { teamId: result.winnerId, isActive: true },
        select: { winBonus: true },
      });
      const winBonusTotal = winSponsors.reduce((s, v) => s + v.winBonus, 0);
      if (winBonusTotal > 0) {
        await ctx.prisma.team.update({
          where: { id: result.winnerId },
          data: { budget: { increment: winBonusTotal } },
        });
      }

      return updatedMatch;
    }),

  simulateWithVeto: saveProcedure
    .input(z.object({ matchId: z.string(), selectedMaps: z.array(z.string()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const match = await ctx.prisma.match.findUnique({
        where: { id: input.matchId },
        include: {
          team1: { include: { players: { where: { isActive: true } } } },
          team2: { include: { players: { where: { isActive: true } } } },
        },
      });

      if (!match) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Match not found." });
      }

      if (match.isPlayed) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Match already played." });
      }

      // Verify this is the user's match
      const userTeam = await ctx.prisma.team.findUnique({
        where: { userId: ctx.userId },
      });

      if (!userTeam || (match.team1Id !== userTeam.id && match.team2Id !== userTeam.id)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This is not your team's match." });
      }

      if (match.team1.players.length === 0 || match.team2.players.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Both teams must have active players to simulate a match.",
        });
      }

      const simTeam1 = buildSimTeam(match.team1);
      const simTeam2 = buildSimTeam(match.team2);

      await applyActivePatch(ctx.prisma, ctx.save.id);
      const result = simulateMatch(simTeam1, simTeam2, match.format, input.selectedMaps);

      const updatedMatch = await ctx.prisma.match.update({
        where: { id: match.id },
        data: {
          isPlayed: true,
          playedAt: new Date(),
          winnerId: result.winnerId,
          score: { team1: result.score.team1, team2: result.score.team2 },
          maps: result.maps.map((m) => ({ ...m })) as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
        },
      });

      const loserId = result.winnerId === match.team1Id ? match.team2Id : match.team1Id;

      await ctx.prisma.$transaction([
        ctx.prisma.team.update({
          where: { id: result.winnerId },
          data: { wins: { increment: 1 } },
        }),
        ctx.prisma.team.update({
          where: { id: loserId },
          data: { losses: { increment: 1 } },
        }),
      ]);

      // Group stage champ pt (+1 per win)
      if (
        match.stageId === "STAGE_1_ALPHA" || match.stageId === "STAGE_1_OMEGA" ||
        match.stageId === "STAGE_2_ALPHA" || match.stageId === "STAGE_2_OMEGA"
      ) {
        await ctx.prisma.team.update({
          where: { id: result.winnerId },
          data: { champPts: { increment: 1 } },
        });
      }

      // Sponsor win bonus for the winner
      const winSponsors = await ctx.prisma.sponsor.findMany({
        where: { teamId: result.winnerId, isActive: true },
        select: { winBonus: true },
      });
      const winBonusTotal = winSponsors.reduce((s, v) => s + v.winBonus, 0);
      if (winBonusTotal > 0) {
        await ctx.prisma.team.update({
          where: { id: result.winnerId },
          data: { budget: { increment: winBonusTotal } },
        });
      }

      return updatedMatch;
    }),

  getById: saveProcedure
    .input(z.object({ matchId: z.string() }))
    .query(async ({ ctx, input }) => {
      const match = await ctx.prisma.match.findUnique({
        where: { id: input.matchId },
        include: {
          team1: true,
          team2: true,
        },
      });

      if (!match) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Match not found." });
      }

      return match;
    }),

  listByTeam: saveProcedure
    .input(z.object({ teamId: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.match.findMany({
        where: {
          OR: [{ team1Id: input.teamId }, { team2Id: input.teamId }],
        },
        include: { team1: true, team2: true },
        orderBy: [{ week: "asc" }, { day: "asc" }],
      });
    }),

  simulateMap: saveProcedure
    .input(
      z.object({
        matchId: z.string(),
        mapName: z.string(),
        side: z.enum(["attack", "defense"]),
        playerAgents: z
          .array(z.object({ playerId: z.string(), agentName: z.string() }))
          .length(5),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const match = await ctx.prisma.match.findUnique({
        where: { id: input.matchId },
        include: {
          team1: { include: { players: { where: { isActive: true } } } },
          team2: { include: { players: { where: { isActive: true } } } },
        },
      });

      if (!match) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Match not found." });
      }

      if (match.isPlayed) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Match already played." });
      }

      // Determine which team belongs to the user
      const userTeam = await ctx.prisma.team.findUnique({
        where: { userId: ctx.userId },
      });

      if (!userTeam || (match.team1Id !== userTeam.id && match.team2Id !== userTeam.id)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This is not your team's match." });
      }

      if (match.team1.players.length === 0 || match.team2.players.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Both teams must have active players to simulate a map.",
        });
      }

      const isUserTeam1 = match.team1Id === userTeam.id;

      // If user picks attack, their team should be team1 (attacks first half).
      // If user picks defense, swap so opponent attacks first half.
      let simTeam1: SimTeam;
      let simTeam2: SimTeam;

      if (
        (isUserTeam1 && input.side === "attack") ||
        (!isUserTeam1 && input.side === "defense")
      ) {
        simTeam1 = buildSimTeam(match.team1);
        simTeam2 = buildSimTeam(match.team2);
      } else {
        simTeam1 = buildSimTeam(match.team2);
        simTeam2 = buildSimTeam(match.team1);
      }

      // Build agent picks with roles for simulation impact
      const userAgentPicks: AgentPick[] = input.playerAgents.map((pa) => {
        const agent = VALORANT_AGENTS.find((a) => a.name === pa.agentName);
        return { playerId: pa.playerId, agentName: pa.agentName, agentRole: agent?.role };
      });

      // AI generates random agent picks (role-matched to their players)
      const aiTeam = isUserTeam1 ? match.team2 : match.team1;
      const aiAgentPicks: AgentPick[] = aiTeam.players.slice(0, 5).map((p) => {
        const roleAgents = VALORANT_AGENTS.filter((a) => a.role === p.role || (p.role === "IGL" && ["Controller", "Initiator"].includes(a.role)));
        const picked = roleAgents[Math.floor(Math.random() * roleAgents.length)] ?? VALORANT_AGENTS[0];
        return { playerId: p.id, agentName: picked.name, agentRole: picked.role };
      });

      const t1Agents = isUserTeam1 ? userAgentPicks : aiAgentPicks;
      const t2Agents = isUserTeam1 ? aiAgentPicks : userAgentPicks;

      const swapped =
        (isUserTeam1 && input.side === "defense") ||
        (!isUserTeam1 && input.side === "attack");

      let mapResult;
      try {
        await applyActivePatch(ctx.prisma, ctx.save.id);
        mapResult = simulateMapEngine(simTeam1, simTeam2, input.mapName, {
          team1Agents: swapped ? t2Agents : t1Agents,
          team2Agents: swapped ? t1Agents : t2Agents,
          team1StartsAttack: true,
        });
      } catch (err) {
        console.error("[simulateMap] engine error:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err instanceof Error ? `Engine: ${err.message}` : "Engine error",
        });
      }

      // ── Apply mastery progression for user's team ──
      // Normalize scores back to real team1/team2 order (pre-swap)
      const realScore1 = swapped ? mapResult.score2 : mapResult.score1;
      const realScore2 = swapped ? mapResult.score1 : mapResult.score2;
      const userScore = isUserTeam1 ? realScore1 : realScore2;
      const oppScore = isUserTeam1 ? realScore2 : realScore1;

      const userPlayers = await ctx.prisma.player.findMany({
        where: { id: { in: input.playerAgents.map((pa) => pa.playerId) } },
        select: { id: true, role: true },
      });
      const userRoleByPlayerId = new Map(userPlayers.map((p) => [p.id, p.role as string]));

      const playedAgentByPlayerId: Record<string, string> = {};
      for (const pa of input.playerAgents) {
        playedAgentByPlayerId[pa.playerId] = pa.agentName;
      }

      try {
        // Apply passive decay first (agents NOT played this map accumulate rust)
        await applyPassiveDecay(ctx.prisma, input.playerAgents.map((pa) => pa.playerId), playedAgentByPlayerId);

        // Apply mastery update for agents that WERE played
        for (const pa of input.playerAgents) {
          const stat = mapResult.playerStats.find((s) => s.playerId === pa.playerId);
          if (!stat) continue;
          await applyMasteryUpdate(ctx.prisma, {
            playerId: pa.playerId,
            agentName: pa.agentName,
            mapName: input.mapName,
            myScore: userScore,
            oppScore,
            playerACS: stat.acs,
            naturalRole: userRoleByPlayerId.get(pa.playerId) ?? "Flex",
            isScrim: false,
          });
        }
      } catch (err) {
        console.error("[simulateMap] mastery error:", err);
        // Don't fail the whole request if mastery fails
      }

      if (swapped) {
        return {
          map: mapResult.map,
          score1: mapResult.score2,
          score2: mapResult.score1,
          playerStats: mapResult.playerStats,
          highlights: mapResult.highlights,
          rounds: mapResult.rounds.map((r) => ({
            ...r,
            winner: (r.winner === 1 ? 2 : 1) as 1 | 2,
            score1: r.score2,
            score2: r.score1,
          })),
        };
      }

      return mapResult;
    }),

  finalizeMatch: saveProcedure
    .input(
      z.object({
        matchId: z.string(),
        maps: z.array(
          z.object({
            map: z.string(),
            score1: z.number(),
            score2: z.number(),
          })
        ),
        winnerId: z.string(),
        score: z.object({
          team1: z.number(),
          team2: z.number(),
        }),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const match = await ctx.prisma.match.findUnique({
        where: { id: input.matchId },
        include: {
          team1: { select: { id: true, region: true } },
          team2: { select: { id: true } },
        },
      });

      if (!match) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Match not found." });
      }

      if (match.isPlayed) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Match already played." });
      }

      // Verify the user owns one of the teams
      const userTeam = await ctx.prisma.team.findUnique({
        where: { userId: ctx.userId },
      });

      if (!userTeam || (match.team1Id !== userTeam.id && match.team2Id !== userTeam.id)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This is not your team's match." });
      }

      // 1. Update the match record
      const updatedMatch = await ctx.prisma.match.update({
        where: { id: match.id },
        data: {
          isPlayed: true,
          playedAt: new Date(),
          winnerId: input.winnerId,
          score: { team1: input.score.team1, team2: input.score.team2 },
          maps: input.maps.map((m) => ({ ...m })) as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
        },
      });

      // 2. Update team wins/losses
      const loserId = input.winnerId === match.team1Id ? match.team2Id : match.team1Id;

      await ctx.prisma.$transaction([
        ctx.prisma.team.update({
          where: { id: input.winnerId },
          data: { wins: { increment: 1 } },
        }),
        ctx.prisma.team.update({
          where: { id: loserId },
          data: { losses: { increment: 1 } },
        }),
      ]);

      // Group stage champ pt (+1 per win)
      if (
        match.stageId === "STAGE_1_ALPHA" || match.stageId === "STAGE_1_OMEGA" ||
        match.stageId === "STAGE_2_ALPHA" || match.stageId === "STAGE_2_OMEGA"
      ) {
        await ctx.prisma.team.update({
          where: { id: input.winnerId },
          data: { champPts: { increment: 1 } },
        });
      }

      // 2b. Sponsor win bonuses for the winning team
      const winningTeamSponsors = await ctx.prisma.sponsor.findMany({
        where: { teamId: input.winnerId, isActive: true },
        select: { winBonus: true },
      });
      const winBonusTotal = winningTeamSponsors.reduce((s, v) => s + v.winBonus, 0);
      if (winBonusTotal > 0) {
        await ctx.prisma.team.update({
          where: { id: input.winnerId },
          data: { budget: { increment: winBonusTotal } },
        });
      }

      // 3. Check bracket progression
      const season = await ctx.prisma.season.findFirst({ where: { isActive: true, saveId: ctx.save.id } });

      if (season) {
        const allRoundMatches = await ctx.prisma.match.findMany({
          where: { stageId: match.stageId, season: season.number },
          include: { team1: { select: { region: true } } },
        });

        // Group by region
        const byRegion = new Map<string, { played: number; total: number }>();
        for (const m of allRoundMatches) {
          const r = m.team1.region;
          const cur = byRegion.get(r) ?? { played: 0, total: 0 };
          cur.total++;
          if (m.isPlayed) cur.played++;
          byRegion.set(r, cur);
        }

        // Progress each region whose round is fully complete
        for (const [region, counts] of byRegion) {
          if (counts.played === counts.total && counts.total > 0) {
            await progressBracket(
              ctx.prisma,
              match.stageId,
              region as Region,
              season.number,
              season.currentDay
            );
          }
        }
      }

      return updatedMatch;
    }),
});
