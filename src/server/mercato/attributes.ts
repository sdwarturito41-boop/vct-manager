import type { PrismaClient, PlaystyleRole } from "@/generated/prisma/client";
import { getAgentSpeed } from "@/constants/agent-speed";
import { ROLE_WEIGHTS, ALL_ATTR_KEYS } from "@/constants/role-weights";
import type { AttrKey } from "@/constants/role-weights";
import type { AgentStatsMap, Attributes, PlayerRaw } from "./attributeTypes";

// ── Percentile cache ───────────────────────────────────────

type StatKey =
  | "acs" | "kd" | "adr" | "kast" | "hs" | "kpr" | "apr" | "fkpr" | "fdpr"
  | "clPct" | "rating"
  | "survivalRate" | "clutchVolume" | "netEntry" | "fkFdRatio" | "tradeRate"
  | "nbAgents" | "agentVariance";

type PercentileCache = Record<StatKey, number[]>;

let _cache: PercentileCache | null = null;
let _cacheTimestamp = 0;
// Cache stays valid for 5 minutes; next call rebuilds. Cheap (~50ms on 800 rows).
const CACHE_TTL_MS = 5 * 60 * 1000;

export async function getPercentileCache(
  prisma: PrismaClient,
  forceRebuild = false,
): Promise<PercentileCache> {
  if (!forceRebuild && _cache && Date.now() - _cacheTimestamp < CACHE_TTL_MS) {
    return _cache;
  }
  _cache = await buildPercentileCache(prisma);
  _cacheTimestamp = Date.now();
  return _cache;
}

/** Invalidates the cached arrays — called after a VLR scrape or bulk import. */
export function invalidatePercentileCache(): void {
  _cache = null;
  _cacheTimestamp = 0;
}

async function buildPercentileCache(prisma: PrismaClient): Promise<PercentileCache> {
  // Template pool = players with teamId null AND currentTeam set (= real
  // pros seeded from VLR/pandascore). These are the reference population.
  const rows = await prisma.player.findMany({
    where: {
      isRetired: false,
      teamId: null,
      currentTeam: { not: null },
    },
    select: {
      acs: true,
      kd: true,
      adr: true,
      kast: true,
      hs: true,
      kpr: true,
      apr: true,
      fkpr: true,
      fdpr: true,
      clPct: true,
      rating: true,
      clTotal: true,
      kills: true,
      deaths: true,
      vlrAssists: true,
      fk: true,
      fd: true,
      vlrRounds: true,
      agentStats: true,
    },
  });

  // Fall back to any player pool if template pool is empty (fresh install).
  const pool =
    rows.length >= 20
      ? rows
      : await prisma.player.findMany({
          where: { isRetired: false },
          select: {
            acs: true,
            kd: true,
            adr: true,
            kast: true,
            hs: true,
            kpr: true,
            apr: true,
            fkpr: true,
            fdpr: true,
            clPct: true,
            rating: true,
            clTotal: true,
            kills: true,
            deaths: true,
            vlrAssists: true,
            fk: true,
            fd: true,
            vlrRounds: true,
            agentStats: true,
          },
        });

  const acs: number[] = [];
  const kd: number[] = [];
  const adr: number[] = [];
  const kast: number[] = [];
  const hs: number[] = [];
  const kpr: number[] = [];
  const apr: number[] = [];
  const fkpr: number[] = [];
  const fdpr: number[] = [];
  const clPct: number[] = [];
  const rating: number[] = [];
  const survivalRate: number[] = [];
  const clutchVolume: number[] = [];
  const netEntry: number[] = [];
  const fkFdRatio: number[] = [];
  const tradeRate: number[] = [];
  const nbAgents: number[] = [];
  const agentVariance: number[] = [];

  for (const p of pool) {
    acs.push(p.acs);
    kd.push(p.kd);
    adr.push(p.adr);
    kast.push(p.kast);
    hs.push(p.hs);
    kpr.push(p.kpr);
    apr.push(p.apr);
    fkpr.push(p.fkpr);
    fdpr.push(p.fdpr);
    clPct.push(p.clPct);
    rating.push(p.rating);

    const rounds = Math.max(1, p.vlrRounds);
    survivalRate.push((rounds - p.deaths) / rounds);
    clutchVolume.push(p.clTotal / rounds);
    netEntry.push((p.fk - p.fd) / rounds);
    fkFdRatio.push(p.fk / Math.max(1, p.fd));
    tradeRate.push(p.vlrAssists / Math.max(1, p.deaths));

    const agents = p.agentStats as AgentStatsMap | null;
    const agentCount = agents ? Object.keys(agents).length : 0;
    nbAgents.push(agentCount);
    agentVariance.push(computeAgentVariance(agents, "acs"));
  }

  const sort = (a: number[]) => a.sort((x, y) => x - y);

  return {
    acs: sort(acs),
    kd: sort(kd),
    adr: sort(adr),
    kast: sort(kast),
    hs: sort(hs),
    kpr: sort(kpr),
    apr: sort(apr),
    fkpr: sort(fkpr),
    fdpr: sort(fdpr),
    clPct: sort(clPct),
    rating: sort(rating),
    survivalRate: sort(survivalRate),
    clutchVolume: sort(clutchVolume),
    netEntry: sort(netEntry),
    fkFdRatio: sort(fkFdRatio),
    tradeRate: sort(tradeRate),
    nbAgents: sort(nbAgents),
    agentVariance: sort(agentVariance),
  };
}

