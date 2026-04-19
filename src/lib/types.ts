/** Shared UI types that mirror the Prisma models for use in components. */

export interface PlayerInfo {
  id: string;
  ign: string;
  firstName: string;
  lastName: string;
  nationality: string;
  age: number;
  role: string;
  imageUrl: string | null;
  salary: number;
  acs: number;
  kd: number;
  adr: number;
  kast: number;
  hs: number;
  isActive: boolean;
  isRetired: boolean;
  teamId: string | null;
}

export interface TeamInfo {
  id: string;
  name: string;
  tag: string;
  region: string;
  budget: number;
  wins: number;
  losses: number;
  champPts: number;
  skillAim: number;
  skillUtility: number;
  skillTeamplay: number;
  players: PlayerInfo[];
}

export interface MatchInfo {
  id: string;
  stageId: string;
  day: number;
  week: number;
  format: string;
  team1Id: string;
  team2Id: string;
  team1: { id: string; name: string; tag: string; region: string };
  team2: { id: string; name: string; tag: string; region: string };
  winnerId: string | null;
  score: unknown;
  maps: unknown;
  isPlayed: boolean;
  playedAt: Date | null;
}

export interface SeasonInfo {
  id: string;
  number: number;
  year: number;
  currentStage: string;
  currentDay: number;
  currentWeek: number;
  isActive: boolean;
}
