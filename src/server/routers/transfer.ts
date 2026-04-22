import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import type { OfferStatus } from "@/generated/prisma/client";

// ── Helpers ──

type ResolveCtx = {
  // Minimal surface we use from PrismaClient so we can call this from
  // mutations as well as from hooks inside other routers (e.g. season.advanceDay).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any;
};

/**
 * Resolves a single pending offer. Returns the updated offer.
 *
 * Rules:
 *  - BUYOUT:
 *      fee >= buyoutClause → ACCEPTED (player transfers immediately)
 *      fee >= 70% of buyout → 50% chance to accept
 *      else → REJECTED
 *      Player demands: proposedSalary must be >= currentSalary * 1.2
 *  - FREE_AGENT_SIGNING:
 *      proposedSalary >= player.salary → ACCEPTED
 *      else 50% chance based on salary ratio
 *  - CONTRACT_EXTENSION:
 *      treated like FA signing (player-side decision)
 */
async function resolveOfferDecision(
  ctx: ResolveCtx,
  offerId: string,
): Promise<"ACCEPTED" | "REJECTED" | "PENDING"> {
  const offer = await ctx.prisma.transferOffer.findUnique({
    where: { id: offerId },
    include: { player: true, fromTeam: true, toTeam: true },
  });
  if (!offer || offer.status !== "PENDING") return "PENDING";

  const player = offer.player;
  const salaryDemandMet = offer.proposedSalary >= Math.ceil(player.salary * 1.2);

  let decision: "ACCEPTED" | "REJECTED" = "REJECTED";

  if (offer.offerType === "BUYOUT") {
    const buyout = player.buyoutClause || 0;
    const fee = offer.transferFee || 0;

    if (buyout > 0 && fee >= buyout) {
      // Even if buyout is auto-triggered, player still needs a fair salary
      decision = salaryDemandMet ? "ACCEPTED" : "REJECTED";
    } else if (buyout > 0 && fee >= Math.floor(buyout * 0.7)) {
      decision = salaryDemandMet && Math.random() < 0.5 ? "ACCEPTED" : "REJECTED";
    } else {
      decision = "REJECTED";
    }
  } else if (offer.offerType === "FREE_AGENT_SIGNING") {
    if (offer.proposedSalary >= player.salary) {
      decision = "ACCEPTED";
    } else {
      const ratio = offer.proposedSalary / Math.max(1, player.salary);
      decision = Math.random() < ratio * 0.5 ? "ACCEPTED" : "REJECTED";
    }
  } else if (offer.offerType === "CONTRACT_EXTENSION") {
    // Contract extension — player decides based on salary offered vs current
    if (offer.proposedSalary >= Math.ceil(player.salary * 1.1)) {
      decision = "ACCEPTED";
    } else {
      const ratio = offer.proposedSalary / Math.max(1, player.salary);
      decision = Math.random() < ratio * 0.4 ? "ACCEPTED" : "REJECTED";
    }
  }

  if (decision === "ACCEPTED") {
    await applyAcceptedOffer(ctx, offerId);
  } else {
    await ctx.prisma.transferOffer.update({
      where: { id: offerId },
      data: { status: "REJECTED" },
    });
  }

  return decision;
}

/**
 * Applies an accepted offer: moves player, deducts fees/salary, updates contract.
 */
async function applyAcceptedOffer(ctx: ResolveCtx, offerId: string): Promise<void> {
  const offer = await ctx.prisma.transferOffer.findUnique({
    where: { id: offerId },
    include: { player: true, fromTeam: true, toTeam: true },
  });
  if (!offer) return;

  const season = await ctx.prisma.season.findFirst({ where: { isActive: true } });
  const currentSeason = season?.number ?? offer.season;
  const currentWeek = season?.currentWeek ?? offer.week;

  // Compute new contract end from current week + contract length
  const totalWeeks = currentWeek + offer.contractLengthWeeks;
  const newContractEndSeason = currentSeason + Math.floor(totalWeeks / 52);
  const newContractEndWeek = totalWeeks % 52 === 0 ? 52 : totalWeeks % 52;

  const updates: unknown[] = [];

  if (offer.offerType === "BUYOUT") {
    // Pay transfer fee to selling team, player moves to buyer
    updates.push(
      ctx.prisma.team.update({
        where: { id: offer.fromTeamId },
        data: { budget: { decrement: offer.transferFee } },
      }),
    );
    if (offer.toTeamId) {
      updates.push(
        ctx.prisma.team.update({
          where: { id: offer.toTeamId },
          data: { budget: { increment: offer.transferFee } },
        }),
      );
    }
    updates.push(
      ctx.prisma.player.update({
        where: { id: offer.playerId },
        data: {
          teamId: offer.fromTeamId,
          salary: offer.proposedSalary,
          contractEndSeason: newContractEndSeason,
          contractEndWeek: newContractEndWeek,
          buyoutClause: Math.ceil(offer.proposedSalary * 30),
          joinedWeek: currentWeek,
        },
      }),
    );
  } else if (offer.offerType === "FREE_AGENT_SIGNING") {
    // Signing bonus = 4 weeks salary
    const signingBonus = offer.proposedSalary * 4;
    updates.push(
      ctx.prisma.team.update({
        where: { id: offer.fromTeamId },
        data: { budget: { decrement: signingBonus } },
      }),
    );
    updates.push(
      ctx.prisma.player.update({
        where: { id: offer.playerId },
        data: {
          teamId: offer.fromTeamId,
          salary: offer.proposedSalary,
          contractEndSeason: newContractEndSeason,
          contractEndWeek: newContractEndWeek,
          buyoutClause: Math.ceil(offer.proposedSalary * 30),
          joinedWeek: currentWeek,
        },
      }),
    );
  } else if (offer.offerType === "CONTRACT_EXTENSION") {
    updates.push(
      ctx.prisma.player.update({
        where: { id: offer.playerId },
        data: {
          salary: offer.proposedSalary,
          contractEndSeason: newContractEndSeason,
          contractEndWeek: newContractEndWeek,
          buyoutClause: Math.ceil(offer.proposedSalary * 30),
        },
      }),
    );
  }

  updates.push(
    ctx.prisma.transferOffer.update({
      where: { id: offerId },
      data: { status: "ACCEPTED" },
    }),
  );

  await ctx.prisma.$transaction(updates);
}

