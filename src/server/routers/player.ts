import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, saveProcedure } from "../trpc";
import { marketRate } from "@/server/mercato/marketRate";
import {
  getPercentileCache,
  computeAttributes,
  computeOverall,
  inferPlaystyleRole,
  synthesizeMissingStats,
} from "@/server/mercato/attributes";
import type { PlayerRaw } from "@/server/mercato/attributeTypes";

export const playerRouter = router({
  roster: protectedProcedure.query(async ({ ctx }) => {
    const team = await ctx.prisma.team.findUnique({
      where: { userId: ctx.userId },
    });

    if (!team) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
    }

    return ctx.prisma.player.findMany({
      where: { teamId: team.id, isActive: true },
      orderBy: { acs: "desc" },
    });
  }),

  rosterAll: protectedProcedure.query(async ({ ctx }) => {
    const team = await ctx.prisma.team.findUnique({
      where: { userId: ctx.userId },
    });

    if (!team) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
    }

    return ctx.prisma.player.findMany({
      where: { teamId: team.id },
      orderBy: [{ isActive: "desc" }, { acs: "desc" }],
    });
  }),

  market: protectedProcedure
    .input(
      z
        .object({
          region: z.enum(["EMEA", "Americas", "Pacific", "China"]).optional(),
          role: z.enum(["IGL", "Duelist", "Initiator", "Sentinel", "Controller"]).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = { teamId: null, isActive: true, isRetired: false };

      if (input?.region) where.region = input.region;
      if (input?.role) where.role = input.role;

      return ctx.prisma.player.findMany({
        where,
        orderBy: { acs: "desc" },
      });
    }),

  buy: protectedProcedure
    .input(
      z.object({
        playerId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const team = await ctx.prisma.team.findUnique({
        where: { userId: ctx.userId },
      });

      if (!team) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
      }

      const player = await ctx.prisma.player.findUnique({
        where: { id: input.playerId },
      });

      if (!player) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Player not found." });
      }

      if (player.teamId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Player is not a free agent." });
      }

      const cost = player.salary * 4;
      if (team.budget < cost) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Insufficient budget. Need $${cost.toLocaleString()}, have $${team.budget.toLocaleString()}.`,
        });
      }

      // Deduct budget and assign player in a transaction
      const [updatedTeam, updatedPlayer] = await ctx.prisma.$transaction([
        ctx.prisma.team.update({
          where: { id: team.id },
          data: { budget: { decrement: cost } },
        }),
        ctx.prisma.player.update({
          where: { id: input.playerId },
          data: { teamId: team.id },
        }),
      ]);

      return { team: updatedTeam, player: updatedPlayer };
    }),

  sell: protectedProcedure
    .input(
      z.object({
        playerId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const team = await ctx.prisma.team.findUnique({
        where: { userId: ctx.userId },
      });

      if (!team) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
      }

      const player = await ctx.prisma.player.findUnique({
        where: { id: input.playerId },
      });

      if (!player) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Player not found." });
      }

      if (player.teamId !== team.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This player is not on your team." });
      }

      const recovery = player.salary * 2;

      const [updatedTeam, updatedPlayer] = await ctx.prisma.$transaction([
        ctx.prisma.team.update({
          where: { id: team.id },
          data: { budget: { increment: recovery } },
        }),
        ctx.prisma.player.update({
          where: { id: input.playerId },
          data: { teamId: null },
        }),
      ]);

      return { team: updatedTeam, player: updatedPlayer };
    }),

  getById: protectedProcedure
    .input(z.object({ playerId: z.string() }))
    .query(async ({ ctx, input }) => {
      const player = await ctx.prisma.player.findUnique({
        where: { id: input.playerId },
        include: { team: true },
      });

      if (!player) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Player not found." });
      }

      return player;
    }),

  teamMapStats: protectedProcedure.query(async ({ ctx }) => {
    const team = await ctx.prisma.team.findUnique({
      where: { userId: ctx.userId },
      include: { players: { where: { isActive: true }, select: { id: true, ign: true, role: true, mapFactors: true } } },
    });
    if (!team) throw new TRPCError({ code: "NOT_FOUND" });

    // Average map factor per map across all players
    const mapAvg: Record<string, number> = {};
    const mapCount: Record<string, number> = {};
    for (const p of team.players) {
      const factors = (p.mapFactors ?? {}) as Record<string, number>;
      for (const [map, factor] of Object.entries(factors)) {
        mapAvg[map] = (mapAvg[map] ?? 0) + factor;
        mapCount[map] = (mapCount[map] ?? 0) + 1;
      }
    }
    for (const map of Object.keys(mapAvg)) {
      mapAvg[map] = mapAvg[map] / (mapCount[map] ?? 1);
    }

    return { teamMapFactors: mapAvg, players: team.players };
  }),

  agentMastery: protectedProcedure
    .input(z.object({ playerIds: z.array(z.string()) }))
    .query(async ({ ctx, input }) => {
      const records = await ctx.prisma.playerAgentPool.findMany({
        where: { playerId: { in: input.playerIds } },
      });
      // Group by playerId
      const byPlayer: Record<string, Array<{ agentName: string; mapName: string; stars: number }>> = {};
      for (const r of records) {
        if (!byPlayer[r.playerId]) byPlayer[r.playerId] = [];
        byPlayer[r.playerId].push({ agentName: r.agentName, mapName: r.mapName, stars: r.stars });
      }
      return byPlayer;
    }),

  // ── Mercato V1 — user actions for roster management ──

  raiseSalary: saveProcedure
    .input(
      z.object({
        playerId: z.string(),
        newSalary: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const team = await ctx.prisma.team.findUnique({ where: { userId: ctx.userId } });
      if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });

      const player = await ctx.prisma.player.findUnique({ where: { id: input.playerId } });
      if (!player) throw new TRPCError({ code: "NOT_FOUND", message: "Player not found." });
      if (player.teamId !== team.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your player." });
      }
      if (input.newSalary <= player.salary) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "New salary must exceed current salary." });
      }
      if (player.raisesUsedSeason >= 1) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "This player has already received a raise this season." });
      }
      const upfront = input.newSalary * 2;
      if (team.budget < upfront) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Not enough budget. Raise costs $${upfront.toLocaleString()} upfront.`,
        });
      }

      const rate = marketRate(player);
      const nextTags = (Array.isArray(player.happinessTags) ? (player.happinessTags as string[]) : [])
        .filter((t) => t !== "UNDERPAID")
        .filter((t) => t !== "RECENT_SIGNING");
      nextTags.push("RECENT_SIGNING");
      // If still below 70% of market, keep UNDERPAID
      if (input.newSalary < rate * 0.7) nextTags.push("UNDERPAID");

      const [, updatedPlayer] = await ctx.prisma.$transaction([
        ctx.prisma.team.update({
          where: { id: team.id },
          data: { budget: { decrement: upfront } },
        }),
        ctx.prisma.player.update({
          where: { id: player.id },
          data: {
            salary: input.newSalary,
            happiness: Math.min(100, player.happiness + 15),
            happinessTags: nextTags,
            raisesUsedSeason: { increment: 1 },
          },
        }),
      ]);
      return updatedPlayer;
    }),

  pepTalk: saveProcedure
    .input(z.object({ playerId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const team = await ctx.prisma.team.findUnique({ where: { userId: ctx.userId } });
      if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });

      const player = await ctx.prisma.player.findUnique({ where: { id: input.playerId } });
      if (!player) throw new TRPCError({ code: "NOT_FOUND", message: "Player not found." });
      if (player.teamId !== team.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your player." });
      }
      if (player.pepTalksUsedSeason >= 2) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "You've already had 2 pep talks with this player this season.",
        });
      }
      return ctx.prisma.player.update({
        where: { id: player.id },
        data: {
          happiness: Math.min(100, player.happiness + 8),
          pepTalksUsedSeason: { increment: 1 },
        },
      });
    }),

  setTransferListed: saveProcedure
    .input(
      z.object({
        playerId: z.string(),
        listed: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const team = await ctx.prisma.team.findUnique({ where: { userId: ctx.userId } });
      if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });

      const player = await ctx.prisma.player.findUnique({ where: { id: input.playerId } });
      if (!player) throw new TRPCError({ code: "NOT_FOUND", message: "Player not found." });
      if (player.teamId !== team.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your player." });
      }
      return ctx.prisma.player.update({
        where: { id: player.id },
        data: { isTransferListed: input.listed },
      });
    }),

  // ── Detail fetch for the Player Detail Modal ──
  detail: saveProcedure
    .input(z.object({ playerId: z.string() }))
    .query(async ({ ctx, input }) => {
      const player = await ctx.prisma.player.findUnique({
        where: { id: input.playerId },
        include: {
          team: { select: { id: true, name: true, tag: true, logoUrl: true, region: true } },
        },
      });
      if (!player) throw new TRPCError({ code: "NOT_FOUND", message: "Player not found." });
      return {
        ...player,
        marketRate: marketRate(player),
      };
    }),

  // ── Mercato V4 — FM-style attributes (on-demand) ──
  attributes: saveProcedure
    .input(z.object({ playerId: z.string() }))
    .query(async ({ ctx, input }) => {
      const p = await ctx.prisma.player.findUnique({
        where: { id: input.playerId },
      });
      if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Player not found." });
      const cache = await getPercentileCache(ctx.prisma);
      const raw: PlayerRaw = {
        id: p.id,
        role: p.role,
        rating: p.rating,
        acs: p.acs,
        kd: p.kd,
        adr: p.adr,
        kast: p.kast,
        hs: p.hs,
        kpr: p.kpr,
        apr: p.apr,
        fkpr: p.fkpr,
        fdpr: p.fdpr,
        clPct: p.clPct,
        clTotal: p.clTotal,
        kills: p.kills,
        deaths: p.deaths,
        vlrAssists: p.vlrAssists,
        fk: p.fk,
        fd: p.fd,
        vlrRounds: p.vlrRounds,
        agentStats: p.agentStats,
        isIgl: p.isIgl,
      };
      const synthesized = synthesizeMissingStats(raw);
      const role = p.playstyleRole ?? inferPlaystyleRole(synthesized);
      const attrs = computeAttributes(synthesized, cache);
      const overall = computeOverall(attrs, role);
      return {
        attrs,
        overall,
        playstyleRole: role,
        wasAutoAssigned: !p.playstyleRole,
      };
    }),

  setPlaystyleRole: saveProcedure
    .input(
      z.object({
        playerId: z.string(),
        role: z.enum([
          "Entry", "Fragger", "Carry",
          "AggressiveInit", "IntelInit", "FlexInit",
          "IglSmoke", "AggressiveSmoke", "AnchorSmoke",
          "Anchor", "Lurker", "SupportSent",
        ]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const team = await ctx.prisma.team.findUnique({ where: { userId: ctx.userId } });
      if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
      const p = await ctx.prisma.player.findUnique({ where: { id: input.playerId } });
      if (!p) throw new TRPCError({ code: "NOT_FOUND", message: "Player not found." });
      if (p.teamId !== team.id) throw new TRPCError({ code: "FORBIDDEN", message: "Not your player." });

      const cache = await getPercentileCache(ctx.prisma);
      const raw: PlayerRaw = {
        id: p.id, role: p.role, rating: p.rating, acs: p.acs, kd: p.kd, adr: p.adr,
        kast: p.kast, hs: p.hs, kpr: p.kpr, apr: p.apr, fkpr: p.fkpr, fdpr: p.fdpr,
        clPct: p.clPct, clTotal: p.clTotal, kills: p.kills, deaths: p.deaths,
        vlrAssists: p.vlrAssists, fk: p.fk, fd: p.fd, vlrRounds: p.vlrRounds,
        agentStats: p.agentStats, isIgl: p.isIgl,
      };
      const synthesized = synthesizeMissingStats(raw);
      const attrs = computeAttributes(synthesized, cache);
      const overall = computeOverall(attrs, input.role);
      return ctx.prisma.player.update({
        where: { id: p.id },
        data: { playstyleRole: input.role, overall },
      });
    }),

  // ── Roster relation summary for UI dots (V3) ──
  rosterRelationSummary: saveProcedure.query(async ({ ctx }) => {
    const team = await ctx.prisma.team.findUnique({ where: { userId: ctx.userId } });
    if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });

    const players = await ctx.prisma.player.findMany({
      where: { teamId: team.id, isActive: true },
      select: { id: true },
    });
    const playerIds = players.map((p) => p.id);
    if (playerIds.length === 0) return {} as Record<string, { maxDuoStrength: number; hasClash: boolean }>;

    const relations = await ctx.prisma.playerRelation.findMany({
      where: {
        saveId: ctx.save.id,
        isCurrentlyTogether: true,
        playerAId: { in: playerIds },
        playerBId: { in: playerIds },
      },
      select: { playerAId: true, playerBId: true, type: true, strength: true },
    });

    const summary: Record<string, { maxDuoStrength: number; hasClash: boolean }> = {};
    for (const id of playerIds) summary[id] = { maxDuoStrength: 0, hasClash: false };

    for (const r of relations) {
      for (const id of [r.playerAId, r.playerBId]) {
        if (!(id in summary)) continue;
        if (r.type === "DUO") {
          summary[id].maxDuoStrength = Math.max(summary[id].maxDuoStrength, r.strength);
        } else if (r.type === "CLASH") {
          summary[id].hasClash = true;
        }
      }
    }
    return summary;
  }),

  // ── Fetch player's relationships (V3) ──
  relationships: saveProcedure
    .input(z.object({ playerId: z.string() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.prisma.playerRelation.findMany({
        where: {
          saveId: ctx.save.id,
          OR: [{ playerAId: input.playerId }, { playerBId: input.playerId }],
        },
        include: {
          playerA: {
            select: { id: true, ign: true, role: true, imageUrl: true, teamId: true },
          },
          playerB: {
            select: { id: true, ign: true, role: true, imageUrl: true, teamId: true },
          },
        },
        orderBy: { weeksTogether: "desc" },
      });

      // Normalize each row so consumers always see "other" as the non-me side.
      // For MENTOR, mentorRole describes the direction (me-as-mentor vs me-as-protégé).
      const normalized = rows.map((r) => {
        const isA = r.playerAId === input.playerId;
        const other = isA ? r.playerB : r.playerA;
        const mentorRole =
          r.type === "MENTOR" ? (isA ? "MENTOR_TO_THEM" : "PROTEGE_OF_THEM") : null;
        return {
          id: r.id,
          type: r.type,
          otherPlayer: other,
          weeksTogether: r.weeksTogether,
          strength: r.strength,
          isCurrentlyTogether: r.isCurrentlyTogether,
          firstTogetherSeason: r.firstTogetherSeason,
          firstTogetherWeek: r.firstTogetherWeek,
          mentorRole,
        };
      });

      return {
        current: normalized.filter((r) => r.isCurrentlyTogether),
        historical: normalized.filter((r) => !r.isCurrentlyTogether),
      };
    }),
});
