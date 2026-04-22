import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import type { Region, Role, PlayerTier } from "../generated/prisma/client";
import { MAP_POOLS } from "../constants/maps";
import { readFileSync } from "fs";
import { join } from "path";

const prisma = new PrismaClient();
const BASE_URL = "https://api.pandascore.co/valorant";
const TOKEN = process.env.PANDASCORE_TOKEN!;

// ── VLR Scraper data ──

interface ScrapedPlayer {
  region: string;
  team: string;
  player: string;
  role: string;
  agent_1: string;
  agent_2: string;
  agent_3: string;
}

const SCRAPED_ROSTERS: ScrapedPlayer[] = JSON.parse(
  readFileSync(join(__dirname, "../../data/vct_2026_rosters.json"), "utf-8")
);

// Build a lookup by player IGN (case-sensitive, since IGNs are unique identifiers)
const SCRAPED_BY_IGN = new Map<string, ScrapedPlayer>();
for (const entry of SCRAPED_ROSTERS) {
  SCRAPED_BY_IGN.set(entry.player, entry);
}

// ── Agent name mapping (lowercase scraper → proper game name) ──

const AGENT_NAME_MAP: Record<string, string> = {
  jett: "Jett",
  raze: "Raze",
  reyna: "Reyna",
  phoenix: "Phoenix",
  neon: "Neon",
  yoru: "Yoru",
  iso: "Iso",
  waylay: "Waylay",
  sova: "Sova",
  breach: "Breach",
  skye: "Skye",
  kayo: "KAY/O",
  fade: "Fade",
  gekko: "Gekko",
  tejo: "Tejo",
  killjoy: "Killjoy",
  cypher: "Cypher",
  sage: "Sage",
  chamber: "Chamber",
  deadlock: "Deadlock",
  vyse: "Vyse",
  brimstone: "Brimstone",
  viper: "Viper",
  omen: "Omen",
  astra: "Astra",
  harbor: "Harbor",
  clove: "Clove",
  miks: "Miks",
  veto: "Veto",
};

