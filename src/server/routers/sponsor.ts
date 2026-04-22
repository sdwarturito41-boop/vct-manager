import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import type { SponsorTier } from "@/generated/prisma/client";

// ── Sponsor generation data ──

const SPONSOR_NAMES_T1 = [
  "Red Bull",
  "Logitech G",
  "Mercedes-Benz",
  "Riot Games",
  "Mastercard",
  "Secretlab",
  "Nike",
  "Intel",
  "BMW",
  "Prime Gaming",
];

const SPONSOR_NAMES_T2 = [
  "HyperX",
  "Razer",
  "SteelSeries",
  "DXRacer",
  "G FUEL",
  "Corsair",
  "MSI",
  "BenQ ZOWIE",
  "NoblePlayer",
  "HP Omen",
];

const SPONSOR_NAMES_T3 = [
  "LocalNet ISP",
  "PixelCafe",
  "Byte Energy",
  "QuickClick Mice",
  "NovaChairs",
  "FragFuel",
  "ClutchCola",
  "BitBurger",
  "PingWorld",
  "StreamKit",
];

// In-memory cache for sponsor offers per team / per stage.
// Key: `${teamId}:${stage}:${season}` => offer list
interface SponsorOffer {
  id: string;
  name: string;
  tier: SponsorTier;
  weeklyPayment: number;
  winBonus: number;
  champPtsBonus: number;
  durationWeeks: number;
}

const offerCache = new Map<string, SponsorOffer[]>();

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function generateOfferForTier(tier: SponsorTier): SponsorOffer {
  const id = `offer-${Math.random().toString(36).slice(2, 10)}`;
  if (tier === "Tier1") {
    return {
      id,
      name: pick(SPONSOR_NAMES_T1),
      tier,
      weeklyPayment: randInt(25000, 50000),
      winBonus: 5000,
      champPtsBonus: 100,
      durationWeeks: 26,
    };
  }
  if (tier === "Tier2") {
    return {
      id,
      name: pick(SPONSOR_NAMES_T2),
      tier,
      weeklyPayment: randInt(10000, 20000),
      winBonus: 2000,
      champPtsBonus: 50,
      durationWeeks: 26,
    };
  }
  return {
    id,
    name: pick(SPONSOR_NAMES_T3),
    tier,
    weeklyPayment: randInt(3000, 8000),
    winBonus: 500,
    champPtsBonus: 0,
    durationWeeks: 26,
  };
}

function generateOffers(prestige: number): SponsorOffer[] {
  const offers: SponsorOffer[] = [];
  for (let i = 0; i < 3; i++) {
    let tier: SponsorTier;
    if (prestige < 40) {
      tier = "Tier3";
    } else if (prestige <= 70) {
      // Tier 2 or 3
      tier = Math.random() < 0.6 ? "Tier2" : "Tier3";
    } else {
      // Tier 1, 2, or 3 possible
      const r = Math.random();
      if (r < 0.35) tier = "Tier1";
      else if (r < 0.75) tier = "Tier2";
      else tier = "Tier3";
    }
    offers.push(generateOfferForTier(tier));
  }
  return offers;
}

export const sponsorRouter = router({
  listMySponsors: protectedProcedure.query(async ({ ctx }) => {
    const team = await ctx.prisma.team.findUnique({
      where: { userId: ctx.userId },
    });
    if (!team) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
    }

    const sponsors = await ctx.prisma.sponsor.findMany({
      where: { teamId: team.id, isActive: true },
      orderBy: { createdAt: "desc" },
    });

    return sponsors;
  }),

  listOffers: protectedProcedure.query(async ({ ctx }) => {
    const team = await ctx.prisma.team.findUnique({
      where: { userId: ctx.userId },
    });
    if (!team) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
    }

    const season = await ctx.prisma.season.findFirst({ where: { isActive: true } });
    if (!season) {
      throw new TRPCError({ code: "NOT_FOUND", message: "No active season." });
    }

    const cacheKey = `${team.id}:${season.currentStage}:${season.number}`;
    let offers = offerCache.get(cacheKey);
    if (!offers) {
      offers = generateOffers(team.prestige);
      offerCache.set(cacheKey, offers);
    }

    return offers;
  }),

  acceptSponsor: protectedProcedure
    .input(
      z.object({
        offerId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const team = await ctx.prisma.team.findUnique({
        where: { userId: ctx.userId },
      });
      if (!team) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
      }

      const season = await ctx.prisma.season.findFirst({ where: { isActive: true } });
      if (!season) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No active season." });
      }

      const cacheKey = `${team.id}:${season.currentStage}:${season.number}`;
      const offers = offerCache.get(cacheKey);
      if (!offers) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No offers available. Please refresh.",
        });
      }

      const offer = offers.find((o) => o.id === input.offerId);
      if (!offer) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Sponsor offer not found.",
        });
      }

      // Compute contract end week/season (26 weeks from current week)
      const totalWeeks = season.currentWeek + offer.durationWeeks;
      const WEEKS_PER_SEASON = 52;
      const contractEndSeason =
        season.number + Math.floor((totalWeeks - 1) / WEEKS_PER_SEASON);
      const contractEndWeek = ((totalWeeks - 1) % WEEKS_PER_SEASON) + 1;

      const sponsor = await ctx.prisma.sponsor.create({
        data: {
          teamId: team.id,
          name: offer.name,
          tier: offer.tier,
          weeklyPayment: offer.weeklyPayment,
          winBonus: offer.winBonus,
          champPtsBonus: offer.champPtsBonus,
          contractEndSeason,
          contractEndWeek,
          isActive: true,
        },
      });

      // Remove the accepted offer from cache
      offerCache.set(
        cacheKey,
        offers.filter((o) => o.id !== input.offerId),
      );

      return sponsor;
    }),

  dropSponsor: protectedProcedure
    .input(
      z.object({
        sponsorId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const team = await ctx.prisma.team.findUnique({
        where: { userId: ctx.userId },
      });
      if (!team) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
      }

      const sponsor = await ctx.prisma.sponsor.findUnique({
        where: { id: input.sponsorId },
      });

      if (!sponsor || sponsor.teamId !== team.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Sponsor is not on your team.",
        });
      }

      await ctx.prisma.sponsor.delete({
        where: { id: sponsor.id },
      });

      return { success: true };
    }),
});

// ── Helper for other systems ──

/** Invalidate sponsor offers cache when the stage transitions. */
export function invalidateSponsorOffersCache(): void {
  offerCache.clear();
}
