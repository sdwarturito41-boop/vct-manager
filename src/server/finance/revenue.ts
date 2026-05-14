/**
 * Phase 4 — weekly revenue sources beyond sponsors.
 *
 *   - Riot league fee: partner-tier orgs receive a flat weekly stipend
 *     (VCT International ~ $500k/year ≈ $10k/week). Models the broadcast
 *     revenue share + slot subsidy real partner orgs collect.
 *   - Merchandising: scales with prestige. A 50-prestige org sells modest
 *     volume; a 90-prestige org with brand recognition (Sentinels, FNATIC)
 *     moves multiples more. Linear for simplicity.
 *
 * Both sources land in operational `budget` each weekly Monday tick.
 */

export const RIOT_WEEKLY_STIPEND = 10_000;
export const MERCH_PER_PRESTIGE_POINT = 100;

/**
 * Riot in-game bundle quarterly payout. The annual projection on
 * `Team.bundleRevenueAnnual` is split into 4 equal quarterly installments.
 * Each installment is then routed:
 *   - 35% → transferBudget (fuels recruitment without operational pressure)
 *   - 65% → operational `budget`
 */
export const BUNDLE_TRANSFER_PCT = 0.35;
export const BUNDLE_OPERATIONAL_PCT = 0.65;

export interface BundlePayout {
  total: number;
  toTransfer: number;
  toOperational: number;
}

export function computeQuarterlyBundle(annual: number): BundlePayout {
  const total = Math.round(annual / 4);
  const toTransfer = Math.round(total * BUNDLE_TRANSFER_PCT);
  const toOperational = total - toTransfer;
  return { total, toTransfer, toOperational };
}

/**
 * Absolute quarter index from season + week. Quarter is 1-4 within a 52-week
 * season; we return `season * 4 + quarter` for monotonic ordering.
 */
export function quarterIndex(season: number, week: number): number {
  const q = Math.min(4, Math.ceil(week / 13));
  return season * 4 + q;
}

/**
 * True when `week` lands on the first day of a quarter (weeks 1 / 14 / 27 /
 * 40). Used by the Monday tick to decide whether to issue bundle payouts.
 */
export function isQuarterStartWeek(week: number): boolean {
  return week === 1 || week === 14 || week === 27 || week === 40;
}

export interface WeeklyRevenueInput {
  prestige: number;
}

export interface WeeklyRevenueBreakdown {
  riotFee: number;
  merch: number;
  total: number;
}

export function computeWeeklyRevenue(t: WeeklyRevenueInput): WeeklyRevenueBreakdown {
  const riotFee = RIOT_WEEKLY_STIPEND;
  const merch = Math.max(0, t.prestige) * MERCH_PER_PRESTIGE_POINT;
  return {
    riotFee,
    merch,
    total: riotFee + merch,
  };
}
