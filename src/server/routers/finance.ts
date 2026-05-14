import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, saveProcedure } from "../trpc";
import { totalAvailable } from "@/server/finance/budgets";
import { computeWeeklyRevenue } from "@/server/finance/revenue";
import { computeWeeklyOperationalCost } from "@/server/finance/operations";

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
});
