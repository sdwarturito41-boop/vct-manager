import "dotenv/config";
import { PrismaClient } from "../generated/prisma/client";
import { initializeSeasonForTeam, progressBracket } from "../server/schedule/generate";
import { simulateMatch } from "../server/simulation/engine";
import type { Region } from "../generated/prisma/client";

const p = new PrismaClient();
const DOW = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

async function simDay(day: number) {
  const matches = await p.match.findMany({
    where: { day, isPlayed: false, season: 1 },
    include: {
      team1: { include: { players: { where: { isActive: true } } } },
      team2: { include: { players: { where: { isActive: true } } } },
    },
  });
  for (const m of matches) {
    if (m.team1.players.length === 0 || m.team2.players.length === 0) continue;
    const t1 = {
      id: m.team1.id, name: m.team1.name, tag: m.team1.tag,
      players: m.team1.players.map((pl) => ({ id: pl.id, ign: pl.ign, acs: pl.acs, kd: pl.kd, adr: pl.adr, kast: pl.kast, hs: pl.hs, role: pl.role })),
      skillAim: m.team1.skillAim, skillUtility: m.team1.skillUtility, skillTeamplay: m.team1.skillTeamplay,
    };
    const t2 = {
      id: m.team2.id, name: m.team2.name, tag: m.team2.tag,
      players: m.team2.players.map((pl) => ({ id: pl.id, ign: pl.ign, acs: pl.acs, kd: pl.kd, adr: pl.adr, kast: pl.kast, hs: pl.hs, role: pl.role })),
      skillAim: m.team2.skillAim, skillUtility: m.team2.skillUtility, skillTeamplay: m.team2.skillTeamplay,
    };
    const result = simulateMatch(t1, t2, m.format);
    await p.match.update({
      where: { id: m.id },
      data: { isPlayed: true, winnerId: result.winnerId, score: { team1: result.score.team1, team2: result.score.team2 } },
    });
  }

  const completed = new Set(matches.map((m) => m.stageId));
  for (const stageId of completed) {
    const all = await p.match.findMany({
      where: { stageId, season: 1 },
      include: { team1: { select: { region: true } } },
    });
    const byRegion = new Map<string, { p: number; t: number }>();
    for (const m of all) {
      const r = m.team1.region;
      const cur = byRegion.get(r) ?? { p: 0, t: 0 };
      cur.t++;
      if (m.isPlayed) cur.p++;
      byRegion.set(r, cur);
    }
    for (const [region, counts] of byRegion) {
      if (counts.p === counts.t) {
        await progressBracket(p, stageId, region as Region, 1, day);
      }
    }
  }
  return matches.length;
}

async function main() {
  // Setup
  const user = await p.user.create({ data: { email: "sched-test@t.com", password: "x", name: "T" } });
  const team = await p.team.create({ data: { name: "Fnatic", tag: "FNC", region: "EMEA", userId: user.id, budget: 2500000, prestige: 95 } });
  await p.player.updateMany({ where: { currentTeam: "Fnatic", teamId: null }, data: { teamId: team.id } });
  await initializeSeasonForTeam(p, team.id, "Fnatic", "EMEA");

  // Simulate 50 days
  for (let day = 1; day <= 50; day++) {
    const c = await simDay(day);
    if (c > 0) {
      const dow = DOW[((day - 1) % 7) + 1];
      console.log(`Day ${day} (${dow} W${Math.ceil(day / 7)}): ${c} matches`);
    }
  }

  // EMEA schedule
  const emeaMatches = await p.match.findMany({
    where: { team1: { region: "EMEA" }, day: { gt: 0 } },
    include: { team1: { select: { name: true } }, team2: { select: { name: true } } },
    orderBy: { day: "asc" },
  });
  console.log("\nEMEA schedule:");
  for (const m of emeaMatches) {
    const dow = DOW[((m.day - 1) % 7) + 1];
    console.log(`  Day ${m.day} (${dow} W${Math.ceil(m.day / 7)}) ${m.stageId}: ${m.team1.name} vs ${m.team2.name}${m.isPlayed ? " ✓" : ""}`);
  }

  // Verify max 2/day
  const dayCounts = new Map<string, number>();
  const allMatches = await p.match.findMany({ where: { day: { gt: 0 } }, include: { team1: { select: { region: true } } } });
  for (const m of allMatches) {
    const key = `${m.team1.region}|${m.day}`;
    dayCounts.set(key, (dayCounts.get(key) ?? 0) + 1);
  }
  const violations = [...dayCounts.entries()].filter(([, c]) => c > 2);
  console.log(violations.length > 0 ? `\n⚠️ ${violations.length} days with >2 matches` : "\n✅ All days ≤2 matches/region");

  await p.$disconnect();
}

main().catch(console.error);
