import type { PrismaClient } from "@/generated/prisma/client";

export interface StageStats {
  kills: number;
  deaths: number;
  assists: number;
  kd: number;
  acs: number;
  mapsPlayed: number;
}

interface MapPlayerStat {
  playerId: string;
  kills?: number;
  deaths?: number;
  assists?: number;
  acs?: number;
}

interface MapBlob {
  playerStats?: MapPlayerStat[];
}

interface MatchRow {
  maps: unknown;
}

/**
 * Aggregate per-player stats over a slice of played matches. The Match.maps
 * field is a Json blob written by the sim with shape
 *   maps: { playerStats: { playerId, kills, deaths, assists, acs, ... }[] }[]
 * so this just walks every (match, map, player) tuple and accumulates.
 *
 * Returns one entry per playerId in `playerIds` that actually appeared in
 * any map — players who haven't played yet are absent (caller treats that
 * as "—").
 */
export function aggregateStageStats(
  matches: MatchRow[],
  playerIds: string[],
): Record<string, StageStats> {
  const wanted = new Set(playerIds);
  const accum = new Map<
    string,
    { kills: number; deaths: number; assists: number; acsSum: number; mapsPlayed: number }
  >();

  for (const m of matches) {
    const maps = Array.isArray(m.maps) ? (m.maps as MapBlob[]) : [];
    for (const map of maps) {
      const playerStats = map.playerStats ?? [];
      for (const ps of playerStats) {
        if (!ps.playerId || !wanted.has(ps.playerId)) continue;
        const cur = accum.get(ps.playerId) ?? {
          kills: 0, deaths: 0, assists: 0, acsSum: 0, mapsPlayed: 0,
        };
        cur.kills += ps.kills ?? 0;
        cur.deaths += ps.deaths ?? 0;
        cur.assists += ps.assists ?? 0;
        cur.acsSum += ps.acs ?? 0;
        cur.mapsPlayed += 1;
        accum.set(ps.playerId, cur);
      }
    }
  }

  const out: Record<string, StageStats> = {};
  for (const [pid, s] of accum) {
    out[pid] = {
      kills: s.kills,
      deaths: s.deaths,
      assists: s.assists,
      kd: s.deaths > 0 ? Math.round((s.kills / s.deaths) * 100) / 100 : s.kills,
      acs: s.mapsPlayed > 0 ? Math.round(s.acsSum / s.mapsPlayed) : 0,
      mapsPlayed: s.mapsPlayed,
    };
  }
  return out;
}

/**
 * Convenience wrapper — fetches all played matches for the current stage in
 * the given save/season, then aggregates. Used by tRPC and by server pages.
 */
export async function getCurrentStageStats(
  prisma: PrismaClient,
  saveId: string,
  seasonNumber: number,
  stagePrefix: string,
  playerIds: string[],
): Promise<Record<string, StageStats>> {
  if (playerIds.length === 0) return {};
  const matches = await prisma.match.findMany({
    where: {
      saveId,
      season: seasonNumber,
      isPlayed: true,
      OR: [
        { stageId: { startsWith: stagePrefix } },
        { stageId: stagePrefix },
      ],
    },
    select: { maps: true },
  });
  return aggregateStageStats(matches, playerIds);
}
