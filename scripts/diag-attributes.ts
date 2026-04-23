import { PrismaClient } from "../src/generated/prisma/client";
import {
  getPercentileCache,
  computeAttributes,
  computeOverall,
  inferPlaystyleRole,
} from "../src/server/mercato/attributes";
import { ALL_ATTR_KEYS } from "../src/constants/role-weights";

const prisma = new PrismaClient();

(async () => {
  const cache = await getPercentileCache(prisma, true);

  const players = await prisma.player.findMany({
    where: { isRetired: false },
    orderBy: { acs: "desc" },
    take: 30,
  });

  console.log("═══════════════════════════════════════");
  console.log(" Attribute diagnostics — top 30 by ACS");
  console.log("═══════════════════════════════════════");

  const overalls: number[] = [];

  for (const p of players) {
    const raw = {
      id: p.id, role: p.role, rating: p.rating, acs: p.acs, kd: p.kd, adr: p.adr,
      kast: p.kast, hs: p.hs, kpr: p.kpr, apr: p.apr, fkpr: p.fkpr, fdpr: p.fdpr,
      clPct: p.clPct, clTotal: p.clTotal, kills: p.kills, deaths: p.deaths,
      vlrAssists: p.vlrAssists, fk: p.fk, fd: p.fd, vlrRounds: p.vlrRounds,
      agentStats: p.agentStats, isIgl: p.isIgl,
    };
    const role = p.playstyleRole ?? inferPlaystyleRole(raw);
    const attrs = computeAttributes(raw, cache);
    const overall = computeOverall(attrs, role);
    overalls.push(overall);
    console.log(
      `  ${p.ign.padEnd(14)} ${role.padEnd(16)} overall=${overall.toFixed(1).padStart(5)}  aim=${attrs.aim.toFixed(0).padStart(2)}  ldr=${attrs.leadership.toFixed(0).padStart(2)}  clutch=${attrs.clutch.toFixed(0).padStart(2)}`,
    );
  }

  console.log();
  console.log("── Overall distribution (template pool) ──");
  const all = await prisma.player.findMany({
    where: { isRetired: false, teamId: null, currentTeam: { not: null } },
    select: { overall: true },
  });
  const sorted = [...all].map((p) => p.overall).sort((a, b) => a - b);
  if (sorted.length > 0) {
    const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    console.log(`  n=${sorted.length}  min=${sorted[0].toFixed(1)}  p50=${p50.toFixed(1)}  p95=${p95.toFixed(1)}  max=${sorted[sorted.length - 1].toFixed(1)}  avg=${avg.toFixed(1)}`);
  } else {
    console.log("  (no template pool rows — run scrape-vlr first)");
  }

  console.log();
  console.log("── Sanity checks ──");
  const outliers = sorted.filter((v) => v < 5 || v > 18);
  console.log(`  Overall outliers (<5 or >18): ${outliers.length}`);
  const lastRun = await prisma.vlrScrapeRun.findFirst({ orderBy: { startedAt: "desc" } });
  if (lastRun) {
    console.log(`  Last VLR scrape: ${lastRun.startedAt.toISOString()} — ${lastRun.status}${lastRun.error ? ` (${lastRun.error.slice(0, 80)})` : ""}`);
  } else {
    console.log("  Last VLR scrape: never");
  }
  console.log(`  Attribute keys wired: ${ALL_ATTR_KEYS.length} (expected 26)`);
})().finally(() => prisma.$disconnect());