function normalizeAgentName(raw: string): string | null {
  if (!raw) return null;
  const mapped = AGENT_NAME_MAP[raw.toLowerCase()];
  if (mapped) return mapped;
  // Fallback: capitalize first letter (handles any future agents)
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── PandaScore types ──

interface PSPlayer {
  id: number;
  name: string;
  first_name: string | null;
  last_name: string | null;
  nationality: string | null;
  age: number | null;
  image_url: string | null;
  active: boolean;
}

interface PSOpponent {
  opponent: {
    id: number;
    name: string;
    acronym: string | null;
    location: string | null;
    image_url: string | null;
  };
}

interface PSMatch {
  opponents: PSOpponent[];
}

interface PSTeamFull {
  id: number;
  name: string;
  acronym: string | null;
  location: string | null;
  image_url: string | null;
  players: PSPlayer[];
}

// ── Known player roles ──

type LeadershipRole = "IGL" | "Entry" | "Support" | "Lurker" | "Anchor";

// Known IGLs — leadership role is separate from agent role
const KNOWN_IGLS = new Set([
  // EMEA
  "Boaster", "Lowkii", "BONECOLD", "Redgar", "ange1", "xms", "SouhcNi", "Muj",
  // Americas
  "johnqt", "FNS", "supamen", "Saadhak", "Rossy",
  // Pacific
  "Benkai", "stax", "Carpe", "Crws",
  // China
  "nobody",
]);

// Agent role overrides — player's main in-game agent category
// Only here when the scraper data is unreliable or we want to override
const KNOWN_AGENT_ROLES: Record<string, Role> = {
  // Known players whose scraper role might not match current meta
  Boaster: "Initiator", crashies: "Initiator", Alfajer: "Duelist", Veqaj: "Sentinel", kaajak: "Controller",
  aspas: "Duelist", Less: "Initiator", cauanzin: "Sentinel", pANcada: "Controller",
  TenZ: "Duelist", zekken: "Duelist", Sacy: "Initiator", johnqt: "Controller", Zellsis: "Initiator",
  f0rsakeN: "Duelist", Jinggg: "Duelist", d4v41: "Initiator",
  nAts: "Sentinel", Derke: "Duelist", Chronicle: "Flex",
};

const DEFAULT_ROLES: Role[] = ["Duelist", "Initiator", "Sentinel", "Controller", "Flex"];

const VALID_ROLES: Set<string> = new Set(["Duelist", "Initiator", "Sentinel", "Controller", "Flex"]);

function assignRole(ign: string, index: number): Role {
  // Hardcoded overrides first
  if (KNOWN_AGENT_ROLES[ign]) return KNOWN_AGENT_ROLES[ign];
  // Fall back to scraper data
  const scraped = SCRAPED_BY_IGN.get(ign);
  if (scraped && VALID_ROLES.has(scraped.role)) {
    return scraped.role as Role;
  }
  // Unknown → use index-based default (ensures role variety per team)
  return DEFAULT_ROLES[index % 5];
}

function assignLeadershipRole(ign: string, agentRole: Role, index: number): LeadershipRole {
  if (KNOWN_IGLS.has(ign)) return "IGL";
  // Infer from agent role + position in roster
  // First duelist → Entry, second duelist → Lurker
  // Sentinel → Anchor
  // Controller → Support (unless they're the IGL)
  // Initiator → Support or Entry depending
  if (agentRole === "Sentinel") return "Anchor";
  if (agentRole === "Duelist") return index < 2 ? "Entry" : "Lurker";
  if (agentRole === "Controller") return "Support";
  if (agentRole === "Initiator") return index === 0 ? "Entry" : "Support";
  // Flex → Support by default
  return "Support";
}

// ── Stat generation ──

function randFloat(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function generateStats(prestige: number) {
  // Prestige 95 → elite stats, prestige 50 → mediocre
  // The gap must be large enough that top teams consistently beat low teams
  const t = prestige / 100;
  const variance = 8; // small random variance within a tier
  const acs = round2(180 + t * 80 + randFloat(-variance, variance));     // 50→220, 95→256
  const kd = round2(0.85 + t * 0.55 + randFloat(-0.05, 0.05));          // 50→1.125, 95→1.375
  const adr = round2(125 + t * 45 + randFloat(-variance, variance));     // 50→147, 95→168
  const kast = round2(62 + t * 16 + randFloat(-2, 2));                   // 50→70, 95→77
  const hs = round2(18 + t * 14 + randFloat(-2, 2));                     // 50→25, 95→31
  const salary = Math.round(5000 + acs * 20 + kd * 3000 + adr * 10 + kast * 50);
  return { acs, kd, adr, kast, hs, salary };
}

// ── Map factors & agent mastery helpers ──

const ALL_MAP_NAMES = Array.from(new Set([...MAP_POOLS.POOL_A, ...MAP_POOLS.POOL_B, ...MAP_POOLS.POOL_C]));

const ROLE_AGENTS: Record<string, string[]> = {
  Duelist: ["Jett", "Raze", "Neon", "Iso", "Yoru"],
  Initiator: ["Fade", "Sova", "Skye", "KAY/O", "Gekko", "Tejo"],
  Sentinel: ["Cypher", "Killjoy", "Sage", "Vyse", "Deadlock"],
  Controller: ["Omen", "Viper", "Astra", "Clove", "Harbor", "Brimstone"],
  IGL: ["Omen", "Viper", "Astra", "Clove", "Fade", "Sova", "Skye", "KAY/O"],
};

const ADJACENT_ROLES: Record<string, string[]> = {
  Duelist: ["Initiator", "Sentinel"],
  Initiator: ["Duelist", "Controller"],
  Sentinel: ["Initiator", "Controller"],
  Controller: ["Sentinel", "Initiator"],
  IGL: ["Sentinel", "Duelist"],
};

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickN<T>(arr: T[], n: number): T[] {
  return shuffle(arr).slice(0, n);
}

function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function generateMapFactors(): Record<string, number> {
  const maps = shuffle(ALL_MAP_NAMES);
  const strongCount = randInt(2, 3);
  const weakCount = randInt(1, 2);
  const factors: Record<string, number> = {};
  for (let i = 0; i < maps.length; i++) {
    if (i < strongCount) factors[maps[i]] = 1.10;
    else if (i < maps.length - weakCount) factors[maps[i]] = 1.00;
    else factors[maps[i]] = 0.88;
  }
  return factors;
}

async function generateAgentMasteryFromScraper(
  playerId: string,
  ign: string,
  role: Role
): Promise<void> {
  const scraped = SCRAPED_BY_IGN.get(ign);

  if (scraped) {
    // Use real agent data from VLR scraper
    const scrapedAgents: { name: string; tier: 1 | 2 | 3 }[] = [];
    const a1 = normalizeAgentName(scraped.agent_1);
    const a2 = normalizeAgentName(scraped.agent_2);
    const a3 = normalizeAgentName(scraped.agent_3);
    if (a1) scrapedAgents.push({ name: a1, tier: 1 });
    if (a2) scrapedAgents.push({ name: a2, tier: 2 });
    if (a3) scrapedAgents.push({ name: a3, tier: 3 });

    const records: { playerId: string; agentName: string; mapName: string; stars: number }[] = [];

    // All active map pool maps for the scraped agents
    const allMaps = ALL_MAP_NAMES;

    for (const agent of scrapedAgents) {
      let stars: number;
      if (agent.tier === 1) stars = randInt(4, 5);       // Primary agent: 4-5 stars
      else if (agent.tier === 2) stars = randInt(3, 4);   // Secondary: 3-4 stars
      else stars = randInt(2, 3);                          // Tertiary: 2-3 stars

      for (const map of allMaps) {
        records.push({ playerId, agentName: agent.name, mapName: map, stars });
      }
    }

    // Add 1-2 random agents at 1-2 stars for variety
    const usedAgents = new Set(scrapedAgents.map((a) => a.name));
    const allAgentsInGame = Object.values(ROLE_AGENTS).flat();
    const unusedAgents = allAgentsInGame.filter((a) => !usedAgents.has(a));
    const extraPicks = pickN(unusedAgents, randInt(1, 2));
    for (const agent of extraPicks) {
      const stars = randInt(1, 2);
      const extraMaps = pickN(allMaps, randInt(2, 3));
      for (const map of extraMaps) {
        records.push({ playerId, agentName: agent, mapName: map, stars });
      }
    }

    // Deduplicate by (agentName, mapName) keeping highest stars
    const deduped = new Map<string, typeof records[number]>();
    for (const r of records) {
      const key = `${r.agentName}::${r.mapName}`;
      const existing = deduped.get(key);
      if (!existing || existing.stars < r.stars) {
        deduped.set(key, r);
      }
    }

    const dedupedRecords = Array.from(deduped.values());
    for (const r of dedupedRecords) {
      await prisma.playerAgentPool.create({ data: r });
    }
  } else {
    // Fallback: random generation (original logic)
    await generateAgentMasteryRandom(playerId, role);
  }
}

async function generateAgentMasteryRandom(playerId: string, role: Role): Promise<void> {
  const mainAgents = ROLE_AGENTS[role] ?? ROLE_AGENTS.Duelist;
  const adjacentRoleNames = ADJACENT_ROLES[role] ?? ["Initiator"];
  const adjacentAgents = adjacentRoleNames.flatMap((r) => ROLE_AGENTS[r] ?? []);

  // Pick 2-3 main agents at 4-5 stars
  const mainPicks = pickN(mainAgents, randInt(2, 3));
  // Pick 1-2 adjacent agents at 2-3 stars
  const adjPicks = pickN(
    adjacentAgents.filter((a) => !mainPicks.includes(a)),
    randInt(1, 2)
  );

  // Pick 3-4 maps the player is strong on for agent mastery records
  const strongMaps = pickN(ALL_MAP_NAMES, randInt(3, 4));

  const records: { playerId: string; agentName: string; mapName: string; stars: number }[] = [];

  for (const agent of mainPicks) {
    const stars = randInt(4, 5);
    for (const map of strongMaps) {
      records.push({ playerId, agentName: agent, mapName: map, stars });
    }
  }

  for (const agent of adjPicks) {
    const stars = randInt(2, 3);
    // Adjacent agents on fewer maps (2-3)
    const adjMaps = pickN(strongMaps, randInt(2, Math.min(3, strongMaps.length)));
    for (const map of adjMaps) {
      records.push({ playerId, agentName: agent, mapName: map, stars });
    }
  }

  // Add 1-star records for 1-2 off-role agents on 1-2 maps
  const allUsed = new Set([...mainPicks, ...adjPicks]);
  const offRoleAgents = Object.values(ROLE_AGENTS)
    .flat()
    .filter((a) => !allUsed.has(a));
  const offPicks = pickN(offRoleAgents, randInt(1, 2));
  for (const agent of offPicks) {
    const offMaps = pickN(ALL_MAP_NAMES, randInt(1, 2));
    for (const map of offMaps) {
      records.push({ playerId, agentName: agent, mapName: map, stars: 1 });
    }
  }

  // Deduplicate by (agentName, mapName) keeping highest stars
  const deduped = new Map<string, typeof records[number]>();
  for (const r of records) {
    const key = `${r.agentName}::${r.mapName}`;
    const existing = deduped.get(key);
    if (!existing || existing.stars < r.stars) {
      deduped.set(key, r);
    }
  }

  const dedupedRecords = Array.from(deduped.values());
  for (const r of dedupedRecords) {
    await prisma.playerAgentPool.create({ data: r });
  }
}

// ── VCT 2026 Stage 1 tournament IDs from PandaScore ──

interface TournamentGroup {
  region: Region;
  tournamentIds: number[];
  budget: Record<number, number>;
  prestige: Record<number, number>;
}

// PS team ID → budget/prestige overrides
const TEAM_BUDGETS: Record<number, number> = {
  // EMEA
  128537: 2500000, // Fnatic
  129662: 1600000, // Eternal Fire
  128796: 2000000, // Team Vitality
  134423: 850000,  // GIANTX
  128577: 1000000, // BBL Esports
  134104: 700000,  // Pcific
  128541: 2300000, // Team Liquid
  130922: 1500000, // Karmine Corp
  133115: 1200000, // Gentle Mates
  128578: 900000,  // FUT Esports
  128622: 1800000, // Team Heretics
  129355: 2200000, // Natus Vincere
  // Americas
  130338: 1500000, // LOUD
  128990: 1000000, // Leviatán
  128470: 1800000, // Team Envy
  130190: 1100000, // MIBR
  128538: 2400000, // G2 Esports
  128819: 2500000, // Cloud9
  128472: 3000000, // Sentinels
  128471: 1800000, // NRG
  128477: 1200000, // FURIA
  128605: 2200000, // 100 Thieves
  128944: 900000,  // KRÜ
  129181: 2000000, // Evil Geniuses
  // Pacific
  128917: 1800000, // Paper Rex
  130137: 1600000, // Kiwoom DRX
  132692: 1400000, // Nongshim RedForce
  129660: 1000000, // Global Esports
  128473: 1700000, // Gen.G
  129537: 1300000, // Team Secret
  130638: 850000,  // Rex Regum Qeon
  131974: 1100000, // DetonatioN FocusMe
  128647: 2000000, // T1
  128912: 800000,  // FULL SENSE
  // China
  128974: 1200000, // All Gamers
  133379: 2000000, // Bilibili Gaming
  133825: 850000,  // TEC Esports
  128540: 2200000, // FunPlus Phoenix
  133288: 1300000, // TYLOO
  134454: 1800000, // JD Gaming
  128976: 2500000, // EDward Gaming
  135470: 900000,  // XLG Gaming
  133287: 1100000, // Nova Esports
  134335: 900000,  // Wolves
  133380: 1500000, // Trace Esports
  133279: 1000000, // Dragon Ranger Gaming
};

const TEAM_PRESTIGE: Record<number, number> = {
  // EMEA
  128537: 95, 129662: 78, 128796: 85, 134423: 58, 128577: 65, 134104: 45,
  128541: 90, 130922: 75, 133115: 70, 128578: 60, 128622: 82, 129355: 88,
  // Americas
  130338: 90, 128990: 72, 128470: 80, 130190: 70, 128538: 92, 128819: 88,
  128472: 95, 128471: 80, 128477: 75, 128605: 85, 128944: 65, 129181: 82,
  // Pacific
  128917: 92, 130137: 88, 132692: 75, 129660: 65, 128473: 82, 129537: 72,
  130638: 58, 131974: 68, 128647: 85, 128912: 55,
  // China
  128974: 68, 133379: 85, 133825: 55, 128540: 88, 133288: 72, 134454: 80,
  128976: 90, 135470: 50, 133287: 65, 134335: 58, 133380: 75, 133279: 62,
};

const REGION_TOURNAMENTS: { region: Region; tournamentIds: number[] }[] = [
  { region: "EMEA", tournamentIds: [20435, 20436] },
  { region: "Americas", tournamentIds: [20564, 20565] },
  { region: "Pacific", tournamentIds: [20468, 20469] },
  { region: "China", tournamentIds: [20433, 20434] },
];

// ── Main ──

async function main() {
  console.log("🔄 Fetching VCT 2026 Stage 1 rosters from PandaScore...\n");

  await prisma.playerAgentPool.deleteMany();
  await prisma.match.deleteMany();
  await prisma.player.deleteMany();
  await prisma.team.deleteMany();
  await prisma.season.deleteMany();
  await prisma.vctTeamTemplate.deleteMany();
  await prisma.user.deleteMany();
  console.log("✅ Cleared existing data.\n");

  await prisma.season.create({
    data: { number: 1, year: 2026, currentStage: "KICKOFF", currentDay: 1, currentWeek: 1 },
  });

  let totalPlayers = 0;
  let totalTeams = 0;

  for (const regionGroup of REGION_TOURNAMENTS) {
    console.log(`\n── ${regionGroup.region} ──`);

    // Step 1: Discover team IDs from matches
    const teamIds = new Set<number>();
    const teamMeta = new Map<number, { name: string; acronym: string; imageUrl: string | null }>();

    for (const tid of regionGroup.tournamentIds) {
      const url = new URL(`${BASE_URL}/matches`);
      url.searchParams.set("filter[tournament_id]", String(tid));
      url.searchParams.set("per_page", "50");

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      if (!res.ok) { console.log(`  ⚠️ Failed to fetch tournament ${tid}`); continue; }

      const matches: PSMatch[] = await res.json();
      for (const m of matches) {
        for (const opp of m.opponents) {
          const t = opp.opponent;
          if (t.id && !teamIds.has(t.id)) {
            teamIds.add(t.id);
            teamMeta.set(t.id, {
              name: t.name,
              acronym: t.acronym ?? t.name.substring(0, 4).toUpperCase(),
              imageUrl: t.image_url,
            });
          }
        }
      }
      await sleep(300);
    }

    // Step 2: Fetch each team's full roster
    for (const psTeamId of teamIds) {
      const meta = teamMeta.get(psTeamId)!;

      try {
        const url = new URL(`${BASE_URL}/teams`);
        url.searchParams.set("search[name]", meta.name);
        url.searchParams.set("per_page", "5");

        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${TOKEN}` },
        });
        if (!res.ok) {
          console.log(`  ⚠️ Failed to fetch team ${meta.name}`);
          continue;
        }

        const teams: PSTeamFull[] = await res.json();
        const psTeam = teams.find((t) => t.id === psTeamId) ?? teams[0];
        if (!psTeam) { console.log(`  ❌ Not found: ${meta.name}`); continue; }

        const activePlayers = psTeam.players.filter((p) => p.active).slice(0, 7);
        const budget = TEAM_BUDGETS[psTeamId] ?? 1000000;
        const prestige = TEAM_PRESTIGE[psTeamId] ?? 60;

        // Create VctTeamTemplate
        await prisma.vctTeamTemplate.create({
          data: {
            name: psTeam.name,
            tag: psTeam.acronym ?? meta.acronym,
            region: regionGroup.region,
            budget,
            prestige,
            logoUrl: psTeam.image_url ?? meta.imageUrl,
          },
        });

        // Create players
        for (let i = 0; i < activePlayers.length; i++) {
          const p = activePlayers[i];
          const stats = generateStats(prestige);
          const role = assignRole(p.name, i);
          const leadershipRole = assignLeadershipRole(p.name, role, i);
          const age = p.age ?? Math.floor(18 + Math.random() * 10);

          const mapFactors = generateMapFactors();
          const createdPlayer = await prisma.player.create({
            data: {
              ign: p.name,
              firstName: p.first_name ?? p.name,
              lastName: p.last_name ?? "",
              nationality: p.nationality ?? (regionGroup.region === "China" ? "CN" : "US"),
              age,
              role,
              leadershipRole,
              imageUrl: p.image_url,
              currentTeam: psTeam.name,
              region: regionGroup.region,
              tier: "VCT" as PlayerTier,
              salary: stats.salary,
              acs: stats.acs,
              kd: stats.kd,
              adr: stats.adr,
              kast: stats.kast,
              hs: stats.hs,
              mapFactors,
              joinedWeek: 0,
              pandascoreId: `ps-${p.id}`,
              isActive: true,
              contractEndSeason: 1,
              contractEndWeek: 52,
              buyoutClause: stats.salary * 30,
            },
          });
          await generateAgentMasteryFromScraper(createdPlayer.id, p.name, role);
          totalPlayers++;
        }

        totalTeams++;
        const playerNames = activePlayers.map((p) => p.name).join(", ");
        console.log(
          `  ✅ ${psTeam.name} (${psTeam.acronym ?? "?"}) — ${activePlayers.length}p — ${playerNames}`
        );

        await sleep(350);
      } catch (err) {
        console.log(`  ❌ Error for ${meta.name}: ${err}`);
      }
    }
  }

  // Free agents (VCL prospects)
  console.log("\n── Free Agents (VCL) ──");
  const freeAgentNames = [
    "FLAVOR", "keznit", "heat", "qw1", "mwzera",
    "saadhak", "Sscary", "Wronski", "frz", "adverso",
    "Tacolilla", "kiNgg", "Mazino", "tehbotol", "Shyy",
    "xand", "v1xen", "Famouz", "Quick", "Khalil",
  ];

  for (const ign of freeAgentNames) {
    const stats = generateStats(50);
    const regions: Region[] = ["EMEA", "Americas", "Pacific", "China"];
    const role = DEFAULT_ROLES[Math.floor(Math.random() * 5)];
    const leadershipRole = assignLeadershipRole(ign, role, Math.floor(Math.random() * 5));
    const mapFactors = generateMapFactors();
    const createdFA = await prisma.player.create({
      data: {
        ign,
        firstName: ign,
        lastName: "",
        nationality: ["BR", "CL", "KR", "TR", "JP", "US", "FR", "ID"][Math.floor(Math.random() * 8)],
        age: Math.floor(17 + Math.random() * 7),
        role,
        leadershipRole,
        imageUrl: null,
        currentTeam: null,
        region: regions[Math.floor(Math.random() * 4)],
        tier: "VCL" as PlayerTier,
        salary: stats.salary,
        acs: stats.acs,
        kd: stats.kd,
        adr: stats.adr,
        kast: stats.kast,
        hs: stats.hs,
        mapFactors,
        joinedWeek: 0,
        isActive: true,
        // Free agents: no contract in force
        contractEndSeason: 0,
        contractEndWeek: 0,
        buyoutClause: 0,
      },
    });
    await generateAgentMasteryFromScraper(createdFA.id, ign, role);
  }
  console.log(`  ✅ ${freeAgentNames.length} free agents created`);

  console.log("\n═══════════════════════════════════════");
  console.log(`✅ ${totalTeams} teams from VCT 2026 Stage 1`);
  console.log(`👤 ${totalPlayers} real players`);
  console.log(`🆓 ${freeAgentNames.length} free agents`);
  console.log("═══════════════════════════════════════");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
