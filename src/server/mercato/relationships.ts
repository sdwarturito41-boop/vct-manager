import type { PrismaClient, Player, RelationType } from "@/generated/prisma/client";
import { playerRating } from "./marketRate";

// ── Tunables ────────────────────────────────────────────────
const DUO_CHEMISTRY_MAX_WEEKS = 80;       // weeks together for chemistry=1.0
const SEPARATION_DECAY = 0.5;             // weeksTogether lost per week apart
const MENTOR_MIN_WEEKS_TOGETHER = 4;      // threshold before MENTOR fires
const VETERAN_MIN_AGE = 28;
const VETERAN_MIN_RATING = 0.6;
const ROOKIE_MAX_AGE = 21;
const CLASH_SPAWN_PROB = 0.02;            // per team-tick on losing streak
const CLASH_HEAL_PROB = 0.05;             // per team-tick on winning streak
const CLASH_INTENSITY_STEP = 0.05;        // +/− per week while active

const MENTOR_STAT_GROWTH = {
  acs: 0.3,
  kd: 0.003,
  adr: 0.1,
};

// ── Helpers ─────────────────────────────────────────────────
function pairKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

function pairString(a: string, b: string): string {
  const [lo, hi] = pairKey(a, b);
  return `${lo}|${hi}`;
}

type TeamStreak = "WIN" | "LOSS" | "NEUTRAL";

async function teamStreakMap(
  prisma: PrismaClient,
  saveId: string,
): Promise<Map<string, TeamStreak>> {
  const matches = await prisma.match.findMany({
    where: { saveId, isPlayed: true },
    orderBy: { playedAt: "desc" },
    select: { team1Id: true, team2Id: true, winnerId: true },
  });
  const results = new Map<string, { won: boolean }[]>();
  for (const m of matches) {
    for (const tid of [m.team1Id, m.team2Id]) {
      const list = results.get(tid) ?? [];
      if (list.length >= 3) continue;
      list.push({ won: m.winnerId === tid });
      results.set(tid, list);
    }
  }
  const streaks = new Map<string, TeamStreak>();
  for (const [tid, last3] of results) {
    if (last3.length < 3) {
      streaks.set(tid, "NEUTRAL");
      continue;
    }
    if (last3.every((r) => !r.won)) streaks.set(tid, "LOSS");
    else if (last3.every((r) => r.won)) streaks.set(tid, "WIN");
    else streaks.set(tid, "NEUTRAL");
  }
  return streaks;
}

// ── Weekly tick ─────────────────────────────────────────────

/**
 * Main weekly tick. Updates all PlayerRelation rows for the save:
 * - DUO: auto-create and grow weeksTogether for active teammate pairs
 * - MENTOR: auto-create once vet+rookie have spent MIN_WEEKS together
 * - CLASH: spawn randomly on teams with losing streaks, heal on winners
 * - Separated pairs: decay weeksTogether, mark not-together, delete at 0
 *
 * All DB ops batched. Called on weekly tick from season.advanceDay.
 */
