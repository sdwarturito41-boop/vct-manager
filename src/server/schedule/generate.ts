import { PrismaClient } from "@/generated/prisma/client";
import type { MatchFormat, Region } from "@/generated/prisma/client";
import { MASTERS_FORMAT } from "@/constants/masters-format";
import { VALORANT_AGENTS } from "@/constants/agents";
import { MAP_POOLS, STAGE_MAP_POOL } from "@/constants/maps";
import { applyPatchToMeta } from "@/constants/meta";

/**
 * VCT 2026 Kickoff — Triple Elimination (31 matches per region)
 *
 * UPPER (0 defeat):  UB_R1(4) → UB_QF(4) → UB_SF(2) → UB_FINAL(1)
 * MIDDLE (1 defeat): MID_R1(4) → MID_R2(2) → MID_QF(2) → MID_SF(1) → MID_FINAL(1)
 * LOWER (2 defeats): LB_R1(2) → LB_R2(2) → LB_R3(2) → LB_QF(2) → LB_SF(1) → LB_FINAL(1)
 *
 * Loser routing:
 *   UB_R1 losers + UB_QF losers → MID_R1 (paired: L(M1)vsL(M5), L(M2)vsL(M6)...)
 *   UB_SF losers → MID_QF (vs MID_R2 winners)
 *   UB_FINAL loser → MID_FINAL (vs MID_SF winner)
 *   MID_R1 losers → LB_R1
 *   MID_R2 losers → LB_R2 (vs LB_R1 winners)
 *   MID_QF losers → LB_R3 (vs LB_R2 winners)
 *   MID_SF loser → LB_QF (+ bye for other LB_R3 winner)
 *   MID_FINAL loser → LB_FINAL (vs LB_SF winner)
 */

// ── Broadcast schedule ──
const MATCH_DAYS: Record<Region, number[]> = {
  EMEA: [2, 3, 4, 5],     // Tue, Wed, Thu, Fri
  Pacific: [4, 5, 6, 7],   // Thu, Fri, Sat, Sun
  China: [4, 5, 6, 7],     // Thu, Fri, Sat, Sun
  Americas: [5, 6, 7],     // Fri, Sat, Sun
};
const MATCHES_PER_DAY = 2;

// ── Kickoff seedings ──
interface KickoffSeeding {
  round1Matchups: [string, string][];
  qfPairings: [string, number][]; // [bye team, R1 match index]
}

const KICKOFF_SEEDS: Record<Region, KickoffSeeding> = {
  EMEA: {
    round1Matchups: [
      ["Natus Vincere", "Karmine Corp"],
      ["FUT Esports", "Gentle Mates"],
      ["Pcific Esports", "BBL Esports"],
      ["Eternal Fire", "Team Vitality"],
    ],
    qfPairings: [
      ["Team Heretics", 0],
      ["GIANTX", 1],
      ["Fnatic", 2],
      ["Team Liquid", 3],
    ],
  },
  Americas: {
    round1Matchups: [
      ["LOUD", "Cloud9"],
      ["Team Envy", "Evil Geniuses"],
      ["KRÜ Esports", "FURIA Esports"],
      ["100 Thieves", "Leviatán Esports"],
    ],
    qfPairings: [
      ["NRG", 0],
      ["MIBR", 1],
      ["Sentinels", 2],
      ["G2 Esports", 3],
    ],
  },
  Pacific: {
    round1Matchups: [
      ["Team Secret", "ZETA DIVISION"],
      ["VARREL", "DetonatioN FocusMe"],
      ["Kiwoom DRX", "Global Esports"],
      ["Gen.G Esports", "FULL SENSE"],
    ],
    qfPairings: [
      ["Nongshim RedForce", 0],
      ["T1", 1],
      ["Paper Rex", 2],
      ["Rex Regum Qeon", 3],
    ],
  },
  China: {
    round1Matchups: [
      ["Nova Esports", "TEC Esports"],
      ["JD Gaming", "Dragon Ranger Gaming"],
      ["Trace Esports", "Wolves Esports"],
      ["FunPlus Phoenix", "TYLOO"],
    ],
    qfPairings: [
      ["All Gamers", 0],
      ["XLG Gaming", 1],
      ["EDward Gaming", 2],
      ["Bilibili Gaming", 3],
    ],
  },
};

export { KICKOFF_SEEDS };
export type { KickoffSeeding };

// ── Helpers ──

// Schedule on next week's broadcast days, spreading across all 3 days
function getNextWeekBroadcastDays(region: Region, afterDay: number, count: number, perDay = MATCHES_PER_DAY): number[] {
  const broadcastDays = MATCH_DAYS[region];
  const result: number[] = [];
  const currentWeek = Math.ceil(afterDay / 7);
  const nextWeekStart = currentWeek * 7 + 1;
  let day = nextWeekStart;
  while (result.length < count) {
    const dow = ((day - 1) % 7) + 1;
    if (broadcastDays.includes(dow)) {
      for (let slot = 0; slot < perDay && result.length < count; slot++) {
        result.push(day);
      }
    }
    day++;
  }
  return result;
}

// Find the last scheduled match day for a region to avoid overlapping
async function getLastScheduledDay(prisma: PrismaClient, region: Region, season: number): Promise<number> {
  const lastMatch = await prisma.match.findFirst({
    where: { season, day: { gt: 0 }, team1: { region } },
    orderBy: { day: "desc" },
  });
  return lastMatch?.day ?? 0;
}

// Schedule on the very next broadcast day (used only for finals — consecutive days)
function getNextBroadcastDay(region: Region, afterDay: number): number {
  const broadcastDays = MATCH_DAYS[region];
  let day = afterDay + 1;
  while (true) {
    const dow = ((day - 1) % 7) + 1;
    if (broadcastDays.includes(dow)) return day;
    day++;
  }
}

function assignDaysNextWeek(
  matches: { team1Id: string; team2Id: string; stageId: string; format: MatchFormat }[],
  region: Region, afterDay: number, seasonNumber: number, perDay = MATCHES_PER_DAY,
) {
  const scheduledDays = getNextWeekBroadcastDays(region, afterDay, matches.length, perDay);
  return matches.map((m, idx) => ({
    ...m,
    day: scheduledDays[idx],
    week: Math.ceil(scheduledDays[idx] / 7),
    season: seasonNumber,
  }));
}

// For initialization (fixed week)
function assignDaysWeek(
  matches: { team1Id: string; team2Id: string; stageId: string; format: MatchFormat }[],
  region: Region, week: number, seasonNumber: number,
) {
  const days = MATCH_DAYS[region];
  return matches.map((m, idx) => {
    const dow = days[Math.floor(idx / MATCHES_PER_DAY) % days.length];
    return { ...m, day: (week - 1) * 7 + dow, week, season: seasonNumber };
  });
}

interface WL { winner: string; loser: string }

async function getResults(prisma: PrismaClient, stageId: string, season: number, region: Region): Promise<WL[]> {
  const matches = await prisma.match.findMany({
    where: { stageId, season, isPlayed: true },
    include: { team1: { select: { id: true, region: true } } },
    orderBy: { day: "asc" },
  });
  return matches
    .filter((m) => m.team1.region === region)
    .map((m) => ({
      winner: m.winnerId!,
      loser: m.winnerId === m.team1Id ? m.team2Id : m.team1Id,
    }));
}

async function getResultsByTeams(
  prisma: PrismaClient, stageId: string, season: number,
  teamPairs: [string, string][], nameToId: Map<string, string>,
): Promise<WL[]> {
  const results: WL[] = [];
  for (const [a, b] of teamPairs) {
    const aId = nameToId.get(a);
    const bId = nameToId.get(b);
    if (!aId || !bId) { results.push({ winner: "", loser: "" }); continue; }
    const match = await prisma.match.findFirst({
      where: {
        stageId, season, isPlayed: true,
        OR: [{ team1Id: aId, team2Id: bId }, { team1Id: bId, team2Id: aId }],
      },
    });
    if (match?.winnerId) {
      results.push({ winner: match.winnerId, loser: match.winnerId === match.team1Id ? match.team2Id : match.team1Id });
    } else {
      results.push({ winner: "", loser: "" });
    }
  }
  return results;
}

async function createMatchesOnNextSlots(
  prisma: PrismaClient, pairs: [string, string][],
  stageId: string, region: Region, afterDay: number, season: number,
  format: MatchFormat = "BO3",
) {
  const valid = pairs.filter(([a, b]) => a && b);
  if (valid.length === 0) return;

  // Find all already-scheduled days + counts for this region
  const existingMatches = await prisma.match.findMany({
    where: { season, day: { gt: 0 }, team1: { region } },
    select: { day: true },
  });
  const dayUsage = new Map<number, number>();
  for (const m of existingMatches) {
    dayUsage.set(m.day, (dayUsage.get(m.day) ?? 0) + 1);
  }

  // Find next broadcast days that have room (< MATCHES_PER_DAY)
  const broadcastDays = MATCH_DAYS[region];
  const scheduledDays: number[] = [];
  let day = afterDay + 1;
  while (scheduledDays.length < valid.length) {
    const dow = ((day - 1) % 7) + 1;
    if (broadcastDays.includes(dow)) {
      const used = dayUsage.get(day) ?? 0;
      const available = MATCHES_PER_DAY - used;
      for (let slot = 0; slot < available && scheduledDays.length < valid.length; slot++) {
        scheduledDays.push(day);
        dayUsage.set(day, used + slot + 1);
      }
    }
    day++;
  }

  const data = valid.map(([team1Id, team2Id], idx) => ({
    team1Id, team2Id, stageId, format,
    day: scheduledDays[idx],
    week: Math.ceil(scheduledDays[idx] / 7),
    season,
  }));
  await prisma.match.createMany({ data });
}

async function stageExistsForRegion(prisma: PrismaClient, stageId: string, season: number, region: Region) {
  const count = await prisma.match.count({
    where: {
      stageId, season,
      team1: { region },
    },
  });
  return count > 0;
}

// ── AI team creation ──

async function createAiTeamsForRegion(prisma: PrismaClient, region: string, excludeTeamName: string) {
  const templates = await prisma.vctTeamTemplate.findMany({ where: { region: region as Region } });
  for (const template of templates) {
    if (template.name === excludeTeamName) continue;
    if (await prisma.team.findFirst({ where: { name: template.name } })) continue;
    const aiUser = await prisma.user.create({
      data: { email: `ai-${template.tag.toLowerCase().replace(/[^a-z0-9]/g, "")}@vctmanager.local`, password: "ai-managed", name: `AI ${template.name}` },
    });
    const team = await prisma.team.create({
      data: { name: template.name, tag: template.tag, region: template.region, userId: aiUser.id, budget: template.budget, prestige: template.prestige, logoUrl: template.logoUrl },
    });
    await prisma.player.updateMany({ where: { currentTeam: template.name, teamId: null }, data: { teamId: team.id } });
  }
}

