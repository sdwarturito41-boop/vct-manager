export interface ValorantMap {
  name: string;
  psId: number;
  imageUrl: string; // PandaScore image
}

export const ALL_MAPS: ValorantMap[] = [
  { name: "Abyss", psId: 71, imageUrl: "https://cdn-api.pandascore.co/images/valorant/map/image/71/367e2546ef67d6a89bc00ef6ed8b2359a6b3c4b7-1920x1080-jpg-webp-webp-webp-webp-webp-webp-webp" },
  { name: "Ascent", psId: 66, imageUrl: "https://cdn-api.pandascore.co/images/valorant/map/image/66/loading_screen_ascent-png-png" },
  { name: "Bind", psId: 65, imageUrl: "https://cdn-api.pandascore.co/images/valorant/map/image/65/bind_map-png-png" },
  { name: "Breeze", psId: 68, imageUrl: "https://cdn-api.pandascore.co/images/valorant/map/image/68/loading_screen_breeze-png-png-png" },
  { name: "Corrode", psId: 69, imageUrl: "https://cdn-api.pandascore.co/images/valorant/map/image/69/loading_screen_corrode-png" },
  { name: "Fracture", psId: 35, imageUrl: "https://cdn-api.pandascore.co/images/valorant/map/image/35/loading_screen_fracture-png-png-png" },
  { name: "Haven", psId: 61, imageUrl: "https://cdn-api.pandascore.co/images/valorant/map/image/61/loading_screen_haven-png-png-png" },
  { name: "Icebox", psId: 58, imageUrl: "https://cdn-api.pandascore.co/images/valorant/map/image/58/icebox-png-png-png" },
  { name: "Lotus", psId: 72, imageUrl: "https://cdn-api.pandascore.co/images/valorant/map/image/72/lotus_map_valorant-png-png-png-png-png-png" },
  { name: "Pearl", psId: 70, imageUrl: "https://cdn-api.pandascore.co/images/valorant/map/image/70/loading_screen_pearl-png-png-png-png-png-png" },
  { name: "Split", psId: 43, imageUrl: "https://cdn-api.pandascore.co/images/valorant/map/image/43/loading_screen_split_v2-jpg-jpeg" },
  { name: "Sunset", psId: 67, imageUrl: "https://cdn-api.pandascore.co/images/valorant/map/image/67/loading_screen_sunset-png-png-png-png-png-png-png" },
];

// 3 map pool rotations per season (7 maps each)
// Pool A: Kickoff + Masters 1
// Pool B: Stage 1 + Masters 2
// Pool C: Stage 2 + EWC + Champions
export const MAP_POOLS: Record<string, string[]> = {
  POOL_A: ["Abyss", "Bind", "Haven", "Lotus", "Pearl", "Split", "Sunset"],
  POOL_B: ["Abyss", "Ascent", "Bind", "Breeze", "Haven", "Lotus", "Split"],
  POOL_C: ["Ascent", "Bind", "Corrode", "Haven", "Icebox", "Lotus", "Pearl"],
};

// Which stages use which pool
export const STAGE_MAP_POOL: Record<string, string> = {
  KICKOFF: "POOL_A",
  MASTERS_1: "POOL_A",
  STAGE_1: "POOL_B",
  MASTERS_2: "POOL_B",
  STAGE_2: "POOL_C",
  EWC: "POOL_C",
  CHAMPIONS: "POOL_C",
};

export function getActiveMapPool(stage: string): string[] {
  const poolKey = STAGE_MAP_POOL[stage] ?? "POOL_A";
  return MAP_POOLS[poolKey] ?? MAP_POOLS.POOL_A;
}

export function getMapByName(name: string): ValorantMap | undefined {
  return ALL_MAPS.find(m => m.name === name);
}

export function getMapImage(name: string): string {
  return ALL_MAPS.find(m => m.name === name)?.imageUrl ?? "";
}

// Keep backwards compat exports
export const MAP_POOL_2026 = MAP_POOLS.POOL_A;
export const ACTIVE_MAP_POOL = MAP_POOLS.POOL_A;
export const MAP_NAMES = MAP_POOLS.POOL_A;