export async function runRelationshipsTick(
  prisma: PrismaClient,
  saveId: string,
  currentWeek: number,
  currentSeason: number,
): Promise<{ created: number; updated: number; deleted: number }> {
  // 1. Roster snapshot
  const players = await prisma.player.findMany({
    where: {
      team: { saveId },
      teamId: { not: null },
      isRetired: false,
      isActive: true,
    },
    select: {
      id: true,
      teamId: true,
      age: true,
      acs: true,
      kd: true,
      adr: true,
    },
  });

  // Group by team
  const byTeam = new Map<string, typeof players>();
  for (const p of players) {
    if (!p.teamId) continue;
    const arr = byTeam.get(p.teamId) ?? [];
    arr.push(p);
    byTeam.set(p.teamId, arr);
  }

  // Build current pair set (unordered, one entry per pair)
  const currentPairs = new Set<string>();
  const teamPairs = new Map<string, string[]>(); // teamId -> pairStrings[]
  for (const [teamId, roster] of byTeam) {
    const pairsForTeam: string[] = [];
    for (let i = 0; i < roster.length; i++) {
      for (let j = i + 1; j < roster.length; j++) {
        const k = pairString(roster[i].id, roster[j].id);
        currentPairs.add(k);
        pairsForTeam.push(k);
      }
    }
    teamPairs.set(teamId, pairsForTeam);
  }

  const playerById = new Map(players.map((p) => [p.id, p]));

  // 2. Existing relations in this save (one query)
  const existing = await prisma.playerRelation.findMany({
    where: { saveId },
  });
  // Map by (pair|type)
  const existingByKey = new Map<string, (typeof existing)[number]>();
  for (const r of existing) {
    existingByKey.set(
      `${pairString(r.playerAId, r.playerBId)}|${r.type}`,
      r,
    );
  }

  // 3. Team streaks (for CLASH spawn / heal)
  const streaks = await teamStreakMap(prisma, saveId);

  const toCreate: Array<{
    saveId: string;
    type: RelationType;
    playerAId: string;
    playerBId: string;
    weeksTogether: number;
    strength: number;
    isCurrentlyTogether: boolean;
    firstTogetherWeek: number;
    firstTogetherSeason: number;
  }> = [];
  const toUpdate: Array<{
    id: string;
    data: {
      weeksTogether?: number;
      strength?: number;
      isCurrentlyTogether?: boolean;
    };
  }> = [];
  const toDelete: string[] = [];

  // Track per-team CLASH pairs to enforce roll semantics (one roll per team)
  const clashedTeams = new Set<string>();

  // 4. Walk each currently active pair
  for (const [teamId, roster] of byTeam) {
    for (let i = 0; i < roster.length; i++) {
      for (let j = i + 1; j < roster.length; j++) {
        const a = roster[i];
        const b = roster[j];
        const [lo, hi] = pairKey(a.id, b.id);
        const key = `${lo}|${hi}`;

        // DUO — ensure and grow
        const duoKey = `${key}|DUO`;
        const duo = existingByKey.get(duoKey);
        if (!duo) {
          toCreate.push({
            saveId,
            type: "DUO",
            playerAId: lo,
            playerBId: hi,
            weeksTogether: 1,
            strength: 1 / DUO_CHEMISTRY_MAX_WEEKS,
            isCurrentlyTogether: true,
            firstTogetherWeek: currentWeek,
            firstTogetherSeason: currentSeason,
          });
        } else {
          const nextWeeks = duo.weeksTogether + 1;
          const nextStrength = Math.min(1, nextWeeks / DUO_CHEMISTRY_MAX_WEEKS);
          toUpdate.push({
            id: duo.id,
            data: {
              weeksTogether: nextWeeks,
              strength: nextStrength,
              isCurrentlyTogether: true,
            },
          });
        }

        // MENTOR — check if pair qualifies
        const pA = playerById.get(a.id)!;
        const pB = playerById.get(b.id)!;
        const aIsVet = pA.age >= VETERAN_MIN_AGE && playerRating(pA) >= VETERAN_MIN_RATING;
        const aIsRookie = pA.age <= ROOKIE_MAX_AGE;
        const bIsVet = pB.age >= VETERAN_MIN_AGE && playerRating(pB) >= VETERAN_MIN_RATING;
        const bIsRookie = pB.age <= ROOKIE_MAX_AGE;
        let mentorVet: string | null = null;
        let mentorRookie: string | null = null;
        if (aIsVet && bIsRookie) {
          mentorVet = a.id;
          mentorRookie = b.id;
        } else if (bIsVet && aIsRookie) {
          mentorVet = b.id;
          mentorRookie = a.id;
        }

        const weeksTogetherForMentor = duo ? duo.weeksTogether + 1 : 1;

        if (mentorVet && mentorRookie && weeksTogetherForMentor >= MENTOR_MIN_WEEKS_TOGETHER) {
          const mentorKey = `${key}|MENTOR`;
          const existingMentor = existingByKey.get(mentorKey);
          if (!existingMentor) {
            toCreate.push({
              saveId,
              type: "MENTOR",
              // Canonical: playerAId = veteran, playerBId = protégé
              // (overrides the lo/hi ordering so we can tell them apart)
              playerAId: mentorVet,
              playerBId: mentorRookie,
              weeksTogether: weeksTogetherForMentor,
              strength: 1,
              isCurrentlyTogether: true,
              firstTogetherWeek: currentWeek,
              firstTogetherSeason: currentSeason,
            });
          } else {
            toUpdate.push({
              id: existingMentor.id,
              data: {
                weeksTogether: existingMentor.weeksTogether + 1,
                isCurrentlyTogether: true,
              },
            });
          }
        } else {
          // If there WAS a MENTOR but conditions no longer hold (rookie grew up,
          // vet lost rating, …) — clear the row so the UI reflects reality.
          const mentorKey = `${key}|MENTOR`;
          const existingMentor = existingByKey.get(mentorKey);
          if (existingMentor) {
            toDelete.push(existingMentor.id);
          }
        }

        // CLASH — intensify if exists
        const clashKey = `${key}|CLASH`;
        const existingClash = existingByKey.get(clashKey);
        if (existingClash) {
          const nextIntensity = Math.min(1, existingClash.strength + CLASH_INTENSITY_STEP);
          toUpdate.push({
            id: existingClash.id,
            data: {
              strength: nextIntensity,
              isCurrentlyTogether: true,
            },
          });
        }
      }
    }

    // CLASH spawn roll (once per team, on losing streak)
    if (streaks.get(teamId) === "LOSS" && Math.random() < CLASH_SPAWN_PROB) {
      const candidates = (teamPairs.get(teamId) ?? []).filter(
        (pk) => !existingByKey.has(`${pk}|CLASH`),
      );
      if (candidates.length > 0 && !clashedTeams.has(teamId)) {
        const picked = candidates[Math.floor(Math.random() * candidates.length)];
        const [lo, hi] = picked.split("|");
        toCreate.push({
          saveId,
          type: "CLASH",
          playerAId: lo,
          playerBId: hi,
          weeksTogether: 0,
          strength: 0.3,
          isCurrentlyTogether: true,
          firstTogetherWeek: currentWeek,
          firstTogetherSeason: currentSeason,
        });
        clashedTeams.add(teamId);
      }
    }

    // CLASH heal roll (on winning streak)
    if (streaks.get(teamId) === "WIN") {
      for (const pk of teamPairs.get(teamId) ?? []) {
        const clash = existingByKey.get(`${pk}|CLASH`);
        if (clash && Math.random() < CLASH_HEAL_PROB) {
          toDelete.push(clash.id);
        }
      }
    }
  }

  // 5. Decay relations whose pair is NOT currently together
  for (const rel of existing) {
    const pk = pairString(rel.playerAId, rel.playerBId);
    if (currentPairs.has(pk)) continue;
    // Pair not currently together — decay
    const nextWeeks = Math.max(0, rel.weeksTogether - SEPARATION_DECAY);
    if (nextWeeks === 0) {
      toDelete.push(rel.id);
    } else {
      const nextStrength =
        rel.type === "DUO"
          ? Math.min(1, nextWeeks / DUO_CHEMISTRY_MAX_WEEKS)
          : rel.strength;
      toUpdate.push({
        id: rel.id,
        data: {
          weeksTogether: nextWeeks,
          strength: nextStrength,
          isCurrentlyTogether: false,
        },
      });
    }
  }

  // 6. Flush in parallel chunks
  const CHUNK = 25;
  for (let i = 0; i < toCreate.length; i += CHUNK) {
    await Promise.all(
      toCreate.slice(i, i + CHUNK).map((data) =>
        prisma.playerRelation.create({ data }).catch(() => null),
      ),
    );
  }
  for (let i = 0; i < toUpdate.length; i += CHUNK) {
    await Promise.all(
      toUpdate.slice(i, i + CHUNK).map((u) =>
        prisma.playerRelation.update({ where: { id: u.id }, data: u.data }),
      ),
    );
  }
  if (toDelete.length > 0) {
    await prisma.playerRelation.deleteMany({ where: { id: { in: toDelete } } });
  }

  return {
    created: toCreate.length,
    updated: toUpdate.length,
    deleted: toDelete.length,
  };
}

