import type { PrismaClient } from "@/generated/prisma/client";

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
}

export async function applyStatRollingUpdate(
  prisma: PrismaClient,
  input: MatchStatInput,
): Promise<void> {
  const player = await prisma.player.findUnique({
    where: { id: input.playerId },
    select: { acs: true, kd: true, kast: true, adr: true, hs: true, rating: true },
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

  await prisma.player.update({
    where: { id: input.playerId },
    data: {
      acs: round2(newAcs),
      kd: round2(newKd),
      kast: round2(clamp(newKast, 50, 90)),
      adr: round2(clamp(newAdr, 80, 200)),
      hs: round2(clamp(newHs, 10, 45)),
      rating: round2(clamp(newRating, 0.5, 2.0)),
    },
  });
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
