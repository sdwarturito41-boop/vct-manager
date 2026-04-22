// Masters Santiago: 12 teams (3 per region), Swiss -> Double Elimination
// Swiss Stage: 4 rounds, teams with 3 wins advance, teams with 3 losses eliminated
// Bracket Stage: 8 teams, double elimination, Grand Final BO5

export const MASTERS_FORMAT = {
  name: "Masters Santiago",
  totalTeams: 12,
  teamsPerRegion: 3,

  // Swiss Stage
  swiss: {
    rounds: 4,
    winsToAdvance: 3,
    lossesToEliminate: 3,
    format: "BO3" as const,
    advancingTeams: 8,
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