// ── MENTOR stat growth ──────────────────────────────────────

/**
 * Bumps protégé stats for every currently-active MENTOR relation.
 * Called on weekly tick after runRelationshipsTick.
 */
export async function applyMentorStatGrowth(
  prisma: PrismaClient,
  saveId: string,
): Promise<number> {
  const mentors = await prisma.playerRelation.findMany({
    where: { saveId, type: "MENTOR", isCurrentlyTogether: true },
    select: { playerBId: true },
  });
  const protégéIds = Array.from(new Set(mentors.map((m) => m.playerBId)));
  if (protégéIds.length === 0) return 0;

  const CHUNK = 25;
  for (let i = 0; i < protégéIds.length; i += CHUNK) {
    await Promise.all(
      protégéIds.slice(i, i + CHUNK).map((id) =>
        prisma.player.update({
          where: { id },
          data: {
            acs: { increment: MENTOR_STAT_GROWTH.acs },
            kd: { increment: MENTOR_STAT_GROWTH.kd },
            adr: { increment: MENTOR_STAT_GROWTH.adr },
          },
        }),
      ),
    );
  }
  return protégéIds.length;
}

// ── Pair map loading (for match engine) ────────────────────

/**
 * Fetches all currently-together DUO/CLASH relations for the given teams in
 * a single query, then buckets them into `Map<teamId, Map<pairKey, strength>>`.
 *
 * Pair key format: "playerALoId|playerBHiId|TYPE" (IDs sorted lex).
 * Matches the key format consumed by duelEngine's relationPairKey.
 */
