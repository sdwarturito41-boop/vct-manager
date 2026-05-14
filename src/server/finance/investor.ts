/**
 * Phase 2 — investor patience + bankruptcy.
 *
 * Real esport orgs run at a loss for years if the investor is patient.
 * `investorPatience` is the maximum sustained debt the backer will absorb
 * before pulling out. We accumulate debt whenever operational budget goes
 * red, and trigger:
 *   - INVESTOR_WARNING event at 50% patience (throttled to once every 4 weeks)
 *   - ORG_BANKRUPTCY at 100% patience (game over for the player, demoted to
 *     Challengers / auto-disband for AI)
 *
 * Recovery: debt drops as soon as operational budget goes positive again.
 * The bankruptcy flag stays set until the user explicitly accepts a buyout
 * / restart cycle.
 */

export const WARNING_THRESHOLD_PCT = 0.50;
export const BANKRUPTCY_THRESHOLD_PCT = 1.00;
export const WARNING_THROTTLE_WEEKS = 4;

export interface InvestorState {
  budget: number;
  debt: number;
  investorPatience: number;
  isBankrupt: boolean;
  lastWarningWeek: number;
}

export type InvestorEvent =
  | { kind: "INVESTOR_WARNING"; debt: number; patience: number }
  | { kind: "ORG_BANKRUPTCY"; debt: number; patience: number };

/**
 * Reconciles a team's debt counter after a weekly tick. Called AFTER
 * income/expense updates have been applied. Returns the updated state +
 * any event that should fire.
 *
 * Logic:
 *   - If budget < 0: convert deficit into debt (budget clamped to 0).
 *   - If budget > 0 and debt > 0: pay down debt with operational surplus.
 *   - Then check thresholds against investorPatience.
 */
export function reconcileDebt(
  state: InvestorState,
  currentWeek: number,
): {
  budget: number;
  debt: number;
  isBankrupt: boolean;
  lastWarningWeek: number;
  event: InvestorEvent | null;
} {
  let { budget, debt, lastWarningWeek, isBankrupt } = state;

  if (budget < 0) {
    debt += -budget;
    budget = 0;
  } else if (debt > 0 && budget > 0) {
    const paydown = Math.min(debt, budget);
    debt -= paydown;
    budget -= paydown;
  }

  let event: InvestorEvent | null = null;

  if (!isBankrupt && debt >= state.investorPatience * BANKRUPTCY_THRESHOLD_PCT) {
    isBankrupt = true;
    event = { kind: "ORG_BANKRUPTCY", debt, patience: state.investorPatience };
  } else if (
    !isBankrupt &&
    debt >= state.investorPatience * WARNING_THRESHOLD_PCT &&
    currentWeek - lastWarningWeek >= WARNING_THROTTLE_WEEKS
  ) {
    event = { kind: "INVESTOR_WARNING", debt, patience: state.investorPatience };
    lastWarningWeek = currentWeek;
  }

  return { budget, debt, isBankrupt, lastWarningWeek, event };
}

/**
 * Compute initial investor patience for a new save based on prestige.
 * Prestige 50 (mid-tier) = $2M. Prestige 95 (top org) = $5M.
 * Prestige 10 (start-up) = $800k.
 */
export function patienceFromPrestige(prestige: number): number {
  const clamped = Math.max(10, Math.min(95, prestige));
  return Math.round(800_000 + ((clamped - 10) / 85) * 4_200_000);
}
