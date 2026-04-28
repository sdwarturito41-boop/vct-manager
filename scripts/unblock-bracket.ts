import "dotenv/config";
import { PrismaClient, type Region } from "../src/generated/prisma/client";
import {
  progressBracket,
  progressMastersBracket,
  progressRegionalStage,
  progressRegionalPlayoffs,
  progressSwiss,
} from "../src/server/schedule/generate";

const prisma = new PrismaClient();

(async () => {
  // Iterate per save — bracket progression is now save-scoped, so we run the
  // self-heal pass against each save's matches independently.
  const saves = await prisma.save.findMany({
    include: { seasons: { where: { isActive: true } } },
  });
  if (saves.length === 0) {
    console.log("No saves found.");
    return;
  }

  for (const save of saves) {
    const season = save.seasons[0];
    if (!season) continue;
    console.log(`\nSave ${save.id} | Season ${season.number} (currentDay=${season.currentDay})`);

    const matches = await prisma.match.findMany({
      where: { saveId: save.id, season: season.number },
      include: { team1: { select: { region: true } } },
    });

    const byStageRegion = new Map<string, { played: number; total: number }>();
    for (const m of matches) {
      const key = `${m.stageId}::${m.team1.region}`;
      const cur = byStageRegion.get(key) ?? { played: 0, total: 0 };
      cur.total++;
      if (m.isPlayed) cur.played++;
      byStageRegion.set(key, cur);
    }

    let progressed = 0;
    for (const [key, counts] of byStageRegion) {
      if (counts.played !== counts.total || counts.total === 0) continue;
      const [stageId, region] = key.split("::");

      const isInternational =
        stageId.startsWith("MASTERS_") ||
        stageId.startsWith("EWC_") ||
        stageId.startsWith("CHAMPIONS_");
      const isSwiss = stageId.includes("_SWISS_R");

      try {
        if (isSwiss) {
          await progressSwiss(prisma, save.id, stageId, season.number, season.currentDay);
          console.log(`  ✓ Swiss progress: ${stageId}`);
        } else if (isInternational && !isSwiss) {
          await progressMastersBracket(prisma, save.id, stageId, season.number, season.currentDay);
          console.log(`  ✓ Masters bracket: ${stageId}`);
        } else if (stageId.startsWith("KICKOFF")) {
          await progressBracket(
            prisma,
            save.id,
            stageId,
            region as Region,
            season.number,
            season.currentDay,
          );
          console.log(`  ✓ Kickoff bracket: ${stageId} (${region})`);
        } else if (stageId === "STAGE_1_ALPHA" || stageId === "STAGE_1_OMEGA") {
          await progressRegionalStage(
            prisma,
            save.id,
            "STAGE_1",
            region as Region,
            season.number,
            season.currentDay,
          );
          console.log(`  ✓ Stage 1 group: ${stageId} (${region})`);
        } else if (stageId === "STAGE_2_ALPHA" || stageId === "STAGE_2_OMEGA") {
          await progressRegionalStage(
            prisma,
            save.id,
            "STAGE_2",
            region as Region,
            season.number,
            season.currentDay,
          );
          console.log(`  ✓ Stage 2 group: ${stageId} (${region})`);
        } else if (stageId.includes("_PO_")) {
          await progressRegionalPlayoffs(
            prisma,
            save.id,
            stageId,
            region as Region,
            season.number,
            season.currentDay,
          );
          console.log(`  ✓ Regional playoffs: ${stageId} (${region})`);
        } else {
          continue;
        }
        progressed++;
      } catch (e) {
        console.warn(`  ⚠ ${stageId} (${region}): ${(e as Error).message.slice(0, 100)}`);
      }
    }

    const fresh = await prisma.match.count({
      where: { saveId: save.id, season: season.number, isPlayed: false, day: { gt: 0 } },
    });
    console.log(`  → ${progressed} progressions run, ${fresh} unplayed matches scheduled`);
  }
})()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
