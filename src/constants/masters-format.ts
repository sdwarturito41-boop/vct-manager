// Masters (VCT 2026 format): 12 teams total
//   - 4 Seed #1 (regional winners) bye direct to bracket
//   - 8 Seed #2 + Seed #3 play Swiss
// Swiss Stage: first-to-2 wins to advance, first-to-2 losses to eliminate
//   → 4 teams advance, 4 eliminated. Max 3 rounds for any team.
// Bracket Stage: 8 teams (4 byes + 4 Swiss survivors), double elimination,
//   BO3 except LB Final + Grand Final in BO5.

export const MASTERS_FORMAT = {
  name: "Masters Santiago",
  totalTeams: 12,
  teamsPerRegion: 3,

  // Swiss Stage
  swiss: {
    rounds: 3,
    winsToAdvance: 2,
    lossesToEliminate: 2,
    format: "BO3" as const,
    advancingTeams: 4,
  },

  // Bracket Stage
  bracket: {
    format: "double_elimination" as const,
    upperBracket: {
      quarterfinals: 4, // 4 matches
      semifinals: 2,
      final: 1,
    },
    lowerBracket: {
      round1: 4,
      round2: 2,
      round3: 2,
      semifinal: 1,
      final: 1,
    },
    grandFinal: {
      format: "BO5" as const,
      advantage: false, // no bracket reset
    },
  },

  // Championship points
  points: {
    1: 400,
    2: 300,
    3: 250,
    4: 200,
    5: 100, // 5-6th
    7: 50,  // 7-8th
  },
} as const;

export type MastersFormat = typeof MASTERS_FORMAT;
