/**
 * VCT 2026 real-world calendar. Each stage is anchored on a specific absolute
 * game day (= calendar day 1 = January 1 of season.year).
 *
 *   Season 1 (2026) EMEA — the canonical schedule (other regions are 1 week
 *   earlier for international qualifier stages so EMEA always finishes last):
 *
 *     S3-6   Kickoff triple-elim   (20 Jan → 15 Feb)
 *     S8-9   Masters Santiago      (28 Feb → 15 Mar)
 *     S13-19 Stage 1               (1 Apr → 17 May)
 *     S22-23 Masters London        (6 Jun → 21 Jun)
 *     S27-35 Stage 2               (~Jul → Aug)
 *     S40-44 Champions Shanghai    (~Sep/Oct)
 *
 * The same shape applies every season — only the calendar year changes. We
 * keep the day offsets identical across years so a "stage 1" always lands in
 * roughly the same window relative to Jan 1.
 *
 * NOTE: The user's existing save already pre-generated Kickoff matches under
 * the legacy "Day 1 = Kickoff start" logic. The calendar below is consumed by
 * NEW saves + by the NEXT stage that hasn't been initialized yet in any
 * existing save.
 */

import type { Region } from "@/generated/prisma/client";

export interface StageWindow {
  /** Stage identifier prefix, e.g. "KICKOFF" | "MASTERS_1" | "STAGE_1". */
  stageId: string;
  /** Absolute day this stage starts for EMEA (the canonical region). */
  emeaStartDay: number;
  /** How many days the stage occupies start-to-finish (used for downstream gating). */
  durationDays: number;
  /**
   * Per-region offset in days. Negative = region starts earlier than EMEA.
   * Default (when not specified): 0 = same day as EMEA.
   */
  regionOffsetDays?: Partial<Record<Region, number>>;
}

/**
 * Year-agnostic calendar — absolute day offsets from Jan 1. Stage windows
 * stay identical across seasons; only the calendar year (via dayToCalendar)
 * changes the rendered date label.
 */
export const VCT_CALENDAR: StageWindow[] = [
  // ── Kickoff — triple elimination, 4 weeks ──
  // S3-6 (20 Jan → 15 Feb) = days 20 → 46
  //   Sem 1 (S3): Tue-Fri    — UB R1 + UB R2
  //   Sem 2 (S4): Tue-Fri    — MB R1 + UB SF
  //   Sem 3 (S5): Tue-Fri    — LB R1 + LB R2 + MB QF + MB SF
  //   Sem 4 (S6): Thu-Sun    — UB Final + MB Final + LB Final (BO5)
  {
    stageId: "KICKOFF",
    emeaStartDay: 20,
    durationDays: 27,
    regionOffsetDays: { Americas: -7, Pacific: -7, China: -7 },
  },

  // ── Masters Santiago — 28 Feb → 15 Mar ──
  // S8-9 = days 59 → 74. Swiss week, then playoffs week. International =
  // no regional offset (all 12 teams play same dates).
  {
    stageId: "MASTERS_1",
    emeaStartDay: 59,
    durationDays: 16,
  },

  // ── Stage 1 — 1 Apr → 17 May ──
  // S13-19 = days 91 → 137. Group Stage (5w, Wed-Fri) + Playoffs (2w).
  {
    stageId: "STAGE_1",
    emeaStartDay: 91,
    durationDays: 47,
    regionOffsetDays: { Americas: -7, Pacific: -7, China: -7 },
  },

  // ── Masters London — 6 Jun → 21 Jun ──
  // S22-23 = days 157 → 172.
  {
    stageId: "MASTERS_2",
    emeaStartDay: 157,
    durationDays: 16,
  },

  // ── Stage 2 — ~Jul → Aug ──
  // S27-35 = days 190 → 245.
  {
    stageId: "STAGE_2",
    emeaStartDay: 190,
    durationDays: 56,
    regionOffsetDays: { Americas: -7, Pacific: -7, China: -7 },
  },

  // ── Champions Shanghai — ~Sep/Oct ──
  // S40-44 = days 280 → 307.
  {
    stageId: "CHAMPIONS",
    emeaStartDay: 280,
    durationDays: 28,
  },
];

/**
 * Resolve the start day of a stage for a given region. Returns the EMEA
 * anchor minus the region-specific offset (so Americas starts 7 days earlier
 * for regional stages like Stage 1 / Kickoff).
 */
export function stageStartDay(stageId: string, region: Region): number | null {
  const window = VCT_CALENDAR.find((w) => w.stageId === stageId);
  if (!window) return null;
  const offset = window.regionOffsetDays?.[region] ?? 0;
  return window.emeaStartDay + offset;
}

/** End-day cap for a stage (start + duration − 1). */
export function stageEndDay(stageId: string, region: Region): number | null {
  const window = VCT_CALENDAR.find((w) => w.stageId === stageId);
  if (!window) return null;
  const start = stageStartDay(stageId, region);
  if (start == null) return null;
  return start + window.durationDays - 1;
}

/**
 * Returns true when the given absolute day falls within the stage's window.
 * Used by initializers to gate "should we generate this stage yet?".
 */
export function dayInStageWindow(stageId: string, region: Region, day: number): boolean {
  const start = stageStartDay(stageId, region);
  const end = stageEndDay(stageId, region);
  if (start == null || end == null) return false;
  return day >= start && day <= end;
}
