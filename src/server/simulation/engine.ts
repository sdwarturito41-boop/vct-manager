import type { MatchFormat, Role } from "@/generated/prisma/client";
import { MAP_POOLS } from "@/constants/maps";
import { generateHighlights } from "./highlights";

// ── Public types ──

export interface SimPlayer {
  id: string;
  ign: string;
  acs: number;
  kd: number;
  adr: number;
  kast: number;
  hs: number;
  role: Role;
}

export interface SimTeam {
  id: string;
  name: string;
  tag: string;
  players: SimPlayer[];
  skillAim: number;
  skillUtility: number;
  skillTeamplay: number;
}

export interface PlayerMapStats {
  playerId: string;
  teamId: string;
  ign: string;
  kills: number;
  deaths: number;
  assists: number;
  acs: number;
  fk: number;
  fd: number;
}

export interface MatchHighlight {
  type: string;
  round: number;
  playerIgn?: string;
  text: string;
}

export interface MapResult {
  map: string;
  score1: number;
  score2: number;
  playerStats: PlayerMapStats[];
  highlights: MatchHighlight[];
}

export interface MatchResult {
  winnerId: string;
  score: { team1: number; team2: number };
  maps: MapResult[];
}

// ── Helpers ──

function randFloat(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** Compute a team's overall strength from players + team skills. */
function teamStrength(team: SimTeam): number {
  const playerCount = Math.max(team.players.length, 1);
  const avgAcs = team.players.reduce((s, p) => s + p.acs, 0) / playerCount;
  const avgKd = team.players.reduce((s, p) => s + p.kd, 0) / playerCount;
  const avgKast = team.players.reduce((s, p) => s + p.kast, 0) / playerCount;

  const avgAdr = team.players.reduce((s, p) => s + p.adr, 0) / playerCount;
  const playerRating = avgAcs * 0.35 + avgKd * 80 + avgAdr * 0.20 + avgKast * 0.25;
  const teamBonus = (team.skillAim * 0.4 + team.skillUtility * 0.3 + team.skillTeamplay * 0.3) * 0.8;

  return playerRating + teamBonus;
}

/** Simulate one half (12 normal rounds). Returns rounds won by the attacking team. */
function simulateHalf(atkStrength: number, defStrength: number): number {
  let atkWins = 0;
  for (let round = 0; round < 12; round++) {
    const noise = randFloat(-8, 8);
    const atkChance = (atkStrength + noise) / (atkStrength + defStrength);
    if (Math.random() < atkChance) atkWins++;
  }
  return atkWins;
}

export function simulateMap(team1: SimTeam, team2: SimTeam, mapName: string): MapResult {
  const str1 = teamStrength(team1) + randFloat(-5, 5);
  const str2 = teamStrength(team2) + randFloat(-5, 5);

  let score1 = 0;
  let score2 = 0;

  // First half (12 rounds): team1 attacks
  for (let round = 0; round < 12 && score1 < 13 && score2 < 13; round++) {
    const noise = randFloat(-8, 8);
    const chance = (str1 + noise) / (str1 + str2);
    if (Math.random() < chance) score1++;
    else score2++;
  }

  // Second half (12 rounds): team2 attacks
  for (let round = 0; round < 12 && score1 < 13 && score2 < 13; round++) {
    const noise = randFloat(-8, 8);
    const chance = (str2 + noise) / (str1 + str2);
    if (Math.random() < chance) score2++;
    else score1++;
  }

  // Overtime if tied 12-12 (MR2: play full pair of 2 rounds, repeat if still tied)
  while (score1 === score2) {
    let otTeam1 = 0;
    let otTeam2 = 0;
    // Play exactly 2 OT rounds (full pair)
    for (let i = 0; i < 2; i++) {
      const noise = randFloat(-5, 5);
      const chance = (str1 + noise) / (str1 + str2);
      if (Math.random() < chance) otTeam1++;
      else otTeam2++;
    }
    score1 += otTeam1;
    score2 += otTeam2;
    // If still tied (1-1 split) → loop continues with another pair
  }

  // Generate player stats scaled by how many rounds their team won
  const totalRounds = score1 + score2;
  const team1WinRate = score1 / totalRounds;
  const team2WinRate = score2 / totalRounds;

  const allPlayers = [
    ...team1.players.map((p) => ({ ...p, teamId: team1.id, winRate: team1WinRate })),
    ...team2.players.map((p) => ({ ...p, teamId: team2.id, winRate: team2WinRate })),
  ];

  const playerStats: PlayerMapStats[] = allPlayers.map((p) => {
    // Scale kills by team performance: winning team gets more kills
    const performanceMultiplier = 0.5 + p.winRate; // 0.73 for 4-13 loser, 1.27 for 13-4 winner
    const baseKills = (p.acs / 240) * totalRounds * performanceMultiplier * randFloat(0.85, 1.15);
    const kills = Math.max(1, Math.round(baseKills));

    // Deaths inversely correlated with team performance
    const deathMultiplier = 1.5 - p.winRate; // more deaths when losing
    const baseDeath = kills / Math.max(p.kd * randFloat(0.85, 1.15), 0.4);
    const deaths = Math.max(2, Math.round(baseDeath * deathMultiplier));

    const assists = Math.round(kills * randFloat(0.2, 0.45));
    // ACS also scales with performance
    const acs = Math.round(p.acs * performanceMultiplier * randFloat(0.8, 1.2));
    const fk = Math.round(kills * randFloat(0.08, 0.22));
    const fd = Math.round(deaths * randFloat(0.08, 0.18));

    return {
      playerId: p.id,
      teamId: p.teamId,
      ign: p.ign,
      kills,
      deaths,
      assists,
      acs,
      fk,
      fd,
    };
  });

  const highlights = generateHighlights(mapName, team1.name, team2.name, score1, score2, playerStats);

  return { map: mapName, score1, score2, playerStats, highlights };
}

// ── Main export ──

export function simulateMatch(team1: SimTeam, team2: SimTeam, format: MatchFormat, mapOverride?: string[], mapPool?: string[]): MatchResult {
  const mapsNeeded = format === "BO1" ? 1 : format === "BO3" ? 2 : 3;
  const mapCount = format === "BO1" ? 1 : format === "BO3" ? 3 : 5;

  const pool = mapPool ?? MAP_POOLS.POOL_A;
  const mapPick = mapOverride ?? shuffle([...pool]).slice(0, mapCount);

  const maps: MapResult[] = [];
  let t1Wins = 0;
  let t2Wins = 0;

  for (const mapName of mapPick) {
    if (t1Wins >= mapsNeeded || t2Wins >= mapsNeeded) break;

    const result = simulateMap(team1, team2, mapName);
    maps.push(result);

    if (result.score1 > result.score2) t1Wins++;
    else t2Wins++;
  }

  return {
    winnerId: t1Wins > t2Wins ? team1.id : team2.id,
    score: { team1: t1Wins, team2: t2Wins },
    maps,
  };
}
