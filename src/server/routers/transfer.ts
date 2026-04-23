import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, saveProcedure } from "../trpc";
import type { OfferStatus } from "@/generated/prisma/client";
import { effectiveBuyoutClause, stateFromScore } from "@/server/mercato/happiness";

const OFFER_DEADLINE_HOURS = 72;

function offerDeadline(): Date {
  return new Date(Date.now() + OFFER_DEADLINE_HOURS * 3600 * 1000);
}

function totalOfferCost(o: {
  transferFee: number;
  proposedSalary: number;
  signingBonus: number;
}): number {
  // Rough yearly cost for comparing offer rounds
  return o.transferFee + o.signingBonus + o.proposedSalary * 52;
}

// ── Helpers ──

type ResolveCtx = {
  // Minimal surface we use from PrismaClient so we can call this from
  // mutations as well as from hooks inside other routers (e.g. season.advanceDay).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any;
  save: { id: string };
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
): Promise<"ACCEPTED" | "REJECTED" | "COUNTERED" | "PENDING"> {
  const offer = await ctx.prisma.transferOffer.findUnique({
    where: { id: offerId },
    include: { player: true, fromTeam: true, toTeam: true, parentOffer: true },
  });
  if (!offer || offer.status !== "PENDING") return "PENDING";

  const player = offer.player;
  // WANTS_TRANSFER players push the selling team to accept at -30% clause
  // and halve the salary-demand rigidity.
  const isDesperate = stateFromScore(player.happiness) === "WANTS_TRANSFER";
  const salaryDemandMet = offer.proposedSalary >= Math.ceil(player.salary * (isDesperate ? 1.05 : 1.2));

  // Counter-offer path: we're replying to a round-1+ offer. Compare total
  // cost against the parent offer to decide accept / counter / reject.
  if (offer.negotiationRound > 1 && offer.parentOffer) {
    const parentCost = totalOfferCost(offer.parentOffer);
    const thisCost = totalOfferCost(offer);
    const costRatio = thisCost / Math.max(1, parentCost);

    if (costRatio <= 1.1) {
      await applyAcceptedOffer(ctx, offerId);
      return "ACCEPTED";
    }
    if (costRatio <= 1.3 && offer.negotiationRound < 3) {
      await createCounterOffer(ctx, offer, offer.parentOffer);
      await ctx.prisma.transferOffer.update({
        where: { id: offerId },
        data: { status: "COUNTERED" },
      });
      return "COUNTERED";
    }
    await ctx.prisma.transferOffer.update({
      where: { id: offerId },
      data: { status: "REJECTED" },
    });
    return "REJECTED";
  }

  let decision: "ACCEPTED" | "REJECTED" | "COUNTERED" = "REJECTED";

  if (offer.offerType === "BUYOUT") {
    const clause = effectiveBuyoutClause(player);
    const fee = offer.transferFee || 0;
    const effClauseThreshold = isDesperate ? clause * 0.9 : clause;

    if (clause > 0 && fee >= effClauseThreshold) {
      decision = salaryDemandMet ? "ACCEPTED" : "COUNTERED";
    } else if (clause > 0 && fee >= Math.floor(clause * 0.8)) {
      // Seller is open to a counter with adjusted terms
      decision = offer.negotiationRound < 3 ? "COUNTERED" : "REJECTED";
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
    if (offer.proposedSalary >= Math.ceil(player.salary * 1.1)) {
      decision = "ACCEPTED";
    } else {
      const ratio = offer.proposedSalary / Math.max(1, player.salary);
      decision = Math.random() < ratio * 0.4 ? "ACCEPTED" : "REJECTED";
    }
  }

  if (decision === "ACCEPTED") {
    await applyAcceptedOffer(ctx, offerId);
  } else if (decision === "COUNTERED") {
    await createCounterOffer(ctx, offer, null);
    await ctx.prisma.transferOffer.update({
      where: { id: offerId },
      data: { status: "COUNTERED" },
    });
  } else {
    await ctx.prisma.transferOffer.update({
      where: { id: offerId },
      data: { status: "REJECTED" },
    });
  }

  return decision;
}

/**
 * Creates a new counter-offer pointing at the given parent. Used by the AI
 * decision path when it wants to negotiate instead of outright reject.
 * If grandparent is provided (round 3 counter to a counter), midpoint the
 * terms between it and the current offer. Otherwise pivot from player's
 * expected terms.
 */
async function createCounterOffer(
  ctx: ResolveCtx,
  offer: {
    id: string;
    saveId: string | null;
    playerId: string;
    fromTeamId: string;
    toTeamId: string | null;
    offerType: string;
    transferFee: number;
    proposedSalary: number;
    contractLengthWeeks: number;
    signingBonus: number;
    sellOnPercentage: number;
    loyaltyBonus: number;
    negotiationRound: number;
    week: number;
    season: number;
  },
  grandparent: {
    transferFee: number;
    proposedSalary: number;
    signingBonus: number;
  } | null,
): Promise<void> {
  const player = await ctx.prisma.player.findUnique({
    where: { id: offer.playerId },
  });
  if (!player) return;

  let counterFee = offer.transferFee;
  let counterSalary = offer.proposedSalary;
  let counterBonus = offer.signingBonus;

  if (grandparent) {
    // Midpoint between grandparent (original IA offer) and current (user's counter)
    counterFee = Math.round((grandparent.transferFee + offer.transferFee) / 2);
    counterSalary = Math.round((grandparent.proposedSalary + offer.proposedSalary) / 2);
    counterBonus = Math.round((grandparent.signingBonus + offer.signingBonus) / 2);
  } else {
    // Round-1 counter from AI side — nudge terms toward the player's demands
    if (offer.offerType === "BUYOUT") {
      const clause = effectiveBuyoutClause(player);
      counterFee = Math.max(offer.transferFee, Math.round(clause * 0.95));
      counterSalary = Math.max(offer.proposedSalary, Math.ceil(player.salary * 1.2));
    } else {
      counterSalary = Math.max(offer.proposedSalary, player.salary);
    }
  }

  await ctx.prisma.transferOffer.create({
    data: {
      saveId: offer.saveId,
      playerId: offer.playerId,
      // Counter flips direction: we respond back to the offerer.
      fromTeamId: offer.toTeamId ?? offer.fromTeamId,
      toTeamId: offer.fromTeamId,
      offerType: offer.offerType as "BUYOUT" | "FREE_AGENT_SIGNING" | "CONTRACT_EXTENSION",
      transferFee: counterFee,
      proposedSalary: counterSalary,
      contractLengthWeeks: offer.contractLengthWeeks,
      signingBonus: counterBonus,
      sellOnPercentage: offer.sellOnPercentage,
      loyaltyBonus: offer.loyaltyBonus,
      status: "PENDING",
      week: offer.week,
      season: offer.season,
      negotiationRound: offer.negotiationRound + 1,
      parentOfferId: offer.id,
      deadlineAt: offerDeadline(),
    },
  });
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

  const season = await ctx.prisma.season.findFirst({ where: { isActive: true, saveId: ctx.save.id } });
  const currentSeason = season?.number ?? offer.season;
  const currentWeek = season?.currentWeek ?? offer.week;

  // Compute new contract end from current week + contract length
  const totalWeeks = currentWeek + offer.contractLengthWeeks;
  const newContractEndSeason = currentSeason + Math.floor(totalWeeks / 52);
  const newContractEndWeek = totalWeeks % 52 === 0 ? 52 : totalWeeks % 52;

  const updates: unknown[] = [];

  const newBuyoutClause = Math.ceil(offer.proposedSalary * 30);

  if (offer.offerType === "BUYOUT") {
    // Buyer pays transferFee + signingBonus. Seller receives transferFee.
    const buyerOutlay = offer.transferFee + offer.signingBonus;
    updates.push(
      ctx.prisma.team.update({
        where: { id: offer.fromTeamId },
        data: { budget: { decrement: buyerOutlay } },
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
          buyoutClause: newBuyoutClause,
          baseBuyoutClause: newBuyoutClause,
          joinedWeek: currentWeek,
          isTransferListed: false,
          happiness: Math.min(100, 75 + 15),
          happinessTags: ["RECENT_SIGNING"],
        },
      }),
    );
  } else if (offer.offerType === "FREE_AGENT_SIGNING") {
    // Upfront = 4w salary + signingBonus
    const buyerOutlay = offer.proposedSalary * 4 + offer.signingBonus;
    updates.push(
      ctx.prisma.team.update({
        where: { id: offer.fromTeamId },
        data: { budget: { decrement: buyerOutlay } },
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
          buyoutClause: newBuyoutClause,
          baseBuyoutClause: newBuyoutClause,
          joinedWeek: currentWeek,
          isTransferListed: false,
          happiness: Math.min(100, 75 + 15),
          happinessTags: ["RECENT_SIGNING"],
        },
      }),
    );
  } else if (offer.offerType === "CONTRACT_EXTENSION") {
    // Extension pays signingBonus upfront, raises salary, resets clause
    if (offer.signingBonus > 0) {
      updates.push(
        ctx.prisma.team.update({
          where: { id: offer.fromTeamId },
          data: { budget: { decrement: offer.signingBonus } },
        }),
      );
    }
    updates.push(
      ctx.prisma.player.update({
        where: { id: offer.playerId },
        data: {
          salary: offer.proposedSalary,
          contractEndSeason: newContractEndSeason,
          contractEndWeek: newContractEndWeek,
          buyoutClause: newBuyoutClause,
          baseBuyoutClause: newBuyoutClause,
          happiness: { increment: 10 },
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
  // Scope to the active save. Without this filter we would churn through
  // offers from other saves (multi-user prod deployment).
  const pending = await ctx.prisma.transferOffer.findMany({
    where: { status: "PENDING", saveId: ctx.save.id },
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
  listFreeAgents: saveProcedure
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
      // Template players (seeded from pandascore for cloning into saves) have
      // teamId=null AND currentTeam set. Real released free agents have
      // teamId=null AND currentTeam=null. Filter out templates.
      const where: Record<string, unknown> = {
        teamId: null,
        currentTeam: null,
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
  listMarketPlayers: saveProcedure
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
  makeOffer: saveProcedure
    .input(
      z.object({
        playerId: z.string(),
        offerType: z.enum(["FREE_AGENT_SIGNING", "BUYOUT", "CONTRACT_EXTENSION"]),
        transferFee: z.number().int().min(0).optional(),
        proposedSalary: z.number().int().min(0),
        contractLengthWeeks: z.number().int().min(1).max(208),
        signingBonus: z.number().int().min(0).optional(),
        sellOnPercentage: z.number().min(0).max(50).optional(),
        loyaltyBonus: z.number().int().min(0).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const team = await ctx.prisma.team.findUnique({
        where: { userId: ctx.userId },
      });
      if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });

      const season = await ctx.prisma.season.findFirst({ where: { isActive: true, saveId: ctx.save.id } });
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
          throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot buyout your own player — use extension." });
        }
      }
      if (input.offerType === "CONTRACT_EXTENSION" && player.teamId !== team.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Can only extend your own players." });
      }

      // Cooldown: 4 weeks after a REJECTED/EXPIRED offer on the same player
      const lastClosed = await ctx.prisma.transferOffer.findFirst({
        where: {
          fromTeamId: team.id,
          playerId: input.playerId,
          status: { in: ["REJECTED", "EXPIRED"] },
        },
        orderBy: { createdAt: "desc" },
        select: { week: true, season: true },
      });
      if (lastClosed) {
        const weeksSince =
          (season.number - lastClosed.season) * 52 + (season.currentWeek - lastClosed.week);
        if (weeksSince < 4) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `This player declined your offer recently. Try again in ${4 - weeksSince} week(s).`,
          });
        }
      }

      const transferFee = input.transferFee ?? 0;
      const signingBonus = input.signingBonus ?? 0;
      const sellOnPercentage = input.sellOnPercentage ?? 0;
      const loyaltyBonus = input.loyaltyBonus ?? 0;
      const upfrontCost =
        input.offerType === "BUYOUT"
          ? transferFee + signingBonus
          : input.offerType === "FREE_AGENT_SIGNING"
            ? input.proposedSalary * 4 + signingBonus
            : signingBonus;

      // Soft budget cap: sum of pending upfronts + this one ≤ budget
      const pendingOffers = await ctx.prisma.transferOffer.findMany({
        where: { fromTeamId: team.id, status: "PENDING" },
        select: { offerType: true, transferFee: true, proposedSalary: true, signingBonus: true },
      });
      const committed = pendingOffers.reduce((sum, o) => {
        const up =
          o.offerType === "BUYOUT"
            ? o.transferFee + o.signingBonus
            : o.offerType === "FREE_AGENT_SIGNING"
              ? o.proposedSalary * 4 + o.signingBonus
              : o.signingBonus;
        return sum + up;
      }, 0);
      if (committed + upfrontCost > team.budget) {
        const remaining = Math.max(0, team.budget - committed);
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Not enough free budget. Need $${upfrontCost.toLocaleString()}, only $${remaining.toLocaleString()} uncommitted after pending offers.`,
        });
      }

      // Create the offer (PENDING initially)
      const offer = await ctx.prisma.transferOffer.create({
        data: {
          saveId: ctx.save.id,
          playerId: input.playerId,
          fromTeamId: team.id,
          toTeamId: input.offerType === "BUYOUT" ? player.teamId : null,
          offerType: input.offerType,
          transferFee,
          proposedSalary: input.proposedSalary,
          contractLengthWeeks: input.contractLengthWeeks,
          signingBonus,
          sellOnPercentage,
          loyaltyBonus,
          status: "PENDING",
          week: season.currentWeek,
          season: season.number,
          negotiationRound: 1,
          deadlineAt: offerDeadline(),
        },
      });

      // Auto-resolve FA signings and auto-accept BUYOUTs where fee >= clause
      let decision: OfferStatus = "PENDING";
      if (input.offerType === "FREE_AGENT_SIGNING") {
        const d = await resolveOfferDecision(ctx, offer.id);
        decision = d as OfferStatus;
      } else if (input.offerType === "BUYOUT") {
        const clause = effectiveBuyoutClause(player);
        // Auto-resolve only when fee triggers automatic acceptance, else keep PENDING
        if (transferFee >= clause) {
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
  myOffers: saveProcedure.query(async ({ ctx }) => {
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

  // ── Accept/reject/counter an incoming offer ──
  respondToOffer: saveProcedure
    .input(
      z.object({
        offerId: z.string(),
        action: z.enum(["ACCEPT", "REJECT", "COUNTER"]),
        counter: z
          .object({
            transferFee: z.number().int().min(0).optional(),
            proposedSalary: z.number().int().min(0),
            contractLengthWeeks: z.number().int().min(1).max(208),
            signingBonus: z.number().int().min(0).optional(),
            sellOnPercentage: z.number().min(0).max(50).optional(),
            loyaltyBonus: z.number().int().min(0).optional(),
          })
          .optional(),
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
        return { ok: true, resolvedAs: "ACCEPTED" as const };
      }
      if (input.action === "REJECT") {
        await ctx.prisma.transferOffer.update({
          where: { id: offer.id },
          data: { status: "REJECTED" },
        });
        return { ok: true, resolvedAs: "REJECTED" as const };
      }

      // COUNTER
      if (!input.counter) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Counter payload required." });
      }
      if (offer.negotiationRound >= 3) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Final round — counter-offer no longer allowed.",
        });
      }

      const season = await ctx.prisma.season.findFirst({ where: { isActive: true, saveId: ctx.save.id } });
      if (!season) throw new TRPCError({ code: "NOT_FOUND", message: "No active season." });

      // Parent of the counter = this offer; mark it COUNTERED.
      await ctx.prisma.transferOffer.update({
        where: { id: offer.id },
        data: { status: "COUNTERED" },
      });

      // Create the counter going back to the original sender (role-swap).
      const child = await ctx.prisma.transferOffer.create({
        data: {
          saveId: ctx.save.id,
          playerId: offer.playerId,
          fromTeamId: team.id,
          toTeamId: offer.fromTeamId,
          offerType: offer.offerType,
          transferFee: input.counter.transferFee ?? offer.transferFee,
          proposedSalary: input.counter.proposedSalary,
          contractLengthWeeks: input.counter.contractLengthWeeks,
          signingBonus: input.counter.signingBonus ?? offer.signingBonus,
          sellOnPercentage: input.counter.sellOnPercentage ?? offer.sellOnPercentage,
          loyaltyBonus: input.counter.loyaltyBonus ?? offer.loyaltyBonus,
          status: "PENDING",
          week: season.currentWeek,
          season: season.number,
          negotiationRound: offer.negotiationRound + 1,
          parentOfferId: offer.id,
          deadlineAt: offerDeadline(),
        },
      });

      // Counters from the user flow are evaluated immediately by the IA
      const d = await resolveOfferDecision(ctx, child.id);
      return { ok: true, resolvedAs: d, counterOfferId: child.id };
    }),

  // ── Fetch full negotiation chain for a given offer ──
  getNegotiationChain: saveProcedure
    .input(z.object({ offerId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Walk up to the root
      let cursor: string | null = input.offerId;
      const seen = new Set<string>();
      while (cursor) {
        if (seen.has(cursor)) break;
        seen.add(cursor);
        const parent: { parentOfferId: string | null } | null =
          await ctx.prisma.transferOffer.findUnique({
            where: { id: cursor },
            select: { parentOfferId: true },
          });
        if (!parent?.parentOfferId) break;
        cursor = parent.parentOfferId;
      }
      const rootId = cursor;
      if (!rootId) return [];

      // Walk back down collecting the full chain
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any[] = [];
      let nextId: string | null = rootId;
      while (nextId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const node: any = await ctx.prisma.transferOffer.findUnique({
          where: { id: nextId },
          include: {
            player: { select: { id: true, ign: true, role: true, imageUrl: true } },
            fromTeam: { select: { id: true, name: true, tag: true, logoUrl: true } },
            toTeam: { select: { id: true, name: true, tag: true, logoUrl: true } },
          },
        });
        if (!node) break;
        chain.push(node);
        const childRow: { id: string } | null = await ctx.prisma.transferOffer.findFirst({
          where: { parentOfferId: node.id },
          select: { id: true },
          orderBy: { createdAt: "asc" },
        });
        nextId = childRow?.id ?? null;
      }
      return chain;
    }),

  // ── Called by advanceDay to resolve pending AI decisions ──
  aiResolveOffers: saveProcedure.mutation(async ({ ctx }) => {
    const n = await runAiOfferResolutions(ctx);
    return { resolved: n };
  }),
});
