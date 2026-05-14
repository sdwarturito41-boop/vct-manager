import type { PrismaClient, MatchFormat, Region } from "@/generated/prisma/client";

/**
 * EWC Qualifier — Stage 1 + Stage 2 par région.
 *
 * **Stage 1 Qualifier** (joué pendant les playoffs VCT Stage 1, Mon-Tue) :
 *   4 équipes = bottom 2 de chaque groupe Alpha/Omega (ranks 9-12 du Stage 1)
 *
 *   UB R1:  GA #6 vs GB #5  (match 1)
 *           GA #5 vs GB #6  (match 2)
 *   UB F:   winner M1 vs winner M2  → QUAL 1 (va au Stage 2)
 *   LB R1:  loser M1 vs loser M2
 *   LB F:   winner LB R1 vs loser UB F  → QUAL 2 (va au Stage 2)
 *
 *   Stage IDs:
 *     EWC_QUAL_S1_UB_R1
 *     EWC_QUAL_S1_UB_FINAL
 *     EWC_QUAL_S1_LB_R1
 *     EWC_QUAL_S1_LB_FINAL
 *
 * **Stage 2 Qualifier** (semaine après fin VCT Stage 1 régional, Mon-Tue) :
 *   8 équipes = top 1, 2, 5, 6, 7, 8 du VCT Stage 1 + QUAL 1, QUAL 2
 *
 *   UB R1:  VCT 2 vs QUAL 1
 *           top 8 vs top 5
 *           top 7 vs top 6
 *           VCT 1 vs QUAL 2
 *   UB R2:  winners en cross-bracket  → 2 EWC qualifiers
 *   LB:     loser path → 1 EWC qualifier supplémentaire
 *
 *   Total : 3 EWC qualifiers par région.
 *
 *   Stage IDs:
 *     EWC_QUAL_S2_UB_R1, EWC_QUAL_S2_UB_R2 (= UB SF/F en pratique)
 *     EWC_QUAL_S2_LB_R1, EWC_QUAL_S2_LB_R2, EWC_QUAL_S2_LB_FINAL
 *
 *   ⚠️ Stage 2 Qualifier scheduler à finaliser (V2.1) — voir stub plus bas.
 */

const QUAL_S1_BO: MatchFormat = "BO3";
const QUAL_S2_BO: MatchFormat = "BO3";
const QUAL_S2_FINAL_BO: MatchFormat = "BO5";

/**
 * Bottom 2 d'un groupe (sorted by wins ASC, losses DESC).
 * Renvoie les IDs des équipes 5e et 6e (= "avant-dernier" et "dernier").
 */
function computeBottom2(matches: Array<{ team1Id: string; team2Id: string; winnerId: string | null }>): {
  fifth: string | null;
  sixth: string | null;
} {
  const recs = new Map<string, { wins: number; played: number }>();
  const participants = new Set<string>();
  for (const m of matches) {
    participants.add(m.team1Id);
    participants.add(m.team2Id);
    for (const t of [m.team1Id, m.team2Id]) {
      const r = recs.get(t) ?? { wins: 0, played: 0 };
      r.played++;
      if (m.winnerId === t) r.wins++;
      recs.set(t, r);
    }
  }
  // Sort: most wins first, fewer losses tiebreak. Bottom 2 = last 2.
  const ranked = [...participants].sort((a, b) => {
    const ra = recs.get(a) ?? { wins: 0, played: 0 };
    const rb = recs.get(b) ?? { wins: 0, played: 0 };
    return rb.wins - ra.wins;
  });
  return {
    fifth: ranked[ranked.length - 2] ?? null,
    sixth: ranked[ranked.length - 1] ?? null,
  };
}

/**
 * Initialise le Stage 1 Qualifier pour UNE région. Appelé après que le
 * group stage VCT soit complet (Alpha + Omega tous joués). Crée les 2
 * matchs UB R1 ; les rounds suivants sont créés par progression.
 */
