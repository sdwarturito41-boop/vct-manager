import { PrismaClient } from "../src/generated/prisma/client";
import {
  parseVlrStatsHtml,
  fetchVlrHtml,
  buildVlrUrl,
} from "../src/server/mercato/vlrScraper";

const prisma = new PrismaClient();

function normalize(ign: string): string {
  return ign.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Levenshtein distance (edit distance), capped — good enough for near-match detection
function editDistance(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const m = a.length;
  const n = b.length;
  const prev = new Array<number>(n + 1);
  const cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(
        cur[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > cap) return cap + 1;
    for (let j = 0; j <= n; j++) prev[j] = cur[j];
  }
  return prev[n];
}

(async () => {
  console.log("═══════════════════════════════════════");
  console.log(" VLR ↔ DB match diagnostic");
  console.log("═══════════════════════════════════════");

  type ParseResult = ReturnType<typeof parseVlrStatsHtml>;
  let vlrRows: ParseResult = [];
  try {
    const html = await fetchVlrHtml(buildVlrUrl("all"));
    vlrRows = parseVlrStatsHtml(html);
  } catch (err) {
    console.error("VLR fetch failed:", err);
    return;
  }

  const dbPlayers = await prisma.player.findMany({
    where: { isRetired: false },
    select: { id: true, ign: true },
  });

  console.log(`VLR scraped: ${vlrRows.length} rows`);
  console.log(`DB players:  ${dbPlayers.length}`);
  console.log();

  // Normalize both sides
  const dbByNorm = new Map<string, { id: string; ign: string }>();
  for (const p of dbPlayers) dbByNorm.set(normalize(p.ign), p);

  const matched: string[] = [];
  const unmatched: string[] = [];
  for (const v of vlrRows) {
    if (dbByNorm.has(normalize(v.ign))) matched.push(v.ign);
    else unmatched.push(v.ign);
  }

  console.log(`Matched (exact normalized): ${matched.length}`);
  console.log(`Unmatched VLR → DB:         ${unmatched.length}`);
  console.log();

  // For unmatched VLR players, look for near-matches in DB (edit distance ≤ 2)
  console.log("── Top 20 unmatched VLR players + near-matches ──");
  const dbNorms = Array.from(dbByNorm.keys());
  let shown = 0;
  for (const vlrIgn of unmatched) {
    if (shown >= 20) break;
    const vNorm = normalize(vlrIgn);
    let bestNorm: string | null = null;
    let bestDist = 99;
    for (const dNorm of dbNorms) {
      const d = editDistance(vNorm, dNorm, 2);
      if (d < bestDist) {
        bestDist = d;
        bestNorm = dNorm;
        if (d === 0) break;
      }
    }
    const near = bestNorm && bestDist <= 2 ? dbByNorm.get(bestNorm) : null;
    const nearStr = near ? ` → near DB "${near.ign}" (dist ${bestDist})` : "";
    console.log(`  VLR "${vlrIgn}"${nearStr}`);
    shown++;
  }

  // Inverse: DB players NOT found in VLR
  const vlrByNorm = new Map<string, string>();
  for (const v of vlrRows) vlrByNorm.set(normalize(v.ign), v.ign);
  const dbMissing = dbPlayers.filter((p) => !vlrByNorm.has(normalize(p.ign)));
  console.log();
  console.log(`── DB players NOT in VLR (sample 20 / ${dbMissing.length}) ──`);
  for (const p of dbMissing.slice(0, 20)) {
    console.log(`  DB "${p.ign}"`);
  }

  console.log();
  console.log("If lots of \"near-matches\" with distance 1-2, the normalizer");
  console.log("probably needs to strip more characters (e.g. accents, numbers).");
})().finally(() => prisma.$disconnect());
