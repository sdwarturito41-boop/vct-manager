import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import { simulateMap } from "@/server/simulation/engine";
import type { SimTeam, AgentPick } from "@/server/simulation/engine";
import { VALORANT_AGENTS } from "@/constants/agents";
import { getActiveMapPool, MAP_POOLS } from "@/constants/maps";
import type { Player, Team } from "@/generated/prisma/client";

const MAX_SCRIMS_PER_WEEK = 5;

// Map pool index to determine reliability decay
// Each pool change = 1 patch. Pool A=0, Pool B=1, Pool C=2
const POOL_ORDER = ["POOL_A", "POOL_B", "POOL_C"];

function getPoolIndex(stage: string): number {
  const poolKey =
    stage === "KICKOFF" || stage === "MASTERS_1"
      ? "POOL_A"
      : stage === "STAGE_1" || stage === "MASTERS_2"
        ? "POOL_B"
        : "POOL_C";
  return POOL_ORDER.indexOf(poolKey);
}

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

function generateAgentPicks(players: Player[]): AgentPick[] {
  const top5 = [...players].sort((a, b) => b.acs - a.acs).slice(0, 5);
  return top5.map((p) => {
    const roleAgents = VALORANT_AGENTS.filter(
      (a) =>
        a.role === p.role ||
        (p.role === "IGL" && ["Controller", "Initiator"].includes(a.role))
    );
    const picked =
      roleAgents[Math.floor(Math.random() * roleAgents.length)] ??
      VALORANT_AGENTS[0]!;
    return { playerId: p.id, agentName: picked.name, agentRole: picked.role };
  });
}

function generateFakeAgentPicks(players: Player[]): AgentPick[] {
  const top5 = [...players].sort((a, b) => b.acs - a.acs).slice(0, 5);
  // Pick random agents regardless of role
  const shuffled = [...VALORANT_AGENTS].sort(() => Math.random() - 0.5);
  return top5.map((p, i) => {
    const agent = shuffled[i % shuffled.length]!;
    return { playerId: p.id, agentName: agent.name, agentRole: agent.role };
  });
}

