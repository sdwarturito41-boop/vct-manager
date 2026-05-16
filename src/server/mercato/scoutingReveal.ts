/**
 * Scouting V2 — tiered reveal based on analyst skill + days elapsed since
 * the player was shortlisted.
 *
 *   No analyst (skill < 40)   → only basic info (name, role, region, age)
 *   Skill 40-59 (Junior)       → tier 1 after 14 days: ACS, K/D, ADR
 *   Skill 60-79 (Senior)       → tier 1 + 2 after 7 days: + KAST, overall
 *   Skill 80+ (Elite)          → tier 1 + 2 + 3 after 3 days: + gameIQ,
 *                                consistencyRating, potential
 *
 * The analyst skill is SNAPSHOTTED on the Shortlist row at scout-start so
 * the report stays valid even if the analyst is later sold/fired — once
 * unlocked, the data is yours forever. Re-shortlisting an already-scouted
 * player is a no-op (the existing report keeps its progress).
 */

export const SCOUTING_BASIC_FIELDS = [
  "ign",
  "firstName",
  "lastName",
  "role",
  "region",
  "nationality",
  "age",
  "isTransferListed",
  "buyoutClause",
  "salary",
  "currentTeam",
] as const;

export const SCOUTING_TIER_1_FIELDS = ["acs", "kd", "adr"] as const;
export const SCOUTING_TIER_2_FIELDS = ["kast", "overall"] as const;
export const SCOUTING_TIER_3_FIELDS = ["gameIQ", "consistencyRating", "potential", "attributes"] as const;

interface ScoutingTier {
  threshold: number; // min analyst skill to unlock
  delayDays: number; // days from shortlist creation until reveal
  fields: readonly string[]; // CUMULATIVE — includes lower tiers
}

const TIERS: ScoutingTier[] = [
  {
    threshold: 80,
    delayDays: 3,
    fields: [
      ...SCOUTING_TIER_1_FIELDS,
      ...SCOUTING_TIER_2_FIELDS,
      ...SCOUTING_TIER_3_FIELDS,
    ],
  },
  {
    threshold: 60,
    delayDays: 7,
    fields: [...SCOUTING_TIER_1_FIELDS, ...SCOUTING_TIER_2_FIELDS],
  },
  {
    threshold: 40,
    delayDays: 14,
    fields: [...SCOUTING_TIER_1_FIELDS],
  },
];

export interface ScoutingReveal {
  /** 0 = nothing revealed (still waiting OR skill too low). 1/2/3 = unlocked tier. */
  tier: 0 | 1 | 2 | 3;
  /** Field names visible (cumulative). Always includes the SCOUTING_BASIC_FIELDS. */
  revealedFields: string[];
  /** Days remaining until next reveal (-1 if no further reveal possible). */
  daysUntilNext: number;
  /** Label of the analyst tier that produced this reveal ("Junior" / "Senior" / "Elite" / null). */
  analystTier: "Junior" | "Senior" | "Elite" | null;
}

export function getScoutingReveal(
  addedDay: number,
  analystSkill: number,
  currentDay: number,
): ScoutingReveal {
  const elapsed = Math.max(0, currentDay - addedDay);

  // Determine which tier the analyst is qualified to reveal at all.
  const qualifiedTier =
    analystSkill >= 80 ? TIERS[0]
    : analystSkill >= 60 ? TIERS[1]
    : analystSkill >= 40 ? TIERS[2]
    : null;

  if (!qualifiedTier) {
    return {
      tier: 0,
      revealedFields: [...SCOUTING_BASIC_FIELDS],
      daysUntilNext: -1,
      analystTier: null,
    };
  }

  const analystTier =
    analystSkill >= 80 ? "Elite"
    : analystSkill >= 60 ? "Senior"
    : "Junior";

  if (elapsed < qualifiedTier.delayDays) {
    return {
      tier: 0,
      revealedFields: [...SCOUTING_BASIC_FIELDS],
      daysUntilNext: qualifiedTier.delayDays - elapsed,
      analystTier,
    };
  }

  const tierIdx = TIERS.indexOf(qualifiedTier);
  // Tier #1 (80+) → 3, #2 (60-79) → 2, #3 (40-59) → 1
  const tierNum = (TIERS.length - tierIdx) as 1 | 2 | 3;

  return {
    tier: tierNum,
    revealedFields: [...SCOUTING_BASIC_FIELDS, ...qualifiedTier.fields],
    daysUntilNext: -1, // no further reveal — analyst already maxed out
    analystTier,
  };
}

/**
 * Returns true if `field` is in the revealed set. Convenience helper for the
 * UI to mask out unrevealed fields with "—" / blur.
 */
export function isFieldRevealed(field: string, reveal: ScoutingReveal): boolean {
  return reveal.revealedFields.includes(field);
}
