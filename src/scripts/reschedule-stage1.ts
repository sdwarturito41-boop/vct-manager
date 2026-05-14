/**
 * One-shot : supprime tous les matchs STAGE_1_* sur chaque save active et
 * reschedule via initializeRegionalStage avec le nouveau code calendar-aware.
 *
 * Effet pour le save courant :
 *   - Tous les matchs Stage 1 (joués + non joués) sont supprimés
 *   - Les wins/losses des équipes ayant joué ces matchs sont décrémentés
 *   - initializeRegionalStage régénère le group stage avec Wed-Fri (EMEA)
 *     et les vrais weekdays par région
 *
 * Run :
 *   DATABASE_URL=… npx tsx src/scripts/reschedule-stage1.ts
 */
import { PrismaClient } from "@/generated/prisma/client";
import { initializeRegionalStage } from "@/server/schedule/generate";

const prisma = new PrismaClient();

async function main() {
  const saves = await prisma.save.findMany({
    select: { id: true },
  });
  console.log(`Found ${saves.length} save(s) to process.\n`);

  for (const save of saves) {
    const season = await prisma.season.findFirst({
      where: { saveId: save.id, isActive: true },
      select: { id: true, number: true, currentDay: true },
    });
    if (!season) {
      console.log(`Save ${save.id} : pas de saison active, skip.`);
      continue;
    }

    console.log(`── Save ${save.id} (season ${season.number}, day ${season.currentDay}) ──`);

    // 1) Liste des matchs Stage 1 played pour rollback W/L
    const playedMatches = await prisma.match.findMany({
      where: {
        saveId: save.id,
        season: season.number,
        stageId: { startsWith: "STAGE_1" },
        isPlayed: true,
        winnerId: { not: null },
      },
      select: {
        winnerId: true,
        team1Id: true,
        team2Id: true,
      },
    });

    // Aggregate W/L rollback per team
    const winsDelta = new Map<string, number>();
    const lossesDelta = new Map<string, number>();
    for (const m of playedMatches) {
      const loserId = m.winnerId === m.team1Id ? m.team2Id : m.team1Id;
      winsDelta.set(m.winnerId!, (winsDelta.get(m.winnerId!) ?? 0) + 1);
      lossesDelta.set(loserId, (lossesDelta.get(loserId) ?? 0) + 1);
    }

    // 2) Decrement
    if (winsDelta.size > 0 || lossesDelta.size > 0) {
      const teamIds = new Set([...winsDelta.keys(), ...lossesDelta.keys()]);
      const updates = Array.from(teamIds).map((teamId) =>
        prisma.team.update({
          where: { id: teamId },
          data: {
            wins: { decrement: winsDelta.get(teamId) ?? 0 },
            losses: { decrement: lossesDelta.get(teamId) ?? 0 },
          },
        }),
      );
      await prisma.$transaction(updates);
      console.log(`  Rollback W/L pour ${teamIds.size} équipe(s)`);
    }

    // 3) Delete all STAGE_1 matches
    const deleted = await prisma.match.deleteMany({
      where: {
        saveId: save.id,
        season: season.number,
        stageId: { startsWith: "STAGE_1" },
      },
    });
    console.log(`  Supprimé ${deleted.count} match(s) STAGE_1`);

    // 4) Re-init Stage 1 with the new calendar-aware scheduler
    const result = await initializeRegionalStage(
      prisma,
      save.id,
      season.number,
      "STAGE_1",
    );
    console.log(`  Re-schedulé ${result.matchesScheduled} match(s)`);
    console.log();
  }

  console.log("── Done ──");
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