export async function initializeEwcQualifierS1(
  prisma: PrismaClient,
  saveId: string,
  region: Region,
  season: number,
  currentDay: number,
): Promise<{ matchesScheduled: number }> {
  // Vérif idempotence
  const existing = await prisma.match.count({
    where: { saveId, stageId: { startsWith: "EWC_QUAL_S1_" }, season, team1: { region } },
  });
  if (existing > 0) return { matchesScheduled: 0 };

  // Récupère les matchs group stage de la région
  const [alpha, omega] = await Promise.all([
    prisma.match.findMany({
      where: { saveId, stageId: "STAGE_1_ALPHA", season, team1: { region } },
      select: { team1Id: true, team2Id: true, winnerId: true, isPlayed: true },
    }),
    prisma.match.findMany({
      where: { saveId, stageId: "STAGE_1_OMEGA", season, team1: { region } },
      select: { team1Id: true, team2Id: true, winnerId: true, isPlayed: true },
    }),
  ]);
  if (alpha.length === 0 || omega.length === 0) return { matchesScheduled: 0 };
  if (alpha.some((m) => !m.isPlayed) || omega.some((m) => !m.isPlayed)) {
    return { matchesScheduled: 0 };
  }

  const alphaBottom = computeBottom2(alpha);
  const omegaBottom = computeBottom2(omega);
  if (!alphaBottom.fifth || !alphaBottom.sixth || !omegaBottom.fifth || !omegaBottom.sixth) {
    return { matchesScheduled: 0 };
  }

  // Imports relatifs au runtime pour éviter circular import
  const { dayOfWeek } = await import("@/lib/game-date");
  const { stageStartDay } = await import("@/constants/vct-calendar");

  // Anchor sur le calendar day EWC_QUALIFIER ou fallback "next Mon après currentDay"
  const calendarStart = stageStartDay("EWC_QUALIFIER", region);
  const anchor = Math.max(calendarStart ?? currentDay + 1, currentDay + 1);

  // Trouve le prochain Mon (dayOfWeek=1) à partir de l'anchor
  let monday = anchor;
  while (dayOfWeek(monday) !== 1) monday++;

  // Schedule UB R1 — les 2 matchs MÊME jour (Mon). Les équipes sont
  // éliminées du group stage, pas de conflit VCT.
  const matchesToCreate = [
    {
      saveId,
      team1Id: alphaBottom.sixth,
      team2Id: omegaBottom.fifth,
      stageId: "EWC_QUAL_S1_UB_R1",
      format: QUAL_S1_BO,
      day: monday,
      week: Math.ceil(monday / 7),
      season,
    },
    {
      saveId,
      team1Id: alphaBottom.fifth,
      team2Id: omegaBottom.sixth,
      stageId: "EWC_QUAL_S1_UB_R1",
      format: QUAL_S1_BO,
      day: monday,
      week: Math.ceil(monday / 7),
      season,
    },
  ];
  await prisma.match.createMany({ data: matchesToCreate });
  return { matchesScheduled: 2 };
}

/**
 * Progression du Stage 1 Qualifier : appelé après chaque round complet
 * de la région. Crée le round suivant en fonction du round qui vient
 * de se terminer.
 */
export async function progressEwcQualifierS1(
  prisma: PrismaClient,
  saveId: string,
  completedStageId: string,
  region: Region,
  season: number,
  currentDay: number,
): Promise<void> {
  async function exists(stage: string): Promise<boolean> {
    const c = await prisma.match.count({
      where: { saveId, stageId: stage, season, team1: { region } },
    });
    return c > 0;
  }

  async function getRoundResults(stage: string): Promise<Array<{ winnerId: string; loserId: string }>> {
    const rows = await prisma.match.findMany({
      where: { saveId, stageId: stage, season, isPlayed: true, team1: { region } },
      select: { team1Id: true, team2Id: true, winnerId: true },
      orderBy: { day: "asc" },
    });
    return rows
      .filter((r) => r.winnerId)
      .map((r) => ({
        winnerId: r.winnerId!,
        loserId: r.winnerId === r.team1Id ? r.team2Id : r.team1Id,
      }));
  }

  // UB R1 done → create UB F + LB R1 LE MÊME JOUR (lendemain UB R1)
  if (completedStageId === "EWC_QUAL_S1_UB_R1") {
    const ubR1 = await getRoundResults("EWC_QUAL_S1_UB_R1");
    if (ubR1.length < 2) return;

    const day = currentDay + 1; // Tue (compressé)
    if (!(await exists("EWC_QUAL_S1_UB_FINAL"))) {
      await prisma.match.create({
        data: {
          saveId,
          team1Id: ubR1[0].winnerId,
          team2Id: ubR1[1].winnerId,
          stageId: "EWC_QUAL_S1_UB_FINAL",
          format: QUAL_S1_BO,
          day,
          week: Math.ceil(day / 7),
          season,
        },
      });
    }
    if (!(await exists("EWC_QUAL_S1_LB_R1"))) {
      await prisma.match.create({
        data: {
          saveId,
          team1Id: ubR1[0].loserId,
          team2Id: ubR1[1].loserId,
          stageId: "EWC_QUAL_S1_LB_R1",
          format: QUAL_S1_BO,
          day, // même jour que UB Final, équipes différentes
          week: Math.ceil(day / 7),
          season,
        },
      });
    }
  }

  // UB FINAL + LB R1 done → create LB FINAL le lendemain (Wed)
  if (completedStageId === "EWC_QUAL_S1_UB_FINAL" || completedStageId === "EWC_QUAL_S1_LB_R1") {
    const ubF = await getRoundResults("EWC_QUAL_S1_UB_FINAL");
    const lbR1 = await getRoundResults("EWC_QUAL_S1_LB_R1");
    if (ubF.length < 1 || lbR1.length < 1) return;
    if (await exists("EWC_QUAL_S1_LB_FINAL")) return;

    const lbFinalDay = currentDay + 1; // Wed (compressé, 3 jours total)
    await prisma.match.create({
      data: {
        saveId,
        team1Id: lbR1[0].winnerId,
        team2Id: ubF[0].loserId,
        stageId: "EWC_QUAL_S1_LB_FINAL",
        format: QUAL_S1_BO,
        day: lbFinalDay,
        week: Math.ceil(lbFinalDay / 7),
        season,
      },
    });
  }
}