// ── Initialize season ──

const ALL_REGIONS: Region[] = ["EMEA", "Americas", "Pacific", "China"];

export async function initializeSeasonForTeam(
  prisma: PrismaClient, userTeamId: string, userTeamName: string, userRegion: string,
) {
  for (const region of ALL_REGIONS) {
    await createAiTeamsForRegion(prisma, region, region === userRegion ? userTeamName : "__none__");
  }
  const allTeams = await prisma.team.findMany({ select: { id: true, name: true } });
  const nameToId = new Map(allTeams.map((t) => [t.name, t.id]));
  nameToId.set(userTeamName, userTeamId);

  let totalMatches = 0;
  for (const region of ALL_REGIONS) {
    const seed = KICKOFF_SEEDS[region];
    const pairs: [string, string][] = seed.round1Matchups.map(([a, b]) => [nameToId.get(a)!, nameToId.get(b)!]);
    const data = pairs.filter(([a,b]) => a && b).map(([team1Id, team2Id]) => ({ team1Id, team2Id, stageId: "KICKOFF_UB_R1", format: "BO3" as MatchFormat }));
    const scheduled = assignDaysWeek(data, region, 1, 1);
    if (scheduled.length > 0) await prisma.match.createMany({ data: scheduled });
    totalMatches += pairs.length;
  }
  return { matchesScheduled: totalMatches };
}

// ── Bracket progression ──

export async function progressBracket(
  prisma: PrismaClient, completedStageId: string, region: Region, seasonNumber: number, currentDay: number,
) {
  const allTeams = await prisma.team.findMany({ select: { id: true, name: true } });
  const nameToId = new Map(allTeams.map((t) => [t.name, t.id]));
  const seed = KICKOFF_SEEDS[region];
  const S = seasonNumber;
  const R = region;
  const D = currentDay;
  const days = MATCH_DAYS[region];

  const cm = (pairs: [string, string][], stageId: string, format: MatchFormat = "BO3") =>
    createMatchesOnNextSlots(prisma, pairs, stageId, R, D, S, format);

  // ── UB R1 done → create UB QF ──
  if (completedStageId === "KICKOFF_UB_R1") {
    if (await stageExistsForRegion(prisma, "KICKOFF_UB_QF", S, R)) return;
    const r1Results = await getResultsByTeams(prisma, "KICKOFF_UB_R1", S, seed.round1Matchups, nameToId);
    const pairs: [string, string][] = seed.qfPairings.map(([byeName, r1Idx]) => {
      const byeId = nameToId.get(byeName)!;
      return [byeId, r1Results[r1Idx].winner];
    });
    await cm(pairs, "KICKOFF_UB_QF");
  }

  // ── UB QF done → create UB SF + MID R1 ──
  if (completedStageId === "KICKOFF_UB_QF") {
    const r1Results = await getResultsByTeams(prisma, "KICKOFF_UB_R1", S, seed.round1Matchups, nameToId);
    const qfMatches: [string, string][] = seed.qfPairings.map(([byeName, r1Idx]) => [byeName, seed.round1Matchups[r1Idx][0]]);
    const qfResultsRaw = await getResults(prisma, "KICKOFF_UB_QF", S, R);
    // Map QF results to bracket position by bye team
    const qfResults: WL[] = seed.qfPairings.map(([byeName]) => {
      const byeId = nameToId.get(byeName)!;
      return qfResultsRaw.find((r) => r.winner === byeId || r.loser === byeId) ?? { winner: "", loser: "" };
    });

    // UB SF: top half (QF 0+1 winners) and bottom half (QF 2+3 winners)
    if (!await stageExistsForRegion(prisma, "KICKOFF_UB_SF", S, R)) {
      await cm([
        [qfResults[0].winner, qfResults[1].winner],
        [qfResults[2].winner, qfResults[3].winner],
      ], "KICKOFF_UB_SF");
    }

    // MID R1: QF[3-i] loser vs R1[i] loser (reversed to avoid rematches)
    if (!await stageExistsForRegion(prisma, "KICKOFF_MID_R1", S, R)) {
      const midR1Pairs: [string, string][] = [0, 1, 2, 3].map((i) => [qfResults[3 - i].loser, r1Results[i].loser]);
      await cm(midR1Pairs, "KICKOFF_MID_R1");
    }
  }

  // ── UB SF done → create UB FINAL ──
  if (completedStageId === "KICKOFF_UB_SF") {
    if (await stageExistsForRegion(prisma, "KICKOFF_UB_FINAL", S, R)) return;
    const sfResults = await getResults(prisma, "KICKOFF_UB_SF", S, R);
    if (sfResults.length >= 2) {
      // UB Final: teams known NOW but scheduled LATER (when LB SF completes)
      // day: 0 = not yet scheduled, visible in bracket but not playable
      await prisma.match.createMany({ data: [{
        team1Id: sfResults[0].winner, team2Id: sfResults[1].winner,
        stageId: "KICKOFF_UB_FINAL", format: "BO5", day: 0, week: 0, season: S,
      }] });
    }
    // UB SF losers are needed for MID QF — check if MID R2 is done
    await tryCreateMidQF(prisma, R, S, D);
  }

  // ── MID R1 done → create MID R2 + LB R1 ──
  if (completedStageId === "KICKOFF_MID_R1") {
    const midR1 = await getResults(prisma, "KICKOFF_MID_R1", S, R);
    if (!await stageExistsForRegion(prisma, "KICKOFF_MID_R2", S, R) && midR1.length >= 4) {
      await cm([
        [midR1[0].winner, midR1[1].winner],
        [midR1[2].winner, midR1[3].winner],
      ], "KICKOFF_MID_R2");
    }
    if (!await stageExistsForRegion(prisma, "KICKOFF_LB_R1", S, R) && midR1.length >= 4) {
      await cm([
        [midR1[0].loser, midR1[1].loser],
        [midR1[2].loser, midR1[3].loser],
      ], "KICKOFF_LB_R1");
    }
  }

  // ── MID R2 done → try create MID QF (needs UB SF losers too) ──
  if (completedStageId === "KICKOFF_MID_R2") {
    await tryCreateMidQF(prisma, R, S, D);
    // MID R2 losers needed for LB R2 — check if LB R1 is done
    await tryCreateLBR2(prisma, R, S, D);
  }

  // ── MID QF done → create MID SF ──
  if (completedStageId === "KICKOFF_MID_QF") {
    if (await stageExistsForRegion(prisma, "KICKOFF_MID_SF", S, R)) return;
    const midQF = await getResults(prisma, "KICKOFF_MID_QF", S, R);
    if (midQF.length >= 2) {
      await cm([[midQF[0].winner, midQF[1].winner]], "KICKOFF_MID_SF");
    }
    // MID QF losers needed for LB R3
    await tryCreateLBR3(prisma, R, S, D);
  }

  // ── MID SF done → try create MID FINAL (needs UB FINAL loser) ──
  if (completedStageId === "KICKOFF_MID_SF") {
    await tryCreateMidFinal(prisma, R, S, D);
  }

  // ── UB FINAL done → try create MID FINAL ──
  if (completedStageId === "KICKOFF_UB_FINAL") {
    await tryCreateMidFinal(prisma, R, S, D);
  }

  // ── LB R1 done → try create LB R2 (needs MID R2 losers) ──
  if (completedStageId === "KICKOFF_LB_R1") {
    await tryCreateLBR2(prisma, R, S, D);
  }

  // ── LB R2 done → try create LB R3 (needs MID QF losers) ──
  if (completedStageId === "KICKOFF_LB_R2") {
    await tryCreateLBR3(prisma, R, S, D);
  }

  // ── LB R3 done → try create LB QF (both LB R3 winners) ──
  if (completedStageId === "KICKOFF_LB_R3") {
    await tryCreateLBQF(prisma, R, S, D);
  }

  // ── LB QF done → create LB SF (LB QF winner vs Mid SF loser) ──
  if (completedStageId === "KICKOFF_LB_QF") {
    if (await stageExistsForRegion(prisma, "KICKOFF_LB_SF", S, R)) return;
    const lbQF = await getResults(prisma, "KICKOFF_LB_QF", S, R);
    const midSF = await getResults(prisma, "KICKOFF_MID_SF", S, R);
    if (lbQF.length >= 1 && midSF.length >= 1) {
      await cm([[lbQF[0].winner, midSF[0].loser]], "KICKOFF_LB_SF");
    }
  }

  // ── LB SF done → schedule UB Final for next week (all brackets are done) ──
  if (completedStageId === "KICKOFF_LB_SF") {
    // Now schedule UB Final: find it (day: 0) and give it a real day
    const ubFinal = await prisma.match.findFirst({
      where: { stageId: "KICKOFF_UB_FINAL", season: S, day: 0, team1: { region: R } },
    });
    if (ubFinal) {
      const finalDays = getNextWeekBroadcastDays(R, D, 1, 1);
      await prisma.match.update({
        where: { id: ubFinal.id },
        data: { day: finalDays[0], week: Math.ceil(finalDays[0] / 7) },
      });
    }
  }

  // ── UB FINAL done → create MID FINAL (UB Final loser vs Mid SF winner), next day ──
  if (completedStageId === "KICKOFF_UB_FINAL") {
    await tryCreateMidFinal(prisma, R, S, D);
  }

  // ── MID FINAL done → create LB FINAL (Mid Final loser vs LB SF winner), next day ──
  if (completedStageId === "KICKOFF_MID_FINAL") {
    await tryCreateLBFinal(prisma, R, S, D);
  }
}

// ── Deferred match creation (waits for multiple dependencies) ──

async function tryCreateMidQF(prisma: PrismaClient, R: Region, S: number, D: number) {
  if (await stageExistsForRegion(prisma, "KICKOFF_MID_QF", S, R)) return;
  const midR2 = await getResults(prisma, "KICKOFF_MID_R2", S, R);
  const ubSF = await getResults(prisma, "KICKOFF_UB_SF", S, R);
  if (midR2.length >= 2 && ubSF.length >= 2) {
    // M18: L(UB_SF match 0) vs W(MID_R2 match 0)
    // M19: L(UB_SF match 1) vs W(MID_R2 match 1)
    await createMatchesOnNextSlots(prisma, [
      [ubSF[0].loser, midR2[0].winner],
      [ubSF[1].loser, midR2[1].winner],
    ], "KICKOFF_MID_QF", R, D, S);
  }
}

