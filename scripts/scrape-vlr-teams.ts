import { PrismaClient } from "../src/generated/prisma/client";
import { scrapeTeamRostersAndFillGaps } from "../src/server/mercato/vlrTeamScraper";
import {
  invalidatePercentileCache,
  recomputeAllOveralls,
} from "../src/server/mercato/attributes";

const prisma = new PrismaClient();

(async () => {
  console.log("[vlr-team] Starting team-roster + player-page scrape");
  const started = Date.now();
  const result = await scrapeTeamRostersAndFillGaps(prisma);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`[vlr-team] Done in ${elapsed}s`);
  console.log(`  teams found:    ${result.teamsFound}`);
  console.log(`  roster players: ${result.playersFound}`);
  console.log(`  players filled: ${result.playersFilled}`);

  if (result.playersFilled > 0) {
    invalidatePercentileCache();
    console.log("[vlr-team] Recomputing overalls for all saves...");
    const saves = await prisma.save.findMany({ select: { id: true } });
    let total = 0;
    for (const s of saves) {
      const n = await recomputeAllOveralls(prisma, s.id);
      total += n;
    }
    console.log(`[vlr-team] Recomputed overalls for ${total} players across ${saves.length} saves`);
  }
})().finally(() => prisma.$disconnect());
