/**
 * Map-specific characteristics for round simulation.
 * Based on real VCT win rates and site geometry.
 */

export interface SiteProfile {
  /** How strong the initial defender angle is when executing here (0.05..0.25) */
  defenderAngleStrength: number;
  /** How hard it is to rotate to this site from the other side (0.4..0.9) */
  rotateDifficulty: number;
  /** Postplant difficulty for defenders (higher = harder retake) */
  postPlantDifficulty: number;
  /** Base attack win rate on this specific site (0.35..0.55) */
  attackSiteWinRate: number;
}

export interface MapProfile {
  name: string;
  sites: string[];
  /** Global attack-vs-defense bias (e.g. Breeze is attacker-friendly, Haven too) */
  attackBias: number;
  siteProfiles: Record<string, SiteProfile>;
  /** Utility impact — some maps are more utility-heavy (Split, Ascent) than others (Breeze) */
  utilityImpact: number;
  /** Mid control importance — how much winning mid matters (0..1) */
  midImportance: number;
}

export const MAP_PROFILES: Record<string, MapProfile> = {
  Bind: {
    name: "Bind",
    sites: ["A", "B"],
    attackBias: 0.01,
    utilityImpact: 1.0,
    midImportance: 0.3, // no real mid, teleporters link the sites
    siteProfiles: {
      A: { defenderAngleStrength: 0.17, rotateDifficulty: 0.7, postPlantDifficulty: 0.5, attackSiteWinRate: 0.48 },
      B: { defenderAngleStrength: 0.15, rotateDifficulty: 0.5, postPlantDifficulty: 0.45, attackSiteWinRate: 0.51 },
    },
  },
  Haven: {
    name: "Haven",
    sites: ["A", "B", "C"],
    attackBias: 0.03,
    utilityImpact: 0.9,
    midImportance: 0.6,
    siteProfiles: {
      A: { defenderAngleStrength: 0.12, rotateDifficulty: 0.6, postPlantDifficulty: 0.42, attackSiteWinRate: 0.50 },
      B: { defenderAngleStrength: 0.10, rotateDifficulty: 0.5, postPlantDifficulty: 0.40, attackSiteWinRate: 0.52 },
      C: { defenderAngleStrength: 0.13, rotateDifficulty: 0.7, postPlantDifficulty: 0.45, attackSiteWinRate: 0.49 },
    },
  },
  Ascent: {
    name: "Ascent",
    sites: ["A", "B"],
    attackBias: -0.02, // Ascent is slightly defense-favored
    utilityImpact: 1.1,
    midImportance: 0.9, // mid control is CRITICAL on Ascent
    siteProfiles: {
      A: { defenderAngleStrength: 0.19, rotateDifficulty: 0.55, postPlantDifficulty: 0.55, attackSiteWinRate: 0.44 },
      B: { defenderAngleStrength: 0.17, rotateDifficulty: 0.55, postPlantDifficulty: 0.52, attackSiteWinRate: 0.46 },
    },
  },
  Split: {
    name: "Split",
    sites: ["A", "B"],
    attackBias: -0.03,
    utilityImpact: 1.2, // utility-heavy map
    midImportance: 0.85,
    siteProfiles: {
      A: { defenderAngleStrength: 0.20, rotateDifficulty: 0.65, postPlantDifficulty: 0.58, attackSiteWinRate: 0.42 },
      B: { defenderAngleStrength: 0.18, rotateDifficulty: 0.65, postPlantDifficulty: 0.55, attackSiteWinRate: 0.44 },
    },
  },
  Breeze: {
    name: "Breeze",
    sites: ["A", "B"],
    attackBias: 0.04, // big, open, attacker-friendly
    utilityImpact: 0.7,
    midImportance: 0.4,
    siteProfiles: {
      A: { defenderAngleStrength: 0.13, rotateDifficulty: 0.75, postPlantDifficulty: 0.40, attackSiteWinRate: 0.53 },
      B: { defenderAngleStrength: 0.14, rotateDifficulty: 0.75, postPlantDifficulty: 0.38, attackSiteWinRate: 0.52 },
    },
  },
  Sunset: {
    name: "Sunset",
    sites: ["A", "B"],
    attackBias: 0.00,
    utilityImpact: 1.0,
    midImportance: 0.8,
    siteProfiles: {
      A: { defenderAngleStrength: 0.16, rotateDifficulty: 0.55, postPlantDifficulty: 0.48, attackSiteWinRate: 0.49 },
      B: { defenderAngleStrength: 0.17, rotateDifficulty: 0.55, postPlantDifficulty: 0.50, attackSiteWinRate: 0.48 },
    },
  },
  Lotus: {
    name: "Lotus",
    sites: ["A", "B", "C"],
    attackBias: 0.02,
    utilityImpact: 1.0,
    midImportance: 0.5,
    siteProfiles: {
      A: { defenderAngleStrength: 0.14, rotateDifficulty: 0.65, postPlantDifficulty: 0.45, attackSiteWinRate: 0.50 },
      B: { defenderAngleStrength: 0.15, rotateDifficulty: 0.55, postPlantDifficulty: 0.48, attackSiteWinRate: 0.49 },
      C: { defenderAngleStrength: 0.16, rotateDifficulty: 0.70, postPlantDifficulty: 0.50, attackSiteWinRate: 0.48 },
    },
  },
  Pearl: {
    name: "Pearl",
    sites: ["A", "B"],
    attackBias: -0.01,
    utilityImpact: 1.0,
    midImportance: 0.95, // mid is everything on Pearl
    siteProfiles: {
      A: { defenderAngleStrength: 0.16, rotateDifficulty: 0.55, postPlantDifficulty: 0.48, attackSiteWinRate: 0.47 },
      B: { defenderAngleStrength: 0.17, rotateDifficulty: 0.55, postPlantDifficulty: 0.50, attackSiteWinRate: 0.46 },
    },
  },
  Icebox: {
    name: "Icebox",
    sites: ["A", "B"],
    attackBias: 0.02,
    utilityImpact: 0.8,
    midImportance: 0.5,
    siteProfiles: {
      A: { defenderAngleStrength: 0.15, rotateDifficulty: 0.60, postPlantDifficulty: 0.55, attackSiteWinRate: 0.50 },
      B: { defenderAngleStrength: 0.18, rotateDifficulty: 0.60, postPlantDifficulty: 0.50, attackSiteWinRate: 0.47 },
    },
  },
  Fracture: {
    name: "Fracture",
    sites: ["A", "B"],
    attackBias: 0.05, // flanks both ways, attacker-friendly
    utilityImpact: 0.95,
    midImportance: 0.3,
    siteProfiles: {
      A: { defenderAngleStrength: 0.11, rotateDifficulty: 0.80, postPlantDifficulty: 0.40, attackSiteWinRate: 0.54 },
      B: { defenderAngleStrength: 0.12, rotateDifficulty: 0.80, postPlantDifficulty: 0.40, attackSiteWinRate: 0.53 },
    },
  },
  Abyss: {
    name: "Abyss",
    sites: ["A", "B"],
    attackBias: 0.00,
    utilityImpact: 0.9,
    midImportance: 0.6,
    siteProfiles: {
      A: { defenderAngleStrength: 0.15, rotateDifficulty: 0.60, postPlantDifficulty: 0.47, attackSiteWinRate: 0.49 },
      B: { defenderAngleStrength: 0.16, rotateDifficulty: 0.60, postPlantDifficulty: 0.49, attackSiteWinRate: 0.48 },
    },
  },
  Corrode: {
    name: "Corrode",
    sites: ["A", "B"],
    attackBias: 0.00,
    utilityImpact: 1.0,
    midImportance: 0.7,
    siteProfiles: {
      A: { defenderAngleStrength: 0.15, rotateDifficulty: 0.55, postPlantDifficulty: 0.48, attackSiteWinRate: 0.49 },
      B: { defenderAngleStrength: 0.16, rotateDifficulty: 0.55, postPlantDifficulty: 0.48, attackSiteWinRate: 0.48 },
    },
  },
};

export function getMapProfile(mapName: string): MapProfile {
  return MAP_PROFILES[mapName] ?? {
    name: mapName,
    sites: ["A", "B"],
    attackBias: 0,
    utilityImpact: 1.0,
    midImportance: 0.5,
    siteProfiles: {
      A: { defenderAngleStrength: 0.15, rotateDifficulty: 0.6, postPlantDifficulty: 0.45, attackSiteWinRate: 0.49 },
      B: { defenderAngleStrength: 0.15, rotateDifficulty: 0.6, postPlantDifficulty: 0.45, attackSiteWinRate: 0.49 },
    },
  };
}
