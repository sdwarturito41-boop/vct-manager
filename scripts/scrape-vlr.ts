import { PrismaClient } from "../src/generated/prisma/client";
import { runVlrScrape } from "../src/server/mercato/vlrScraper";
import { invalidatePercentileCache, recomputeAllOveralls } from "../src/server/mercato/attributes";

const prisma = new PrismaClient();

(async () => {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`[scrape-vlr] Starting${dryRun ? " (DRY RUN)" : ""}...`);
  const started = Date.now();

  try {
    const result = await runVlrScrape(prisma, { dryRun });
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`[scrape-vlr] Done in ${elapsed}s`);
    console.log(`  runId:           ${result.runId}`);
    console.log(`  playersUpdated:  ${result.playersUpdated}`);
    console.log(`  playersSkipped:  ${result.playersSkipped}`);
    console.log(`  agentsCovered:   ${result.agentsCovered}/26`);

    if (!dryRun) {
      invalidatePercentileCache();
      console.log(`[scrape-vlr] Recomputing overalls for all saves...`);
      const saves = await prisma.save.findMany({ select: { id: true } });
      let total = 0;
      for (const s of saves) {
        const n = await recomputeAllOveralls(prisma, s.id);
        total += n;
      }
      console.log(`[scrape-vlr] Recomputed overalls for ${total} players across ${saves.length} saves`);
    }
  } catch (err) {
    console.error(`[scrape-vlr] FAILED: ${String(err)}`);
    process.exit(1);
  }
})().finally(() => prisma.$disconnect());