export const scrimRouter = router({
  listScrims: protectedProcedure.query(async ({ ctx }) => {
    const team = await ctx.prisma.team.findUnique({
      where: { userId: ctx.userId },
    });
    if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });

    const season = await ctx.prisma.season.findFirst({ where: { isActive: true } });
    if (!season) throw new TRPCError({ code: "NOT_FOUND", message: "No active season." });

    const scrims = await ctx.prisma.scrim.findMany({
      where: { teamId: team.id, season: season.number },
      orderBy: { createdAt: "desc" },
    });

    // Get opponent team info for each scrim
    const opponentIds = [...new Set(scrims.map((s) => s.opponentId))];
    const opponents = await ctx.prisma.team.findMany({
      where: { id: { in: opponentIds } },
      select: { id: true, name: true, tag: true, logoUrl: true },
    });
    const oppMap = new Map(opponents.map((o) => [o.id, o]));

    return scrims.map((s) => ({
      ...s,
      opponent: oppMap.get(s.opponentId) ?? { id: s.opponentId, name: "Unknown", tag: "???", logoUrl: null },
    }));
  }),

  requestScrim: protectedProcedure
    .input(
      z.object({
        opponentTeamId: z.string(),
        mapName: z.string(),
        fakeComp: z.boolean(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const team = await ctx.prisma.team.findUnique({
        where: { userId: ctx.userId },
        include: { players: { where: { isActive: true } }, coach: true },
      });
      if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });

      const season = await ctx.prisma.season.findFirst({ where: { isActive: true } });
      if (!season) throw new TRPCError({ code: "NOT_FOUND", message: "No active season." });

      // Check scrim slots
      const usedScrims = await ctx.prisma.scrim.count({
        where: {
          teamId: team.id,
          season: season.number,
          week: season.currentWeek,
        },
      });
      if (usedScrims >= MAX_SCRIMS_PER_WEEK) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No scrim slots remaining this week (max 5).",
        });
      }

      // Get opponent
      const opponent = await ctx.prisma.team.findUnique({
        where: { id: input.opponentTeamId },
        include: { players: { where: { isActive: true } }, coach: true },
      });
      if (!opponent) throw new TRPCError({ code: "NOT_FOUND", message: "Opponent not found." });

      // Check same region (inter-region only at international events)
      const internationalStages = ["MASTERS_1", "MASTERS_2", "EWC", "CHAMPIONS"];
      const isInternational = internationalStages.includes(season.currentStage);
      if (!isInternational && team.region !== opponent.region) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Can only scrim teams in your region outside of international events.",
        });
      }

      // Check not upcoming match opponent
      const upcomingMatch = await ctx.prisma.match.findFirst({
        where: {
          isPlayed: false,
          season: season.number,
          OR: [
            { team1Id: team.id, team2Id: input.opponentTeamId },
            { team1Id: input.opponentTeamId, team2Id: team.id },
          ],
        },
      });
      if (upcomingMatch) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot scrim your next scheduled opponent.",
        });
      }

      // Validate map is in active pool
      const mapPool = getActiveMapPool(season.currentStage);
      if (!mapPool.includes(input.mapName)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Map is not in the active map pool.",
        });
      }

      // Check players
      if (team.players.length < 5) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Your team needs at least 5 active players." });
      }
      if (opponent.players.length < 5) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Opponent doesn't have enough players." });
      }

      // AI acceptance logic: 70% base, lower if upcoming match
      const hasUpcomingMatchGeneral = await ctx.prisma.match.findFirst({
        where: {
          isPlayed: false,
          season: season.number,
          OR: [{ team1Id: input.opponentTeamId }, { team2Id: input.opponentTeamId }],
        },
      });
      let acceptChance = 0.7;
      if (hasUpcomingMatchGeneral) acceptChance -= 0.15;
      // Random prestige factor - higher prestige teams are pickier
      if (opponent.prestige > 70) acceptChance -= 0.1;

      const accepted = Math.random() < acceptChance;

      if (!accepted) {
        // Store refused scrim
        const scrim = await ctx.prisma.scrim.create({
          data: {
            teamId: team.id,
            opponentId: input.opponentTeamId,
            mapName: input.mapName,
            season: season.number,
            week: season.currentWeek,
            fakeComp: input.fakeComp,
            accepted: false,
            refused: true,
            reliability: 1.0,
          },
        });
        return {
          ...scrim,
          opponent: { id: opponent.id, name: opponent.name, tag: opponent.tag, logoUrl: opponent.logoUrl },
        };
      }

      // Simulate the scrim (BO1)
      const simTeam1 = buildSimTeam(team as Team & { players: Player[] });
      const simTeam2 = buildSimTeam(opponent as Team & { players: Player[] });

      // Generate comps
      const myRealComp = generateAgentPicks(team.players);
      const oppComp = generateAgentPicks(opponent.players); // AI teams never fake
      const myDisplayComp = input.fakeComp
        ? generateFakeAgentPicks(team.players)
        : myRealComp;

      const mapResult = simulateMap(simTeam1, simTeam2, input.mapName, {
        team1Agents: myRealComp, // Use REAL comp for simulation
        team2Agents: oppComp,
        team1CoachBoost: team.coach?.utilityBoost,
        team2CoachBoost: opponent.coach?.utilityBoost,
      });

      // ── Apply mastery progression for scrim (reduced delta, no passive decay) ──
      const { applyMasteryUpdate } = await import("@/server/simulation/mastery");
      for (const pick of myRealComp) {
        const stat = mapResult.playerStats.find((s) => s.playerId === pick.playerId);
        if (!stat) continue;
        const player = team.players.find((p) => p.id === pick.playerId);
        if (!player) continue;
        await applyMasteryUpdate(ctx.prisma, {
          playerId: pick.playerId,
          agentName: pick.agentName,
          mapName: input.mapName,
          myScore: mapResult.score1,
          oppScore: mapResult.score2,
          playerACS: stat.acs,
          naturalRole: player.role,
          isScrim: true,
        });
      }

      const result = {
        score1: mapResult.score1,
        score2: mapResult.score2,
        myComp: myDisplayComp.map((a) => a.agentName), // What opponent sees (fake or real)
        myRealComp: myRealComp.map((a) => a.agentName), // What we actually played
        oppComp: oppComp.map((a) => a.agentName), // Always real for AI
      };

      const scrim = await ctx.prisma.scrim.create({
        data: {
          teamId: team.id,
          opponentId: input.opponentTeamId,
          mapName: input.mapName,
          season: season.number,
          week: season.currentWeek,
          fakeComp: input.fakeComp,
          accepted: true,
          refused: false,
          result,
          reliability: 1.0,
        },
      });

      return {
        ...scrim,
        opponent: { id: opponent.id, name: opponent.name, tag: opponent.tag, logoUrl: opponent.logoUrl },
      };
    }),

  getScrimSlots: protectedProcedure.query(async ({ ctx }) => {
    const team = await ctx.prisma.team.findUnique({
      where: { userId: ctx.userId },
    });
    if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });

    const season = await ctx.prisma.season.findFirst({ where: { isActive: true } });
    if (!season) return { used: 0, max: MAX_SCRIMS_PER_WEEK, week: 0 };

    const used = await ctx.prisma.scrim.count({
      where: {
        teamId: team.id,
        season: season.number,
        week: season.currentWeek,
      },
    });

    return { used, max: MAX_SCRIMS_PER_WEEK, week: season.currentWeek };
  }),

  getScoutingData: protectedProcedure
    .input(z.object({ opponentTeamId: z.string() }))
    .query(async ({ ctx, input }) => {
      const season = await ctx.prisma.season.findFirst({ where: { isActive: true } });
      if (!season) return [];

      const currentPoolIdx = getPoolIndex(season.currentStage);

      // Get all scrims involving this opponent (from any team)
      const scrims = await ctx.prisma.scrim.findMany({
        where: {
          accepted: true,
          season: season.number,
          OR: [
            { opponentId: input.opponentTeamId },
            { teamId: input.opponentTeamId },
          ],
        },
        orderBy: { createdAt: "desc" },
      });

      // Get the user's team to know perspective
      const userTeam = await ctx.prisma.team.findUnique({
        where: { userId: ctx.userId },
        include: { coach: true },
      });

      // Coach scouting bonus: +0.1 to reliability if scoutingSkill > 60
      const scoutingBonus =
        userTeam?.coach && userTeam.coach.scoutingSkill > 60 ? 0.1 : 0;

      return scrims
        .map((scrim) => {
          const result = scrim.result as {
            score1: number;
            score2: number;
            myComp: string[];
            myRealComp?: string[];
            oppComp: string[];
          } | null;
          if (!result) return null;

          // Calculate reliability based on week difference (proxy for patch)
          // Each 3 weeks ~= 1 patch cycle
          const weekDiff = Math.max(0, season.currentWeek - scrim.week);
          const patchesBehind = Math.floor(weekDiff / 3);
          const reliability = Math.min(
            1.0,
            Math.max(0, 1.0 - patchesBehind * 0.25) + scoutingBonus,
          );

          if (reliability <= 0) return null;

          // Determine opponent's comp from this scrim
          // If the scrim was BY the opponent (they were teamId), their comp shown is myComp (possibly fake)
          // If the scrim was AGAINST the opponent (they were opponentId), their comp is oppComp (always real for AI)
          let opponentComp: string[];
          let score: string;

          if (scrim.opponentId === input.opponentTeamId) {
            // Opponent was the target - their comp is oppComp (always real)
            opponentComp = result.oppComp;
            score = `${result.score1} - ${result.score2}`;
          } else {
            // Opponent initiated this scrim - what they showed is myComp (could be fake)
            // But if the scrim was faked, they showed a fake comp
            opponentComp = scrim.fakeComp ? result.myComp : (result.myRealComp ?? result.myComp);
            score = `${result.score2} - ${result.score1}`;
          }

          // If this scrim was by the current user, they can see the real opponent comp
          const isOwnScrim = scrim.teamId === userTeam?.id;

          return {
            id: scrim.id,
            map: scrim.mapName,
            opponentComp,
            score,
            reliability,
            week: scrim.week,
            isOwnScrim,
            fakeComp: scrim.fakeComp,
          };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null);
    }),

  getRegionTeams: protectedProcedure.query(async ({ ctx }) => {
    const team = await ctx.prisma.team.findUnique({
      where: { userId: ctx.userId },
    });
    if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });

    const teams = await ctx.prisma.team.findMany({
      where: {
        region: team.region,
        id: { not: team.id },
      },
      select: { id: true, name: true, tag: true, logoUrl: true, prestige: true },
      orderBy: { name: "asc" },
    });

    return teams;
  }),
});
