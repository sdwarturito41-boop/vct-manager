import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient();
const CSV_PATH = path.join(process.cwd(), "data", "players-agents.csv");

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else { inQuotes = false; }
      } else { cell += c; }
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

function num(s: string | undefined): number | null {
  if (!s) return null;
  const t = s.trim();
  if (!t || t === "—") return null;
  const n = parseFloat(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

(async () => {
  const text = fs.readFileSync(CSV_PATH, "utf8");
  const rows = parseCsv(text);
  // Row 0 = header: IGN,Agent,Rounds,Rating,ACS,K:D,ADR,KAST,KPR,APR,FKPR,FDPR,HS%,Mastery
  const dataRows = rows.slice(1).filter((r) => (r[0] ?? "").trim());
  console.log(`[agents] ${dataRows.length} agent rows`);

  // Group by IGN
  const byIgn = new Map<string, Record<string, unknown>>();
  for (const row of dataRows) {
    const ign = row[0].trim();
    const agent = row[1].trim().toLowerCase();
    if (!agent) continue;
    const stats = {
      rounds: num(row[2]) ?? 0,
      rating: num(row[3]) ?? 0,
      acs: num(row[4]) ?? 0,
      kd: num(row[5]) ?? 0,
      adr: num(row[6]) ?? 0,
      kast: num(row[7]) ?? 0,
      kpr: num(row[8]) ?? 0,
      apr: num(row[9]) ?? 0,
      fkpr: num(row[10]) ?? 0,
      fdpr: num(row[11]) ?? 0,
      hs: num(row[12]) ?? 0,
      mastery: num(row[13]) ?? 0,
    };
    if (!byIgn.has(ign)) byIgn.set(ign, {});
    (byIgn.get(ign) as Record<string, unknown>)[agent] = stats;
  }
  console.log(`[agents] ${byIgn.size} unique IGNs with agents`);

  // Match earliest-created player per IGN (template)
  const all = await prisma.player.findMany({
    select: { id: true, ign: true },
    orderBy: { createdAt: "asc" },
  });
  const ignToId = new Map<string, string>();
  for (const p of all) {
    const k = p.ign.toLowerCase().trim();
    if (!ignToId.has(k)) ignToId.set(k, p.id);
  }

  let updated = 0;
  const unmatched: string[] = [];
  for (const [ign, agents] of byIgn) {
    const id = ignToId.get(ign.toLowerCase());
    if (!id) { unmatched.push(ign); continue; }
    await prisma.player.update({ where: { id }, data: { agentStats: agents as object } });
    updated++;
  }

  console.log(`[agents] updated: ${updated}, unmatched: ${unmatched.length}`);
  if (unmatched.length) console.log(`[agents] unmatched:`, unmatched.slice(0, 20));
})().finally(() => prisma.$disconnect());
