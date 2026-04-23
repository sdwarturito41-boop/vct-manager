import type { PlaystyleRole } from "@/generated/prisma/client";

/**
 * FM-style overall = weighted average of the 25 attributes. Weights depend
 * on the player's playstyle role. Every attribute is 0-20; the output is
 * also 0-20 (weighted mean).
 *
 * The 10 attributes explicitly tabled by the design (Aim, Entry timing,
 * Peek, Positioning, Util usage, Clutch, Aggression, Consistency,
 * Adaptability, Movement speed) use the exact values from the spec. The
 * other 15 are extrapolated with role-archetype logic — e.g. Leadership
 * dominates for IGL roles, Vision matters for initiators / supports.
 *
 * Omitted weights default to 1.0 at the call site, so a role can simply not
 * list an attribute it cares nothing about.
 */

export type AttrKey =
  | "aim"
  | "crosshair"
  | "entryTiming"
  | "peek"
  | "positioning"
  | "utilUsage"
  | "tradeDiscipline"
  | "clutch"
  | "counterStrat"
  | "mapAdaptability"
  | "aggression"
  | "decisionMaking"
  | "consistency"
  | "workRate"
  | "vision"
  | "composure"
  | "pressureRes"
  | "adaptability"
  | "leadership"
  | "ambition"
  | "reactionTime"
  | "mousePrecision"
  | "peakPerf"
  | "staminaBO5"
  | "movementSpeed"
  | "mentalEndurance";

export const ALL_ATTR_KEYS: readonly AttrKey[] = [
  "aim", "crosshair", "entryTiming", "peek", "positioning",
  "utilUsage", "tradeDiscipline", "clutch", "counterStrat", "mapAdaptability",
  "aggression", "decisionMaking", "consistency", "workRate", "vision",
  "composure", "pressureRes", "adaptability", "leadership", "ambition",
  "reactionTime", "mousePrecision", "peakPerf", "staminaBO5", "movementSpeed",
  "mentalEndurance",
] as const;