export async function loadActivePairMaps(
  prisma: PrismaClient,
  saveId: string,
  teamIds: string[],
): Promise<Map<string, Map<string, number>>> {
  const result = new Map<string, Map<string, number>>();
  if (teamIds.length === 0) return result;

  // Get teams → their active player IDs (only players still on the team)
  const rosters = await prisma.player.findMany({
    where: { teamId: { in: teamIds }, isActive: true, isRetired: false },
    select: { id: true, teamId: true },
  });
  const playerToTeam = new Map<string, string>();
  const teamRoster = new Map<string, Set<string>>();
  for (const p of rosters) {
    if (!p.teamId) continue;
    playerToTeam.set(p.id, p.teamId);
    const set = teamRoster.get(p.teamId) ?? new Set<string>();
    set.add(p.id);
    teamRoster.set(p.teamId, set);
  }

  const playerIds = Array.from(playerToTeam.keys());
  if (playerIds.length === 0) return result;

  const relations = await prisma.playerRelation.findMany({
    where: {
      saveId,
      isCurrentlyTogether: true,
      type: { in: ["DUO", "CLASH"] },
      playerAId: { in: playerIds },
      playerBId: { in: playerIds },
    },
    select: {
      type: true,
      playerAId: true,
      playerBId: true,
      strength: true,
    },
  });

  for (const teamId of teamIds) result.set(teamId, new Map());

  for (const rel of relations) {
    const teamA = playerToTeam.get(rel.playerAId);
    const teamB = playerToTeam.get(rel.playerBId);
    // Only keep intra-team pairs
    if (!teamA || teamA !== teamB) continue;
    const [lo, hi] =
      rel.playerAId < rel.playerBId
        ? [rel.playerAId, rel.playerBId]
        : [rel.playerBId, rel.playerAId];
    const key = `${lo}|${hi}|${rel.type}`;
    result.get(teamA)?.set(key, rel.strength);
  }

  return result;
}

// ── Departure handler ──────────────────────────────────────

/**
 * Called from applyAcceptedOffer when a player changes teams. Emits
 * happiness tags on the remaining teammates whose relations just broke.
 *  - DUO: malus = min(weeksTogether/50, 1) × 12 on the other player
 *  - MENTOR (veteran leaves): MENTOR_LOST one-shot on protégé
 *  - MENTOR (protégé leaves): no tag on veteran
 *  - CLASH: just clear the row, no happiness impact
 */
export async function handleTeamDeparture(
  prisma: PrismaClient,
  playerId: string,
): Promise<void> {
  const activeRelations = await prisma.playerRelation.findMany({
    where: {
      isCurrentlyTogether: true,
      OR: [{ playerAId: playerId }, { playerBId: playerId }],
    },
  });

  if (activeRelations.length === 0) return;

  const updates: Promise<unknown>[] = [];

  for (const rel of activeRelations) {
    const otherId = rel.playerAId === playerId ? rel.playerBId : rel.playerAId;

    if (rel.type === "DUO") {
      const malus = Math.round(Math.min(rel.weeksTogether / 50, 1) * 12);
      if (malus > 0) {
        updates.push(
          prisma.player
            .findUnique({
              where: { id: otherId },
              select: { happiness: true, happinessTags: true },
            })
            .then((p) => {
              if (!p) return null;
              const existingTags = Array.isArray(p.happinessTags)
                ? (p.happinessTags as string[])
                : [];
              const nextTags = existingTags.includes("DUO_BROKEN")
                ? existingTags
                : [...existingTags, "DUO_BROKEN"];
              return prisma.player.update({
                where: { id: otherId },
                data: {
                  happiness: Math.max(0, p.happiness - malus),
                  happinessTags: nextTags,
                },
              });
            }),
        );
      }
    } else if (rel.type === "MENTOR" && rel.playerAId === playerId) {
      // Veteran leaves → protégé gets MENTOR_LOST
      updates.push(
        prisma.player
          .findUnique({
            where: { id: otherId },
            select: { happiness: true, happinessTags: true },
          })
          .then((p) => {
            if (!p) return null;
            const existingTags = Array.isArray(p.happinessTags)
              ? (p.happinessTags as string[])
              : [];
            const nextTags = existingTags.includes("MENTOR_LOST")
              ? existingTags
              : [...existingTags, "MENTOR_LOST"];
            return prisma.player.update({
              where: { id: otherId },
              data: {
                happiness: Math.max(0, p.happiness - 10),
                happinessTags: nextTags,
              },
            });
          }),
      );
    }
  }

  await Promise.all(updates);

  // Mark all these relations as no longer together (they'll decay next tick)
  await prisma.playerRelation.updateMany({
    where: { id: { in: activeRelations.map((r) => r.id) } },
    data: { isCurrentlyTogether: false },
  });
}