async function tryCreateLBR2(prisma: PrismaClient, R: Region, S: number, D: number) {
  if (await stageExistsForRegion(prisma, "KICKOFF_LB_R2", S, R)) return;
  const lbR1 = await getResults(prisma, "KICKOFF_LB_R1", S, R);
  const midR2 = await getResults(prisma, "KICKOFF_MID_R2", S, R);
  if (lbR1.length >= 2 && midR2.length >= 2) {
    // Mid R2 losers reversed: L(MidR2[1]) vs W(LBR1[0]), L(MidR2[0]) vs W(LBR1[1])
    await createMatchesOnNextSlots(prisma, [
      [midR2[1].loser, lbR1[0].winner],
      [midR2[0].loser, lbR1[1].winner],
    ], "KICKOFF_LB_R2", R, D, S);
  }
}

async function tryCreateLBR3(prisma: PrismaClient, R: Region, S: number, D: number) {
  if (await stageExistsForRegion(prisma, "KICKOFF_LB_R3", S, R)) return;
  const lbR2 = await getResults(prisma, "KICKOFF_LB_R2", S, R);
  const midQF = await getResults(prisma, "KICKOFF_MID_QF", S, R);
  if (lbR2.length >= 2 && midQF.length >= 2) {
    await createMatchesOnNextSlots(prisma, [
      [midQF[0].loser, lbR2[0].winner],
      [midQF[1].loser, lbR2[1].winner],
    ], "KICKOFF_LB_R3", R, D, S);
  }
}

async function tryCreateLBQF(prisma: PrismaClient, R: Region, S: number, D: number) {
  if (await stageExistsForRegion(prisma, "KICKOFF_LB_QF", S, R)) return;
  const lbR3 = await getResults(prisma, "KICKOFF_LB_R3", S, R);
  if (lbR3.length >= 2) {
    // LB QF: both LB R3 winners face each other
    await createMatchesOnNextSlots(prisma, [
      [lbR3[0].winner, lbR3[1].winner],
    ], "KICKOFF_LB_QF", R, D, S);
  }
}

async function tryCreateMidFinal(prisma: PrismaClient, R: Region, S: number, D: number) {
  if (await stageExistsForRegion(prisma, "KICKOFF_MID_FINAL", S, R)) return;
  const midSF = await getResults(prisma, "KICKOFF_MID_SF", S, R);
  const ubFinal = await getResults(prisma, "KICKOFF_UB_FINAL", S, R);
  if (midSF.length >= 1 && ubFinal.length >= 1) {
    // Mid Final = day after UB Final (consecutive finals)
    const day = D + 1;
    await prisma.match.createMany({ data: [{
      team1Id: ubFinal[0].loser, team2Id: midSF[0].winner,
      stageId: "KICKOFF_MID_FINAL", format: "BO5", day, week: Math.ceil(day / 7), season: S,
    }] });
  }
}

async function tryCreateLBFinal(prisma: PrismaClient, R: Region, S: number, D: number) {
  if (await stageExistsForRegion(prisma, "KICKOFF_LB_FINAL", S, R)) return;
  const lbSF = await getResults(prisma, "KICKOFF_LB_SF", S, R);
  const midFinal = await getResults(prisma, "KICKOFF_MID_FINAL", S, R);
  if (lbSF.length >= 1 && midFinal.length >= 1) {
    // LB Final = day after Mid Final (consecutive finals)
    const day = D + 1;
    await prisma.match.createMany({ data: [{
      team1Id: midFinal[0].loser, team2Id: lbSF[0].winner,
      stageId: "KICKOFF_LB_FINAL", format: "BO5", day, week: Math.ceil(day / 7), season: S,
    }] });
  }
}

// ══════════════════════════════════════════════════════════════
// ── International event scheduling helpers ──
// ══════════════════════════════════════════════════════════════

const INTERNATIONAL_BROADCAST_DAYS = MATCH_DAYS.EMEA; // Tue-Fri for international events

async function createMatchesOnInternationalSlots(
  prisma: PrismaClient, pairs: [string, string][],
  stageId: string, afterDay: number, season: number,
  format: MatchFormat = "BO3",
) {
  const valid = pairs.filter(([a, b]) => a && b);
  if (valid.length === 0) return;

  // Find all already-scheduled days + counts for international matches
  const existingMatches = await prisma.match.findMany({
    where: { season, day: { gt: afterDay }, stageId: { startsWith: stageId.split("_")[0] } },
    select: { day: true },
  });
  const dayUsage = new Map<number, number>();
  for (const m of existingMatches) {
    dayUsage.set(m.day, (dayUsage.get(m.day) ?? 0) + 1);
  }

  const scheduledDays: number[] = [];
  let day = afterDay + 1;
  while (scheduledDays.length < valid.length) {
    const dow = ((day - 1) % 7) + 1;
    if (INTERNATIONAL_BROADCAST_DAYS.includes(dow)) {
      const used = dayUsage.get(day) ?? 0;
      const available = MATCHES_PER_DAY - used;
      for (let slot = 0; slot < available && scheduledDays.length < valid.length; slot++) {
        scheduledDays.push(day);
        dayUsage.set(day, used + slot + 1);
      }
    }
    day++;
  }

  const data = valid.map(([team1Id, team2Id], idx) => ({
    team1Id, team2Id, stageId, format,
    day: scheduledDays[idx],
    week: Math.ceil(scheduledDays[idx] / 7),
    season,
  }));
  await prisma.match.createMany({ data });
}

// ══════════════════════════════════════════════════════════════
// ── Masters Santiago initialization ──
// ══════════════════════════════════════════════════════════════

/**
 * Get the top 3 qualifying teams from a region's Kickoff results.
 * Top 3 = winners of UB Final, Mid Final, LB Final.
 */
async function getKickoffQualifiers(
  prisma: PrismaClient, region: Region, season: number,
): Promise<string[]> {
  const qualifiers: string[] = [];
  for (const stageId of ["KICKOFF_UB_FINAL", "KICKOFF_MID_FINAL", "KICKOFF_LB_FINAL"]) {
    const match = await prisma.match.findFirst({
      where: { stageId, season, isPlayed: true, team1: { region } },
    });
    if (match?.winnerId) qualifiers.push(match.winnerId);
  }
  return qualifiers;
}

/**
 * Initialize the Masters tournament (used for both MASTERS_1 and MASTERS_2).
 * Called when the season transitions to a Masters stage.
 *
 * Format: {@link MASTERS_FORMAT}
 *   - Swiss Stage: 12 teams, BO3, 3 wins to advance, 3 losses to eliminate
 *   - Bracket Stage: 8 teams, double elimination, Grand Final BO5
 */
export async function initializeMasters(
  prisma: PrismaClient,
  seasonNumber: number,
  stagePrefix: string = "MASTERS_1",
  qualifyingStagePrefix: string = "KICKOFF",
): Promise<{ matchesScheduled: number }> {
  // Check if already initialized
  const existing = await prisma.match.count({
    where: { stageId: { startsWith: `${stagePrefix}_SWISS` }, season: seasonNumber },
  });
  if (existing > 0) return { matchesScheduled: 0 };

  // Get qualifiers: top 3 from each region
  const qualifiedTeams: { teamId: string; region: Region; seed: number }[] = [];

  for (const region of ALL_REGIONS) {
    let teamIds: string[];
    if (qualifyingStagePrefix === "KICKOFF") {
      teamIds = await getKickoffQualifiers(prisma, region, seasonNumber);
    } else {
      // For STAGE_1 / STAGE_2 qualification: top 3 by wins in that stage
      teamIds = await getStageTopTeams(prisma, region, seasonNumber, qualifyingStagePrefix, 3);
    }
    teamIds.forEach((id, idx) => {
      qualifiedTeams.push({ teamId: id, region, seed: idx + 1 });
    });
  }

  if (qualifiedTeams.length < 12) {
    // Not enough qualifiers - shouldn't happen but guard against it
    return { matchesScheduled: 0 };
  }

  // Sort by seed for initial pairing: 1v12, 2v11, 3v10, etc.
  // Seed order: region1 seed1, region2 seed1, region3 seed1, region4 seed1, then seed2s, then seed3s
  const sorted = [...qualifiedTeams].sort((a, b) => a.seed - b.seed || ALL_REGIONS.indexOf(a.region) - ALL_REGIONS.indexOf(b.region));

  // Swiss R1: 1v12, 2v11, 3v10, 4v9, 5v8, 6v7
  const pairs: [string, string][] = [];
  for (let i = 0; i < 6; i++) {
    pairs.push([sorted[i].teamId, sorted[11 - i].teamId]);
  }

  // Find last Kickoff match day to schedule after it
  const lastKickoffMatch = await prisma.match.findFirst({
    where: { season: seasonNumber, stageId: { startsWith: qualifyingStagePrefix } },
    orderBy: { day: "desc" },
  });
  const afterDay = lastKickoffMatch?.day ?? 0;

  await createMatchesOnInternationalSlots(
    prisma, pairs, `${stagePrefix}_SWISS_R1`, afterDay, seasonNumber,
  );

  return { matchesScheduled: pairs.length };
}

// ══════════════════════════════════════════════════════════════
// ── Swiss stage progression ──
// ══════════════════════════════════════════════════════════════

interface SwissRecord {
  teamId: string;
  wins: number;
  losses: number;
  buchholz: number; // sum of opponents' wins
  opponents: string[];
}

/**
 * Progress Swiss stage after matches are completed.
 * Checks W-L records, identifies advances/eliminations,
 * and creates next round matchups.
 */