/**
 * Récupère les 2 qualifiés du Stage 1 Qualifier d'une région :
 *   QUAL 1 = winner UB Final
 *   QUAL 2 = winner LB Final
 * Renvoie null si pas encore complet.
 */
export async function getEwcQualifierS1Winners(
  prisma: PrismaClient,
  saveId: string,
  region: Region,
  season: number,
): Promise<{ qual1: string; qual2: string } | null> {
  const [ubF, lbF] = await Promise.all([
    prisma.match.findFirst({
      where: { saveId, stageId: "EWC_QUAL_S1_UB_FINAL", season, isPlayed: true, team1: { region } },
      select: { winnerId: true },
    }),
    prisma.match.findFirst({
      where: { saveId, stageId: "EWC_QUAL_S1_LB_FINAL", season, isPlayed: true, team1: { region } },
      select: { winnerId: true },
    }),
  ]);
  if (!ubF?.winnerId || !lbF?.winnerId) return null;
  return { qual1: ubF.winnerId, qual2: lbF.winnerId };
}

// ──────────────────────────────────────────────────────────────────────
// Stage 2 Qualifier — 8 teams double elim, top 3 → EWC main
// ──────────────────────────────────────────────────────────────────────

/**
 * Récupère les 8 seeds Stage 2 Qualifier pour une région : top 1, 2, 5, 6, 7, 8
 * du VCT Stage 1 (calculé par wins globales group stage) + QUAL 1 et QUAL 2
 * issus du Stage 1 Qualifier.
 *
 * Ranks 3 et 4 sont skipped — ils sont allés à Masters London.
 */
async function getEwcQualifierS2Seeds(
  prisma: PrismaClient,
  saveId: string,
  region: Region,
  season: number,
): Promise<{
  vct1: string;
  vct2: string;
  top5: string;
  top6: string;
  top7: string;
  top8: string;
  qual1: string;
  qual2: string;
} | null> {
  // Standings overall = wins cumulés sur ALPHA + OMEGA
  const groupMatches = await prisma.match.findMany({
    where: {
      saveId, season,
      OR: [{ stageId: "STAGE_1_ALPHA" }, { stageId: "STAGE_1_OMEGA" }],
      team1: { region },
      isPlayed: true,
    },
    select: { team1Id: true, team2Id: true, winnerId: true },
  });
  if (groupMatches.length === 0) return null;

  const winMap = new Map<string, number>();
  const participants = new Set<string>();
  for (const m of groupMatches) {
    participants.add(m.team1Id);
    participants.add(m.team2Id);
    if (m.winnerId) winMap.set(m.winnerId, (winMap.get(m.winnerId) ?? 0) + 1);
  }
  const ranked = [...participants].sort(
    (a, b) => (winMap.get(b) ?? 0) - (winMap.get(a) ?? 0),
  );
  if (ranked.length < 8) return null; // pas assez d'équipes

  // QUAL 1 = UB Final winner, QUAL 2 = LB Final winner du S1 Qualifier
  const qualifiers = await getEwcQualifierS1Winners(prisma, saveId, region, season);
  if (!qualifiers) return null;

  return {
    vct1: ranked[0],
    vct2: ranked[1],
    // skip ranks 3, 4 (= Masters London bound)
    top5: ranked[4],
    top6: ranked[5],
    top7: ranked[6],
    top8: ranked[7],
    qual1: qualifiers.qual1,
    qual2: qualifiers.qual2,
  };
}

