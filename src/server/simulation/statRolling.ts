import type { PrismaClient } from "@/generated/prisma/client";

/** Soft cap on form momentum gained from match wins. Hard ceiling stays at
 *  ±10 (for one-off bonuses outside the match loop). Lowered from 8 → 5 to
 *  prevent the +momentum × +0.03 multiplier from snowballing a winning team
 *  to a permanent rating boost. */
const MOMENTUM_SOFT_CAP = 5;

import {
  recomputePlayerOverall,
  getPercentileCache,
  synthesizeMissingStats,
  computeAttributes,
  computeOverall,
  inferPlaystyleRole,
} from "@/server/mercato/attributes";
import type { PlayerRaw } from "@/server/mercato/attributeTypes";

/**
 * Rolling-average stat update — applique une EMA (exponentially weighted
 * moving average) sur les stats de base d'un joueur après chaque map.
 *
 * Pourquoi EMA et pas vrai average sur N matchs :
 *   - 0 table additionnelle (on update directement player.acs/kd/etc.)
 *   - Convergence naturelle : un MVP run boost les stats progressivement,
 *     une mauvaise saison les fait descendre
 *   - α = 0.08 → chaque match pèse 8%. Après 10 matchs l'ancienne valeur
 *     conserve ~43% du poids. Après 30 matchs : ~8%
 *
 * On update ACS et K/D directement depuis les stats produites par le sim.
 * KAST/ADR/HS/Rating dérivent partiellement (pas de données per-round) :
 *   - Rating ≈ EMA depuis (acs / 200)
 *   - KAST/ADR/HS drift léger basé sur le delta ACS (les joueurs en forme
 *     ont aussi un KAST/ADR meilleur, corrélation observée IRL)
 */
const EMA_ALPHA = 0.08;

export interface MatchStatInput {
  playerId: string;
  acs: number;
  kills: number;
  deaths: number;
  assists: number;
  /** Le match a-t-il été gagné par l'équipe du joueur ? Pour formMomentum. */
  won?: boolean;
}

export async function applyStatRollingUpdate(
  prisma: PrismaClient,
  input: MatchStatInput,
): Promise<void> {
  const player = await prisma.player.findUnique({
    where: { id: input.playerId },
    select: {
      acs: true, kd: true, kast: true, adr: true, hs: true, rating: true,
      formMomentum: true,
    },
  });
  if (!player) return;

  // Match-level values
  const matchAcs = input.acs;
  const matchKd = input.kills / Math.max(1, input.deaths);

  // EMA blend
  const newAcs = ema(player.acs, matchAcs, EMA_ALPHA);
  const newKd = ema(player.kd, matchKd, EMA_ALPHA);

  // Stats dérivées (drift léger basé sur le delta ACS vs baseline).
  // Une grosse perf ACS améliore légèrement KAST/ADR/HS/Rating, et inversement.
  const acsDelta = (matchAcs - player.acs) / 200; // ±0.5 typique
  const microDrift = clamp(acsDelta, -0.5, 0.5);

  const newKast = ema(player.kast, player.kast + microDrift * 3, EMA_ALPHA);
  const newAdr = ema(player.adr, player.adr + microDrift * 6, EMA_ALPHA);
  const newHs = ema(player.hs, player.hs + microDrift * 2, EMA_ALPHA);
  // Rating ≈ ACS / 200 + assists boost
  const matchRating = matchAcs / 200 + (input.assists / Math.max(1, input.kills + input.deaths + input.assists)) * 0.2;
  const newRating = ema(player.rating, matchRating, EMA_ALPHA);

  // ── Form momentum ──
  // win + ACS bon = +2, win + ACS mid = +1
  // défaite + ACS mid = 0 (le résultat affecte plus que la perf perso)
  // défaite + ACS mauvais = -2
  // Soft cap à ±8 sur le path per-match — un run intensif (Swiss stage 5
  // matchs en 1 semaine) ne peut pas dépasser 8 même sur des perfs MVP.
  // Le hard ceiling reste ±10 (utile pour des accumulations rares hors
  // de cette boucle).
  const acsAboveBaseline = matchAcs > player.acs;
  let momentumDelta = 0;
  if (input.won === true) {
    momentumDelta = acsAboveBaseline ? 2 : 1;
  } else if (input.won === false) {
    momentumDelta = acsAboveBaseline ? 0 : -2;
  }
  const raw = player.formMomentum + momentumDelta;
  // Soft cap MOMENTUM_SOFT_CAP — snap to the cap when match wins would push
  // past it. Hard ceiling ±10 stays for one-off non-match adjustments.
  let newMomentum = Math.max(-10, Math.min(10, raw));
  if (Math.abs(newMomentum) > MOMENTUM_SOFT_CAP) {
    newMomentum = Math.sign(newMomentum) * MOMENTUM_SOFT_CAP;
  }

  await prisma.player.update({
    where: { id: input.playerId },
    data: {
      acs: round2(newAcs),
      kd: round2(newKd),
      kast: round2(clamp(newKast, 50, 90)),
      adr: round2(clamp(newAdr, 80, 200)),
      hs: round2(clamp(newHs, 10, 45)),
      rating: round2(clamp(newRating, 0.5, 2.0)),
      formMomentum: newMomentum,
    },
  });

  // Recompute la "carte" du joueur (overall + attributs + stars) à partir
  // des nouvelles stats. Sans ça, ACS bouge mais l'overall reste figé
  // → l'user voit pas l'évolution de Bipo après les Masters.
  await recomputePlayerOverall(prisma, input.playerId);
}

