// Base agent meta scores — can be adjusted at runtime by active MetaPatch.
// 1.06 = strong meta, 1.00 = neutral, 0.94 = weak, 0.88 = nerfed hard
export const AGENT_META_BASE: Record<string, number> = {
  // Current Kickoff meta
  Jett: 1.00,
  Raze: 0.94,
  Reyna: 0.88,
  Phoenix: 0.94,
  Neon: 1.06,
  Yoru: 0.94,
  Iso: 1.00,
  Waylay: 1.06,
  Sova: 0.94,
  Breach: 1.00,
  Skye: 1.00,
  "KAY/O": 1.06,
  Fade: 1.06,
  Gekko: 1.00,
  Tejo: 1.06,
  Killjoy: 1.00,
  Cypher: 1.06,
  Sage: 0.94,
  Chamber: 0.88,
  Deadlock: 0.94,
  Vyse: 1.06,
  Brimstone: 0.94,
  Viper: 1.06,
  Omen: 1.00,
  Astra: 1.00,
  Harbor: 0.94,
  Clove: 1.06,
  Miks: 1.00,
  Veto: 1.00,
};

// Live meta table that the simulation reads. Mutated when a new patch drops.
export const AGENT_META: Record<string, number> = { ...AGENT_META_BASE };

/**
 * Apply a patch's buffs/nerfs to the live AGENT_META table.
 * Resets to base first so patches don't stack.
 */
export function applyPatchToMeta(buffs: string[], nerfs: string[]): void {
  for (const k of Object.keys(AGENT_META)) delete AGENT_META[k];
  for (const [k, v] of Object.entries(AGENT_META_BASE)) AGENT_META[k] = v;
  for (const name of buffs) {
    AGENT_META[name] = Math.min(1.15, (AGENT_META[name] ?? 1.0) + 0.05);
  }
  for (const name of nerfs) {
    AGENT_META[name] = Math.max(0.80, (AGENT_META[name] ?? 1.0) - 0.05);
  }
}

// Counter table
// Key = agent name, value = { hardCounters: string[], softCounters: string[] }
// Hard counter = +0.08, soft counter = +0.04, capped at +0.15 total
export interface CounterEntry {
  hardCounters: string[]; // agents this one hard-counters
  softCounters: string[]; // agents this one soft-counters
}

export const COUNTER_TABLE: Record<string, CounterEntry> = {
  "KAY/O": { hardCounters: ["Chamber", "Cypher", "Killjoy"], softCounters: ["Sage", "Vyse", "Astra"] },
  Fade: { hardCounters: ["Cypher", "Chamber"], softCounters: ["Killjoy", "Deadlock"] },
  Sova: { hardCounters: ["Cypher", "Viper"], softCounters: ["Omen", "Killjoy"] },
  Breach: { hardCounters: ["Sage", "Deadlock"], softCounters: ["Killjoy", "Chamber"] },
  Skye: { hardCounters: ["Cypher"], softCounters: ["Killjoy", "Sage"] },
  Gekko: { hardCounters: ["Cypher", "Killjoy"], softCounters: ["Sage"] },
  Tejo: { hardCounters: ["Viper", "Harbor"], softCounters: ["Astra", "Omen"] },
  Jett: { hardCounters: [], softCounters: ["Deadlock", "Sage"] },
  Neon: { hardCounters: [], softCounters: ["Cypher", "Killjoy"] },
  Raze: { hardCounters: [], softCounters: ["Cypher", "Killjoy", "Sage"] },
  Viper: { hardCounters: ["Harbor"], softCounters: ["Brimstone"] },
  Vyse: { hardCounters: ["Neon", "Raze"], softCounters: ["Jett", "Iso"] },
};

// Agent mastery stars (0-5)
export const MASTERY_FACTOR: Record<number, number> = {
  5: 1.08,
  4: 1.04,
  3: 1.00,
  2: 0.93,
  1: 0.85,
  0: 0.75,
};

// Map factors
export const MAP_FACTOR = {
  STRONG: 1.10,
  NEUTRAL: 1.00,
  WEAK: 0.88,
  UNKNOWN: 0.80,
} as const;

// Synergy factor based on weeks since joining
export function getSynergyFactor(weeksSinceJoining: number): number {
  if (weeksSinceJoining <= 0) return 0.88;
  if (weeksSinceJoining === 1) return 0.88;
  if (weeksSinceJoining === 2) return 0.92;
  if (weeksSinceJoining === 3) return 0.96;
  return 1.00;
}