/**
 * Initialise le Stage 2 Qualifier pour UNE région. Joué après le Stage 1
 * Qualifier (LB Final terminé). 8 équipes, format double élim, top 3 → EWC.
 *
 * UB R1 (Mon, 4 matchs) :
 *   M1: VCT 2 vs QUAL 1
 *   M2: top 8 vs top 5
 *   M3: top 7 vs top 6
 *   M4: VCT 1 vs QUAL 2
 *
 * Crée UB R1 seulement ; les rounds suivants progressent via
 * `progressEwcQualifierS2`.
 */
export async function initializeEwcQualifierS2(
  prisma: PrismaClient,
  saveId: string,
  region: Region,
  season: number,
  currentDay: number,
): Promise<{ matchesScheduled: number }> {
  const existing = await prisma.match.count({
    where: { saveId, stageId: { startsWith: "EWC_QUAL_S2_" }, season, team1: { region } },
  });
  if (existing > 0) return { matchesScheduled: 0 };

  const seeds = await getEwcQualifierS2Seeds(prisma, saveId, region, season);
  if (!seeds) return { matchesScheduled: 0 };

  const { dayOfWeek } = await import("@/lib/game-date");

  // Anchor : prochain lundi après currentDay
  let monday = currentDay + 1;
  while (dayOfWeek(monday) !== 1) monday++;

  const matches = [
    { team1Id: seeds.vct2, team2Id: seeds.qual1 },
    { team1Id: seeds.top8, team2Id: seeds.top5 },
    { team1Id: seeds.top7, team2Id: seeds.top6 },
    { team1Id: seeds.vct1, team2Id: seeds.qual2 },
  ].map((p) => ({
    saveId,
    team1Id: p.team1Id,
    team2Id: p.team2Id,
    stageId: "EWC_QUAL_S2_UB_R1",
    format: QUAL_S2_BO,
    day: monday,
    week: Math.ceil(monday / 7),
    season,
  }));
  await prisma.match.createMany({ data: matches });
  return { matchesScheduled: matches.length };
}

/**
 * Progression du Stage 2 Qualifier — 8 teams double elim, all 11 matches:
 *   UB R1 → UB R2 (2 matchs) + LB R1 (2 matchs)
 *   UB R2 done → les 2 winners qualifient EWC, losers tombent en LB R2
 *   LB R1 done → si UB R2 done aussi → LB R2 (cross-bracket)
 *   LB R2 done → LB Final → winner qualifie EWC
 *
 * Total : 3 EWC qualifiers par région (UB R2 winners x2 + LB Final winner).
 */