function ema(prev: number, sample: number, alpha: number): number {
  return prev * (1 - alpha) + sample * alpha;
}
function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * Batched version of applyStatRollingUpdate. Collapses what used to be
 * 4 sequential queries per (player, map) (2 in applyStatRollingUpdate +
 * 2 in recomputePlayerOverall) into:
 *   - 1 findMany for all affected players
 *   - 1 percentile-cache read (memoized, usually free)
 *   - 1 $transaction with N updates
 *
 * On Vercel + Neon this turns 16-match days from ~75s sequential round-trips
 * into ~2 round-trips total. Same EMA/momentum/overall math as the per-player
 * function — only the I/O is collapsed.
 */
export async function applyStatRollingUpdatesBatch(
  prisma: PrismaClient,
  updates: MatchStatInput[],
): Promise<void> {
  if (updates.length === 0) return;

  // Group updates by player so we can replay them in order in-memory.
  const byPlayer = new Map<string, MatchStatInput[]>();
  for (const u of updates) {
    const arr = byPlayer.get(u.playerId) ?? [];
    arr.push(u);
    byPlayer.set(u.playerId, arr);
  }
  const playerIds = [...byPlayer.keys()];

  const [players, cache] = await Promise.all([
    prisma.player.findMany({
      where: { id: { in: playerIds } },
      select: {
        id: true, role: true, rating: true,
        acs: true, kd: true, adr: true, kast: true, hs: true,
        kpr: true, apr: true, fkpr: true, fdpr: true,
        clPct: true, clTotal: true,
        kills: true, deaths: true, vlrAssists: true,
        fk: true, fd: true, vlrRounds: true,
        agentStats: true, isIgl: true,
        playstyleRole: true,
        potential: true,
        formMomentum: true,
      },
    }),
    getPercentileCache(prisma),
  ]);

  const writes: import("@/generated/prisma/client").Prisma.PrismaPromise<unknown>[] = [];

  for (const player of players) {
    const playerUpdates = byPlayer.get(player.id);
    if (!playerUpdates) continue;

    // Replay each map's EMA/momentum update in memory.
    let curAcs = player.acs;
    let curKd = player.kd;
    let curKast = player.kast;
    let curAdr = player.adr;
    let curHs = player.hs;
    let curRating = player.rating;
    let curMomentum = player.formMomentum;

    for (const u of playerUpdates) {
      const matchAcs = u.acs;
      const matchKd = u.kills / Math.max(1, u.deaths);

      const newAcs = ema(curAcs, matchAcs, EMA_ALPHA);
      const newKd = ema(curKd, matchKd, EMA_ALPHA);

      const acsDelta = (matchAcs - curAcs) / 200;
      const microDrift = clamp(acsDelta, -0.5, 0.5);

      const newKast = ema(curKast, curKast + microDrift * 3, EMA_ALPHA);
      const newAdr = ema(curAdr, curAdr + microDrift * 6, EMA_ALPHA);
      const newHs = ema(curHs, curHs + microDrift * 2, EMA_ALPHA);
      const matchRating =
        matchAcs / 200 +
        (u.assists / Math.max(1, u.kills + u.deaths + u.assists)) * 0.2;
      const newRating = ema(curRating, matchRating, EMA_ALPHA);

      const acsAboveBaseline = matchAcs > curAcs;
      let momentumDelta = 0;
      if (u.won === true) {
        momentumDelta = acsAboveBaseline ? 2 : 1;
      } else if (u.won === false) {
        momentumDelta = acsAboveBaseline ? 0 : -2;
      }
      const raw = curMomentum + momentumDelta;
      let newMomentum = Math.max(-10, Math.min(10, raw));
      if (Math.abs(newMomentum) > MOMENTUM_SOFT_CAP) {
        newMomentum = Math.sign(newMomentum) * MOMENTUM_SOFT_CAP;
      }

      curAcs = round2(newAcs);
      curKd = round2(newKd);
      curKast = round2(clamp(newKast, 50, 90));
      curAdr = round2(clamp(newAdr, 80, 200));
      curHs = round2(clamp(newHs, 10, 45));
      curRating = round2(clamp(newRating, 0.5, 2.0));
      curMomentum = newMomentum;
    }

    // Recompute overall + attributes in-memory using the post-update stats.
    const rawStats: PlayerRaw = {
      id: player.id,
      role: player.role,
      rating: curRating,
      acs: curAcs,
      kd: curKd,
      adr: curAdr,
      kast: curKast,
      hs: curHs,
      kpr: player.kpr,
      apr: player.apr,
      fkpr: player.fkpr,
      fdpr: player.fdpr,
      clPct: player.clPct,
      clTotal: player.clTotal,
      kills: player.kills,
      deaths: player.deaths,
      vlrAssists: player.vlrAssists,
      fk: player.fk,
      fd: player.fd,
      vlrRounds: player.vlrRounds,
      agentStats: player.agentStats,
      isIgl: player.isIgl,
    };
    const synthesized = synthesizeMissingStats(rawStats);
    const role = player.playstyleRole ?? inferPlaystyleRole(synthesized);
    const attrs = computeAttributes(synthesized, cache);
    const rawOverall = computeOverall(attrs, role);
    const overall = Math.min(rawOverall, player.potential);

    writes.push(
      prisma.player.update({
        where: { id: player.id },
        data: {
          acs: curAcs,
          kd: curKd,
          kast: curKast,
          adr: curAdr,
          hs: curHs,
          rating: curRating,
          formMomentum: curMomentum,
          overall,
          attributes: attrs as unknown as object,
          ...(player.playstyleRole == null ? { playstyleRole: role } : {}),
        },
      }),
    );
  }

  // Parallel chunked execution instead of one big $transaction. Prisma's
  // sequential transaction API serializes each UPDATE on its connection — at
  // ~50 ms Neon RTT × 60 player updates that was 3 s of pure wait. Chunks of
  // 10 fan out across the pool while staying well under its 100-conn cap.
  // Updates are independent (different player ids), so atomicity isn't needed.
  if (writes.length > 0) {
    const CHUNK = 10;
    for (let i = 0; i < writes.length; i += CHUNK) {
      await Promise.all(writes.slice(i, i + CHUNK));
    }
  }
}