function computeAgentVariance(
  agents: AgentStatsMap | null | undefined,
  field: "acs",
): number {
  if (!agents) return 0;
  const values = Object.values(agents)
    .filter((v) => v.rounds >= 30)
    .map((v) => v[field]);
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Returns the percentile score (0-20) of `value` within the sorted array.
 * If `invert` is true, the rank is flipped (useful for stats where low = good,
 * e.g. fdpr).
 */
function percentile(arr: number[], value: number, invert = false): number {
  if (arr.length === 0) return 10;
  // Binary search for insertion position → that's the rank.
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  const pct = lo / arr.length;
  return (invert ? 1 - pct : pct) * 20;
}

// ── Synthetic stats for unmatched players ──────────────────

/**
 * For players whose extended stats weren't populated by the VLR scrape
 * (lastScrapedAt = null OR vlrRounds = 0), derive kpr / apr / fkpr / fdpr /
 * clPct / rating from the base stats we do have (ACS, KD, ADR, KAST). The
 * goal is NOT to invent fake data — it's to place the player somewhere
 * plausible in the distribution based on how strong their base stats are.
 *
 * All formulas are anchored on empirical VCT tier-1 averages:
 *   - median ACS ≈ 215, kpr ≈ 0.75
 *   - median KD ≈ 1.0, fkpr ≈ 0.12, fdpr ≈ 0.12
 *   - median KAST ≈ 72, apr ≈ 0.32
 */
export function synthesizeMissingStats(p: PlayerRaw): PlayerRaw {
  // Player was scraped — trust real data, return as-is
  if (p.vlrRounds > 0) return p;

  const acs = p.acs;
  const kd = p.kd;
  const kast = p.kast / 100; // 0-1

  // kpr tracks ACS closely — 1 kill contributes ~100 ACS
  const kpr = Math.max(0.45, Math.min(1.0, 0.5 + (acs - 150) / 250));
  // apr tracks kast but also playstyle; duelists lower, supports higher
  const apr = Math.max(0.15, Math.min(0.55, 0.25 + (kast - 0.7) * 0.6));
  // fkpr correlates with KD and role aggression
  const fkpr = Math.max(0.05, Math.min(0.22, 0.09 + (kd - 0.9) * 0.12));
  // fdpr is inverse — good players die less often first
  const fdpr = Math.max(0.05, Math.min(0.22, 0.14 - (kd - 0.9) * 0.08));
  // clutch % tracks overall form
  const rating = Math.max(0.75, Math.min(1.35, 0.85 + (kd - 0.9) * 0.8 + (kast - 0.7) * 0.5));
  const clPct = Math.max(0.08, Math.min(0.42, 0.18 + (rating - 1.0) * 0.4));

  // Assume ~300 rounds over a typical VCT window so rates have a denominator
  const rounds = 300;
  const kills = Math.round(kpr * rounds);
  const deaths = Math.round(rounds * (1 - kast) * 0.9 + rounds * 0.15);
  const vlrAssists = Math.round(apr * rounds);
  const fk = Math.round(fkpr * rounds);
  const fd = Math.round(fdpr * rounds);

  return {
    ...p,
    rating: p.rating || rating,
    kpr: p.kpr || kpr,
    apr: p.apr || apr,
    fkpr: p.fkpr || fkpr,
    fdpr: p.fdpr || fdpr,
    clPct: p.clPct || clPct,
    clTotal: p.clTotal || Math.round(rounds * 0.08),
    kills: p.kills || kills,
    deaths: p.deaths || deaths,
    vlrAssists: p.vlrAssists || vlrAssists,
    fk: p.fk || fk,
    fd: p.fd || fd,
    vlrRounds: rounds,
    agentStats: p.agentStats, // leave as-is (empty)
  };
}

// ── Attribute computation ───────────────────────────────────

export function computeAttributes(
  p: PlayerRaw,
  cache: PercentileCache,
): Attributes {
  const rounds = Math.max(1, p.vlrRounds);
  const survival = (rounds - p.deaths) / rounds;
  const fkFdRatio = p.fk / Math.max(1, p.fd);
  const netEntry = (p.fk - p.fd) / rounds;
  const clutchVol = p.clTotal / rounds;
  const tradeRate = p.vlrAssists / Math.max(1, p.deaths);

  const agents = (p.agentStats as AgentStatsMap | null) ?? {};
  const agentCount = Object.keys(agents).length;
  // No per-agent data → no signal. Use neutral value so the downstream
  // percentile lookup lands around 10 instead of 20 (empty variance = 0
  // would otherwise read as "perfectly consistent across agents").
  const agentAcsVariance = agentCount >= 2 ? computeAgentVariance(agents, "acs") : -1;

  const pAcs = percentile(cache.acs, p.acs);
  const pAdr = percentile(cache.adr, p.adr);
  const pKast = percentile(cache.kast, p.kast);
  const pHs = percentile(cache.hs, p.hs);
  const pKd = percentile(cache.kd, p.kd);
  const pKpr = percentile(cache.kpr, p.kpr);
  const pApr = percentile(cache.apr, p.apr);
  const pFkpr = percentile(cache.fkpr, p.fkpr);
  const pFdprLow = percentile(cache.fdpr, p.fdpr, true); // low fdpr = good
  const pFdprHigh = percentile(cache.fdpr, p.fdpr); // high fdpr = aggressive
  const pClPct = percentile(cache.clPct, p.clPct);
  const pRating = percentile(cache.rating, p.rating);
  const pSurvival = percentile(cache.survivalRate, survival);
  const pClutchVol = percentile(cache.clutchVolume, clutchVol);
  const pNetEntry = percentile(cache.netEntry, netEntry);
  const pFkFd = percentile(cache.fkFdRatio, fkFdRatio);
  const pTradeRate = percentile(cache.tradeRate, tradeRate);
  const pNbAgents = percentile(cache.nbAgents, agentCount);
  // Sentinel -1 means "no agent data" — use neutral 10 instead of a real
  // percentile that would over-reward missing info.
  const pAgentVar = agentAcsVariance < 0 ? 10 : percentile(cache.agentVariance, agentAcsVariance, true);

  // Role flexibility — proxy for "can play outside main lane". Higher when
  // player has many agents AND spreads stats evenly across them.
  const roleFlex = (pNbAgents * 0.6 + pAgentVar * 0.4) * 0.5;

  // Movement speed needs weighted agent speed × pFkpr. Weight by rounds played
  // on each agent.
  const agentSpeedScore = weightedAgentSpeed(agents);

  // Peak performance proxies
  const maxAcsByAgent = Math.max(
    ...Object.values(agents).map((a) => a.acs).filter((n) => Number.isFinite(n)),
    p.acs,
  );
  const pPeakAcs = percentile(cache.acs, maxAcsByAgent);

  const attrs: Attributes = {
    // TECHNIQUE
    aim: 0.4 * pAcs + 0.35 * pAdr + 0.25 * pHs,
    crosshair: 0.5 * pHs + 0.3 * pKd + 0.2 * pKpr,
    entryTiming: 0.6 * pFkpr + 0.4 * pNetEntry,
    peek: 0.55 * pFkFd + 0.45 * pKd,
    positioning: 0.5 * pFdprLow + 0.5 * pSurvival,
    utilUsage: 0.55 * pApr + 0.45 * pKast,
    tradeDiscipline: 0.5 * pTradeRate + 0.3 * pKast + 0.2 * pApr,
    clutch: 0.5 * pClPct + 0.5 * pClutchVol,
    counterStrat: 0.6 * pNbAgents + 0.4 * roleFlex,
    mapAdaptability: pAgentVar, // inverse variance already embedded

    // MENTAL
    aggression: 0.5 * pFkpr + 0.3 * pFdprHigh + 0.2 * pNetEntry,
    decisionMaking: 0.4 * pKast + 0.35 * pFdprLow + 0.25 * pKd,
    consistency: pKast, // proxy until save has >12 weeks of snapshots
    workRate: 0.5 * pKast + 0.3 * pApr + 0.2 * pSurvival,
    vision: 0.6 * pApr + 0.4 * pTradeRate,
    composure: pClPct, // proxy
    pressureRes: 0.4 * pClutchVol + 0.4 * pClPct + 0.2 * pRating,
    adaptability: 0.5 * pNbAgents + 0.5 * roleFlex,
    leadership: p.isIgl ? 16 : 8,
    ambition: 10, // proxy; V4.1 replaces via snapshot-based progression

    // PHYSIQUE
    reactionTime: 0.55 * pFkpr + 0.45 * pHs,
    mousePrecision: 0.6 * pHs + 0.4 * pKpr,
    peakPerf: 0.6 * pPeakAcs + 0.4 * pRating,
    staminaBO5: pKast, // proxy
    movementSpeed: 0.6 * agentSpeedScore + 0.4 * pFkpr,
    mentalEndurance: 0, // filled below — needs consistency + pressureRes
  };

  attrs.mentalEndurance = 0.5 * attrs.consistency + 0.5 * attrs.pressureRes;

  // Clamp everything to [0, 20]
  for (const k of ALL_ATTR_KEYS) {
    attrs[k] = Math.max(0, Math.min(20, attrs[k]));
  }

  return attrs;
}

function weightedAgentSpeed(agents: AgentStatsMap): number {
  const entries = Object.entries(agents);
  if (entries.length === 0) return 10;
  let totalRounds = 0;
  let weightedSpeed = 0;
  for (const [name, data] of entries) {
    const tier = getAgentSpeed(name); // 0-5
    totalRounds += data.rounds;
    weightedSpeed += tier * data.rounds;
  }
  if (totalRounds === 0) return 10;
  const tier = weightedSpeed / totalRounds; // 0-5
  return (tier / 5) * 20; // 0-20
}

// ── Overall pondéré par playstyleRole ───────────────────────

export function computeOverall(
  attrs: Attributes,
  role: PlaystyleRole,
): number {
  const weights = ROLE_WEIGHTS[role];
  let weightedSum = 0;
  let totalWeight = 0;
  for (const key of ALL_ATTR_KEYS) {
    const w = weights[key] ?? 1.0;
    weightedSum += attrs[key] * w;
    totalWeight += w;
  }
  if (totalWeight === 0) return 10;
  return Math.max(0, Math.min(20, weightedSum / totalWeight));
}

// ── Playstyle role inference ────────────────────────────────

export function inferPlaystyleRole(p: PlayerRaw): PlaystyleRole {
  if (p.isIgl) {
    if (p.role === "Controller") return "IglSmoke";
    if (p.role === "Initiator") return "IntelInit";
    if (p.role === "Sentinel") return "SupportSent";
    return "IglSmoke";
  }
  if (p.role === "Duelist") {
    if (p.fkpr >= 0.2) return "Entry";
    if (p.kd >= 1.15) return "Fragger";
    return "Carry";
  }
  if (p.role === "Initiator") {
    if (p.fkpr >= 0.15) return "AggressiveInit";
    if (p.apr >= 0.4) return "IntelInit";
    return "FlexInit";
  }
  if (p.role === "Controller") {
    if (p.fkpr >= 0.12) return "AggressiveSmoke";
    return "AnchorSmoke";
  }
  if (p.role === "Sentinel") {
    if (p.apr >= 0.35) return "SupportSent";
    if (p.fkpr < 0.08) return "Anchor";
    return "Lurker";
  }
  if (p.role === "Flex") return "FlexInit";
  return "Fragger";
}

// ── Bulk recompute for a save ───────────────────────────────

/**
 * Recomputes `overall` and (if absent) `playstyleRole` for every player
 * attached to the save. Intended to run weekly in advanceDay, after
 * stat-mutating systems (training, mentor growth) have settled.
 */
export async function recomputeAllOveralls(
  prisma: PrismaClient,
  saveId: string,
): Promise<number> {
  const players = await prisma.player.findMany({
    where: { team: { saveId }, isRetired: false },
  });
  if (players.length === 0) return 0;

  const cache = await getPercentileCache(prisma);

  const CHUNK = 25;
  for (let i = 0; i < players.length; i += CHUNK) {
    const batch = players.slice(i, i + CHUNK);
    await Promise.all(
      batch.map((p) => {
        const raw: PlayerRaw = {
          id: p.id,
          role: p.role,
          rating: p.rating,
          acs: p.acs,
          kd: p.kd,
          adr: p.adr,
          kast: p.kast,
          hs: p.hs,
          kpr: p.kpr,
          apr: p.apr,
          fkpr: p.fkpr,
          fdpr: p.fdpr,
          clPct: p.clPct,
          clTotal: p.clTotal,
          kills: p.kills,
          deaths: p.deaths,
          vlrAssists: p.vlrAssists,
          fk: p.fk,
          fd: p.fd,
          vlrRounds: p.vlrRounds,
          agentStats: p.agentStats,
          isIgl: p.isIgl,
        };
        const synthesized = synthesizeMissingStats(raw);
        const role = p.playstyleRole ?? inferPlaystyleRole(synthesized);
        const attrs = computeAttributes(synthesized, cache);
        const overall = computeOverall(attrs, role);
        return prisma.player.update({
          where: { id: p.id },
          data: { overall, playstyleRole: role },
        });
      }),
    );
  }

  return players.length;
}

/**
 * Weekly snapshot of each active player's stats — feeds the historical
 * variance computation (V4.1). Called once per weekly tick.
 */
export async function snapshotPlayerStats(
  prisma: PrismaClient,
  saveId: string,
  week: number,
  season: number,
): Promise<number> {
  const players = await prisma.player.findMany({
    where: { team: { saveId }, isRetired: false },
    select: { id: true, rating: true, acs: true, kd: true, kast: true, adr: true, clPct: true },
  });
  if (players.length === 0) return 0;

  const CHUNK = 50;
  for (let i = 0; i < players.length; i += CHUNK) {
    const batch = players.slice(i, i + CHUNK);
    await Promise.all(
      batch.map((p) =>
        prisma.playerStatSnapshot
          .upsert({
            where: { playerId_season_week: { playerId: p.id, season, week } },
            update: {
              rating: p.rating,
              acs: p.acs,
              kd: p.kd,
              kast: p.kast,
              adr: p.adr,
              clPct: p.clPct,
            },
            create: {
              saveId,
              playerId: p.id,
              season,
              week,
              rating: p.rating,
              acs: p.acs,
              kd: p.kd,
              kast: p.kast,
              adr: p.adr,
              clPct: p.clPct,
            },
          })
          .catch(() => null),
      ),
    );
  }
  return players.length;
}
