import { PrismaClient } from "@/generated/prisma/client";
import type { MatchFormat, Region } from "@/generated/prisma/client";

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
