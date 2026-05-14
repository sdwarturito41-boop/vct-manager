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