export async function progressSwiss(
  prisma: PrismaClient,
  completedRoundStageId: string, // e.g. "MASTERS_1_SWISS_R1"
  seasonNumber: number,
  currentDay: number,
): Promise<{ advanced: string[]; eliminated: string[]; nextRoundCreated: boolean }> {
  // Parse the stage prefix and round number
  const parts = completedRoundStageId.split("_SWISS_R");
  if (parts.length !== 2) return { advanced: [], eliminated: [], nextRoundCreated: false };
  const stagePrefix = parts[0]; // e.g. "MASTERS_1"
  const roundNum = parseInt(parts[1], 10);

  // Get all Swiss matches played so far for this tournament
  const allSwissMatches = await prisma.match.findMany({
    where: {
      season: seasonNumber,
      stageId: { startsWith: `${stagePrefix}_SWISS_R` },
      isPlayed: true,
    },
  });

  // Build W-L records
  const records = new Map<string, SwissRecord>();

  function ensureRecord(teamId: string): SwissRecord {
    if (!records.has(teamId)) {
      records.set(teamId, { teamId, wins: 0, losses: 0, buchholz: 0, opponents: [] });
    }
    return records.get(teamId)!;
  }

  for (const match of allSwissMatches) {
    const winnerId = match.winnerId!;
    const loserId = winnerId === match.team1Id ? match.team2Id : match.team1Id;

    const winnerRec = ensureRecord(winnerId);
    const loserRec = ensureRecord(loserId);

    winnerRec.wins++;
    winnerRec.opponents.push(loserId);
    loserRec.losses++;
    loserRec.opponents.push(winnerId);
  }

  // Calculate Buchholz (sum of opponents' wins)
  for (const rec of records.values()) {
    rec.buchholz = rec.opponents.reduce((sum, oppId) => {
      const opp = records.get(oppId);
      return sum + (opp?.wins ?? 0);
    }, 0);
  }

  const advanced: string[] = [];
  const eliminated: string[] = [];
  const stillPlaying: SwissRecord[] = [];

  for (const rec of records.values()) {
    if (rec.wins >= 3) {
      advanced.push(rec.teamId);
    } else if (rec.losses >= 3) {
      eliminated.push(rec.teamId);
    } else {
      stillPlaying.push(rec);
    }
  }

  // If all teams are resolved (advanced or eliminated), Swiss is complete
  if (stillPlaying.length === 0) {
    // Create bracket matches
    await createMastersBracket(prisma, stagePrefix, seasonNumber, currentDay, advanced);
    return { advanced, eliminated, nextRoundCreated: true };
  }

  // Check if next round already exists
  const nextRoundStageId = `${stagePrefix}_SWISS_R${roundNum + 1}`;
  const nextRoundExists = await prisma.match.count({
    where: { stageId: nextRoundStageId, season: seasonNumber },
  });
  if (nextRoundExists > 0) {
    return { advanced, eliminated, nextRoundCreated: false };
  }

  // Pair teams with same W-L record, using Buchholz for seeding
  // Group by W-L record
  const groups = new Map<string, SwissRecord[]>();
  for (const rec of stillPlaying) {
    const key = `${rec.wins}-${rec.losses}`;
    const group = groups.get(key) ?? [];
    group.push(rec);
    groups.set(key, group);
  }

  const nextPairs: [string, string][] = [];
  const paired = new Set<string>();

  // Sort groups by wins desc, then pair within each group
  const sortedKeys = [...groups.keys()].sort((a, b) => {
    const [aw] = a.split("-").map(Number);
    const [bw] = b.split("-").map(Number);
    return bw - aw;
  });

  for (const key of sortedKeys) {
    const group = groups.get(key)!;
    // Sort by Buchholz desc for seeding
    group.sort((a, b) => b.buchholz - a.buchholz);

    const unpaired = group.filter((r) => !paired.has(r.teamId));
    for (let i = 0; i < unpaired.length - 1; i += 2) {
      // Try to avoid rematches
      let opponent = i + 1;
      while (
        opponent < unpaired.length &&
        unpaired[i].opponents.includes(unpaired[opponent].teamId)
      ) {
        opponent++;
      }
      if (opponent >= unpaired.length) opponent = i + 1; // fallback: allow rematch

      nextPairs.push([unpaired[i].teamId, unpaired[opponent].teamId]);
      paired.add(unpaired[i].teamId);
      paired.add(unpaired[opponent].teamId);
    }
  }

  // Handle any leftover unpaired team (odd number in a group) — pair across groups
  const leftover = stillPlaying.filter((r) => !paired.has(r.teamId));
  for (let i = 0; i < leftover.length - 1; i += 2) {
    nextPairs.push([leftover[i].teamId, leftover[i + 1].teamId]);
    paired.add(leftover[i].teamId);
    paired.add(leftover[i + 1].teamId);
  }

  if (nextPairs.length > 0) {
    await createMatchesOnInternationalSlots(
      prisma, nextPairs, nextRoundStageId, currentDay, seasonNumber,
    );
  }

  return { advanced, eliminated, nextRoundCreated: nextPairs.length > 0 };
}

// ══════════════════════════════════════════════════════════════
// ── Masters bracket (double elimination) ──
// ══════════════════════════════════════════════════════════════

/**
 * Create the double-elimination bracket for Masters.
 * 8 teams seeded by Swiss performance.
 */
async function createMastersBracket(
  prisma: PrismaClient,
  stagePrefix: string,
  seasonNumber: number,
  afterDay: number,
  advancedTeamIds: string[],
) {
  // Already created?
  const existing = await prisma.match.count({
    where: { stageId: { startsWith: `${stagePrefix}_UB_QF` }, season: seasonNumber },
  });
  if (existing > 0) return;

  // Get Swiss records for seeding
  const allSwissMatches = await prisma.match.findMany({
    where: {
      season: seasonNumber,
      stageId: { startsWith: `${stagePrefix}_SWISS_R` },
      isPlayed: true,
    },
  });

  const winsMap = new Map<string, number>();
  const buchholzMap = new Map<string, number>();
  const opponentsMap = new Map<string, string[]>();

  for (const match of allSwissMatches) {
    const winnerId = match.winnerId!;
    const loserId = winnerId === match.team1Id ? match.team2Id : match.team1Id;
    winsMap.set(winnerId, (winsMap.get(winnerId) ?? 0) + 1);
    winsMap.set(loserId, winsMap.get(loserId) ?? 0);
    const wOpps = opponentsMap.get(winnerId) ?? [];
    wOpps.push(loserId);
    opponentsMap.set(winnerId, wOpps);
    const lOpps = opponentsMap.get(loserId) ?? [];
    lOpps.push(winnerId);
    opponentsMap.set(loserId, lOpps);
  }

  for (const teamId of advancedTeamIds) {
    const opps = opponentsMap.get(teamId) ?? [];
    buchholzMap.set(teamId, opps.reduce((s, o) => s + (winsMap.get(o) ?? 0), 0));
  }

  // Seed: sort by wins desc, then Buchholz desc
  const seeded = [...advancedTeamIds].sort((a, b) => {
    const wDiff = (winsMap.get(b) ?? 0) - (winsMap.get(a) ?? 0);
    if (wDiff !== 0) return wDiff;
    return (buchholzMap.get(b) ?? 0) - (buchholzMap.get(a) ?? 0);
  });

  // UB QF: 1v8, 2v7, 3v6, 4v5
  const ubQfPairs: [string, string][] = [
    [seeded[0], seeded[7]],
    [seeded[1], seeded[6]],
    [seeded[2], seeded[5]],
    [seeded[3], seeded[4]],
  ];

  await createMatchesOnInternationalSlots(
    prisma, ubQfPairs, `${stagePrefix}_UB_QF`, afterDay, seasonNumber,
  );
}

/**
 * Progress the Masters double-elimination bracket.
 * Called when a bracket round completes.
 */
export async function progressMastersBracket(
  prisma: PrismaClient,
  completedStageId: string,
  seasonNumber: number,
  currentDay: number,
) {
  const stagePrefix = completedStageId.includes("MASTERS_2") ? "MASTERS_2" : "MASTERS_1";
  const S = seasonNumber;
  const D = currentDay;

  async function getIntlResults(stageId: string): Promise<WL[]> {
    const matches = await prisma.match.findMany({
      where: { stageId, season: S, isPlayed: true },
      orderBy: { day: "asc" },
    });
    return matches.map((m) => ({
      winner: m.winnerId!,
      loser: m.winnerId === m.team1Id ? m.team2Id : m.team1Id,
    }));
  }

  async function intlStageExists(stageId: string): Promise<boolean> {
    const count = await prisma.match.count({ where: { stageId, season: S } });
    return count > 0;
  }

  const cm = (pairs: [string, string][], stageId: string, format: MatchFormat = "BO3") =>
    createMatchesOnInternationalSlots(prisma, pairs, stageId, D, S, format);

  // ── UB QF done → UB SF + LB R1 ──
  if (completedStageId === `${stagePrefix}_UB_QF`) {
    const qf = await getIntlResults(`${stagePrefix}_UB_QF`);
    if (qf.length >= 4) {
      if (!await intlStageExists(`${stagePrefix}_UB_SF`)) {
        await cm([
          [qf[0].winner, qf[1].winner],
          [qf[2].winner, qf[3].winner],
        ], `${stagePrefix}_UB_SF`);
      }
      if (!await intlStageExists(`${stagePrefix}_LB_R1`)) {
        await cm([
          [qf[3].loser, qf[0].loser],
          [qf[2].loser, qf[1].loser],
        ], `${stagePrefix}_LB_R1`);
      }
    }
  }

  // ── UB SF done → UB Final (day:0), LB R2 needs LB R1 ──
  if (completedStageId === `${stagePrefix}_UB_SF`) {
    const sf = await getIntlResults(`${stagePrefix}_UB_SF`);
    if (sf.length >= 2 && !await intlStageExists(`${stagePrefix}_UB_FINAL`)) {
      await prisma.match.createMany({ data: [{
        team1Id: sf[0].winner, team2Id: sf[1].winner,
        stageId: `${stagePrefix}_UB_FINAL`, format: "BO3", day: 0, week: 0, season: S,
      }] });
    }
    // Try LB R2
    await tryMastersLBR2(prisma, stagePrefix, S, D);
  }

  // ── LB R1 done → try LB R2 (needs UB SF losers) ──
  if (completedStageId === `${stagePrefix}_LB_R1`) {
    await tryMastersLBR2(prisma, stagePrefix, S, D);
  }

  // ── LB R2 done → LB R3 (needs UB SF losers vs LB R2 winners) ──
  if (completedStageId === `${stagePrefix}_LB_R2`) {
    const lbR2 = await getIntlResults(`${stagePrefix}_LB_R2`);
    const ubSF = await getIntlResults(`${stagePrefix}_UB_SF`);
    if (lbR2.length >= 2 && ubSF.length >= 2 && !await intlStageExists(`${stagePrefix}_LB_R3`)) {
      await cm([
        [ubSF[0].loser, lbR2[0].winner],
        [ubSF[1].loser, lbR2[1].winner],
      ], `${stagePrefix}_LB_R3`);
    }
  }

  // ── LB R3 done → LB SF ──
  if (completedStageId === `${stagePrefix}_LB_R3`) {
    const lbR3 = await getIntlResults(`${stagePrefix}_LB_R3`);
    if (lbR3.length >= 2 && !await intlStageExists(`${stagePrefix}_LB_SF`)) {
      await cm([[lbR3[0].winner, lbR3[1].winner]], `${stagePrefix}_LB_SF`);
    }
  }

  // ── LB SF done → schedule UB Final + LB Final ──
  if (completedStageId === `${stagePrefix}_LB_SF`) {
    // Schedule UB Final
    const ubFinal = await prisma.match.findFirst({
      where: { stageId: `${stagePrefix}_UB_FINAL`, season: S, day: 0 },
    });
    if (ubFinal) {
      const nextDays = getNextWeekBroadcastDays("EMEA", D, 1, 1);
      await prisma.match.update({
        where: { id: ubFinal.id },
        data: { day: nextDays[0], week: Math.ceil(nextDays[0] / 7) },
      });
    }
  }

  // ── UB Final done → LB Final (UB Final loser vs LB SF winner) ──
  if (completedStageId === `${stagePrefix}_UB_FINAL`) {
    const ubFinal = await getIntlResults(`${stagePrefix}_UB_FINAL`);
    const lbSF = await getIntlResults(`${stagePrefix}_LB_SF`);
    if (ubFinal.length >= 1 && lbSF.length >= 1 && !await intlStageExists(`${stagePrefix}_LB_FINAL`)) {
      const day = D + 1;
      await prisma.match.createMany({ data: [{
        team1Id: ubFinal[0].loser, team2Id: lbSF[0].winner,
        stageId: `${stagePrefix}_LB_FINAL`, format: "BO3", day, week: Math.ceil(day / 7), season: S,
      }] });
    }
  }

  // ── LB Final done → Grand Final (UB Final winner vs LB Final winner) ──
  if (completedStageId === `${stagePrefix}_LB_FINAL`) {
    const ubFinal = await getIntlResults(`${stagePrefix}_UB_FINAL`);
    const lbFinal = await getIntlResults(`${stagePrefix}_LB_FINAL`);
    if (ubFinal.length >= 1 && lbFinal.length >= 1 && !await intlStageExists(`${stagePrefix}_GRAND_FINAL`)) {
      const day = D + 1;
      await prisma.match.createMany({ data: [{
        team1Id: ubFinal[0].winner, team2Id: lbFinal[0].winner,
        stageId: `${stagePrefix}_GRAND_FINAL`, format: "BO5", day, week: Math.ceil(day / 7), season: S,
      }] });
    }
  }
}