export async function progressEwcQualifierS2(
  prisma: PrismaClient,
  saveId: string,
  completedStageId: string,
  region: Region,
  season: number,
  currentDay: number,
): Promise<void> {
  async function exists(stage: string): Promise<boolean> {
    const c = await prisma.match.count({
      where: { saveId, stageId: stage, season, team1: { region } },
    });
    return c > 0;
  }

  async function getResults(stage: string) {
    const rows = await prisma.match.findMany({
      where: { saveId, stageId: stage, season, isPlayed: true, team1: { region } },
      select: { team1Id: true, team2Id: true, winnerId: true },
      orderBy: { day: "asc" },
    });
    return rows
      .filter((r) => r.winnerId)
      .map((r) => ({
        winnerId: r.winnerId!,
        loserId: r.winnerId === r.team1Id ? r.team2Id : r.team1Id,
      }));
  }

  // UB R1 done → UB R2 (2 matchs winners cross) + LB R1 (2 matchs losers paired)
  if (completedStageId === "EWC_QUAL_S2_UB_R1") {
    const ubR1 = await getResults("EWC_QUAL_S2_UB_R1");
    if (ubR1.length < 4) return;

    if (!(await exists("EWC_QUAL_S2_UB_R2"))) {
      // Cross-bracket : W(M1) vs W(M2), W(M3) vs W(M4)
      await prisma.match.createMany({
        data: [
          {
            saveId,
            team1Id: ubR1[0].winnerId,
            team2Id: ubR1[1].winnerId,
            stageId: "EWC_QUAL_S2_UB_R2",
            format: QUAL_S2_BO,
            day: currentDay + 1,
            week: Math.ceil((currentDay + 1) / 7),
            season,
          },
          {
            saveId,
            team1Id: ubR1[2].winnerId,
            team2Id: ubR1[3].winnerId,
            stageId: "EWC_QUAL_S2_UB_R2",
            format: QUAL_S2_BO,
            day: currentDay + 1,
            week: Math.ceil((currentDay + 1) / 7),
            season,
          },
        ],
      });
    }
    if (!(await exists("EWC_QUAL_S2_LB_R1"))) {
      // Losers paired : L(M1) vs L(M2), L(M3) vs L(M4)
      await prisma.match.createMany({
        data: [
          {
            saveId,
            team1Id: ubR1[0].loserId,
            team2Id: ubR1[1].loserId,
            stageId: "EWC_QUAL_S2_LB_R1",
            format: QUAL_S2_BO,
            day: currentDay + 1,
            week: Math.ceil((currentDay + 1) / 7),
            season,
          },
          {
            saveId,
            team1Id: ubR1[2].loserId,
            team2Id: ubR1[3].loserId,
            stageId: "EWC_QUAL_S2_LB_R1",
            format: QUAL_S2_BO,
            day: currentDay + 1,
            week: Math.ceil((currentDay + 1) / 7),
            season,
          },
        ],
      });
    }
  }

  // UB R2 done → losers cascade vers LB R2 (cross-bracket)
  // Cross-bracket : L(UB R2 #1) vs W(LB R1 #2), L(UB R2 #2) vs W(LB R1 #1)
  // Note : on attend que LB R1 soit done aussi pour scheduler proprement
  if (completedStageId === "EWC_QUAL_S2_UB_R2" || completedStageId === "EWC_QUAL_S2_LB_R1") {
    const ubR2 = await getResults("EWC_QUAL_S2_UB_R2");
    const lbR1 = await getResults("EWC_QUAL_S2_LB_R1");
    if (ubR2.length < 2 || lbR1.length < 2) return;
    if (await exists("EWC_QUAL_S2_LB_R2")) return;

    await prisma.match.createMany({
      data: [
        {
          saveId,
          team1Id: ubR2[0].loserId,
          team2Id: lbR1[1].winnerId,
          stageId: "EWC_QUAL_S2_LB_R2",
          format: QUAL_S2_BO,
          day: currentDay + 1,
          week: Math.ceil((currentDay + 1) / 7),
          season,
        },
        {
          saveId,
          team1Id: ubR2[1].loserId,
          team2Id: lbR1[0].winnerId,
          stageId: "EWC_QUAL_S2_LB_R2",
          format: QUAL_S2_BO,
          day: currentDay + 1,
          week: Math.ceil((currentDay + 1) / 7),
          season,
        },
      ],
    });
  }

  // LB R2 done → LB Final (1 match)
  if (completedStageId === "EWC_QUAL_S2_LB_R2") {
    const lbR2 = await getResults("EWC_QUAL_S2_LB_R2");
    if (lbR2.length < 2) return;
    if (await exists("EWC_QUAL_S2_LB_FINAL")) return;

    await prisma.match.create({
      data: {
        saveId,
        team1Id: lbR2[0].winnerId,
        team2Id: lbR2[1].winnerId,
        stageId: "EWC_QUAL_S2_LB_FINAL",
        format: QUAL_S2_FINAL_BO,
        day: currentDay + 1,
        week: Math.ceil((currentDay + 1) / 7),
        season,
      },
    });
  }
}

/**
 * EWC Main Event — 16 équipes, 4 groupes de 4, round-robin → top 2 → SE playoffs.
 *
 * Composition des 16 slots :
 *   - 12 qualifiers : 3 par région via getEwcQualifierS2Winners
 *   - 1 defending champion : winner EWC année précédente (bypass qualifier)
 *   - 3 invités Riot : top prestige des équipes non-qualifiées / non-defending,
 *     avec balance régionale (max 1 invité par région tant que possible)
 *
 * Si le defending champion est aussi dans les 12 qualifiers (rare, mais
 * possible s'il gagne son qualifier), on bump à 4 invités.
 *
 * Structure 1 semaine :
 *   Day 1-3 : Group stage round-robin (3 rounds, 8 matchs/jour)
 *   Day 4   : Quarterfinals (4 matchs SE, top 2 de chaque groupe)
 *   Day 5   : Semifinals (2 matchs)
 *   Day 6   : Grand Final BO5
 *
 * Stage IDs :
 *   EWC_GROUP_A, EWC_GROUP_B, EWC_GROUP_C, EWC_GROUP_D
 *   EWC_QF, EWC_SF, EWC_GRAND_FINAL
 */
