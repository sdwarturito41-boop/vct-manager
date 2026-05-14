/**
 * VCT roster cap — 5 active + 5 reserve = 10 contracted max per team.
 * Active plays official matches; reserve does not but can be promoted.
 */

export const MAX_ACTIVE_ROSTER = 5;
export const MAX_RESERVE_ROSTER = 5;
export const MAX_TOTAL_ROSTER = MAX_ACTIVE_ROSTER + MAX_RESERVE_ROSTER;

export interface RosterCounts {
  active: number;
  reserve: number;
}

export function countRoster(
  players: ReadonlyArray<{ isActive: boolean; isRetired: boolean; isReserve: boolean }>,
): RosterCounts {
  let active = 0;
  let reserve = 0;
  for (const p of players) {
    if (p.isRetired || !p.isActive) continue;
    if (p.isReserve) reserve += 1;
    else active += 1;
  }
  return { active, reserve };
}

/**
 * Determines where an incoming signing should go. Prefers filling active
 * slots first (matches what most managers do — sign starters, then depth).
 * Returns null when the team is already at 10 contracted players.
 */
export function assignSigningSlot(counts: RosterCounts): "active" | "reserve" | null {
  if (counts.active < MAX_ACTIVE_ROSTER) return "active";
  if (counts.reserve < MAX_RESERVE_ROSTER) return "reserve";
  return null;
}

export function canSign(counts: RosterCounts): boolean {
  return counts.active + counts.reserve < MAX_TOTAL_ROSTER;
}