async function tryMastersLBR2(prisma: PrismaClient, stagePrefix: string, S: number, D: number) {
  const count = await prisma.match.count({ where: { stageId: `${stagePrefix}_LB_R2`, season: S } });
  if (count > 0) return;
  const lbR1Matches = await prisma.match.findMany({
    where: { stageId: `${stagePrefix}_LB_R1`, season: S, isPlayed: true },
    orderBy: { day: "asc" },
  });
  const ubSFMatches = await prisma.match.findMany({
    where: { stageId: `${stagePrefix}_UB_SF`, season: S, isPlayed: true },
    orderBy: { day: "asc" },
  });
  if (lbR1Matches.length >= 2 && ubSFMatches.length >= 2) {
    const lbR1: WL[] = lbR1Matches.map((m) => ({
      winner: m.winnerId!, loser: m.winnerId === m.team1Id ? m.team2Id : m.team1Id,
    }));
    // LB R2: LB R1 winners face each other (UB SF losers go to LB R3)
    await createMatchesOnInternationalSlots(prisma,
      [[lbR1[0].winner, lbR1[1].winner]],
      `${stagePrefix}_LB_R2`, D, S,
    );
  }
}

// ══════════════════════════════════════════════════════════════
// ── Stage 1 / Stage 2 (Regional round-robin) ──
// ══════════════════════════════════════════════════════════════

/**
 * Initialize a regional round-robin stage (STAGE_1 or STAGE_2).
 * Each region: all 12 teams play round-robin within their region.
 * Simplified: ~15 BO3 matches per region spread across 6 weeks.
 */
/**
 * Round-robin schedule via circle method.
 * Returns N-1 rounds for N teams, each round being a list of [team, team] pairs.
 * Team at index 0 is fixed; others rotate.
 * For N=6 → 5 rounds × 3 pairs per round = 15 matches per group.
 */
function roundRobinSchedule(teamIds: string[]): string[][][] {
  const n = teamIds.length;
  const teams = n % 2 === 0 ? [...teamIds] : [...teamIds, "_BYE"];
  const rounds: string[][][] = [];
  const size = teams.length;
  const roundCount = size - 1;

  for (let r = 0; r < roundCount; r++) {
    const pairs: string[][] = [];
    for (let i = 0; i < size / 2; i++) {
      const a = teams[i];
      const b = teams[size - 1 - i];
      if (a !== "_BYE" && b !== "_BYE") pairs.push([a, b]);
    }
    rounds.push(pairs);
    // Rotate: keep teams[0] fixed, rotate rest clockwise
    const fixed = teams[0];
    const rotating = teams.slice(1);
    rotating.unshift(rotating.pop()!);
    teams.splice(0, size, fixed, ...rotating);
  }
  return rounds;
}

/**
 * Initialize a regional stage (STAGE_1 or STAGE_2).
 *
 * Format per region:
 *   - 12 teams split into 2 groups of 6 (Alpha + Omega, balanced via snake draft by prestige)
 *   - Round-robin within each group via circle method → 5 rounds (each team plays 5 matches, one per week)
 *   - Each broadcast day has 2 matches: 1 Alpha + 1 Omega (3 broadcast days per round)
 *   - 15 matches per group × 2 groups = 30 matches per region × 4 regions = 120 matches total
 *
 * Playoffs are created after the group phase completes (see progressRegionalStage).
 */
export async function initializeRegionalStage(
  prisma: PrismaClient,
  seasonNumber: number,
  stageId: string, // "STAGE_1" or "STAGE_2"
): Promise<{ matchesScheduled: number }> {
  const existing = await prisma.match.count({
    where: { stageId: { startsWith: stageId }, season: seasonNumber },
  });
  if (existing > 0) return { matchesScheduled: 0 };

  const lastMatch = await prisma.match.findFirst({
    where: { season: seasonNumber },
    orderBy: { day: "desc" },
  });
  const afterDay = lastMatch?.day ?? 0;
  const firstWeekStart = Math.ceil(afterDay / 7) * 7 + 1;

  let totalMatches = 0;

  for (const region of ALL_REGIONS) {
    const teams = await prisma.team.findMany({
      where: { region },
      select: { id: true, prestige: true },
      orderBy: { prestige: "desc" },
    });
    if (teams.length < 2) continue;

    // Snake draft to balance groups by prestige
    const alpha: string[] = [];
    const omega: string[] = [];
    for (let i = 0; i < teams.length; i++) {
      const group = Math.floor(i / 2) % 2 === 0
        ? (i % 2 === 0 ? alpha : omega)
        : (i % 2 === 0 ? omega : alpha);
      group.push(teams[i].id);
    }

    const alphaRounds = roundRobinSchedule(alpha); // e.g. 5 rounds × 3 pairs
    const omegaRounds = roundRobinSchedule(omega);
    const roundCount = Math.max(alphaRounds.length, omegaRounds.length);

    const broadcastDays = MATCH_DAYS[region];
    const matchData: Array<{
      team1Id: string; team2Id: string; stageId: string;
      format: MatchFormat; day: number; week: number; season: number;
    }> = [];

    // Each "round" = 1 week, each team plays once in the week
    for (let r = 0; r < roundCount; r++) {
      const weekStart = firstWeekStart + r * 7;
      const alphaMatches = alphaRounds[r] ?? [];
      const omegaMatches = omegaRounds[r] ?? [];
      const pairsPerGroup = Math.max(alphaMatches.length, omegaMatches.length);

      // We need `pairsPerGroup` broadcast days with 1 Alpha + 1 Omega per day
      const daysNeeded = pairsPerGroup;
      const availableDays = broadcastDays.slice(0, Math.max(daysNeeded, broadcastDays.length));
      // Cycle through broadcast days if we need more slots than available
      for (let i = 0; i < pairsPerGroup; i++) {
        const dow = availableDays[i % availableDays.length];
        const day = weekStart + dow - 1;
        const week = Math.ceil(day / 7);

        const aPair = alphaMatches[i];
        const oPair = omegaMatches[i];

        if (aPair) {
          matchData.push({
            team1Id: aPair[0], team2Id: aPair[1],
            stageId: `${stageId}_ALPHA`, format: "BO3", day, week, season: seasonNumber,
          });
        }
        if (oPair) {
          matchData.push({
            team1Id: oPair[0], team2Id: oPair[1],
            stageId: `${stageId}_OMEGA`, format: "BO3", day, week, season: seasonNumber,
          });
        }
      }
    }

    if (matchData.length > 0) {
      await prisma.match.createMany({ data: matchData });
      totalMatches += matchData.length;
    }
  }

  return { matchesScheduled: totalMatches };
}

/**
 * After the group phase of STAGE_1/STAGE_2 completes for a region,
 * create the playoffs bracket (double-elimination, 6 teams — top 3 of each group).
 *
 * Bracket: 6 teams from each region → 3 qualify for Masters.
 * Format (simplified): UB semis #A1 vs #B2, #B1 vs #A2, loser's bracket for others.
 *   - UB SF1: A1 vs B2
 *   - UB SF2: B1 vs A2
 *   - LB R1: A3 vs B3
 *   - LB R2: loser UB SF1 vs winner LB R1, loser UB SF2 vs ... (simplified)
 *
 * For MVP we use a simpler path:
 *   UB SF1, UB SF2 → UB FINAL (→ Masters #1)
 *   LB R1 (SF losers + A3/B3) → LB FINAL (→ Masters #2 + #3 decided by final)
 */
