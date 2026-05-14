/**
 * Staff constants — labels per role + slot constraints. Generic `skill1/2/3`
 * columns on the Staff model are interpreted via STAFF_SKILL_LABELS at the
 * UI + game-logic layer.
 */

import type { StaffRole } from "@/generated/prisma/client";

/**
 * Display labels for skill1 / skill2 / skill3 by role. Order matters —
 * STAFF_SKILL_LABELS.COACH[0] describes skill1 for a coach, etc.
 */
export const STAFF_SKILL_LABELS: Record<StaffRole, [string, string, string]> = {
  COACH: ["Utility Boost", "Training Eff.", "Scouting Skill"],
  ANALYST: ["Scout Speed", "Prep Quality", "VOD Review"],
  MANAGER: ["Negotiation", "Network", "Contract Savvy"],
  FITNESS: ["Recovery", "Injury Prev.", "Peak Cond."],
};

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  COACH: "Head Coach",
  ANALYST: "Analyst",
  MANAGER: "Team Manager",
  FITNESS: "Fitness Coach",
};

/**
 * Per-role slot rules per team. `min` is enforced on fire (can't drop below);
 * `max` is enforced on hire (can't sign more).
 */
export interface SlotRule {
  min: number;
  max: number;
  required: boolean;
}

export const STAFF_SLOTS: Record<StaffRole, SlotRule> = {
  COACH:   { min: 0, max: 1, required: false },
  ANALYST: { min: 1, max: 5, required: true },
  MANAGER: { min: 1, max: 1, required: true },
  FITNESS: { min: 0, max: 1, required: false },
};

/**
 * Salary anchor per role used by market-offer generation. Real value scales
 * with average skill (50 = anchor, 95 ≈ 2.0× anchor).
 */
export const STAFF_BASE_SALARY: Record<StaffRole, number> = {
  COACH: 8_000,
  ANALYST: 5_000,
  MANAGER: 8_000,
  FITNESS: 4_000,
};

export function scaledSalary(role: StaffRole, avgSkill: number): number {
  const factor = 0.6 + (avgSkill / 100) * 1.4; // skill 0 → 0.6×, skill 100 → 2.0×
  return Math.round(STAFF_BASE_SALARY[role] * factor);
}

export const ALL_STAFF_ROLES: ReadonlyArray<StaffRole> = [
  "COACH", "ANALYST", "MANAGER", "FITNESS",
];
