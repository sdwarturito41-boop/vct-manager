import * as cheerio from "cheerio";
import type { PrismaClient } from "@/generated/prisma/client";
import type { AgentStatsEntry, AgentStatsMap } from "./attributeTypes";

// ── Config ─────────────────────────────────────────────────

// Default to VCT 2026 + 60d (the user's canonical window). Env overrides
// let us target specific events without touching code.
const EVENT_GROUP_ID = process.env.VLR_EVENT_GROUP_ID ?? "86";
const TIMESPAN = process.env.VLR_TIMESPAN ?? "60d";
const MIN_RATING = 0;
const REQUEST_DELAY_MS = 800; // respectful pacing (~1.25 req/s)

// Two-pass scrape: wide net (min_rounds=1) captures amateurs with short
// samples; tight net (min_rounds=500) surfaces tier-1 pros who otherwise
// sit below the 840 cap because tier-2 stompers inflate the top of the
// list with unusually high ratings against weaker opposition.
const MIN_ROUNDS_PASSES = [1, 500];

const AGENTS: string[] = [
  "jett", "raze", "neon", "phoenix", "yoru", "reyna", "iso",
  "sova", "breach", "kayo", "skye", "fade", "gekko", "tejo",
  "omen", "brimstone", "astra", "harbor", "viper", "clove",
  "killjoy", "cypher", "sage", "chamber", "deadlock", "vyse",
];

// Map lowercase slugs from VLR back to the capitalized names used elsewhere.
const AGENT_CANONICAL: Record<string, string> = {
  jett: "Jett",
  raze: "Raze",
  neon: "Neon",
  phoenix: "Phoenix",
  yoru: "Yoru",
  reyna: "Reyna",
  iso: "Iso",
  sova: "Sova",
  breach: "Breach",
  kayo: "KAYO",
  skye: "Skye",
  fade: "Fade",
  gekko: "Gekko",
  tejo: "Tejo",
  omen: "Omen",
  brimstone: "Brimstone",
  astra: "Astra",
  harbor: "Harbor",
  viper: "Viper",
  clove: "Clove",
  killjoy: "Killjoy",
  cypher: "Cypher",
  sage: "Sage",
  chamber: "Chamber",
  deadlock: "Deadlock",
  vyse: "Vyse",
};

export function buildVlrUrl(agent: string, region = "all", page = 1, minRounds = 1): string {
  const eg = EVENT_GROUP_ID === "all" ? "" : `event_group_id=${EVENT_GROUP_ID}&`;
  const pg = page > 1 ? `&page=${page}` : "";
  return `https://www.vlr.gg/stats/?${eg}region=${region}&min_rounds=${minRounds}&min_rating=${MIN_RATING}&agent=${agent}&map_id=all&timespan=${TIMESPAN}${pg}`;
}

function buildUrl(agent: string, region = "all", page = 1, minRounds = 1): string {
  return buildVlrUrl(agent, region, page, minRounds);
}

// Valid VLR region codes (confirmed working with event_group_id=86 filter).
// Each region is much smaller than "all" so we bypass the 840-row cap and
// actually get tier-1 pros instead of just tier-2 stompers.
const VLR_REGIONS = ["eu", "cn", "na", "br", "jp", "kr", "ap", "las"];

/**
 * Scrapes the stats page across all 4 regions for the given agent and merges
 * unique IGNs. Region-scoped fetches stay below VLR's row cap — so tier-1
 * pros actually appear instead of being buried behind tier-2 stompers.
 */
async function fetchAllRegions(agent: string): Promise<ScrapedPlayer[]> {
  const byIgn = new Map<string, ScrapedPlayer>();
  for (const region of VLR_REGIONS) {
    for (const minRounds of MIN_ROUNDS_PASSES) {
      try {
        const html = await fetchHtml(buildUrl(agent, region, 1, minRounds));
        const rows = parseVlrStatsHtml(html);
        for (const r of rows) {
          const key = normalizeIgn(r.ign);
          const prev = byIgn.get(key);
          if (!prev || r.rounds > prev.rounds) byIgn.set(key, r);
        }
      } catch (err) {
        console.warn(
          `[vlr] region=${region} min_rounds=${minRounds} failed for agent=${agent}: ${String(err).slice(0, 100)}`,
        );
      }
      await sleep(REQUEST_DELAY_MS);
    }
  }
  return Array.from(byIgn.values());
}