export async function progressRegionalStage(
  prisma: PrismaClient,
  stageId: string, // STAGE_1 or STAGE_2
  region: Region,
  seasonNumber: number,
  currentDay: number,
): Promise<void> {
  const S = seasonNumber;
  const R = region;

  // Check if group phase complete for this region
  const alphaMatches = await prisma.match.findMany({
    where: { stageId: `${stageId}_ALPHA`, season: S, team1: { region: R } },
  });
  const omegaMatches = await prisma.match.findMany({
    where: { stageId: `${stageId}_OMEGA`, season: S, team1: { region: R } },
  });
  const alphaDone = alphaMatches.length > 0 && alphaMatches.every((m) => m.isPlayed);
  const omegaDone = omegaMatches.length > 0 && omegaMatches.every((m) => m.isPlayed);
  if (!alphaDone || !omegaDone) return;

  // Check if playoffs already started
  const playoffs = await prisma.match.count({
    where: { stageId: { startsWith: `${stageId}_PO_` }, season: S, team1: { region: R } },
  });
  if (playoffs > 0) return;

  // Compute standings per group by wins (top 4 qualify — 4th drops to LB R1)
  function computeTop4(matches: typeof alphaMatches): string[] {
    const recs = new Map<string, number>();
    const participants = new Set<string>();
    for (const m of matches) {
      participants.add(m.team1Id);
      participants.add(m.team2Id);
      if (m.winnerId) {
        recs.set(m.winnerId, (recs.get(m.winnerId) ?? 0) + 1);
      }
    }
    return [...participants]
      .sort((a, b) => (recs.get(b) ?? 0) - (recs.get(a) ?? 0))
      .slice(0, 4);
  }

  const alphaTop4 = computeTop4(alphaMatches);
  const omegaTop4 = computeTop4(omegaMatches);
  if (alphaTop4.length < 4 || omegaTop4.length < 4) return;

  const [a1, a2, a3, a4] = alphaTop4;
  const [b1, b2, b3, b4] = omegaTop4;

  // VCT 2026 Stage playoff bracket (8 teams, double-elim):
  //   UB QF:    A2 vs B3 / B2 vs A3              — seeds 2/3 from each group
  //   UB SF:    A1 vs W(UB QF1) / B1 vs W(UB QF2)  — seeds 1 get byes
  //   UB Final: UB SF winners
  //   LB R1:    A4 vs L(UB QF2) / B4 vs L(UB QF1)  — 4th seeds cross-bracket with QF losers
  //   LB R2:    W(LB R1) vs L(UB SF) cross-bracket
  //   LB Final: LB R2 winners
  //   Grand Final (BO5): UB Final winner vs LB Final winner
  const cm = (pairs: [string, string][], stage: string, format: MatchFormat = "BO3") =>
    createMatchesOnNextSlots(prisma, pairs, stage, R, currentDay, S, format);

  // UB QF and LB R1 start simultaneously (4th seeds enter immediately in LB R1)
  await cm([[a2, b3], [b2, a3]], `${stageId}_PO_UB_QF`);
  // LB R1 seeds: 4th from each group vs TBD (QF loser) — we schedule a placeholder
  // pairing of the 4th seeds against each other since QF isn't done yet. When QF
  // completes, progressRegionalPlayoffs will create LB R2 with proper cross-bracket.
  // Alternative: wait for QF to complete, then create LB R1 with 4th-vs-QFLoser.
  // We go with the latter to keep the bracket proper (seeds play known opponents).
  // So here we only create UB QF. LB R1 is created when UB QF completes.
}

/**
 * Progress regional playoffs after a round completes.
 * Bracket structure (VCT 2026 — 8 teams, top 4 per group):
 *   UB QF:    A2 vs B3 / B2 vs A3
 *   UB SF:    A1 vs W(QF1) / B1 vs W(QF2)   — top seeds get byes
 *   UB Final: W(UB SF1) vs W(UB SF2)
 *   LB R1:    A4 vs L(QF2) / B4 vs L(QF1)   — 4th seeds enter here cross-bracket
 *   LB R2:    W(LB R1-1) vs L(UB SF1) / W(LB R1-2) vs L(UB SF2)
 *   LB Final: W(LB R2-1) vs W(LB R2-2)
 *   Grand Final (BO5): W(UB Final) vs W(LB Final)
 */
export async function progressRegionalPlayoffs(
  prisma: PrismaClient,
  completedStageId: string,
  region: Region,
  seasonNumber: number,
  currentDay: number,
): Promise<void> {
  const S = seasonNumber;
  const R = region;
  const prefix = completedStageId.replace(/_PO_.*$/, "");

  async function results(stageId: string): Promise<Array<{ winner: string; loser: string }>> {
    const matches = await prisma.match.findMany({
      where: { stageId, season: S, isPlayed: true, team1: { region: R } },
      orderBy: { day: "asc" },
    });
    return matches.map((m) => ({
      winner: m.winnerId!,
      loser: m.winnerId === m.team1Id ? m.team2Id : m.team1Id,
    }));
  }

  async function exists(stageId: string): Promise<boolean> {
    const n = await prisma.match.count({
      where: { stageId, season: S, team1: { region: R } },
    });
    return n > 0;
  }

  // Get group standings needed for bracket seeding — recompute from group stage.
  // Returns top-N seeds per group in order (seed 1, 2, 3, 4).
  async function getGroupSeeds(count: number): Promise<{ alpha: string[]; omega: string[] }> {
    async function topN(stageId: string): Promise<string[]> {
      const matches = await prisma.match.findMany({
        where: { stageId, season: S, team1: { region: R }, isPlayed: true },
      });
      const wins = new Map<string, number>();
      const ids = new Set<string>();
      for (const m of matches) {
        ids.add(m.team1Id);
        ids.add(m.team2Id);
        if (m.winnerId) wins.set(m.winnerId, (wins.get(m.winnerId) ?? 0) + 1);
      }
      return [...ids].sort((a, b) => (wins.get(b) ?? 0) - (wins.get(a) ?? 0)).slice(0, count);
    }
    return {
      alpha: await topN(`${prefix}_ALPHA`),
      omega: await topN(`${prefix}_OMEGA`),
    };
  }

  async function getTop1PerGroup(): Promise<{ a1: string | null; b1: string | null }> {
    const seeds = await getGroupSeeds(1);
    return { a1: seeds.alpha[0] ?? null, b1: seeds.omega[0] ?? null };
  }

  const cm = (pairs: [string, string][], stage: string, format: MatchFormat = "BO3") =>
    createMatchesOnNextSlots(prisma, pairs, stage, R, currentDay, S, format);

  // ── UB QF done → UB SF (with A1/B1 byes) + LB R1 (4th seeds enter here) ──
  if (completedStageId === `${prefix}_PO_UB_QF`) {
    const qf = await results(`${prefix}_PO_UB_QF`);
    if (qf.length >= 2) {
      const seeds = await getGroupSeeds(4);
      const a1 = seeds.alpha[0];
      const b1 = seeds.omega[0];
      const a4 = seeds.alpha[3];
      const b4 = seeds.omega[3];
      if (a1 && b1 && !await exists(`${prefix}_PO_UB_SF`)) {
        // QF1 was A2 vs B3 (A1 plays this winner)
        // QF2 was B2 vs A3 (B1 plays this winner)
        await cm([[a1, qf[0].winner], [b1, qf[1].winner]], `${prefix}_PO_UB_SF`);
      }
      if (a4 && b4 && !await exists(`${prefix}_PO_LB_R1`)) {
        // LB R1 entrance: 4th seeds cross-bracket with QF losers
        //   A4 vs L(QF2)  — A4 avoids rematching their own group's QF loser
        //   B4 vs L(QF1)
        await cm([[a4, qf[1].loser], [b4, qf[0].loser]], `${prefix}_PO_LB_R1`);
      }
    }
  }

  // ── UB SF done → UB Final + try LB R2 ──
  if (completedStageId === `${prefix}_PO_UB_SF`) {
    const sf = await results(`${prefix}_PO_UB_SF`);
    if (sf.length >= 2 && !await exists(`${prefix}_PO_UB_FINAL`)) {
      await cm([[sf[0].winner, sf[1].winner]], `${prefix}_PO_UB_FINAL`);
    }
    await tryRegionalLBR2(prisma, prefix, R, S, currentDay);
  }

  // ── LB R1 done → try LB R2 ──
  if (completedStageId === `${prefix}_PO_LB_R1`) {
    await tryRegionalLBR2(prisma, prefix, R, S, currentDay);
  }

  // ── LB R2 done → LB Final (winners of 2 LB R2 matches) ──
  if (completedStageId === `${prefix}_PO_LB_R2`) {
    const lbR2 = await results(`${prefix}_PO_LB_R2`);
    if (lbR2.length >= 2 && !await exists(`${prefix}_PO_LB_FINAL`)) {
      await cm([[lbR2[0].winner, lbR2[1].winner]], `${prefix}_PO_LB_FINAL`);
    }
  }

  // ── UB Final or LB Final done → Grand Final ──
  if (completedStageId === `${prefix}_PO_UB_FINAL` || completedStageId === `${prefix}_PO_LB_FINAL`) {
    const ubF = await results(`${prefix}_PO_UB_FINAL`);
    const lbF = await results(`${prefix}_PO_LB_FINAL`);
    if (ubF.length >= 1 && lbF.length >= 1 && !await exists(`${prefix}_PO_GF`)) {
      await cm([[ubF[0].winner, lbF[0].winner]], `${prefix}_PO_GF`, "BO5");
    }
  }
}

/** Try to create LB R2 (needs both LB R1 winners + both UB SF losers). Creates 2 matches. */
async function tryRegionalLBR2(
  prisma: PrismaClient,
  prefix: string,
  region: Region,
  season: number,
  currentDay: number,
): Promise<void> {
  const count = await prisma.match.count({
    where: { stageId: `${prefix}_PO_LB_R2`, season, team1: { region } },
  });
  if (count > 0) return;

  const sf = await prisma.match.findMany({
    where: { stageId: `${prefix}_PO_UB_SF`, season, team1: { region }, isPlayed: true },
    orderBy: { day: "asc" },
  });
  const lbR1 = await prisma.match.findMany({
    where: { stageId: `${prefix}_PO_LB_R1`, season, team1: { region }, isPlayed: true },
    orderBy: { day: "asc" },
  });
  // Need both SF matches + both LB R1 matches played
  if (sf.length < 2 || lbR1.length < 2) return;

  const sf1Loser = sf[0].winnerId === sf[0].team1Id ? sf[0].team2Id : sf[0].team1Id;
  const sf2Loser = sf[1].winnerId === sf[1].team1Id ? sf[1].team2Id : sf[1].team1Id;
  const lbR1Winner1 = lbR1[0].winnerId!;
  const lbR1Winner2 = lbR1[1].winnerId!;
  // Cross-bracket to avoid immediate rematch: W(LB R1-1) vs L(UB SF2), W(LB R1-2) vs L(UB SF1)
  await createMatchesOnNextSlots(
    prisma,
    [[lbR1Winner1, sf2Loser], [lbR1Winner2, sf1Loser]],
    `${prefix}_PO_LB_R2`, region, currentDay, season, "BO3",
  );
}