export async function initializeEwcMainFromQualifiers(
  prisma: PrismaClient,
  saveId: string,
  season: number,
): Promise<{ matchesScheduled: number }> {
  // Idempotent — ne fait rien si group stage déjà créé
  const existing = await prisma.match.count({
    where: { saveId, stageId: { startsWith: "EWC_GROUP_" }, season },
  });
  if (existing > 0) return { matchesScheduled: 0 };

  const REGIONS: Region[] = ["EMEA", "Americas", "Pacific", "China"];

  // ── 12 qualifiers issus du Stage 2 Qualifier ──
  const qualified: { teamId: string; region: Region; seed: number; source: "QUALIFIER" | "DEFENDING" | "INVITE" }[] = [];
  for (const region of REGIONS) {
    const winners = await getEwcQualifierS2Winners(prisma, saveId, region, season);
    if (winners && winners.length === 3) {
      winners.forEach((id, idx) => {
        qualified.push({ teamId: id, region, seed: idx + 1, source: "QUALIFIER" });
      });
    }
  }
  if (qualified.length < 8) return { matchesScheduled: 0 };

  const qualifiedIds = new Set(qualified.map((q) => q.teamId));

  // ── Defending champion bypass (1 slot) ──
  const defending = await prisma.team.findFirst({
    where: { saveId, isEwcDefendingChampion: true },
    select: { id: true, region: true },
  });
  let defendingTaken = false;
  if (defending && !qualifiedIds.has(defending.id)) {
    qualified.push({
      teamId: defending.id,
      region: defending.region,
      seed: 0, // top seed (champion en titre)
      source: "DEFENDING",
    });
    qualifiedIds.add(defending.id);
    defendingTaken = true;
  }

  // ── Invités Riot — combler à 16 avec top prestige non-qualifié ──
  // Si defending est dans les qualifiers déjà, on a 3 slots invités.
  // Sinon (defending bypass utilisé OU pas de defending) on a 3 ou 4 invités.
  const inviteSlotsTarget = 16 - qualified.length;
  if (inviteSlotsTarget > 0) {
    const invites = await prisma.team.findMany({
      where: {
        saveId,
        isPlayerTeam: false,
        id: { notIn: Array.from(qualifiedIds) },
      },
      select: { id: true, region: true, prestige: true },
      orderBy: { prestige: "desc" },
      take: inviteSlotsTarget * 3, // pool large pour permettre balance régionale
    });

    // Balance régionale : max 1 invité par région tant que possible.
    // (Avec 3-4 slots invités et 4 régions, on peut quasi toujours respecter.)
    const usedRegions = new Set<Region>();
    let pickedInvites = 0;
    for (const inv of invites) {
      if (pickedInvites >= inviteSlotsTarget) break;
      if (usedRegions.has(inv.region) && usedRegions.size < REGIONS.length) continue;
      qualified.push({
        teamId: inv.id,
        region: inv.region,
        seed: 99,
        source: "INVITE",
      });
      qualifiedIds.add(inv.id);
      usedRegions.add(inv.region);
      pickedInvites++;
    }
    // Si on n'a pas atteint 16 (pool d'invites limité), fill avec n'importe
    // quelle équipe restante triée par prestige.
    if (pickedInvites < inviteSlotsTarget) {
      for (const inv of invites) {
        if (qualifiedIds.has(inv.id)) continue;
        qualified.push({
          teamId: inv.id,
          region: inv.region,
          seed: 99,
          source: "INVITE",
        });
        qualifiedIds.add(inv.id);
        pickedInvites++;
        if (pickedInvites >= inviteSlotsTarget) break;
      }
    }
  }

  if (qualified.length < 8) return { matchesScheduled: 0 };
  const teams = qualified.slice(0, 16);
  void defendingTaken; // marker pour clarity, pas utilisé en aval

  // ── Seeding snake-draft pour distribuer les seeds dans 4 groupes ──
  // Top seed 1 va dans A, seed 2 dans B, etc. Puis serpentin pour
  // équilibrer (seed 5 retourne dans D, seed 8 dans A, etc.)
  const sortedBySeed = [...teams].sort(
    (a, b) => a.seed - b.seed || REGIONS.indexOf(a.region) - REGIONS.indexOf(b.region),
  );
  const groups: string[][] = [[], [], [], []]; // A, B, C, D
  sortedBySeed.forEach((t, idx) => {
    const row = Math.floor(idx / 4); // 0, 1, 2, 3
    const col = idx % 4;
    // Serpentin : rangées impaires inversées
    const groupIdx = row % 2 === 0 ? col : 3 - col;
    groups[groupIdx].push(t.teamId);
  });

  // ── Anchor sur le calendar day EWC (Day 187 = Mon Jul 6 en 2026) ──
  const { stageStartDay } = await import("@/constants/vct-calendar");
  const lastMatch = await prisma.match.findFirst({
    where: { saveId, season },
    orderBy: { day: "desc" },
  });
  const fallbackAfter = lastMatch?.day ?? 0;
  const calendarStart = stageStartDay("EWC", "EMEA");
  const day1 = calendarStart != null
    ? Math.max(calendarStart, fallbackAfter + 1)
    : fallbackAfter + 1;

  // ── Round-robin par groupe (4 équipes = 6 matchs, distribués 2/jour sur 3 jours) ──
  // RR schedule pour groupe [a, b, c, d] :
  //   R1: (a,b), (c,d)  → Day 1
  //   R2: (a,c), (b,d)  → Day 2
  //   R3: (a,d), (b,c)  → Day 3
  const groupRoundPairs: [string, string][][] = groups.map((g) => {
    if (g.length < 4) return [];
    const [a, b, c, d] = g;
    return [
      [a, b], [c, d], // R1
      [a, c], [b, d], // R2
      [a, d], [b, c], // R3
    ];
  });

  const stageIds = ["EWC_GROUP_A", "EWC_GROUP_B", "EWC_GROUP_C", "EWC_GROUP_D"];
  const matchesToCreate: Array<{
    saveId: string; team1Id: string; team2Id: string;
    stageId: string; format: MatchFormat;
    day: number; week: number; season: number;
  }> = [];

  groupRoundPairs.forEach((pairs, groupIdx) => {
    const stageId = stageIds[groupIdx];
    pairs.forEach((pair, matchIdx) => {
      // matchIdx 0,1 = R1 (day 1); 2,3 = R2 (day 2); 4,5 = R3 (day 3)
      const round = Math.floor(matchIdx / 2);
      const day = day1 + round;
      matchesToCreate.push({
        saveId,
        team1Id: pair[0],
        team2Id: pair[1],
        stageId,
        format: "BO3",
        day,
        week: Math.ceil(day / 7),
        season,
      });
    });
  });

  await prisma.match.createMany({ data: matchesToCreate });
  return { matchesScheduled: matchesToCreate.length };
}

