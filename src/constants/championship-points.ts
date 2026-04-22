/**
 * VCT 2026 — Championship Points system.
 * Source: official Riot circuit scoring.
 *
 * Max 4 pts per placement (no 400/300/etc.).
 * Group stages award 1 pt per match win (max 5).
 * EWC & Champions = no points.
 */

export type ChampPointStageId =
  | "KICKOFF"
  | "MASTERS_1"
  | "STAGE_1_GROUPS"
  | "STAGE_1_PLAYOFFS"
  | "MASTERS_2"
  | "STAGE_2_GROUPS"
  | "STAGE_2_PLAYOFFS";

/** Placement → points, index 0 = 1st place */
export const PLACEMENT_POINTS: Record<ChampPointStageId, number[]> = {
  KICKOFF:           [4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0],
  MASTERS_1:         [4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0],
  STAGE_1_GROUPS:    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  STAGE_1_PLAYOFFS:  [4, 3, 2, 1, 0, 0, 0, 0],
  MASTERS_2:         [4, 3, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0],
  STAGE_2_GROUPS:    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  STAGE_2_PLAYOFFS:  [4, 3, 2, 1, 0, 0, 0, 0],
};

/** Per-match-win points for group stages */
export const MATCH_WIN_POINTS: Partial<Record<ChampPointStageId, number>> = {
  STAGE_1_GROUPS: 1,
  STAGE_2_GROUPS: 1,
};

/** Tiebreaker order (applied if two teams are tied on total points) */
export const TIEBREAKER_ORDER: ChampPointStageId[] = [
  "STAGE_2_PLAYOFFS",
  "MASTERS_2",
  "STAGE_1_PLAYOFFS",
  "MASTERS_1",
  "KICKOFF",
];

/** Champions qualification structure */
export const CHAMPIONS_QUALIFICATION = {
  /** Top 2 of Stage 2 playoffs in each region auto-qualify */
  via_stage2_playoffs: 2,
  /** Top 2 of remaining teams by total champ pts */
  via_points: 2,
  /** Total slots per region for Champions */
  total_per_region: 4,
};

/** Helper: get points for a given placement (1-indexed) */
export function getPlacementPoints(stage: ChampPointStageId, placement: number): number {
  return PLACEMENT_POINTS[stage][placement - 1] ?? 0;
}

/** Helper: match win points for a stage (group stages only) */
export function getMatchWinPoints(stage: ChampPointStageId): number {
  return MATCH_WIN_POINTS[stage] ?? 0;
}
