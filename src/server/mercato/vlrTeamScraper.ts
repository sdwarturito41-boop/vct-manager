import * as cheerio from "cheerio";
import type { PrismaClient } from "@/generated/prisma/client";
import { fetchVlrHtml } from "./vlrScraper";
import type { AgentStatsMap } from "./attributeTypes";

// ── Config ─────────────────────────────────────────────────

const RANK_REGIONS = ["eu", "na", "cn", "br", "jp", "kr", "ap", "las"];
const REQUEST_DELAY_MS = 800;

// ── URL builders ──────────────────────────────────────────

function rankingsUrl(region: string): string {
  return `https://www.vlr.gg/rankings/${region}`;
}

function teamUrl(id: string, slug: string): string {
  return `https://www.vlr.gg/team/${id}/${slug}`;
}

function playerUrl(id: string, slug: string): string {
  return `https://www.vlr.gg/player/${id}/${slug}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeIgn(ign: string): string {
  return ign.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ── Rankings page → list of teams ──────────────────────────

type VlrTeam = { id: string; slug: string; name: string };

export function parseRankingsHtml(html: string): VlrTeam[] {
  const $ = cheerio.load(html);
  const teams: VlrTeam[] = [];

  // Team cards link to /team/<id>/<slug>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $("a[href^='/team/']").each((_: number, el: any) => {
    const href = $(el).attr("href") ?? "";
    const m = href.match(/^\/team\/(\d+)\/([a-z0-9-]+)/);
    if (!m) return;
    const [, id, slug] = m;
    // Try multiple locations for team name — some layouts nest in .team-name,
    // some inline the text.
    const name =
      $(el).find(".rank-item-team-name, .team-name").first().text().trim() ||
      $(el).text().trim().split("\n")[0].trim();
    if (name.length > 0 && name.length < 100) {
      teams.push({ id, slug, name });
    }
  });

  // Dedupe by id
  const byId = new Map<string, VlrTeam>();
  for (const t of teams) byId.set(t.id, t);
  return Array.from(byId.values());
}

// ── Team page → list of players ────────────────────────────

type VlrPlayer = { id: string; slug: string; ign: string };

export function parseTeamHtml(html: string): VlrPlayer[] {
  const $ = cheerio.load(html);
  const players: VlrPlayer[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  $("a[href^='/player/']").each((_: number, el: any) => {
    const href = $(el).attr("href") ?? "";
    const m = href.match(/^\/player\/(\d+)\/([a-z0-9-_]+)/);
    if (!m) return;
    const [, id, slug] = m;
    const ign =
      $(el).find(".team-roster-item-name-alias, .wf-module-item-name").first().text().trim() ||
      $(el).text().trim().split("\n").map((s) => s.trim()).filter(Boolean)[0] ||
      slug;
    if (ign && ign.length < 40) {
      players.push({ id, slug, ign });
    }
  });

  // Dedupe
  const byId = new Map<string, VlrPlayer>();
  for (const p of players) byId.set(p.id, p);
  return Array.from(byId.values());
}

// ── Player page → detailed stats ───────────────────────────

export type PlayerPageStats = {
  ign: string;
  rating: number;
  acs: number;
  kd: number;
  kast: number;
  adr: number;
  kpr: number;
  apr: number;
  fkpr: number;
  fdpr: number;
  hs_pct: number;
  cl_pct: number;
  cl_total: number;
  rounds: number;
  kills: number;
  deaths: number;
  assists: number;
  fk: number;
  fd: number;
  agentStats: AgentStatsMap;
};

function parseNum(raw: string | undefined, fallback = 0): number {
  if (!raw) return fallback;
  const cleaned = raw.replace("%", "").replace(",", ".").trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

function parsePct(raw: string | undefined, fallback = 0): number {
  const n = parseNum(raw, fallback);
  return n > 1 ? n / 100 : n;
}

function parseClutchPair(raw: string | undefined): { wins: number; total: number } {
  if (!raw) return { wins: 0, total: 0 };
  const parts = raw.split("/").map((s) => parseInt(s.replace(/[^\d]/g, ""), 10));
  if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
    return { wins: parts[0], total: parts[1] };
  }
  return { wins: 0, total: 0 };
}

export function parsePlayerPageHtml(html: string): PlayerPageStats | null {
  const $ = cheerio.load(html);

  const ign = $(".wf-title-med, .player-header .wf-title").first().text().trim();
  if (!ign) return null;

  // Stats table on player page — typically a <table> with per-event or total row
  // Try to find the "aggregate" / career row. VLR's player page has a primary
  // stats block where a tbody row summarizes overall stats.
  // Strategy: find any table, take the first row whose cells include large
  // numeric values (rounds ≥ 50).
  let bestRow: { cells: string[]; rounds: number } | null = null;
  $("table").each((_, t) => {
    const $t = $(t);
    $t.find("tr").each((__, tr) => {
      const cells = $(tr)
        .find("td")
        .map((___, td) => $(td).text().trim())
        .get();
      if (cells.length < 10) return;
      // Try to detect rounds column — look for a cell that's a bare integer 50-9999
      for (const c of cells) {
        const n = parseInt(c.replace(/[^\d]/g, ""), 10);
        if (n >= 50 && n < 10000) {
          if (!bestRow || n > bestRow.rounds) bestRow = { cells, rounds: n };
          break;
        }
      }
    });
  });

  if (!bestRow) return null;

  // Heuristic column mapping. VLR player pages have varied layouts; we rely
  // on ordering resembling the stats page. If this miscolumnizes, we fall
  // back gracefully to zeros.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cells = (bestRow as any).cells;
  // Same layout as the stats page starting at rounds:
  // 0: (optional) agent/event label
  // 1: Rnd, 2: R, 3: ACS, 4: K:D, 5: KAST, 6: ADR, 7: KPR, 8: APR, 9: FKPR
  // 10: FDPR, 11: HS%, 12: CL%, 13: CL, 14: KMax, 15: K, 16: D, 17: A, 18: FK, 19: FD
  // If prefix is missing, offset by -1. We detect by checking if cell 0 looks
  // like a label (has letters) vs numeric.
  const hasPrefix = /[a-zA-Z]/.test(cells[0] ?? "");
  const o = hasPrefix ? 0 : -1;

  const rounds = parseNum(cells[1 + o], 0);
  const rating = parseNum(cells[2 + o], 1.0);
  const acs = parseNum(cells[3 + o], 0);
  const kd = parseNum(cells[4 + o], 1);
  const kast = parsePct(cells[5 + o], 0.7);
  const adr = parseNum(cells[6 + o], 0);
  const kpr = parseNum(cells[7 + o], 0);
  const apr = parseNum(cells[8 + o], 0);
  const fkpr = parseNum(cells[9 + o], 0);
  const fdpr = parseNum(cells[10 + o], 0);
  const hs_pct = parsePct(cells[11 + o], 0);
  const cl_pct = parsePct(cells[12 + o], 0);
  const clutch = parseClutchPair(cells[13 + o]);
  const kills = parseNum(cells[15 + o], 0);
  const deaths = parseNum(cells[16 + o], 0);
  const assists = parseNum(cells[17 + o], 0);
  const fk = parseNum(cells[18 + o], 0);
  const fd = parseNum(cells[19 + o], 0);

  return {
    ign,
    rating,
    acs,
    kd,
    kast,
    adr,
    kpr,
    apr,
    fkpr,
    fdpr,
    hs_pct,
    cl_pct,
    cl_total: clutch.total,
    rounds,
    kills,
    deaths,
    assists,
    fk,
    fd,
    agentStats: {},
  };
}

// ── Orchestrator: discover teams → discover rosters → match missing DB pros ──

export async function scrapeTeamRostersAndFillGaps(
  prisma: PrismaClient,
): Promise<{ teamsFound: number; playersFound: number; playersFilled: number }> {
  // 1. Enumerate teams via /rankings/<region> for each region
  const teams = new Map<string, VlrTeam>(); // id → team
  for (const region of RANK_REGIONS) {
    try {
      const html = await fetchVlrHtml(rankingsUrl(region));
      const parsed = parseRankingsHtml(html);
      for (const t of parsed) teams.set(t.id, t);
      console.log(`[vlr-team] rankings ${region}: found ${parsed.length} teams`);
    } catch (err) {
      console.warn(`[vlr-team] rankings ${region} failed: ${String(err).slice(0, 100)}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }
  console.log(`[vlr-team] total unique teams: ${teams.size}`);

  // 2. Fetch each team page → extract roster IGNs + player IDs
  const rosterByIgn = new Map<string, VlrPlayer>(); // normalized ign → player
  for (const team of teams.values()) {
    try {
      const html = await fetchVlrHtml(teamUrl(team.id, team.slug));
      const players = parseTeamHtml(html);
      for (const p of players) rosterByIgn.set(normalizeIgn(p.ign), p);
    } catch (err) {
      console.warn(`[vlr-team] team ${team.name} failed: ${String(err).slice(0, 100)}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }
  console.log(`[vlr-team] total roster pros discovered: ${rosterByIgn.size}`);

  // 3. For each DB player NOT yet scraped, try matching against roster IGNs
  const unscraped = await prisma.player.findMany({
    where: { isRetired: false, lastScrapedAt: null },
    select: { id: true, ign: true },
  });

  let filled = 0;
  for (const dbPlayer of unscraped) {
    const match = rosterByIgn.get(normalizeIgn(dbPlayer.ign));
    if (!match) continue;

    // 4. Fetch player's own VLR page → detailed stats
    try {
      const html = await fetchVlrHtml(playerUrl(match.id, match.slug));
      const stats = parsePlayerPageHtml(html);
      if (!stats || stats.rounds < 10) {
        console.log(`[vlr-team] ${dbPlayer.ign}: no usable stats on player page`);
        continue;
      }

      await prisma.player.update({
        where: { id: dbPlayer.id },
        data: {
          rating: stats.rating,
          acs: stats.acs,
          kd: stats.kd,
          kast: stats.kast * 100,
          adr: stats.adr,
          hs: stats.hs_pct * 100,
          kpr: stats.kpr,
          apr: stats.apr,
          fkpr: stats.fkpr,
          fdpr: stats.fdpr,
          clPct: stats.cl_pct,
          clTotal: stats.cl_total,
          kills: stats.kills,
          deaths: stats.deaths,
          vlrAssists: stats.assists,
          fk: stats.fk,
          fd: stats.fd,
          vlrRounds: stats.rounds,
          lastScrapedAt: new Date(),
          scrapedRounds: stats.rounds,
        },
      });
      filled++;
      console.log(`[vlr-team] ${dbPlayer.ign}: filled (rounds=${stats.rounds}, rating=${stats.rating.toFixed(2)})`);
    } catch (err) {
      console.warn(`[vlr-team] ${dbPlayer.ign} player page failed: ${String(err).slice(0, 100)}`);
    }
    await sleep(REQUEST_DELAY_MS);
  }

  return {
    teamsFound: teams.size,
    playersFound: rosterByIgn.size,
    playersFilled: filled,
  };
}