export const ROLE_WEIGHTS: Record<PlaystyleRole, Partial<Record<AttrKey, number>>> = {
  Entry: {
    aim: 1, crosshair: 1, entryTiming: 2, peek: 1.5, positioning: 0.5,
    utilUsage: 0.5, clutch: 0.5, aggression: 2, consistency: 0.5,
    adaptability: 0.5, movementSpeed: 2, reactionTime: 2, mousePrecision: 1.5,
    peakPerf: 1, staminaBO5: 0.5, mentalEndurance: 0.5, vision: 0.5,
    leadership: 0.5, decisionMaking: 1, workRate: 1,
  },

  Fragger: {
    aim: 2, crosshair: 2, entryTiming: 1, peek: 2, positioning: 1,
    utilUsage: 0.5, clutch: 1.5, aggression: 1.5, consistency: 1.5,
    adaptability: 0.5, movementSpeed: 1, reactionTime: 2, mousePrecision: 2,
    peakPerf: 1.5, staminaBO5: 1, mentalEndurance: 1, vision: 0.5,
    leadership: 0.5, decisionMaking: 1, workRate: 1,
  },

  Carry: {
    aim: 2, crosshair: 2, entryTiming: 0.5, peek: 2, positioning: 1,
    utilUsage: 0.5, clutch: 2, aggression: 1, consistency: 2,
    adaptability: 0.5, movementSpeed: 1, reactionTime: 1.5, mousePrecision: 2,
    peakPerf: 2, staminaBO5: 1.5, mentalEndurance: 1.5, composure: 1.5,
    pressureRes: 1.5, vision: 0.5, leadership: 0.5, decisionMaking: 1,
    workRate: 1,
  },

  AggressiveInit: {
    aim: 1, crosshair: 1, entryTiming: 2, peek: 1.5, positioning: 0.5,
    utilUsage: 1.5, clutch: 0.5, aggression: 2, consistency: 1,
    adaptability: 1, movementSpeed: 1.5, reactionTime: 1.5, mousePrecision: 1,
    peakPerf: 1, staminaBO5: 1, mentalEndurance: 1, vision: 1.5,
    leadership: 0.5, decisionMaking: 1.5, workRate: 1, tradeDiscipline: 1,
  },

  IntelInit: {
    aim: 1, crosshair: 0.5, entryTiming: 0.5, peek: 0.5, positioning: 1.5,
    utilUsage: 2, clutch: 1, aggression: 0.5, consistency: 2,
    adaptability: 1, movementSpeed: 0.5, reactionTime: 1, mousePrecision: 0.5,
    peakPerf: 1, staminaBO5: 1.5, mentalEndurance: 1.5, vision: 2,
    leadership: 1, decisionMaking: 1.5, workRate: 1.5, tradeDiscipline: 1.5,
  },

  FlexInit: {
    aim: 1, crosshair: 1, entryTiming: 1, peek: 1, positioning: 1,
    utilUsage: 1.5, clutch: 1, aggression: 1, consistency: 1.5,
    adaptability: 2, movementSpeed: 1, reactionTime: 1, mousePrecision: 1,
    peakPerf: 1, staminaBO5: 1, mentalEndurance: 1, vision: 1.5,
    leadership: 0.5, decisionMaking: 1, workRate: 1.5, counterStrat: 1.5,
  },

  IglSmoke: {
    aim: 0.5, crosshair: 0.5, entryTiming: 0.5, peek: 0.5, positioning: 1.5,
    utilUsage: 2, clutch: 1, aggression: 0.5, consistency: 2,
    adaptability: 1, movementSpeed: 0.5, reactionTime: 0.5, mousePrecision: 0.5,
    peakPerf: 0.5, staminaBO5: 1.5, mentalEndurance: 2, vision: 1.5,
    leadership: 2, decisionMaking: 2, workRate: 1.5, counterStrat: 2,
    composure: 1.5, pressureRes: 1.5,
  },

  AggressiveSmoke: {
    aim: 1.5, crosshair: 1.5, entryTiming: 1, peek: 1.5, positioning: 1,
    utilUsage: 1, clutch: 1, aggression: 2, consistency: 1,
    adaptability: 1, movementSpeed: 1, reactionTime: 1.5, mousePrecision: 1.5,
    peakPerf: 1, staminaBO5: 1, mentalEndurance: 1, vision: 1,
    leadership: 0.5, decisionMaking: 1, workRate: 1,
  },

  AnchorSmoke: {
    aim: 0.5, crosshair: 0.5, entryTiming: 0.5, peek: 0.5, positioning: 2,
    utilUsage: 1.5, clutch: 1.5, aggression: 0.5, consistency: 2,
    adaptability: 1, movementSpeed: 0.5, reactionTime: 0.5, mousePrecision: 0.5,
    peakPerf: 0.5, staminaBO5: 1.5, mentalEndurance: 1.5, vision: 1,
    leadership: 0.5, decisionMaking: 1, workRate: 1.5, composure: 1.5,
    pressureRes: 1.5,
  },

  Anchor: {
    aim: 1, crosshair: 1, entryTiming: 0.5, peek: 1, positioning: 2,
    utilUsage: 1.5, clutch: 1.5, aggression: 0.5, consistency: 2,
    adaptability: 0.5, movementSpeed: 0.5, reactionTime: 1, mousePrecision: 1,
    peakPerf: 1, staminaBO5: 1.5, mentalEndurance: 1.5, vision: 1,
    leadership: 0.5, decisionMaking: 1, workRate: 1.5, composure: 2,
    pressureRes: 1.5,
  },

  Lurker: {
    aim: 1.5, crosshair: 1.5, entryTiming: 1.5, peek: 1.5, positioning: 1.5,
    utilUsage: 0.5, clutch: 2, aggression: 1, consistency: 1,
    adaptability: 1.5, movementSpeed: 1.5, reactionTime: 1.5, mousePrecision: 1.5,
    peakPerf: 1.5, staminaBO5: 1, mentalEndurance: 1, vision: 1,
    leadership: 0.5, decisionMaking: 1.5, workRate: 1, counterStrat: 1,
    composure: 1.5, pressureRes: 1.5,
  },

  SupportSent: {
    aim: 0.5, crosshair: 0.5, entryTiming: 0.5, peek: 0.5, positioning: 1.5,
    utilUsage: 2, clutch: 1, aggression: 0.5, consistency: 2,
    adaptability: 1, movementSpeed: 0.5, reactionTime: 0.5, mousePrecision: 0.5,
    peakPerf: 0.5, staminaBO5: 1.5, mentalEndurance: 1.5, vision: 2,
    leadership: 1, decisionMaking: 1.5, workRate: 1.5, tradeDiscipline: 1.5,
    mapAdaptability: 1,
  },
};