// ── Parsing ────────────────────────────────────────────────

export type ScrapedPlayer = {
  ign: string;
  teamTag: string | null;
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
};

function parseNum(raw: string | undefined, fallback = 0): number {
  if (!raw) return fallback;
  const cleaned = raw.replace("%", "").replace(",", ".").trim();
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : fallback;
}

function parsePct(raw: string | undefined, fallback = 0): number {
  const n = parseNum(raw, fallback);
  // VLR exposes percentages as "45%" strings — we normalize to 0-1
  return n > 1 ? n / 100 : n;
}

function parseClutchPair(raw: string | undefined): { wins: number; total: number } {
  if (!raw) return { wins: 0, total: 0 };
  // Format: "5/14" or "—"
  const parts = raw.split("/").map((s) => parseInt(s.replace(/[^\d]/g, ""), 10));
  if (parts.length === 2 && parts.every((n) => Number.isFinite(n))) {
    return { wins: parts[0], total: parts[1] };
  }
  return { wins: 0, total: 0 };
}

/**
 * Parses the VLR stats table into player records. Column layout observed on
 * /stats/ pages: Player, Agents, R (rounds), Rating, ACS, K:D, KAST, ADR,
 * KPR, APR, FKPR, FDPR, HS%, CL%, CL, K, D, A, FK, FD. Schemas may shift
 * between VLR updates — see TROUBLESHOOTING.md.
 */