/**
 * Top 2 d'un groupe EWC (par wins, tiebreak alphabétique sur teamId pour
 * déterminisme). Renvoie les seedIds dans l'ordre : [1er, 2e].
 */
async function ewcGroupTop2(
  prisma: PrismaClient,
  saveId: string,
  groupStageId: string,
  season: number,
): Promise<string[]> {
  const matches = await prisma.match.findMany({
    where: { saveId, stageId: groupStageId, season, isPlayed: true },
    select: { team1Id: true, team2Id: true, winnerId: true },
  });
  if (matches.length === 0) return [];

  const wins = new Map<string, number>();
  const participants = new Set<string>();
  for (const m of matches) {
    participants.add(m.team1Id);
    participants.add(m.team2Id);
    if (m.winnerId) wins.set(m.winnerId, (wins.get(m.winnerId) ?? 0) + 1);
  }
  const ranked = [...participants].sort((a, b) => {
    const w = (wins.get(b) ?? 0) - (wins.get(a) ?? 0);
    return w !== 0 ? w : a.localeCompare(b);
  });
  return ranked.slice(0, 2);
}

/**
 * Progression EWC Main : crée le bracket SE quand tous les groupes sont
 * terminés. Cross-bracket : 1er Group A vs 2e Group B, 1er Group B vs 2e
 * Group A, etc. Standard pattern pour éviter rematch group → bracket.
 */
