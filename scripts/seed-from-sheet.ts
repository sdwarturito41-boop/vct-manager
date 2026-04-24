import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import {
  PrismaClient,
  type PlaystyleRole,
} from "../src/generated/prisma/client";

const prisma = new PrismaClient();

const CSV_PATH = path.join(process.cwd(), "data", "players.csv");

// ── CSV parsing ────────────────────────────────────────────

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (c !== "\r") {
      cell += c;
    }
  }
  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// ── Value parsers ──────────────────────────────────────────

function num(s: string | undefined): number | null {
  if (!s) return null;
  const t = s.trim();
  if (!t || t === "—" || t === "-" || t === "#NAME?") return null;
  const cleaned = t.replace(/[%$]/g, "").replace(/\s/g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseStars(s: string | undefined): number {
  if (!s) return 0;
  const full = (s.match(/★/g) || []).length;
  const half = s.includes("½") ? 0.5 : 0;
  // "★★★★☆" = 4 full. "★★★½☆" = 3 full + "½" → 3.5. The ½ char counts
  // inside ★-match sometimes? Be defensive: strip then measure.
  const cleanFull = (s.replace(/½/g, "").match(/★/g) || []).length;
  return cleanFull + half;
}

// ── Column indices (0-based, from header row at line 2) ────

const C = {
  REGION: 0,
  TEAM: 1,
  IGN: 2,
  NAME: 3,
  NAT: 4,
  AGE: 5,
  ROLE: 6,
  SALARY: 10,
  ROUNDS: 12,
  RATING: 13,
  ACS: 14,
  KD: 15,
  KAST: 16,
  ADR: 17,
  KPR: 18,
  APR: 19,
  FKPR: 20,
  FDPR: 21,
  HS: 22,
  CL_PCT: 23,
  CL_TOTAL: 24,
  FK: 25,
  FD: 26,
  // 32-57 = 26 attributes
  ATTR_START: 32,
  TECH_AVG: 58,
  MEN_AVG: 59,
  PHY_AVG: 60,
  OVERALL: 61,
  ROLES_START: 62, // pairs of (score, stars) × 12
  LABEL: 86,
};

// camelCase names align with AttrKey / ROLE_WEIGHTS throughout the app.
const ATTR_NAMES = [
  // Technique (10)
  "aim", "crosshair", "entryTiming", "peek", "positioning",
  "utilUsage", "tradeDiscipline", "clutch", "counterStrat", "mapAdaptability",
  // Mental (10)
  "aggression", "decisionMaking", "consistency", "workRate", "vision",
  "composure", "pressureRes", "adaptability", "leadership", "ambition",
  // Physique (6)
  "reactionTime", "mousePrecision", "peakPerf", "staminaBO5", "movementSpeed", "mentalEndurance",
];

const ROLE_NAMES: PlaystyleRole[] = [
  "Entry", "Fragger", "Carry",
  "AggressiveInit", "IntelInit", "FlexInit",
  "IglSmoke", "AggressiveSmoke", "AnchorSmoke",
  "Anchor", "Lurker", "SupportSent",
];

// ── Main ──────────────────────────────────────────────────

async function main() {
  if (!fs.existsSync(CSV_PATH)) {
    console.error(`CSV not found: ${CSV_PATH}`);
    process.exit(1);
  }

  const text = fs.readFileSync(CSV_PATH, "utf8");
  const rows = parseCsv(text);
  console.log(`[seed] parsed ${rows.length} rows`);

  // Skip: row 0 = category headers, row 1 = field names, row 2 = #NAME? junk
  const dataRows = rows.slice(3).filter((r) => (r[C.IGN] ?? "").trim());
  console.log(`[seed] ${dataRows.length} player rows`);

  // Match all players by IGN; if duplicates, prefer the earliest-created (the template).
  // Skips save clones because their updates are overridden by subsequent clones anyway;
  // updating the template is what propagates to future saves.
  const all = await prisma.player.findMany({
    select: { id: true, ign: true, createdAt: true, teamId: true, pandascoreId: true },
    orderBy: { createdAt: "asc" },
  });
  const byIgn = new Map<string, string>();
  for (const p of all) {
    const key = p.ign.toLowerCase().trim();
    if (!byIgn.has(key)) byIgn.set(key, p.id); // first (earliest) wins
  }

  console.log(`[seed] ${all.length} total players in DB (using earliest-created per IGN)`);

  let matched = 0;
  let unmatched: string[] = [];
  let updated = 0;

  for (const row of dataRows) {
    const ign = (row[C.IGN] ?? "").trim();
    const dbId = byIgn.get(ign.toLowerCase());
    if (!dbId) {
      unmatched.push(ign);
      continue;
    }
    matched++;

    // Parse 26 attributes
    const attributes: Record<string, number> = {};
    for (let i = 0; i < ATTR_NAMES.length; i++) {
      const v = num(row[C.ATTR_START + i]);
      if (v != null) attributes[ATTR_NAMES[i]] = v;
    }

    // Parse 12 role scores + stars
    const roleScores: Record<string, { score: number; stars: number }> = {};
    let bestRole: PlaystyleRole | null = null;
    let bestScore = -1;
    for (let i = 0; i < ROLE_NAMES.length; i++) {
      const score = num(row[C.ROLES_START + i * 2]);
      const stars = parseStars(row[C.ROLES_START + i * 2 + 1]);
      if (score != null) {
        roleScores[ROLE_NAMES[i]] = { score, stars };
        if (score > bestScore) {
          bestScore = score;
          bestRole = ROLE_NAMES[i];
        }
      }
    }

    // Base stats
    const acs = num(row[C.ACS]);
    const kd = num(row[C.KD]);
    const adr = num(row[C.ADR]);
    const kast = num(row[C.KAST]); // %, keep as 0-100
    const hs = num(row[C.HS]); // %
    const rating = num(row[C.RATING]);
    const kpr = num(row[C.KPR]);
    const apr = num(row[C.APR]);
    const fkpr = num(row[C.FKPR]);
    const fdpr = num(row[C.FDPR]);
    const clPct = num(row[C.CL_PCT]); // stored as 0-100 % in sheet
    const clTotal = num(row[C.CL_TOTAL]);
    const fk = num(row[C.FK]);
    const fd = num(row[C.FD]);
    const rounds = num(row[C.ROUNDS]);
    const overall = num(row[C.OVERALL]);
    const label = (row[C.LABEL] ?? "").trim() || null;

    await prisma.player.update({
      where: { id: dbId },
      data: {
        ...(acs != null && { acs }),
        ...(kd != null && { kd }),
        ...(adr != null && { adr }),
        ...(kast != null && { kast }),
        ...(hs != null && { hs }),
        ...(rating != null && { rating }),
        ...(kpr != null && { kpr }),
        ...(apr != null && { apr }),
        ...(fkpr != null && { fkpr }),
        ...(fdpr != null && { fdpr }),
        ...(clPct != null && { clPct: clPct / 100 }),
        ...(clTotal != null && { clTotal: Math.round(clTotal) }),
        ...(fk != null && { fk: Math.round(fk) }),
        ...(fd != null && { fd: Math.round(fd) }),
        ...(rounds != null && { vlrRounds: Math.round(rounds), scrapedRounds: Math.round(rounds) }),
        ...(overall != null && { overall }),
        ...(bestRole && { playstyleRole: bestRole }),
        attributes,
        roleScores,
        label,
        lastScrapedAt: new Date(),
      },
    });
    updated++;
  }

  console.log(`[seed] matched: ${matched}, updated: ${updated}, unmatched: ${unmatched.length}`);
  if (unmatched.length > 0) {
    console.log(`[seed] unmatched (first 20):`, unmatched.slice(0, 20));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