/**
 * Hook called from season.advanceDay to resolve AI team decisions on
 * pending offers. Safe to call every tick — it only processes PENDING offers.
 */
export async function runAiOfferResolutions(ctx: ResolveCtx): Promise<number> {
  const pending = await ctx.prisma.transferOffer.findMany({
    where: { status: "PENDING" },
    select: { id: true },
  });
  let resolved = 0;
  for (const o of pending) {
    const d = await resolveOfferDecision(ctx, o.id);
    if (d !== "PENDING") resolved++;
  }
  return resolved;
}

export const transferRouter = router({
  // ── Free agents grouped by region ──
  listFreeAgents: protectedProcedure
    .input(
      z
        .object({
          region: z.enum(["EMEA", "Americas", "Pacific", "China"]).optional(),
          role: z.enum(["IGL", "Duelist", "Initiator", "Sentinel", "Controller", "Flex"]).optional(),
          minSalary: z.number().int().min(0).optional(),
          maxSalary: z.number().int().min(0).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const where: Record<string, unknown> = {
        teamId: null,
        isRetired: false,
      };
      if (input?.region) where.region = input.region;
      if (input?.role) where.role = input.role;
      if (input?.minSalary !== undefined || input?.maxSalary !== undefined) {
        const range: Record<string, number> = {};
        if (input.minSalary !== undefined) range.gte = input.minSalary;
        if (input.maxSalary !== undefined) range.lte = input.maxSalary;
        where.salary = range;
      }

      const players = await ctx.prisma.player.findMany({
        where,
        orderBy: [{ region: "asc" }, { acs: "desc" }],
      });

      // Group by region
      const byRegion: Record<string, typeof players> = {};
      for (const p of players) {
        const r = p.region as string;
        if (!byRegion[r]) byRegion[r] = [];
        byRegion[r].push(p);
      }
      return { all: players, byRegion };
    }),

  // ── Players from OTHER teams, showing their buyout clause ──
  listMarketPlayers: protectedProcedure
    .input(
      z
        .object({
          region: z.enum(["EMEA", "Americas", "Pacific", "China"]).optional(),
          role: z.enum(["IGL", "Duelist", "Initiator", "Sentinel", "Controller", "Flex"]).optional(),
          minSalary: z.number().int().min(0).optional(),
          maxSalary: z.number().int().min(0).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const team = await ctx.prisma.team.findUnique({
        where: { userId: ctx.userId },
      });
      if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });

      const where: Record<string, unknown> = {
        teamId: { not: null },
        isRetired: false,
        NOT: { teamId: team.id },
        buyoutClause: { gt: 0 },
      };
      if (input?.region) where.region = input.region;
      if (input?.role) where.role = input.role;
      if (input?.minSalary !== undefined || input?.maxSalary !== undefined) {
        const range: Record<string, number> = {};
        if (input.minSalary !== undefined) range.gte = input.minSalary;
        if (input.maxSalary !== undefined) range.lte = input.maxSalary;
        where.salary = range;
      }

      const players = await ctx.prisma.player.findMany({
        where,
        include: {
          team: { select: { id: true, name: true, tag: true, logoUrl: true, region: true } },
        },
        orderBy: { acs: "desc" },
      });

      return players;
    }),

  // ── Create a transfer offer ──
  makeOffer: protectedProcedure
    .input(
      z.object({
        playerId: z.string(),
        offerType: z.enum(["FREE_AGENT_SIGNING", "BUYOUT", "CONTRACT_EXTENSION"]),
        transferFee: z.number().int().min(0).optional(),
        proposedSalary: z.number().int().min(0),
        contractLengthWeeks: z.number().int().min(1).max(208),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const team = await ctx.prisma.team.findUnique({
        where: { userId: ctx.userId },
      });
      if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });

      const season = await ctx.prisma.season.findFirst({ where: { isActive: true } });
      if (!season) throw new TRPCError({ code: "NOT_FOUND", message: "No active season." });

      const player = await ctx.prisma.player.findUnique({
        where: { id: input.playerId },
      });
      if (!player) throw new TRPCError({ code: "NOT_FOUND", message: "Player not found." });

      // Validate offer type against player state
      if (input.offerType === "FREE_AGENT_SIGNING" && player.teamId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Player is not a free agent." });
      }
      if (input.offerType === "BUYOUT") {
        if (!player.teamId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Player is a free agent — use FA signing." });
        }
        if (player.teamId === team.id) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot buyout your own player." });
        }
      }
      if (input.offerType === "CONTRACT_EXTENSION" && player.teamId !== team.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Can only extend your own players." });
      }

      // Budget checks
      const transferFee = input.transferFee ?? 0;
      const upfrontCost =
        input.offerType === "BUYOUT"
          ? transferFee
          : input.offerType === "FREE_AGENT_SIGNING"
            ? input.proposedSalary * 4
            : 0;
      if (team.budget < upfrontCost) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Insufficient budget. Need $${upfrontCost.toLocaleString()}, have $${team.budget.toLocaleString()}.`,
        });
      }

      // Create the offer (PENDING initially)
      const offer = await ctx.prisma.transferOffer.create({
        data: {
          playerId: input.playerId,
          fromTeamId: team.id,
          toTeamId: input.offerType === "BUYOUT" ? player.teamId : null,
          offerType: input.offerType,
          transferFee,
          proposedSalary: input.proposedSalary,
          contractLengthWeeks: input.contractLengthWeeks,
          status: "PENDING",
          week: season.currentWeek,
          season: season.number,
        },
      });

      // Auto-resolve FA signings and auto-accept BUYOUTs where fee >= clause
      let decision: OfferStatus = "PENDING";
      if (input.offerType === "FREE_AGENT_SIGNING") {
        const d = await resolveOfferDecision(ctx, offer.id);
        decision = d as OfferStatus;
      } else if (input.offerType === "BUYOUT") {
        // Auto-resolve only when fee triggers automatic acceptance, else keep PENDING
        if (transferFee >= (player.buyoutClause || Infinity)) {
          const d = await resolveOfferDecision(ctx, offer.id);
          decision = d as OfferStatus;
        }
      } else if (input.offerType === "CONTRACT_EXTENSION") {
        const d = await resolveOfferDecision(ctx, offer.id);
        decision = d as OfferStatus;
      }

      return { offerId: offer.id, status: decision };
    }),

  // ── List offers related to current user ──
  myOffers: protectedProcedure.query(async ({ ctx }) => {
    const team = await ctx.prisma.team.findUnique({
      where: { userId: ctx.userId },
    });
    if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });

    const made = await ctx.prisma.transferOffer.findMany({
      where: { fromTeamId: team.id },
      include: {
        player: { select: { id: true, ign: true, role: true, imageUrl: true, salary: true, region: true } },
        toTeam: { select: { id: true, name: true, tag: true, logoUrl: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // Offers TO the user's team (buyout attempts on your players)
    const received = await ctx.prisma.transferOffer.findMany({
      where: { toTeamId: team.id },
      include: {
        player: { select: { id: true, ign: true, role: true, imageUrl: true, salary: true, region: true } },
        fromTeam: { select: { id: true, name: true, tag: true, logoUrl: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return { made, received };
  }),

  // ── Accept/reject an incoming offer on one of user's players ──
  respondToOffer: protectedProcedure
    .input(
      z.object({
        offerId: z.string(),
        action: z.enum(["ACCEPT", "REJECT"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const team = await ctx.prisma.team.findUnique({
        where: { userId: ctx.userId },
      });
      if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });

      const offer = await ctx.prisma.transferOffer.findUnique({
        where: { id: input.offerId },
      });
      if (!offer) throw new TRPCError({ code: "NOT_FOUND", message: "Offer not found." });
      if (offer.toTeamId !== team.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "This offer isn't directed at your team." });
      }
      if (offer.status !== "PENDING") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Offer is no longer pending." });
      }

      if (input.action === "ACCEPT") {
        await applyAcceptedOffer(ctx, offer.id);
      } else {
        await ctx.prisma.transferOffer.update({
          where: { id: offer.id },
          data: { status: "REJECTED" },
        });
      }
      return { ok: true };
    }),

  // ── Called by advanceDay to resolve pending AI decisions ──
  aiResolveOffers: protectedProcedure.mutation(async ({ ctx }) => {
    const n = await runAiOfferResolutions(ctx);
    return { resolved: n };
  }),
});