export function parseVlrStatsHtml(html: string): ScrapedPlayer[] {
  const $ = cheerio.load(html);
  const rows: ScrapedPlayer[] = [];

  // VLR class combinations have changed over time. Try tbody first, then
  // fall back to direct tr children (some layouts omit tbody). Skip the
  // header row (first tr) by filtering cells.length.
  const SELECTORS = [
    "table.mod-stats tbody tr",
    "table.wf-table tbody tr",
    "table.mod-stats tr",    // tbody-less variant
    "table.wf-table tr",
    "table tbody tr",
    "table tr",
  ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let trs: any = null;
  for (const sel of SELECTORS) {
    const found = $(sel);
    if (found.length > 1) {
      // Need >1 to skip pure-header tables (single <tr> = header only)
      trs = found;
      console.log(`[vlr] parse: selector "${sel}" matched ${found.length} rows`);
      break;
    }
  }
  if (!trs || trs.length === 0) {
    const tables = $("table");
    console.warn(
      `[vlr] parse: no stats table rows. Found ${tables.length} <table>(s). Classes:`,
      tables
        .map((_, t) => $(t).attr("class") ?? "(no class)")
        .get()
        .slice(0, 5),
    );
    // Show the inner shape of the first table so we can spot the structure.
    if (tables.length > 0) {
      const firstTable = tables.first();
      console.warn(
        `[vlr] parse: first table has ${firstTable.find("tr").length} <tr>, ${firstTable.find("tbody").length} <tbody>, ${firstTable.find("td").length} <td>`,
      );
      const snippet = firstTable.html()?.slice(0, 600) ?? "(empty table)";
      console.warn(`[vlr] parse: first table innerHTML snippet:\n${snippet}`);
    }
    console.warn(
      `[vlr] parse: body length ${html.length}, first 300 chars:\n`,
      html.slice(0, 300),
    );
    return rows;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  trs.each((_: number, tr: any) => {
    const $tr = $(tr);
    const cells = $tr.find("td");
    if (cells.length < 10) return;

    // Player cell — nested a.text-of div with name + team
    const nameAnchor = $(cells[0]).find("a").first();
    const ignText = nameAnchor.find(".text-of").first().text().trim()
      || nameAnchor.text().trim();
    if (!ignText) return;
    const teamTag = $(cells[0]).find(".stats-player-country, .ge-text-light").first().text().trim() || null;

    // Column offsets may shift; we reach by known positions relative to the
    // "Rating" column which is reliably at index 3 on the stats page.
    const get = (idx: number) => $(cells[idx]).text();

    const rounds = parseNum(get(2), 0);
    const rating = parseNum(get(3), 1.0);
    const acs = parseNum(get(4), 0);
    const kd = parseNum(get(5), 1);
    const kast = parsePct(get(6), 0.7);
    const adr = parseNum(get(7), 0);
    const kpr = parseNum(get(8), 0);
    const apr = parseNum(get(9), 0);
    const fkpr = parseNum(get(10), 0);
    const fdpr = parseNum(get(11), 0);
    const hs_pct = parsePct(get(12), 0);
    const cl_pct = parsePct(get(13), 0);
    const clutch = parseClutchPair(get(14));
    // cells[15] is KMax (single-map best), NOT kills. Real K/D/A/FK/FD start at 16.
    const kills = parseNum(get(16), 0);
    const deaths = parseNum(get(17), 0);
    const assists = parseNum(get(18), 0);
    const fk = parseNum(get(19), 0);
    const fd = parseNum(get(20), 0);

    rows.push({
      ign: ignText,
      teamTag,
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
    });
  });

  return rows;
}

// ── HTTP ───────────────────────────────────────────────────

/**
 * Manual redirect handler with a persistent cookie jar. VLR sets cookies via
 * redirects (bot-challenge-style); without honoring them between hops the
 * fetch loops until it exceeds the redirect cap. Also lets us reuse cookies
 * across all scrape calls in a single run.
 */
const COOKIE_JAR = new Map<string, string>();
const MAX_REDIRECTS = 8;

function serializeCookies(): string {
  return Array.from(COOKIE_JAR.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
}

function absorbSetCookies(headers: Headers): void {
  // Node's fetch Headers supports getSetCookie() as of Node 19.7+
  // Falls back to the single-header path on older runtimes.
  const setCookies =
    (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  if (setCookies.length === 0) {
    const raw = headers.get("set-cookie");
    if (raw) setCookies.push(raw);
  }
  for (const sc of setCookies) {
    const [kv] = sc.split(";");
    const eq = kv.indexOf("=");
    if (eq < 1) continue;
    const k = kv.slice(0, eq).trim();
    const v = kv.slice(eq + 1).trim();
    if (k && v) COOKIE_JAR.set(k, v);
  }
}

async function fetchFollowing(url: string, depth = 0): Promise<Response> {
  if (depth > MAX_REDIRECTS) {
    throw new Error(`Too many redirects (${depth}) starting from ${url}`);
  }
  const cookieHeader = serializeCookies();
  const res = await fetch(url, {
    redirect: "manual",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      "Accept":
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "Upgrade-Insecure-Requests": "1",
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    },
  });
  absorbSetCookies(res.headers);

  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    if (!loc) return res;
    const next = new URL(loc, url).toString();
    // drain the body to free the socket
    await res.arrayBuffer().catch(() => null);
    return fetchFollowing(next, depth + 1);
  }
  return res;
}

export async function fetchVlrHtml(url: string, attempt = 1): Promise<string> {
  return fetchHtml(url, attempt);
}

async function fetchHtml(url: string, attempt = 1): Promise<string> {
  try {
    const res = await fetchFollowing(url);
    if (!res.ok) throw new Error(`VLR ${res.status} on ${url}`);
    return await res.text();
  } catch (err) {
    const cause = (err as { cause?: unknown }).cause;
    const causeMsg = cause
      ? ` cause=${(cause as { code?: string; message?: string }).code ?? ""} ${(cause as { message?: string }).message ?? String(cause)}`
      : "";
    console.warn(`[vlr] fetch attempt ${attempt} failed on ${url}:${causeMsg} (${String(err)})`);
    if (attempt >= 3) {
      throw new Error(
        `VLR fetch failed after 3 attempts on ${url}${causeMsg} — original: ${String(err)}`,
      );
    }
    await sleep(2_000 * attempt);
    return fetchHtml(url, attempt + 1);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Orchestrator ───────────────────────────────────────────

function normalizeIgn(ign: string): string {
  return ign.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function confidenceForRounds(rounds: number): AgentStatsEntry["confidence"] {
  if (rounds >= 200) return "reliable";
  if (rounds >= 50) return "small_sample";
  return "insufficient";
}

function toAgentStatsEntry(r: ScrapedPlayer): AgentStatsEntry {
  return {
    rounds: r.rounds,
    acs: r.acs,
    kd: r.kd,
    kast: r.kast,
    adr: r.adr,
    kpr: r.kpr,
    apr: r.apr,
    fkpr: r.fkpr,
    fdpr: r.fdpr,
    hs_pct: r.hs_pct,
    confidence: confidenceForRounds(r.rounds),
  };
}

export type VlrScrapeResult = {
  runId: string;
  playersUpdated: number;
  playersSkipped: number;
  agentsCovered: number;
};

/**
 * Full VLR scrape pipeline. Fetches the global stats page plus one page per
 * agent, then upserts into Player. Matching is by normalized IGN against
 * existing rows (so the template pool must already contain the pros by
 * name — seed-pandascore is run first).
 */
export async function runVlrScrape(
  prisma: PrismaClient,
  options: { dryRun?: boolean } = {},
): Promise<VlrScrapeResult> {
  const run = await prisma.vlrScrapeRun.create({
    data: { status: "pending" },
  });

  try {
    // Pass 1 — global stats, scraped per-region (8 fetches) to bypass the
    // 840-row cap. Union gives comprehensive coverage of tier-1 pros.
    const globalRows = await fetchAllRegions("all");
    console.log(`[vlr] global total: ${globalRows.length} unique pros across ${VLR_REGIONS.length} regions`);

    // Pass 2 — per agent, single region=all fetch (26 fetches). The per-agent
    // page is naturally smaller (filtered to one agent) so the 840 cap is
    // rarely hit. Skip per-region iteration here to keep scrape time bounded.
    const byAgent = new Map<string, Map<string, ScrapedPlayer>>();
    let agentsOk = 0;
    for (const agent of AGENTS) {
      await sleep(REQUEST_DELAY_MS);
      try {
        const html = await fetchHtml(buildUrl(agent, "all"));
        const rows = parseVlrStatsHtml(html);
        const bucket = new Map<string, ScrapedPlayer>();
        for (const r of rows) bucket.set(normalizeIgn(r.ign), r);
        byAgent.set(agent, bucket);
        agentsOk++;
      } catch (err) {
        console.warn(`VLR scrape skipped agent=${agent}: ${String(err).slice(0, 120)}`);
      }
    }

    // Merge into database — match existing Player rows by normalized IGN
    const existing = await prisma.player.findMany({
      where: { isRetired: false },
      select: { id: true, ign: true },
    });
    const byNormalized = new Map<string, string>();
    for (const p of existing) {
      byNormalized.set(normalizeIgn(p.ign), p.id);
    }

    let updated = 0;
    let skipped = 0;
    const CHUNK = 20;

    const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
    for (const row of globalRows) {
      const playerId = byNormalized.get(normalizeIgn(row.ign));
      if (!playerId) {
        skipped++;
        continue;
      }

      // Build agentStats map from per-agent pages
      const agentStats: AgentStatsMap = {};
      for (const [agent, bucket] of byAgent) {
        const r = bucket.get(normalizeIgn(row.ign));
        if (!r) continue;
        const canonical = AGENT_CANONICAL[agent] ?? agent;
        agentStats[canonical] = toAgentStatsEntry(r);
      }

      const scrapedRounds = Math.max(
        row.rounds,
        ...Object.values(agentStats).map((s) => s.rounds),
      );

      updates.push({
        id: playerId,
        data: {
          rating: row.rating,
          acs: row.acs,
          kd: row.kd,
          kast: row.kast * 100, // Player.kast stored as 0-100
          adr: row.adr,
          hs: row.hs_pct * 100, // Player.hs stored as 0-100
          kpr: row.kpr,
          apr: row.apr,
          fkpr: row.fkpr,
          fdpr: row.fdpr,
          clPct: row.cl_pct,
          clTotal: row.cl_total,
          kills: row.kills,
          deaths: row.deaths,
          vlrAssists: row.assists,
          fk: row.fk,
          fd: row.fd,
          vlrRounds: row.rounds,
          agentStats: agentStats as unknown as object,
          lastScrapedAt: new Date(),
          scrapedRounds,
        },
      });
    }

    if (!options.dryRun) {
      for (let i = 0; i < updates.length; i += CHUNK) {
        await Promise.all(
          updates.slice(i, i + CHUNK).map((u) =>
            prisma.player.update({ where: { id: u.id }, data: u.data }),
          ),
        );
      }
      updated = updates.length;
    } else {
      updated = updates.length;
    }

    await prisma.vlrScrapeRun.update({
      where: { id: run.id },
      data: {
        status: "success",
        finishedAt: new Date(),
        playersUpdated: updated,
      },
    });

    return {
      runId: run.id,
      playersUpdated: updated,
      playersSkipped: skipped,
      agentsCovered: agentsOk,
    };
  } catch (err) {
    await prisma.vlrScrapeRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        error: String(err),
      },
    });
    throw err;
  }
}
