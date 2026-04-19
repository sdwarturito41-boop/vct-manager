import type { PlayerMapStats, MatchHighlight } from "./engine";

/**
 * Pick a random integer in [min, max] inclusive.
 */
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Pick a random element from an array.
 */
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/**
 * Shuffle an array in place (Fisher-Yates) and return it.
 */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/**
 * Generate 3-5 post-map highlights based on the map outcome and player stats.
 *
 * Highlights are probabilistic -- they pick plausible rounds and players to
 * create short narrative beats that make match recaps feel alive.
 */
export function generateHighlights(
  map: string,
  team1Name: string,
  team2Name: string,
  score1: number,
  score2: number,
  playerStats: PlayerMapStats[],
): MatchHighlight[] {
  const totalRounds = score1 + score2;
  const highlights: MatchHighlight[] = [];
  const usedRounds = new Set<number>();

  /** Return a round number that hasn't been used yet. */
  function freshRound(min = 1, max = totalRounds): number {
    const clampedMax = Math.min(max, totalRounds);
    const clampedMin = Math.max(min, 1);
    // Try a few times to find an unused round, then just accept a repeat.
    for (let attempt = 0; attempt < 20; attempt++) {
      const r = randInt(clampedMin, clampedMax);
      if (!usedRounds.has(r)) {
        usedRounds.add(r);
        return r;
      }
    }
    const fallback = randInt(clampedMin, clampedMax);
    usedRounds.add(fallback);
    return fallback;
  }

  // Sort players by ACS descending -- star players are more likely to feature.
  const sortedPlayers = [...playerStats].sort((a, b) => b.acs - a.acs);

  // Determine which team name a player belongs to (first 5 = team1).
  const team1Ids = new Set(
    playerStats.filter((_, i) => i < 5).map((p) => p.teamId),
  );
  function teamNameFor(p: PlayerMapStats): string {
    return team1Ids.has(p.teamId) ? team1Name : team2Name;
  }

  // ---------- candidate generators ----------

  function clutch(): MatchHighlight {
    // Favour high-FK / high-ACS players for clutches.
    const candidate = pick(sortedPlayers.slice(0, 6));
    const opponents = pick([2, 3, 4, 5]);
    const round = freshRound();
    return {
      type: "clutch",
      round,
      playerIgn: candidate.ign,
      text: `${candidate.ign} clutch 1v${opponents} on ${map} \u00b7 Round ${round}`,
    };
  }

  function ace(): MatchHighlight {
    // Top fraggers get aces.
    const candidate = sortedPlayers[randInt(0, Math.min(3, sortedPlayers.length - 1))]!;
    const round = freshRound();
    return {
      type: "ace",
      round,
      playerIgn: candidate.ign,
      text: `${candidate.ign} ace on ${map} \u00b7 Round ${round}`,
    };
  }

  function ecoWin(): MatchHighlight {
    const team = pick([team1Name, team2Name]);
    const round = freshRound(3, totalRounds); // eco rounds don't happen round 1-2
    return {
      type: "eco_win",
      round,
      text: `${team} eco win on ${map} \u00b7 Round ${round}`,
    };
  }

  function flawless(): MatchHighlight {
    const team = pick([team1Name, team2Name]);
    const round = freshRound();
    return {
      type: "flawless",
      round,
      text: `Flawless round for ${team} \u00b7 ${map} \u00b7 Round ${round}`,
    };
  }

  function comeback(): MatchHighlight | null {
    // Only generate if the winning margin is small or the map went to OT.
    const diff = Math.abs(score1 - score2);
    if (diff > 3) return null;
    const winnerName = score1 > score2 ? team1Name : team2Name;
    // The "deficit" they came back from.
    const deficitLead = randInt(3, 7);
    const deficitTrail = randInt(0, deficitLead - 2);
    const round = freshRound(Math.max(13, totalRounds - 4), totalRounds);
    return {
      type: "comeback",
      round,
      text: `${winnerName} epic comeback from ${deficitTrail}-${deficitLead} on ${map}`,
    };
  }

  // ---------- assemble ----------

  const targetCount = randInt(3, 5);

  // Always try to include a clutch.
  highlights.push(clutch());

  // Build a pool of the remaining types, weighted by likelihood.
  type GeneratorFn = () => MatchHighlight | null;
  const pool: GeneratorFn[] = [
    ace,
    ace,
    ecoWin,
    ecoWin,
    ecoWin,
    flawless,
    flawless,
    clutch,
    comeback,
  ];

  shuffle(pool);

  for (const gen of pool) {
    if (highlights.length >= targetCount) break;
    const h = gen();
    if (h !== null) {
      highlights.push(h);
    }
  }

  // Sort highlights by round number for chronological presentation.
  highlights.sort((a, b) => a.round - b.round);

  return highlights;
}
