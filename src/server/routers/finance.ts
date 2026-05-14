import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, saveProcedure } from "../trpc";
import { totalAvailable } from "@/server/finance/budgets";
import { computeWeeklyRevenue } from "@/server/finance/revenue";
import { computeWeeklyOperationalCost } from "@/server/finance/operations";

const SCOUTING_REVEAL_WEEKS = 4;
const ROLES = ["Duelist", "Initiator", "Sentinel", "Controller", "Flex", "IGL"] as const;

/**
 * Finance router — read-only finance overview + board-allocation rebalance.
 *
 * The rebalance endpoint lets the user reshape transferBudget /
 * wageBudgetSeason / operational `budget` without losing any total capital.
 * Three slider values that must sum to current totalAvailable.
 */
export const financeRouter = router({
  overview: saveProcedure.query(async ({ ctx }) => {
    const team = await ctx.prisma.team.findFirst({
      where: { saveId: ctx.save.id, isPlayerTeam: true },
      include: {
        players: { where: { isActive: true }, select: { salary: true } },
        coach: { select: { salary: true } },
        sponsors: {
          where: { isActive: true },
          select: { name: true, weeklyPayment: true, contractEndSeason: true, contractEndWeek: true },
        },
      },
    });
    if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });

    const totalSalary = team.players.reduce((s, p) => s + p.salary, 0);
    const coachSalary = team.coach?.salary ?? 0;
    const sponsorIncome = team.sponsors.reduce((s, sp) => s + sp.weeklyPayment, 0);
    const weeklyRev = computeWeeklyRevenue({ prestige: team.prestige });
    const ops = computeWeeklyOperationalCost({
      facilityTier: team.facilityTier,
      bootcampWeeksLeft: team.bootcampWeeksLeft,
    });

    const weeklyIncome = sponsorIncome + weeklyRev.total;
    const weeklyExpense = totalSalary + coachSalary + ops.total;
    const weeklyNet = weeklyIncome - weeklyExpense;

    return {
      buckets: {
        operational: team.budget,
        transfer: team.transferBudget,
        wage: team.wageBudgetSeason,
        total: totalAvailable({
          budget: team.budget,
          transferBudget: team.transferBudget,
          wageBudgetSeason: team.wageBudgetSeason,
        }),
      },
      debt: {
        amount: team.debt,
        patience: team.investorPatience,
        warningAt: Math.round(team.investorPatience * 0.5),
        bankruptcyAt: team.investorPatience,
        isBankrupt: team.isBankrupt,
      },
      weekly: {
        sponsorIncome,
        riotFee: weeklyRev.riotFee,
        merch: weeklyRev.merch,
        totalIncome: weeklyIncome,
        playerWages: totalSalary,
        coachWage: coachSalary,
        facility: ops.facility,
        bootcamp: ops.bootcamp,
        totalExpense: weeklyExpense,
        net: weeklyNet,
      },
      operations: {
        facilityTier: team.facilityTier,
        bootcampWeeksLeft: team.bootcampWeeksLeft,
      },
      sponsors: team.sponsors,
    };
  }),

  /**
   * Reshape the 3 buckets without changing total capital. All three amounts
   * must be non-negative and sum to the current total. Mid-season rebalances
   * are allowed but should incur a small board-relationship cost (Phase 3
   * V2 — for now, free).
   */
  rebalanceBudget: saveProcedure
    .input(
      z.object({
        transferBudget: z.number().int().min(0),
        wageBudgetSeason: z.number().int().min(0),
        operationalBudget: z.number().int().min(0),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const team = await ctx.prisma.team.findFirst({
        where: { saveId: ctx.save.id, isPlayerTeam: true },
      });
      if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });

      const currentTotal = totalAvailable({
        budget: team.budget,
        transferBudget: team.transferBudget,
        wageBudgetSeason: team.wageBudgetSeason,
      });
      const requested =
        input.transferBudget + input.wageBudgetSeason + input.operationalBudget;
      if (requested !== currentTotal) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Allocation must sum to $${currentTotal.toLocaleString()} (got $${requested.toLocaleString()}).`,
        });
      }

      await ctx.prisma.team.update({
        where: { id: team.id },
        data: {
          transferBudget: input.transferBudget,
          wageBudgetSeason: input.wageBudgetSeason,
          budget: input.operationalBudget,
        },
      });
      return { ok: true };
    }),

  /**
   * Toggle bootcamp on/off. Setting weeks > 0 turns on; 0 turns off. The
   * weekly tick deducts $5k/week + decrements the counter.
   */
  setBootcamp: saveProcedure
    .input(z.object({ weeks: z.number().int().min(0).max(12) }))
    .mutation(async ({ ctx, input }) => {
      const team = await ctx.prisma.team.findFirst({
        where: { saveId: ctx.save.id, isPlayerTeam: true },
      });
      if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
      await ctx.prisma.team.update({
        where: { id: team.id },
        data: { bootcampWeeksLeft: input.weeks },
      });
      return { ok: true };
    }),

  /**
   * Upgrade or downgrade facility tier. Tiers cost cash upfront (the build
   * out): $50k per tier delta. Charged from operational budget. Tier 1-5.
   */
  setFacilityTier: saveProcedure
    .input(z.object({ tier: z.number().int().min(1).max(5) }))
    .mutation(async ({ ctx, input }) => {
      const team = await ctx.prisma.team.findFirst({
        where: { saveId: ctx.save.id, isPlayerTeam: true },
      });
      if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });
      const delta = input.tier - team.facilityTier;
      const upfrontCost = delta > 0 ? delta * 50_000 : 0;
      if (upfrontCost > team.budget) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Need $${upfrontCost.toLocaleString()} operational, have $${team.budget.toLocaleString()}.`,
        });
      }
      await ctx.prisma.team.update({
        where: { id: team.id },
        data: {
          facilityTier: input.tier,
          budget: { decrement: upfrontCost },
        },
      });
      return { ok: true };
    }),

  /**
   * Combined dashboard-ticker payload — replaces the 4 separate trpc queries
   * the client was firing (finance.overview + scouting.list + recommended +
   * season.getCurrent). Single RTT, only the fields the ticker actually
   * renders.
   */
  ticker: saveProcedure.query(async ({ ctx }) => {
    const [season, team] = await Promise.all([
      ctx.prisma.season.findFirst({
        where: { isActive: true, saveId: ctx.save.id },
        select: { number: true, currentWeek: true },
      }),
      ctx.prisma.team.findFirst({
        where: { saveId: ctx.save.id, isPlayerTeam: true },
        select: {
          id: true, prestige: true,
          budget: true, transferBudget: true, wageBudgetSeason: true,
          debt: true, investorPatience: true, isBankrupt: true,
          facilityTier: true, bootcampWeeksLeft: true,
          players: {
            where: { isActive: true, isRetired: false, isReserve: false },
            select: { role: true, overall: true, salary: true },
          },
          coach: { select: { salary: true } },
          sponsors: {
            where: { isActive: true },
            select: { weeklyPayment: true },
          },
        },
      }),
    ]);
    if (!team) return null;
    const absWeek = season ? season.number * 52 + season.currentWeek : 0;

    // Weekly net (compact, same math as overview but skipping breakdown noise).
    const totalSalary = team.players.reduce((s, p) => s + p.salary, 0);
    const coachSalary = team.coach?.salary ?? 0;
    const sponsorIncome = team.sponsors.reduce((s, sp) => s + sp.weeklyPayment, 0);
    const weeklyRev = computeWeeklyRevenue({ prestige: team.prestige });
    const ops = computeWeeklyOperationalCost({
      facilityTier: team.facilityTier,
      bootcampWeeksLeft: team.bootcampWeeksLeft,
    });
    const weeklyNet =
      sponsorIncome + weeklyRev.total - totalSalary - coachSalary - ops.total;

    // Shortlist with player fields the ticker shows.
    const shortlist = await ctx.prisma.shortlist.findMany({
      where: { teamId: team.id },
      take: 4,
      orderBy: { addedWeek: "desc" },
      select: {
        id: true,
        addedWeek: true,
        player: {
          select: {
            id: true,
            ign: true,
            role: true,
            potential: true,
            potentialRevealed: true,
          },
        },
      },
    });

    // Recommended — gap-aware (same logic as scouting.recommended but inlined
    // so we don't fire a second tRPC RTT just to get this slice).
    const rolesPresent = new Set(team.players.map((p) => p.role));
    const missingRoles = ROLES.filter((r) => !rolesPresent.has(r));
    const teamAvg = team.players.length > 0
      ? team.players.reduce((s, p) => s + (p.overall ?? 10), 0) / team.players.length
      : 10;
    const transferEnvelope = team.transferBudget + team.budget;
    const candidates = await ctx.prisma.player.findMany({
      where: {
        isRetired: false,
        isActive: true,
        OR: [{ teamId: null }, { isTransferListed: true }],
        NOT: { teamId: team.id },
      },
      select: {
        id: true, ign: true, role: true, overall: true,
        salary: true, teamId: true, buyoutClause: true,
      },
      orderBy: { overall: "desc" },
      take: 30,
    });
    const scored = candidates.map((c) => {
      let score = (c.overall ?? 10) * 5;
      let reason = "Upgrade candidate";
      if (missingRoles.includes(c.role as typeof ROLES[number])) {
        score += 50;
        reason = `Fills ${c.role} gap`;
      }
      if ((c.overall ?? 10) > teamAvg + 1) score += 20;
      const upfront = c.teamId == null ? c.salary * 4 : (c.buyoutClause ?? c.salary * 30);
      if (upfront <= transferEnvelope) score += 15;
      else score -= 30;
      if (c.teamId == null && reason === "Upgrade candidate") reason = "Free agent";
      return { id: c.id, ign: c.ign, role: c.role, overall: c.overall, score, reason };
    });
    scored.sort((a, b) => b.score - a.score);

    return {
      absWeek,
      revealWeeks: SCOUTING_REVEAL_WEEKS,
      buckets: {
        operational: team.budget,
        transfer: team.transferBudget,
        wage: team.wageBudgetSeason,
      },
      debt: {
        amount: team.debt,
        patience: team.investorPatience,
        isBankrupt: team.isBankrupt,
      },
      weeklyNet,
      shortlist,
      recommended: scored.slice(0, 4),
    };
  }),
});
