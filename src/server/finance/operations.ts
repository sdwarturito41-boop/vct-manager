/**
 * Phase 5 — operational outflows.
 *
 *   - Facility upkeep: fixed weekly cost scaling with facility tier.
 *     Tier 1 (rented apartment): $2k/wk
 *     Tier 2 (small gaming house): $5k/wk
 *     Tier 3 (dedicated facility):  $12k/wk
 *     Tier 4 (training complex):    $25k/wk
 *     Tier 5 (org HQ + analytics):  $45k/wk
 *
 *   - Bootcamp: when active (bootcampWeeksLeft > 0), adds $5k/week. The
 *     prep boost itself is applied via the training system; this just
 *     models the cost side.
 *
 *   - Travel: a one-shot $20k charge per team per international tournament.
 *     Booked at tournament initialization (initializeMasters), not weekly.
 */

export const FACILITY_UPKEEP: Record<number, number> = {
  1: 2_000,
  2: 5_000,
  3: 12_000,
  4: 25_000,
  5: 45_000,
};

export const BOOTCAMP_WEEKLY_COST = 5_000;
export const INTERNATIONAL_TRAVEL_COST = 20_000;

export interface OperationalInput {
  facilityTier: number;
  bootcampWeeksLeft: number;
}

export interface OperationalBreakdown {
  facility: number;
  bootcamp: number;
  total: number;
}

export function computeWeeklyOperationalCost(t: OperationalInput): OperationalBreakdown {
  const facility = FACILITY_UPKEEP[t.facilityTier] ?? FACILITY_UPKEEP[1];
  const bootcamp = t.bootcampWeeksLeft > 0 ? BOOTCAMP_WEEKLY_COST : 0;
  return {
    facility,
    bootcamp,
    total: facility + bootcamp,
  };
}
