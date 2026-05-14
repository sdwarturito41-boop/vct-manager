/**
 * FM-style 3-bucket budget system for VCT Manager.
 *
 *   transferBudget    — one-shot pool for signing fees. Refilled by player
 *                       sales + board season-start allocation.
 *   wageBudgetSeason  — season-long pool for paying weekly salaries
 *                       (players + coach + staff). Refilled by board allocation.
 *   budget            — operational/general pool. Sponsor income, prize money,
 *                       sale proceeds. Acts as fallback when the dedicated
 *                       pools run dry (the deficit silently cascades into here).
 *
 * The board allocates transfer + wage at season start by carving out a
 * percentage of the team's total capital. Default split: 30% transfer / 55%
 * wage / 15% operational. The user will be able to rebalance via a slider in
 * Phase 3.
 */

export const DEFAULT_TRANSFER_PCT = 0.30;
export const DEFAULT_WAGE_PCT = 0.55;
export const DEFAULT_OPERATIONAL_PCT = 0.15;

export interface TeamBudgetSnapshot {
  budget: number;            // operational
  transferBudget: number;
  wageBudgetSeason: number;
}

export interface DebitResult {
  transferBudget: number;
  wageBudgetSeason: number;
  budget: number;
  fellBackToOperational: boolean;
}

/**
 * Debit a transfer fee. Drains transferBudget first; if it goes negative,
 * the shortfall is taken from operational `budget` and transferBudget is
 * clamped to 0. Returns the new field values for a Prisma update.
 */
export function debitTransfer(
  current: TeamBudgetSnapshot,
  amount: number,
): DebitResult {
  if (amount <= 0) {
    return {
      transferBudget: current.transferBudget,
      wageBudgetSeason: current.wageBudgetSeason,
      budget: current.budget,
      fellBackToOperational: false,
    };
  }
  if (current.transferBudget >= amount) {
    return {
      transferBudget: current.transferBudget - amount,
      wageBudgetSeason: current.wageBudgetSeason,
      budget: current.budget,
      fellBackToOperational: false,
    };
  }
  const shortfall = amount - current.transferBudget;
  return {
    transferBudget: 0,
    wageBudgetSeason: current.wageBudgetSeason,
    budget: current.budget - shortfall,
    fellBackToOperational: true,
  };
}

/**
 * Debit weekly wage payments. Drains wageBudgetSeason first, falls back to
 * operational `budget`. Negative `budget` is allowed here (the org goes
 * into the red) — Phase 2 will trigger investor warnings / bankruptcy.
 */
export function debitWages(
  current: TeamBudgetSnapshot,
  amount: number,
): DebitResult {
  if (amount <= 0) {
    return {
      transferBudget: current.transferBudget,
      wageBudgetSeason: current.wageBudgetSeason,
      budget: current.budget,
      fellBackToOperational: false,
    };
  }
  if (current.wageBudgetSeason >= amount) {
    return {
      transferBudget: current.transferBudget,
      wageBudgetSeason: current.wageBudgetSeason - amount,
      budget: current.budget,
      fellBackToOperational: false,
    };
  }
  const shortfall = amount - current.wageBudgetSeason;
  return {
    transferBudget: current.transferBudget,
    wageBudgetSeason: 0,
    budget: current.budget - shortfall,
    fellBackToOperational: true,
  };
}

/**
 * Aggregate total cash available across all buckets. Used by UI and by
 * the `canAfford` check for soft caps.
 */
export function totalAvailable(current: TeamBudgetSnapshot): number {
  return current.budget + current.transferBudget + current.wageBudgetSeason;
}

/**
 * Initial board allocation for a new season. Carves out transfer + wage
 * pools from the team's current capital using the default split. Returns
 * the new field values for the Prisma update. Called once at season-start
 * tick (Phase 3 will add a user-facing slider override).
 */
export function allocateSeasonBudget(opts: {
  totalCapital: number;
  transferPct?: number;
  wagePct?: number;
}): {
  budget: number;
  transferBudget: number;
  wageBudgetSeason: number;
  seasonStartBudget: number;
} {
  const tPct = opts.transferPct ?? DEFAULT_TRANSFER_PCT;
  const wPct = opts.wagePct ?? DEFAULT_WAGE_PCT;
  const transferBudget = Math.round(opts.totalCapital * tPct);
  const wageBudgetSeason = Math.round(opts.totalCapital * wPct);
  const budget = opts.totalCapital - transferBudget - wageBudgetSeason;
  return {
    budget,
    transferBudget,
    wageBudgetSeason,
    seasonStartBudget: opts.totalCapital,
  };
}

/**
 * Idempotent migration: if a team has the legacy single-budget state
 * (transferBudget + wageBudgetSeason both 0 AND budget > 0), perform the
 * default split. Called lazily before any read that needs the buckets.
 */
export function needsInitialSplit(
  current: TeamBudgetSnapshot & { seasonStartBudget?: number },
): boolean {
  return (
    current.transferBudget === 0 &&
    current.wageBudgetSeason === 0 &&
    current.budget > 0 &&
    (current.seasonStartBudget ?? 0) === 0
  );
}
