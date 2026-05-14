import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, saveProcedure } from "../trpc";
import type { StaffRole, Region } from "@/generated/prisma/client";
import { STAFF_SLOTS, scaledSalary, ALL_STAFF_ROLES } from "@/constants/staff";

const STAFF_ROLE_ENUM = z.enum(["COACH", "ANALYST", "MANAGER", "FITNESS"]);

// Name pools — kept lightweight here; the market regenerates per save+region.
const FIRST = ["Marc", "Tom", "Ben", "Liam", "Noah", "Lucas", "Ethan", "Sam", "Felix", "Jonas", "Pablo", "Diego", "Hiro", "Kenji", "Wei"];
const LAST = ["Smith", "Müller", "Dubois", "Rossi", "Silva", "Park", "Tanaka", "Wang", "Costa", "Bauer", "Andersson", "Novak"];
function randInt(min: number, max: number) { return Math.floor(min + Math.random() * (max - min + 1)); }
function pick<T>(a: ReadonlyArray<T>): T { return a[Math.floor(Math.random() * a.length)]; }

function generateMarketOffer(role: StaffRole, region: Region) {
  // Market candidates skew slightly above team-average prestige skills.
  const skillBase = randInt(40, 75);
  const variance = () => randInt(-8, 8);
  const skill1 = Math.max(10, Math.min(95, skillBase + variance()));
  const skill2 = Math.max(10, Math.min(95, skillBase + variance()));
  const skill3 = Math.max(10, Math.min(95, skillBase + variance()));
  return {
    id: `mkt-${role}-${region}-${Math.random().toString(36).slice(2, 8)}`,
    name: `${pick(FIRST)} ${pick(LAST)}`,
    role,
    region,
    age: randInt(28, 48),
    skill1,
    skill2,
    skill3,
    salary: scaledSalary(role, (skill1 + skill2 + skill3) / 3),
  };
}

// Per-save+region+role market cache. Regenerated on a stage transition.
type CachedOffer = ReturnType<typeof generateMarketOffer>;
const marketCache = new Map<string, CachedOffer[]>();
export function invalidateStaffMarket(): void {
  marketCache.clear();
}

function getMarket(region: Region, role: StaffRole, stage: string): CachedOffer[] {
  const key = `${region}:${role}:${stage}`;
  let offers = marketCache.get(key);
  if (!offers) {
    offers = Array.from({ length: 5 }, () => generateMarketOffer(role, region));
    marketCache.set(key, offers);
  }
  return offers;
}

export const staffRouter = router({
  /** All staff currently on the user team — grouped by role. */
  listMine: saveProcedure.query(async ({ ctx }) => {
    const team = await ctx.prisma.team.findFirst({
      where: { saveId: ctx.save.id, isPlayerTeam: true },
      select: { id: true },
    });
    if (!team) return { staff: [], slots: emptySlots() };
    const staff = await ctx.prisma.staff.findMany({
      where: { teamId: team.id },
      orderBy: [{ role: "asc" }, { salary: "desc" }],
    });
    const counts: Record<StaffRole, number> = {
      COACH: 0, ANALYST: 0, MANAGER: 0, FITNESS: 0,
    };
    for (const s of staff) counts[s.role]++;
    return {
      staff,
      slots: ALL_STAFF_ROLES.reduce((acc, role) => {
        const rule = STAFF_SLOTS[role];
        acc[role] = {
          current: counts[role],
          min: rule.min,
          max: rule.max,
          canHire: counts[role] < rule.max,
          canFireLast: counts[role] > rule.min,
        };
        return acc;
      }, emptySlots()),
    };
  }),

  /** Staff market filtered by role. Region matches the user team's. */
  listMarket: saveProcedure
    .input(z.object({ role: STAFF_ROLE_ENUM }))
    .query(async ({ ctx, input }) => {
      const team = await ctx.prisma.team.findFirst({
        where: { saveId: ctx.save.id, isPlayerTeam: true },
        select: { region: true },
      });
      if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
      const season = await ctx.prisma.season.findFirst({
        where: { saveId: ctx.save.id, isActive: true },
        select: { currentStage: true, number: true },
      });
      const stage = `${season?.number ?? 1}:${season?.currentStage ?? "KICKOFF"}`;
      return getMarket(team.region as Region, input.role, stage);
    }),

  /**
   * Hire a market candidate. Validates slot capacity + budget envelope. The
   * "candidate" can be a freshly generated market offer (passed as input) or
   * a custom record — we don't persist offers, so the client passes the
   * candidate fields verbatim.
   */
  hire: saveProcedure
    .input(
      z.object({
        name: z.string(),
        role: STAFF_ROLE_ENUM,
        region: z.string(),
        nationality: z.string().optional(),
        age: z.number().int().min(20).max(70),
        salary: z.number().int().min(1000),
        skill1: z.number().int().min(0).max(100),
        skill2: z.number().int().min(0).max(100),
        skill3: z.number().int().min(0).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const team = await ctx.prisma.team.findFirst({
        where: { saveId: ctx.save.id, isPlayerTeam: true },
        select: { id: true, region: true },
      });
      if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });

      // Slot capacity check
      const count = await ctx.prisma.staff.count({
        where: { teamId: team.id, role: input.role },
      });
      const rule = STAFF_SLOTS[input.role];
      if (count >= rule.max) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Slot full — already have ${count}/${rule.max} ${input.role.toLowerCase()}(s).`,
        });
      }

      await ctx.prisma.staff.create({
        data: {
          saveId: ctx.save.id,
          teamId: team.id,
          name: input.name,
          role: input.role,
          region: input.region,
          nationality: input.nationality ?? "Unknown",
          age: input.age,
          salary: input.salary,
          skill1: input.skill1,
          skill2: input.skill2,
          skill3: input.skill3,
        },
      });
      return { ok: true };
    }),

  /**
   * Fire a staff member. Refuses to drop below the role's min (e.g. firing
   * the only Manager / Analyst — must hire a replacement first).
   */
  fire: saveProcedure
    .input(z.object({ staffId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const team = await ctx.prisma.team.findFirst({
        where: { saveId: ctx.save.id, isPlayerTeam: true },
        select: { id: true },
      });
      if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });

      const staff = await ctx.prisma.staff.findUnique({
        where: { id: input.staffId },
      });
      if (!staff || staff.teamId !== team.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Not your staff." });
      }

      const count = await ctx.prisma.staff.count({
        where: { teamId: team.id, role: staff.role },
      });
      const rule = STAFF_SLOTS[staff.role];
      if (count <= rule.min) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Cannot fire — ${staff.role.toLowerCase()} at minimum (${rule.min}). Hire a replacement first.`,
        });
      }

      await ctx.prisma.staff.delete({ where: { id: input.staffId } });
      return { ok: true };
    }),
});

function emptySlots() {
  return ALL_STAFF_ROLES.reduce((acc, role) => {
    acc[role] = { current: 0, min: 0, max: 0, canHire: false, canFireLast: false };
    return acc;
  }, {} as Record<StaffRole, { current: number; min: number; max: number; canHire: boolean; canFireLast: boolean }>);
}
