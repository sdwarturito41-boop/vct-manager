import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Courbe d'âge appliquée à la transition de saison.
 *
 *   17-20 : peak growth — +1 potential, +2% sur les stats brutes si overlap
 *           avec le bonus EMA de la saison (Bipo qui carry à 18 ans monte vite)
 *   21-23 : steady growth — +0 à +1 potential occasionnel
 *   24-27 : plateau — rien
 *   28-30 : déclin léger — -1.5%/an sur stats brutes, aim x1.2 (plus rapide),
 *           gameIQ x0.6 (tient plus longtemps), clutch x0.7
 *   31+   : déclin marqué — -2.5%/an, potential clamp à overall
 *
 * Le déclin frappe les stats brutes (ACS, KD) qui sont mécanique-driven.
 * Le gameIQ / clutch (calculés dans les attrs Json) ne sont pas directement
 * touchés ici — le recomputePlayerOverall les régénère depuis les stats
 * brutes lors du premier match de la nouvelle saison.
 */
export async function applyAgingEffects(
  prisma: PrismaClient,
  saveId: string,
): Promise<{ aged: number; declined: number; grew: number }> {
  const players = await prisma.player.findMany({
    where: { team: { saveId }, isRetired: false },
    select: {
      id: true,
      age: true,
      overall: true,
      potential: true,
      acs: true,
      kd: true,
      adr: true,
      kast: true,
      hs: true,
      rating: true,
    },
  });

  let aged = 0;
  let declined = 0;
  let grew = 0;

  for (const p of players) {
    aged++;
    const updates: Partial<{
      acs: number;
      kd: number;
      adr: number;
      kast: number;
      hs: number;
      rating: number;
      potential: number;
    }> = {};

    // ── Growth (jeunes pépites) ──
    if (p.age <= 20 && p.potential < 20 && Math.random() < 0.6) {
      // 60% chance de gagner +1 potential par an entre 17 et 20
      updates.potential = Math.min(20, p.potential + 1);
      grew++;
    } else if (p.age <= 23 && p.potential < 18 && Math.random() < 0.25) {
      // 25% chance de +1 entre 21-23, capé à 18
      updates.potential = Math.min(18, p.potential + 1);
      grew++;
    }

    // ── Decline (vieillesse) ──
    if (p.age >= 28) {
      const yearsOver = p.age - 27;
      const decline = Math.min(0.05, yearsOver * 0.015); // 1.5%/an, cap 5%
      // Aim/mécanique frappés plus fort
      const aimDecline = decline * 1.2;
      // Game-IQ-adjacent stats (KAST, ADR proxy de positioning) tiennent
      const positioningDecline = decline * 0.6;

      updates.acs = round2(p.acs * (1 - aimDecline));
      updates.hs = round2(p.hs * (1 - aimDecline));
      updates.kd = round2(p.kd * (1 - decline));
      updates.adr = round2(p.adr * (1 - decline));
      updates.kast = round2(p.kast * (1 - positioningDecline));
      updates.rating = round2(p.rating * (1 - decline * 0.8));

      // Potential descend aussi (un mec à 30 ans avec potential 17 mais
      // overall 12 ne va plus jamais atteindre 17). Floor à overall.
      const newPotential = Math.max(
        p.overall ?? 10,
        Math.floor(p.potential * (1 - decline * 0.5)),
      );
      if (newPotential < p.potential) {
        updates.potential = newPotential;
      }
      declined++;
    }

    if (Object.keys(updates).length > 0) {
      await prisma.player.update({
        where: { id: p.id },
        data: updates,
      });
    }
  }

  return { aged, declined, grew };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
