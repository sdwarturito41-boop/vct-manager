/**
 * One-shot : initialise le `potential` de chaque joueur basé sur :
 *   - son overall actuel (= floor minimum)
 *   - son âge (jeunes = +room to grow, vieux = potential ≈ overall)
 *   - son talent latent (variance aléatoire pour avoir de la diversité)
 *
 * Idempotent : ne touche QUE les joueurs où potential == default (10) ou
 * < overall (incohérent).
 *
 * Courbe d'âge :
 *   17-20 : +3 à +5 potential bonus (jeunes pépites)
 *   21-23 : +1 à +3
 *   24-26 : +0 à +2 (proche du peak)
 *   27-29 : -1 à +1 (plateau)
 *   30+   : potential = overall (peu de croissance possible)
 *
 * Run :
 *   DATABASE_URL=… npx tsx src/scripts/migrate-potentials.ts
 */
import { PrismaClient } from "@/generated/prisma/client";

const prisma = new PrismaClient();

function randInt(min: number, max: number) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function computePotential(overall: number, age: number): number {
  let bonus = 0;
  if (age <= 20) bonus = randInt(3, 5);
  else if (age <= 23) bonus = randInt(1, 3);
  else if (age <= 26) bonus = randInt(0, 2);
  else if (age <= 29) bonus = randInt(-1, 1);
  else bonus = 0;

  // Floor : potential >= overall (un joueur ne peut pas être en dessous de
  // son niveau actuel). Cap : 20 (échelle max).
  return Math.max(overall, Math.min(20, overall + bonus));
}

async function main() {
  console.log("── Migration potentials ──\n");

  const players = await prisma.player.findMany({
    select: { id: true, ign: true, overall: true, age: true, potential: true },
  });
  console.log(`${players.length} joueurs à analyser.`);

  let updated = 0;
  let skipped = 0;
  const updates: { id: string; potential: number }[] = [];

  for (const p of players) {
    const overall = p.overall ?? 10;
    // Skip si potential déjà cohérent (>= overall) et > default 10.
    if (p.potential >= overall && p.potential > 10) {
      skipped++;
      continue;
    }
    const newPotential = computePotential(overall, p.age);
    if (newPotential === p.potential) {
      skipped++;
      continue;
    }
    updates.push({ id: p.id, potential: newPotential });
    updated++;
  }

  if (updates.length === 0) {
    console.log("Rien à mettre à jour.");
  } else {
    // Batch update par chunks
    const CHUNK = 50;
    for (let i = 0; i < updates.length; i += CHUNK) {
      const batch = updates.slice(i, i + CHUNK);
      await prisma.$transaction(
        batch.map((u) =>
          prisma.player.update({
            where: { id: u.id },
            data: { potential: u.potential },
          }),
        ),
      );
    }
    console.log(`Mis à jour : ${updated} joueurs (skip : ${skipped}).`);
  }

  // Sample report
  const sample = await prisma.player.findMany({
    where: { potential: { gt: 17 } },
    select: { ign: true, age: true, overall: true, potential: true },
    orderBy: { potential: "desc" },
    take: 8,
  });
  console.log("\nTop pépites (potential > 17) :");
  for (const s of sample) {
    console.log(
      `  ${s.ign.padEnd(16)} · ${s.age} ans · OVR ${s.overall} → POT ${s.potential}`,
    );
  }

  console.log("\n── Done ──");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
