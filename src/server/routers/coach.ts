import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";
import type { Region } from "@/generated/prisma/client";

// ── Coach generation data ──

const COACH_NAMES = [
  "Sliggy",
  "Potter",
  "Neilzinho",
  "Aiko",
  "Salah",
  "Mortal",
  "Lothar",
  "DDKong",
  "Penny",
  "kamo",
  "Heurtelou",
  "CigaN",
  "Enemy",
  "ItsMajicHD",
  "Dali",
  "fRoD",
  "TOGGLE",
  "mCe",
  "Elmapuddy",
  "Banks",
  "Bucky",
  "Orion",
  "Skadoodle",
  "tacolilla",
  "onur",
  "PlayerOne",
  "Chemistry",
  "Lunatik",
  "Drexxie",
];

// Region → nationality list (simple mapping)
const NATIONALITIES_BY_REGION: Record<Region, string[]> = {
  EMEA: ["FR", "DE", "GB", "ES", "SE", "TR", "PL", "IT", "NL", "UA"],
  Americas: ["US", "BR", "AR", "CA", "CL", "MX"],
  Pacific: ["KR", "JP", "ID", "PH", "TH", "SG", "AU"],
  China: ["CN"],
};

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

// In-memory cache: key `${region}:${stage}:${season}` => generated coaches
interface CoachOffer {
  id: string;
  name: string;
  nationality: string;
  age: number;
  salary: number;
  utilityBoost: number;
  trainingEff: number;
  scoutingSkill: number;
}

const coachOfferCache = new Map<string, CoachOffer[]>();

function generateCoachOffer(region: Region): CoachOffer {
  const utilityBoost = randInt(30, 95);
  const trainingEff = randInt(30, 95);
  const scoutingSkill = randInt(30, 95);
  const statAvg = (utilityBoost + trainingEff + scoutingSkill) / 3;
  // Salary scales from $5k to $30k/week based on stat avg.
  const salary = Math.round(5000 + (statAvg / 100) * 25000);

  return {
    id: `coach-${Math.random().toString(36).slice(2, 10)}`,
    name: pick(COACH_NAMES),
    nationality: pick(NATIONALITIES_BY_REGION[region]),
    age: randInt(28, 45),
    salary,
    utilityBoost,
    trainingEff,
    scoutingSkill,
  };
}

function generateCoachOffers(region: Region): CoachOffer[] {
  // 10 random coaches, unique names preferred
  const names = shuffle([...COACH_NAMES]).slice(0, 10);
  return names.map((name) => {
    const offer = generateCoachOffer(region);
    return { ...offer, name };
  });
}

export const coachRouter = router({
  listMyCoach: protectedProcedure.query(async ({ ctx }) => {
    const team = await ctx.prisma.team.findUnique({
      where: { userId: ctx.userId },
      include: { coach: true },
    });
    if (!team) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
    }
    return team.coach;
  }),

  listAvailableCoaches: protectedProcedure.query(async ({ ctx }) => {
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

    const cacheKey = `${team.region}:${season.currentStage}:${season.number}`;
    let offers = coachOfferCache.get(cacheKey);
    if (!offers) {
      offers = generateCoachOffers(team.region);
      coachOfferCache.set(cacheKey, offers);
    }

    return offers;
  }),

  hireCoach: protectedProcedure
    .input(
      z.object({
        coachOfferId: z.string(),
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

      const cacheKey = `${team.region}:${season.currentStage}:${season.number}`;
      const offers = coachOfferCache.get(cacheKey);
      if (!offers) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No coach offers available. Please refresh.",
        });
      }

      const offer = offers.find((o) => o.id === input.coachOfferId);
      if (!offer) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Coach offer not found.",
        });
      }

      if (team.budget < offer.salary) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Insufficient budget to pay first week salary.",
        });
      }

      // Contract default: 52 weeks (1 full season)
      const contractEndSeason = season.number;
      const contractEndWeek = 52;

      // Create the coach
      const coach = await ctx.prisma.coach.create({
        data: {
          name: offer.name,
          nationality: offer.nationality,
          age: offer.age,
          salary: offer.salary,
          utilityBoost: offer.utilityBoost,
          trainingEff: offer.trainingEff,
          scoutingSkill: offer.scoutingSkill,
          contractEndSeason,
          contractEndWeek,
        },
      });

      // If team already has a coach, remove link (fire previous)
      // Then hire new coach + deduct first week salary
      await ctx.prisma.team.update({
        where: { id: team.id },
        data: {
          coachId: coach.id,
          budget: team.budget - offer.salary,
        },
      });

      // Remove from cache so it cannot be re-hired
      coachOfferCache.set(
        cacheKey,
        offers.filter((o) => o.id !== input.coachOfferId),
      );

      return coach;
    }),

  fireCoach: protectedProcedure.mutation(async ({ ctx }) => {
    const team = await ctx.prisma.team.findUnique({
      where: { userId: ctx.userId },
    });
    if (!team) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
    }

    if (!team.coachId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "You don't have a coach.",
      });
    }

    const coachId = team.coachId;

    // Unlink first, then delete coach row
    await ctx.prisma.team.update({
      where: { id: team.id },
      data: { coachId: null },
    });

    // Best-effort delete; coach could be shared in theory, but per our model
    // each coach is linked 1-to-1 to the team that hired them.
    await ctx.prisma.coach.delete({ where: { id: coachId } }).catch(() => {});

    return { success: true };
  }),
});

/** Invalidate coach offers cache when the stage transitions. */
export function invalidateCoachOffersCache(): void {
  coachOfferCache.clear();
}