/**
 * Get top N teams from a regional stage by number of match wins.
 */
async function getStageTopTeams(
  prisma: PrismaClient, region: Region, season: number, stageId: string, count: number,
): Promise<string[]> {
  // For STAGE_1/STAGE_2 we qualify via playoffs bracket:
  //   #1 = UB Final winner
  //   #2 = Grand Final winner
  //   #3 = Grand Final loser (= 3rd place)
  if (stageId === "STAGE_1" || stageId === "STAGE_2") {
    const ubFinal = await prisma.match.findFirst({
      where: { stageId: `${stageId}_PO_UB_FINAL`, season, isPlayed: true, team1: { region } },
    });
    const gf = await prisma.match.findFirst({
      where: { stageId: `${stageId}_PO_GF`, season, isPlayed: true, team1: { region } },
    });

    const qualified: string[] = [];
    if (ubFinal?.winnerId) qualified.push(ubFinal.winnerId);
    if (gf?.winnerId) qualified.push(gf.winnerId);
    if (gf) {
      const gfLoser = gf.winnerId === gf.team1Id ? gf.team2Id : gf.team1Id;
      if (!qualified.includes(gfLoser)) qualified.push(gfLoser);
    }

    if (qualified.length >= count) return qualified.slice(0, count);

    // Fallback: if playoffs incomplete, just return qualified so far + fill with group leaders
    const grpMatches = await prisma.match.findMany({
      where: {
        season,
        isPlayed: true,
        team1: { region },
        OR: [
          { stageId: `${stageId}_ALPHA` },
          { stageId: `${stageId}_OMEGA` },
        ],
      },
      select: { winnerId: true },
    });
    const winMap = new Map<string, number>();
    for (const m of grpMatches) if (m.winnerId) winMap.set(m.winnerId, (winMap.get(m.winnerId) ?? 0) + 1);
    const topByWins = [...winMap.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    for (const id of topByWins) {
      if (!qualified.includes(id)) qualified.push(id);
      if (qualified.length >= count) break;
    }
    return qualified.slice(0, count);
  }

  // Fallback: old win-count logic for other stages
  const matches = await prisma.match.findMany({
    where: { stageId, season, isPlayed: true, team1: { region } },
    select: { winnerId: true },
  });

  const winCounts = new Map<string, number>();
  for (const m of matches) {
    if (m.winnerId) {
      winCounts.set(m.winnerId, (winCounts.get(m.winnerId) ?? 0) + 1);
    }
  }

  const matches2 = await prisma.match.findMany({
    where: { stageId, season, isPlayed: true, team2: { region } },
    select: { winnerId: true },
  });
  for (const m of matches2) {
    if (m.winnerId) {
      winCounts.set(m.winnerId, (winCounts.get(m.winnerId) ?? 0) + 1);
    }
  }

  return [...winCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([id]) => id);
}

// ══════════════════════════════════════════════════════════════
// ── EWC / Champions (International Swiss + Double Elim) ──
// ══════════════════════════════════════════════════════════════

/**
 * Initialize EWC or Champions following Swiss + double-elim format.
 * Uses the same logic as Masters but may have different team counts.
 */
export async function initializeInternationalEvent(
  prisma: PrismaClient,
  seasonNumber: number,
  stagePrefix: string, // "EWC" or "CHAMPIONS"
  teamsPerRegion: number,
  qualifyingStageId: string, // previous stage to pull qualifiers from
): Promise<{ matchesScheduled: number }> {
  // Check if already initialized
  const existing = await prisma.match.count({
    where: { stageId: { startsWith: `${stagePrefix}_SWISS` }, season: seasonNumber },
  });
  if (existing > 0) return { matchesScheduled: 0 };

  const qualifiedTeams: { teamId: string; region: Region; seed: number }[] = [];

  for (const region of ALL_REGIONS) {
    const teamIds = await getStageTopTeams(prisma, region, seasonNumber, qualifyingStageId, teamsPerRegion);
    teamIds.forEach((id, idx) => {
      qualifiedTeams.push({ teamId: id, region, seed: idx + 1 });
    });
  }

  const totalTeams = qualifiedTeams.length;
  if (totalTeams < 4) return { matchesScheduled: 0 };

  // Sort by seed
  const sorted = [...qualifiedTeams].sort((a, b) => a.seed - b.seed || ALL_REGIONS.indexOf(a.region) - ALL_REGIONS.indexOf(b.region));

  // Create Swiss R1 pairs (top vs bottom seeding)
  const pairs: [string, string][] = [];
  const half = Math.floor(sorted.length / 2);
  for (let i = 0; i < half; i++) {
    pairs.push([sorted[i].teamId, sorted[sorted.length - 1 - i].teamId]);
  }

  const lastMatch = await prisma.match.findFirst({
    where: { season: seasonNumber },
    orderBy: { day: "desc" },
  });
  const afterDay = lastMatch?.day ?? 0;

  await createMatchesOnInternationalSlots(
    prisma, pairs, `${stagePrefix}_SWISS_R1`, afterDay, seasonNumber,
  );

  return { matchesScheduled: pairs.length };
}

// ══════════════════════════════════════════════════════════════
// ── Meta patch generation ──
// ══════════════════════════════════════════════════════════════

/**
 * Generate a MetaPatch record for the transition into a new stage.
 * Picks 2-3 buffs + 2-3 nerfs, avoiding agents touched in the previous 1-2 patches.
 */
export async function generateMetaPatch(
  prisma: PrismaClient,
  seasonNumber: number,
  stage: string,
): Promise<{ buffs: string[]; nerfs: string[] } | null> {
  // Idempotent — skip if patch already exists for this stage
  const existing = await prisma.metaPatch.findFirst({
    where: { season: seasonNumber, stage },
  });
  if (existing) {
    const buffs = Array.isArray(existing.buffs) ? (existing.buffs as string[]) : [];
    const nerfs = Array.isArray(existing.nerfs) ? (existing.nerfs as string[]) : [];
    applyPatchToMeta(buffs, nerfs);
    return { buffs, nerfs };
  }

  const recentPatches = await prisma.metaPatch.findMany({
    orderBy: [{ season: "desc" }, { createdAt: "desc" }],
    take: 2,
  });
  const recentlyChanged = new Set<string>();
  for (const p of recentPatches) {
    const buffs = Array.isArray(p.buffs) ? (p.buffs as string[]) : [];
    const nerfs = Array.isArray(p.nerfs) ? (p.nerfs as string[]) : [];
    for (const n of buffs) recentlyChanged.add(n);
    for (const n of nerfs) recentlyChanged.add(n);
  }

  const pool = VALORANT_AGENTS.map((a) => a.name).filter((n) => !recentlyChanged.has(n));
  const candidates = pool.length >= 6 ? pool : VALORANT_AGENTS.map((a) => a.name);

  function shuffleArr<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }

  const shuffled = shuffleArr(candidates);
  const buffCount = 2 + Math.floor(Math.random() * 2); // 2-3
  const nerfCount = 2 + Math.floor(Math.random() * 2); // 2-3
  const buffs = shuffled.slice(0, buffCount);
  const nerfs = shuffled.slice(buffCount, buffCount + nerfCount);

  await prisma.metaPatch.create({
    data: {
      season: seasonNumber,
      stage,
      buffs,
      nerfs,
    },
  });

  applyPatchToMeta(buffs, nerfs);
  return { buffs, nerfs };
}

// ══════════════════════════════════════════════════════════════
// ── Off-season roll-over ──
// ══════════════════════════════════════════════════════════════

const OFFSEASON_FIRST_NAMES = [
  "Alex", "Kai", "Leo", "Mateo", "Jin", "Ren", "Hugo", "Luka", "Mika",
  "Tomi", "Finn", "Rio", "Sho", "Nico", "Dylan", "Emre", "Yuto", "Arjun",
  "Lucas", "Oliver", "Marcos", "Pedro", "Rafa", "Sven", "Theo", "Viktor",
];
const OFFSEASON_LAST_NAMES = [
  "Silva", "Lee", "Kim", "Park", "Nakamura", "Kowalski", "Santos", "Muller",
  "Dubois", "Rossi", "Fernandes", "Novak", "Tanaka", "Yamamoto", "Ivanov",
  "Martinez", "Chen", "Wang", "Singh", "Patel", "Costa", "Reyes",
];
const OFFSEASON_NATIONALITIES: Record<string, string[]> = {
  EMEA: ["FR", "DE", "ES", "GB", "PL", "TR", "SE", "NO", "FI", "IT"],
  Americas: ["US", "BR", "CA", "MX", "AR", "CL"],
  Pacific: ["KR", "JP", "ID", "TH", "PH", "SG", "AU"],
  China: ["CN"],
};
const OFFSEASON_ROLES = ["Duelist", "Initiator", "Sentinel", "Controller", "IGL"] as const;
const OFFSEASON_REGIONS: Region[] = ["EMEA", "Americas", "Pacific", "China"];