export async function progressEwcMain(
  prisma: PrismaClient,
  saveId: string,
  completedStageId: string,
  season: number,
  currentDay: number,
): Promise<void> {
  // Group stage terminé → QF
  if (completedStageId.startsWith("EWC_GROUP_")) {
    // Vérif que les 4 groupes sont tous joués
    const stageIds = ["EWC_GROUP_A", "EWC_GROUP_B", "EWC_GROUP_C", "EWC_GROUP_D"];
    const counts = await Promise.all(
      stageIds.map((sid) =>
        prisma.match.count({ where: { saveId, stageId: sid, season } }).then(async (total) => {
          if (total === 0) return { sid, ready: false };
          const played = await prisma.match.count({
            where: { saveId, stageId: sid, season, isPlayed: true },
          });
          return { sid, ready: played === total };
        }),
      ),
    );
    if (counts.some((c) => !c.ready)) return;
    if ((await prisma.match.count({ where: { saveId, stageId: "EWC_QF", season } })) > 0) return;

    const [aTop, bTop, cTop, dTop] = await Promise.all(
      stageIds.map((sid) => ewcGroupTop2(prisma, saveId, sid, season)),
    );
    if (aTop.length < 2 || bTop.length < 2 || cTop.length < 2 || dTop.length < 2) return;

    // Cross-bracket QF : 1A vs 2B / 1B vs 2A / 1C vs 2D / 1D vs 2C
    const qfDay = currentDay + 1;
    await prisma.match.createMany({
      data: [
        { saveId, team1Id: aTop[0], team2Id: bTop[1], stageId: "EWC_QF", format: "BO3" as MatchFormat, day: qfDay, week: Math.ceil(qfDay / 7), season },
        { saveId, team1Id: bTop[0], team2Id: aTop[1], stageId: "EWC_QF", format: "BO3" as MatchFormat, day: qfDay, week: Math.ceil(qfDay / 7), season },
        { saveId, team1Id: cTop[0], team2Id: dTop[1], stageId: "EWC_QF", format: "BO3" as MatchFormat, day: qfDay, week: Math.ceil(qfDay / 7), season },
        { saveId, team1Id: dTop[0], team2Id: cTop[1], stageId: "EWC_QF", format: "BO3" as MatchFormat, day: qfDay, week: Math.ceil(qfDay / 7), season },
      ],
    });
    return;
  }

  // QF terminé → SF
  if (completedStageId === "EWC_QF") {
    const qfMatches = await prisma.match.findMany({
      where: { saveId, stageId: "EWC_QF", season, isPlayed: true },
      orderBy: { day: "asc" },
      select: { winnerId: true },
    });
    if (qfMatches.length < 4 || qfMatches.some((m) => !m.winnerId)) return;
    if ((await prisma.match.count({ where: { saveId, stageId: "EWC_SF", season } })) > 0) return;

    const sfDay = currentDay + 1;
    await prisma.match.createMany({
      data: [
        { saveId, team1Id: qfMatches[0].winnerId!, team2Id: qfMatches[1].winnerId!, stageId: "EWC_SF", format: "BO3" as MatchFormat, day: sfDay, week: Math.ceil(sfDay / 7), season },
        { saveId, team1Id: qfMatches[2].winnerId!, team2Id: qfMatches[3].winnerId!, stageId: "EWC_SF", format: "BO3" as MatchFormat, day: sfDay, week: Math.ceil(sfDay / 7), season },
      ],
    });
    return;
  }

  // SF terminé → GF BO5
  if (completedStageId === "EWC_SF") {
    const sfMatches = await prisma.match.findMany({
      where: { saveId, stageId: "EWC_SF", season, isPlayed: true },
      orderBy: { day: "asc" },
      select: { winnerId: true },
    });
    if (sfMatches.length < 2 || sfMatches.some((m) => !m.winnerId)) return;
    if ((await prisma.match.count({ where: { saveId, stageId: "EWC_GRAND_FINAL", season } })) > 0) return;

    const gfDay = currentDay + 1;
    await prisma.match.create({
      data: {
        saveId,
        team1Id: sfMatches[0].winnerId!,
        team2Id: sfMatches[1].winnerId!,
        stageId: "EWC_GRAND_FINAL",
        format: "BO5",
        day: gfDay,
        week: Math.ceil(gfDay / 7),
        season,
      },
    });
  }
}

/**
 * Renvoie les 3 EWC qualifiers d'une région :
 *   - 2 winners du UB R2
 *   - 1 winner du LB Final
 */
export async function getEwcQualifierS2Winners(
  prisma: PrismaClient,
  saveId: string,
  region: Region,
  season: number,
): Promise<string[] | null> {
  const [ubR2, lbF] = await Promise.all([
    prisma.match.findMany({
      where: {
        saveId, stageId: "EWC_QUAL_S2_UB_R2", season,
        isPlayed: true, team1: { region },
      },
      select: { winnerId: true },
    }),
    prisma.match.findFirst({
      where: {
        saveId, stageId: "EWC_QUAL_S2_LB_FINAL", season,
        isPlayed: true, team1: { region },
      },
      select: { winnerId: true },
    }),
  ]);
  if (ubR2.length < 2 || !lbF?.winnerId) return null;
  const winners: string[] = [];
  for (const m of ubR2) if (m.winnerId) winners.push(m.winnerId);
  winners.push(lbF.winnerId);
  return winners.length === 3 ? winners : null;
}
