/**
 * VCT roster constraints — Roster Lock + Transfer Window gates.
 *
 * Roster Lock: applied per-team when qualified for an international tournament
 * (Masters, Champions). Locks the squad for the tournament's full duration
 * — no signings, no releases, no trades. The real VCT explicitly maintains
 * the lock even after a team is eliminated mid-tournament.
 *
 * Transfer Window: a global season-level gate. Closed only between the end
 * of Champions and the start of the next Kickoff (off-season). Active stages
 * keep the window open by default.
 */

const ROSTER_LOCKED_STAGE_PREFIXES = [
  "MASTERS_1",
  "MASTERS_2",
  "CHAMPIONS",
] as const;

export function isRosterLocked(
  team: { rosterLockedUntilDay: number | null },
  currentDay: number,
): boolean {
  return team.rosterLockedUntilDay != null && team.rosterLockedUntilDay >= currentDay;
}

/**
 * Transfer window is open during the active season. Off-season (currentStage
 * is empty / OFF_SEASON / explicit transfer-closed marker) closes the window
 * globally — for now we only treat "OFF_SEASON" as closed since the codebase
 * doesn't carry an off-season concept yet.
 */
export function isTransferWindowOpen(season: { currentStage: string }): boolean {
  return season.currentStage !== "OFF_SEASON";
}

/**
 * Returns the stage prefix (MASTERS_1 / MASTERS_2 / CHAMPIONS) that triggers
 * a roster lock, or null if the input doesn't match one.
 */
export function lockedStagePrefix(stageId: string): string | null {
  for (const prefix of ROSTER_LOCKED_STAGE_PREFIXES) {
    if (stageId.startsWith(prefix)) return prefix;
  }
  return null;
}

/**
 * Builds a human-readable explanation for a blocked offer. Used by tRPC
 * error messages so the user (and admin logs) know which gate fired.
 */
export function describeLockReason(opts: {
  buyerLockedUntil?: number | null;
  sellerLockedUntil?: number | null;
  windowClosed?: boolean;
  currentDay: number;
}): string {
  if (opts.windowClosed) return "Transfer window is closed (off-season).";
  if (opts.buyerLockedUntil != null && opts.buyerLockedUntil >= opts.currentDay) {
    const daysLeft = opts.buyerLockedUntil - opts.currentDay;
    return `Your team is under Roster Lock for ${daysLeft} more day(s) (international tournament).`;
  }
  if (opts.sellerLockedUntil != null && opts.sellerLockedUntil >= opts.currentDay) {
    const daysLeft = opts.sellerLockedUntil - opts.currentDay;
    return `Target team is under Roster Lock for ${daysLeft} more day(s) — no trades possible.`;
  }
  return "Roster operation blocked.";
}