function offseasonRandFloat(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
function offseasonRandInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function offseasonRound2(n: number): number {
  return Math.round(n * 100) / 100;
}
function offseasonCalcSalary(acs: number, kd: number, adr: number, kast: number): number {
  return Math.round(5000 + acs * 20 + kd * 3000 + adr * 10 + kast * 50);
}

/**
 * Roll the league into a new season.
 *   - bump season number, reset stage to KICKOFF, day=1, week=1
 *   - age all players +1
 *   - retire old underperformers
 *   - generate 20-40 rookie free agents
 *   - reset wins/losses/champPts on all teams
 *   - refresh map pool
 *   - reinitialize Kickoff bracket across existing AI teams
 */
export async function rollOffSeason(
  prisma: PrismaClient,
  seasonId: string,
  currentSeasonNumber: number,
): Promise<{
  newSeasonNumber: number;
  retiredCount: number;
  rookiesCreated: number;
  matchesScheduled: number;
}> {
  const newSeasonNumber = currentSeasonNumber + 1;

  // 1) Age all players
  await prisma.player.updateMany({ data: { age: { increment: 1 } } });

  // 2) Retire old underperformers
  const toRetire = await prisma.player.findMany({
    where: { age: { gte: 32 }, acs: { lt: 200 }, isRetired: false },
    select: { id: true },
  });
  if (toRetire.length > 0) {
    await prisma.player.updateMany({
      where: { id: { in: toRetire.map((p) => p.id) } },
      data: { isRetired: true, isActive: false, teamId: null, currentTeam: null },
    });
  }

  // 3) Generate rookies
  const rookieTarget = 20 + Math.floor(Math.random() * 21);
  let rookiesCreated = 0;
  for (let i = 0; i < rookieTarget; i++) {
    const region = OFFSEASON_REGIONS[i % OFFSEASON_REGIONS.length];
    const nationality =
      OFFSEASON_NATIONALITIES[region][
        Math.floor(Math.random() * OFFSEASON_NATIONALITIES[region].length)
      ];
    const firstName = OFFSEASON_FIRST_NAMES[Math.floor(Math.random() * OFFSEASON_FIRST_NAMES.length)];
    const lastName = OFFSEASON_LAST_NAMES[Math.floor(Math.random() * OFFSEASON_LAST_NAMES.length)];
    const role = OFFSEASON_ROLES[i % OFFSEASON_ROLES.length];
    const age = offseasonRandInt(17, 20);
    const acs = offseasonRound2(offseasonRandFloat(160, 235));
    const kd = offseasonRound2(offseasonRandFloat(0.80, 1.20));
    const adr = offseasonRound2(offseasonRandFloat(120, 165));
    const kast = offseasonRound2(offseasonRandFloat(60, 75));
    const hs = offseasonRound2(offseasonRandFloat(18, 30));
    const salary = offseasonCalcSalary(acs, kd, adr, kast);
    const ign = `${firstName}${offseasonRandInt(10, 99)}`;

    await prisma.player.create({
      data: {
        ign,
        firstName,
        lastName,
        nationality,
        age,
        role,
        region,
        tier: "VCL",
        salary,
        acs,
        kd,
        adr,
        kast,
        hs,
        imageUrl: `https://placehold.co/200x200/16161E/ECE8E1?text=${encodeURIComponent(ign)}`,
        isActive: true,
        isRetired: false,
        contractEndSeason: newSeasonNumber + 1,
        contractEndWeek: 52,
      },
    });
    rookiesCreated++;
  }

  // 4) Reset team stats
  await prisma.team.updateMany({
    data: { wins: 0, losses: 0, champPts: 0, lastTrainedWeek: 0 },
  });

  // 5) Bump season to a fresh KICKOFF
  await prisma.season.update({
    where: { id: seasonId },
    data: {
      number: newSeasonNumber,
      currentStage: "KICKOFF",
      currentDay: 1,
      currentWeek: 1,
    },
  });

  // 6) Refresh map pool for the new season
  await prisma.mapPool.updateMany({ data: { isActive: false } });
  const kickoffPoolKey = STAGE_MAP_POOL.KICKOFF ?? "POOL_A";
  await prisma.mapPool.create({
    data: {
      season: newSeasonNumber,
      patchId: `${newSeasonNumber}.0`,
      maps: (MAP_POOLS[kickoffPoolKey] ?? MAP_POOLS.POOL_A) as unknown as import("@/generated/prisma/client").Prisma.InputJsonValue,
      isActive: true,
    },
  });

  // 7) Generate the new season's Kickoff patch
  await generateMetaPatch(prisma, newSeasonNumber, "KICKOFF");

  // 8) Re-initialize the Kickoff bracket for all regions
  const allTeams = await prisma.team.findMany({ select: { id: true, name: true, region: true } });
  const teamsByRegion = new Map<Region, { id: string; name: string }[]>();
  for (const t of allTeams) {
    const list = teamsByRegion.get(t.region) ?? [];
    list.push({ id: t.id, name: t.name });
    teamsByRegion.set(t.region, list);
  }

  let totalScheduled = 0;
  for (const region of OFFSEASON_REGIONS) {
    const seed = KICKOFF_SEEDS[region];
    const nameToId = new Map((teamsByRegion.get(region) ?? []).map((t) => [t.name, t.id]));
    const pairs = seed.round1Matchups
      .map(([a, b]) => [nameToId.get(a), nameToId.get(b)] as [string | undefined, string | undefined])
      .filter((pair): pair is [string, string] => !!pair[0] && !!pair[1]);

    const data = pairs.map(([team1Id, team2Id]) => ({
      team1Id,
      team2Id,
      stageId: "KICKOFF_UB_R1",
      format: "BO3" as MatchFormat,
    }));
    const scheduled = assignDaysWeek(data, region, 1, newSeasonNumber);
    if (scheduled.length > 0) {
      await prisma.match.createMany({ data: scheduled });
      totalScheduled += scheduled.length;
    }
  }

  return {
    newSeasonNumber,
    retiredCount: toRetire.length,
    rookiesCreated,
    matchesScheduled: totalScheduled,
  };
}

// ─────────────────────────────────────────────────────────────
// MULTI-SAVE BOOTSTRAP (stub)
// ─────────────────────────────────────────────────────────────
// Minimal save world initializer. Creates Save's initial Season, clones AI teams
// from VctTeamTemplate, creates the user's team. Players/schedule/sponsors are
// TODO — they'll need to be populated by follow-up work that scopes everything
// by saveId. For now this is enough to let a new save exist without crashes.
/**
 * Full save bootstrap: Season + per-save teams (cloned from VctTeamTemplate)
 * + per-save players (cloned from the global "template" player pool which the
 * pandascore seed populated) + Kickoff bracket scheduled for Week 1.
 */
export async function initializeSaveWorld(
  prisma: PrismaClient,
  saveId: string,
  input: { teamName: string; teamTag: string; region: Region },
): Promise<void> {
  const save = await prisma.save.findUnique({ where: { id: saveId } });
  if (!save) throw new Error("Save not found");

  // 1. Season record for this save
  await prisma.season.create({
    data: {
      saveId,
      number: 1,
      year: 2026,
      currentStage: "KICKOFF",
      currentDay: 1,
      currentWeek: 1,
    },
  });

  // 2. User's team — create it from VctTeamTemplate preset if the name matches,
  //    else from the user's custom inputs.
  const userTemplate = await prisma.vctTeamTemplate.findFirst({
    where: { name: input.teamName },
  });
  // Verify the user actually exists (session could be stale after manual delete).
  const userExists = await prisma.user.findUnique({ where: { id: save.userId } });
  const userTeam = await prisma.team.create({
    data: {
      saveId,
      // Only set userId if the User row exists — otherwise FK constraint fails.
      // isPlayerTeam=true is the authoritative flag for "user's team in this save".
      userId: userExists ? save.userId : undefined,
      isPlayerTeam: true,
      name: input.teamName,
      tag: input.teamTag,
      region: input.region,
      logoUrl: userTemplate?.logoUrl,
      budget: userTemplate?.budget ?? 1_000_000,
      prestige: userTemplate?.prestige ?? 50,
    },
  });

  // 3. Clone AI teams from VctTeamTemplate (bulk insert for speed).
  //    createMany doesn't return IDs — so we bulk-create then re-query to map name→id.
  const templates = await prisma.vctTeamTemplate.findMany();
  const aiTemplates = templates.filter((t) => t.name !== input.teamName);
  if (aiTemplates.length > 0) {
    await prisma.team.createMany({
      data: aiTemplates.map((t) => ({
        saveId,
        isPlayerTeam: false,
        name: t.name,
        tag: t.tag,
        region: t.region,
        logoUrl: t.logoUrl,
        budget: t.budget,
        prestige: t.prestige,
      })),
    });
  }
  const allSaveTeams = await prisma.team.findMany({
    where: { saveId },
    select: { id: true, name: true },
  });
  const savedTeamByName = new Map<string, string>();
  for (const t of allSaveTeams) savedTeamByName.set(t.name, t.id);

  // 4. Clone players from the global "template" pool (seeded by pandascore).
  //    Template players have teamId=null (unassigned) and `currentTeam` set to
  //    their real-life team name. We clone them per save, mapping `currentTeam`
  //    name → the save's new Team.id. Filter by teamId=null so we DON'T pick up
  //    players from other saves that already have a teamId.
  const globalPlayers = await prisma.player.findMany({
    where: {
      teamId: null,
      currentTeam: { not: null },
      isRetired: false,
    },
  });
  const playerCloneData = globalPlayers
    .map((p) => {
      const teamId = p.currentTeam ? savedTeamByName.get(p.currentTeam) : null;
      if (!teamId) return null;
      return {
        ign: p.ign,
        firstName: p.firstName,
        lastName: p.lastName,
        nationality: p.nationality,
        age: p.age,
        role: p.role,
        leadershipRole: p.leadershipRole,
        imageUrl: p.imageUrl,
        currentTeam: p.currentTeam,
        region: p.region,
        tier: p.tier,
        salary: p.salary,
        acs: p.acs,
        kd: p.kd,
        adr: p.adr,
        kast: p.kast,
        hs: p.hs,
        mapFactors: p.mapFactors as object,
        teamId,
        contractEndSeason: p.contractEndSeason,
        contractEndWeek: p.contractEndWeek,
        buyoutClause: p.buyoutClause,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (playerCloneData.length > 0) {
    await prisma.player.createMany({ data: playerCloneData });
  }

  // 5. Kickoff bracket — schedule R1 matches per region using the KICKOFF_SEEDS
  //    pairings (same as single-save initializeSeasonForTeam).
  let totalMatches = 0;
  for (const region of ALL_REGIONS) {
    const seed = KICKOFF_SEEDS[region];
    const pairs: [string, string][] = seed.round1Matchups
      .map(([a, b]) => [savedTeamByName.get(a), savedTeamByName.get(b)] as [string | undefined, string | undefined])
      .filter((p): p is [string, string] => !!p[0] && !!p[1]);
    const data = pairs.map(([team1Id, team2Id]) => ({
      saveId,
      team1Id,
      team2Id,
      stageId: "KICKOFF_UB_R1",
      format: "BO3" as MatchFormat,
    }));
    const scheduled = assignDaysWeek(data, region, 1, 1);
    if (scheduled.length > 0) {
      await prisma.match.createMany({ data: scheduled });
      totalMatches += scheduled.length;
    }
  }
  void totalMatches;
}
