import type { MatchFormat, Role, Playstyle } from "@/generated/prisma/client";
import { MAP_POOLS } from "@/constants/maps";
import { generateHighlights } from "./highlights";
import {
  AGENT_META,
  COUNTER_TABLE,
  MASTERY_FACTOR,
  getSynergyFactor,
  MAP_FACTOR,
} from "@/constants/meta";

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
  mapFactors?: Record<string, number>; // map name → factor
  joinedWeek?: number; // for synergy calc
  /** V4 — FM-style 0-20 overall. Undefined before the first recompute tick. */
  overall?: number;
}

export interface SimTeam {
  id: string;
  name: string;
  tag: string;
  players: SimPlayer[];
  skillAim: number;
  skillUtility: number;
  skillTeamplay: number;
  playstyle?: Playstyle;
}

// ── Playstyle bonuses ──
// Subtle (1-3%) simulation tweaks keyed off a team's current Playstyle.
export interface PlaystyleBonus {
  scoreMultiplier: number; // multiplies the aggregate team score
  utilityMultiplier: number; // multiplies skillUtility contribution
  firstBloodBonus: number; // additive bonus for first blood events
  kastBonus: number; // additive bonus / penalty (percentage points as decimal)
  defenseRoundBonus: number; // additive bonus to team's defensive half win chance
  ecoWinBonus: number; // additive bonus to eco round win chance
}

export function getPlaystyleBonus(playstyle?: Playstyle): PlaystyleBonus {
  switch (playstyle) {
    case "Aggressive":
      return {
        scoreMultiplier: 1.00,
        utilityMultiplier: 1.00,
        firstBloodBonus: 0.03,
        kastBonus: -0.02,
        defenseRoundBonus: 0,
        ecoWinBonus: 0,
      };
    case "Tactical":
      return {
        scoreMultiplier: 1.00,
        utilityMultiplier: 1.03,
        firstBloodBonus: 0,
        kastBonus: 0.02,
        defenseRoundBonus: 0,
        ecoWinBonus: 0,
      };
    case "Defensive":
      return {
        scoreMultiplier: 1.00,
        utilityMultiplier: 1.00,
        firstBloodBonus: 0,
        kastBonus: 0,
        defenseRoundBonus: 0.02,
        ecoWinBonus: 0.03,
      };
    case "Flex":
      return {
        scoreMultiplier: 1.005,
        utilityMultiplier: 1.01,
        firstBloodBonus: 0.01,
        kastBonus: 0.005,
        defenseRoundBonus: 0.01,
        ecoWinBonus: 0.01,
      };
    case "Balanced":
    default:
      return {
        scoreMultiplier: 1.00,
        utilityMultiplier: 1.00,
        firstBloodBonus: 0,
        kastBonus: 0,
        defenseRoundBonus: 0,
        ecoWinBonus: 0,
      };
  }
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
  rounds: RoundEvent[];
  playerStats: PlayerMapStats[];
  highlights: MatchHighlight[];
}

export interface MatchResult {
  winnerId: string;
  score: { team1: number; team2: number };
  maps: MapResult[];
}

export interface AgentPick {
  playerId: string;
  agentName: string;
  agentRole?: string;
}

export interface SimMapOptions {
  team1Agents?: AgentPick[];
  team2Agents?: AgentPick[];
  team1StartsAttack?: boolean;
  currentWeek?: number; // for synergy calculation
  agentMastery?: Record<string, number>; // "playerId:agentName" → stars (0-5)
  team1CoachBoost?: number; // 0-100 coach utilityBoost (boosts team1 skillUtility by boost/100 * 0.05)
  team2CoachBoost?: number; // 0-100 coach utilityBoost (boosts team2 skillUtility by boost/100 * 0.05)
  /** Mercato V3 — pre-fetched pair maps (DUO/CLASH strengths) for each side. */
  team1Pairs?: Map<string, number>;
  team2Pairs?: Map<string, number>;
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

// ── Layer 1: Base player rating ──

function baseRating(p: SimPlayer): number {
  return p.acs * 0.35 + p.kast * 0.25 + p.adr * 0.20 + p.kd * 0.20;
}

// ── Layer 2: Map factor ──

function mapFactor(p: SimPlayer, mapName: string): number {
  if (!p.mapFactors) return MAP_FACTOR.UNKNOWN;
  return p.mapFactors[mapName] ?? MAP_FACTOR.UNKNOWN;
}

// ── Layer 3: Agent mastery ──

function agentMasteryFactor(
  playerId: string,
  agentName: string,
  mastery?: Record<string, number>,
): number {
  if (!mastery) return MASTERY_FACTOR[3]!; // neutral
  const key = `${playerId}:${agentName}`;
  const stars = mastery[key];
  if (stars === undefined) return MASTERY_FACTOR[3]!;
  return MASTERY_FACTOR[Math.max(0, Math.min(5, stars))] ?? MASTERY_FACTOR[3]!;
}

// ── Layer 4: Meta factor ──

function metaFactor(agentName: string): number {
  return AGENT_META[agentName] ?? 1.0;
}

// ── Layer 5: Counter bonus ──

function counterBonus(
  teamAgents: AgentPick[],
  opponentAgents: AgentPick[],
): number {
  let bonus = 0;
  const opponentNames = opponentAgents.map((a) => a.agentName);

  for (const pick of teamAgents) {
    const entry = COUNTER_TABLE[pick.agentName];
    if (!entry) continue;

    for (const opp of opponentNames) {
      if (entry.hardCounters.includes(opp)) bonus += 0.08;
      if (entry.softCounters.includes(opp)) bonus += 0.04;
    }
  }

  return Math.min(bonus, 0.15);
}

// ── Layer 6: Team skill bonus ──

function skillBonus(team: SimTeam): number {
  const ps = getPlaystyleBonus(team.playstyle);
  const utilityWeighted = team.skillUtility * 0.3 * ps.utilityMultiplier;
  return (team.skillAim * 0.4 + utilityWeighted + team.skillTeamplay * 0.3) / 100;
}

// ── Layer 7: Synergy factor ──

function teamSynergyFactor(
  players: SimPlayer[],
  currentWeek?: number,
): number {
  if (players.length === 0) return 1.0;
  if (currentWeek === undefined) return 1.0; // no week info → neutral

  let total = 0;
  for (const p of players) {
    const joined = p.joinedWeek ?? 0;
    const weeksSince = Math.max(0, currentWeek - joined);
    total += getSynergyFactor(weeksSince);
  }
  return total / players.length;
}

// ── Compute final team score ──

function teamScore(
  team: SimTeam,
  mapName: string,
  ownAgents: AgentPick[],
  oppAgents: AgentPick[],
  options?: SimMapOptions,
  coachBoost?: number,
): number {
  const players = team.players;
  const count = Math.max(players.length, 1);

  // Per-player weighted ratings (layers 1-4)
  let ratingSum = 0;
  for (const p of players) {
    const pick = ownAgents.find((a) => a.playerId === p.id);
    const agentName = pick?.agentName ?? "";

    const base = baseRating(p); // L1
    const mf = mapFactor(p, mapName); // L2
    const af = agentName
      ? agentMasteryFactor(p.id, agentName, options?.agentMastery)
      : MASTERY_FACTOR[3]!; // L3
    const meta = agentName ? metaFactor(agentName) : 1.0; // L4

    ratingSum += base * mf * af * meta;
  }

  const avgRating = ratingSum / count;

  // L5 — counter bonus
  const cb = ownAgents.length > 0 && oppAgents.length > 0
    ? counterBonus(ownAgents, oppAgents)
    : 0;

  // L6 — skill bonus (with optional coach utility boost)
  // Coach boost adds coachBoost/100 * 5 to skillUtility (max +5 at 100 utility)
  let teamForSkill = team;
  if (coachBoost && coachBoost > 0) {
    const boostedUtility = Math.min(100, team.skillUtility + (coachBoost / 100) * 5);
    teamForSkill = { ...team, skillUtility: boostedUtility };
  }
  const sb = skillBonus(teamForSkill);

  // L7 — synergy
  const synergy = teamSynergyFactor(players, options?.currentWeek);

  // Playstyle multiplier (score + kast influence)
  const ps = getPlaystyleBonus(team.playstyle);
  const playstyleMult = ps.scoreMultiplier + ps.kastBonus;

  // Final score
  const score = (avgRating * (1 + sb) * synergy + cb + randFloat(-0.05, 0.05)) * playstyleMult;

  return score;
}

// ── Round-by-round simulation ──

export type BuyType = "pistol" | "eco" | "force" | "half" | "full";

export interface RoundEventDetail {
  type: "clutch" | "ace" | "eco_win" | "first_blood" | "momentum_break" | "defuse_clutch" | "flawless";
  text: string;
  playerIgn?: string;
  weight: number; // emotional weight for post-match narrative
  clutchSize?: string; // "1v2", "1v3" etc
}

export interface RoundKillEvent {
  killerId: string;
  victimId: string;
  assistIds: string[];
  isFirstKill: boolean;
  timing: number;
}

export interface PlayerLoadoutSnapshot {
  playerId: string;
  weapon: string;
  armor: "heavy" | "light" | "none";
  creditsAfterBuy: number;
  fromPickup: boolean;
}

export interface RoundEvent {
  round: number;
  winner: 1 | 2;
  half: 1 | 2 | "OT";
  score1: number;
  score2: number;
  // Economy
  team1Buy: BuyType;
  team2Buy: BuyType;
  team1Budget: number;
  team2Budget: number;
  // Event (null = standard round)
  event: RoundEventDetail | null;
  /** Real per-round kill log from the sim */
  kills: RoundKillEvent[];
  /** Post-buy loadouts for all 10 players */
  loadouts: PlayerLoadoutSnapshot[];
  /** When spike plant completed (null if never planted) */
  plantTime: number | null;
  /** True if defenders defused the spike */
  spikeDefused: boolean;
}

// ── Economy helpers ──

const BUY_FACTOR: Record<BuyType, number> = {
  pistol: 1.0,
  eco: 0.72,
  force: 0.85,
  half: 0.92,
  full: 1.0,
};

const BUY_COST: Record<BuyType, number> = {
  pistol: 800,
  eco: 0,
  force: 1500,
  half: 2500,
  full: 3900,
};

function decideBuy(budget: number, isPistol: boolean): BuyType {
  if (isPistol) return "pistol";
  if (budget >= 3900) return "full";
  if (budget >= 2000) return "half";
  if (budget >= 1000) return "force";
  return "eco";
}

function lossIncome(consecutiveLosses: number): number {
  if (consecutiveLosses <= 1) return 1900;
  if (consecutiveLosses === 2) return 2400;
  return 2900;
}

// ── Event text templates ──

function clutchText(ign: string, n: number, map: string, r: number): string {
  const templates = [
    `${ign} clutch 1v${n} on ${map} · Round ${r}`,
    `${ign} holds his nerve · 1v${n} · Round ${r}`,
    `Impossible but ${ign} does it · 1v${n}`,
  ];
  return templates[Math.floor(Math.random() * templates.length)]!;
}

function aceText(ign: string, map: string, r: number, s1: number, s2: number): string {
  const templates = [
    `${ign} ACE · ${map} · Round ${r}`,
    `5 kills for ${ign} — site cleaned`,
    `The ace from ${ign} · ${s1}-${s2}`,
  ];
  return templates[Math.floor(Math.random() * templates.length)]!;
}

function ecoWinText(team: string, r: number, s1: number, s2: number): string {
  const templates = [
    `ECO WIN · ${team} wins with pistols · Round ${r}`,
    `${team} force buy pays off · ${s1}-${s2}`,
    `Budget miracle for ${team} · Round ${r}`,
  ];
  return templates[Math.floor(Math.random() * templates.length)]!;
}

function momentumBreakText(team: string, streakLen: number, r: number): string {
  const templates = [
    `${team} breaks the ${streakLen}-round streak · Round ${r}`,
    `Momentum shift — ${team} stops the bleeding`,
    `The streak ends at ${streakLen} · ${team} responds`,
  ];
  return templates[Math.floor(Math.random() * templates.length)]!;
}

function firstBloodText(ign: string, r: number): string {
  const templates = [
    `${ign} opens the round with first blood · Round ${r}`,
    `First kill ${ign} — early advantage`,
    `${ign} catches the first pick`,
  ];
  return templates[Math.floor(Math.random() * templates.length)]!;
}

function defuseClutchText(ign: string, team: string, r: number): string {
  const templates = [
    `Spike defuse clutch by ${ign} · Round ${r}`,
    `${ign} defuses with seconds left`,
    `The defuse goes through — ${team} survives`,
  ];
  return templates[Math.floor(Math.random() * templates.length)]!;
}

// ── Player selection weighted by ACS ──

function pickWeightedPlayer(players: SimPlayer[]): SimPlayer | undefined {
  if (players.length === 0) return undefined;
  const weights = players.map((p) => Math.max(p.acs, 50));
  const total = weights.reduce((s, v) => s + v, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < players.length; i++) {
    roll -= weights[i]!;
    if (roll <= 0) return players[i]!;
  }
  return players[players.length - 1];
}

// ── Clutch size generation ──

function rollClutchSize(): { n: number; weight: number } {
  const roll = Math.random();
  if (roll < 0.40) return { n: 1, weight: 2 };
  if (roll < 0.75) return { n: 2, weight: 4 };
  if (roll < 0.93) return { n: 3, weight: 7 };
  if (roll < 0.99) return { n: 4, weight: 10 };
  return { n: 5, weight: 15 };
}

// ── Main simulation ──

function simulateRounds(
  str1: number, str2: number,
  team1: SimTeam, team2: SimTeam,
  mapName?: string,
): { score1: number; score2: number; rounds: RoundEvent[] } {
  let s1 = 0;
  let s2 = 0;
  const rounds: RoundEvent[] = [];
  let roundNum = 0;

  // Economy state
  let budget1 = 800;
  let budget2 = 800;
  let t1LossStreak = 0;
  let t2LossStreak = 0;
  // Track consecutive wins for momentum
  let t1WinStreak = 0;
  let t2WinStreak = 0;

  const map = mapName ?? "Unknown";

  function playRound(half: 1 | 2 | "OT", attackerIsT1: boolean) {
    roundNum++;
    const isPistol = roundNum === 1 || roundNum === 13;
    const isOT = half === "OT";

    // Reset budget on pistol rounds
    if (isPistol) {
      budget1 = 800;
      budget2 = 800;
    }

    // In OT, everyone gets full buy
    const buy1: BuyType = isOT ? "full" : decideBuy(budget1, isPistol);
    const buy2: BuyType = isOT ? "full" : decideBuy(budget2, isPistol);

    const buyFactor1 = BUY_FACTOR[buy1];
    const buyFactor2 = BUY_FACTOR[buy2];

    // Deduct cost after buying
    if (!isOT) {
      budget1 -= BUY_COST[buy1];
      budget2 -= BUY_COST[buy2];
    }

    // Snapshot budgets after buy (what they have left)
    const postBuyBudget1 = Math.max(budget1, 0);
    const postBuyBudget2 = Math.max(budget2, 0);

    // Win probability
    const adjStr1 = str1 * buyFactor1;
    const adjStr2 = str2 * buyFactor2;
    const adjTotal = adjStr1 + adjStr2;

    const atkBonus = 0.02;
    let chance1: number;
    if (adjTotal > 0) {
      chance1 = adjStr1 / adjTotal;
    } else {
      chance1 = 0.5;
    }
    if (attackerIsT1) {
      chance1 += atkBonus;
    } else {
      chance1 -= atkBonus;
    }

    // Playstyle: defensive round bonus (applies to team while defending)
    const ps1 = getPlaystyleBonus(team1.playstyle);
    const ps2 = getPlaystyleBonus(team2.playstyle);
    if (!attackerIsT1) {
      // T1 defends
      chance1 += ps1.defenseRoundBonus;
      chance1 -= ps2.defenseRoundBonus;
    } else {
      // T2 defends
      chance1 -= ps2.defenseRoundBonus;
      chance1 += ps1.defenseRoundBonus;
    }

    // Playstyle: eco win boost (only applies when a team is on eco/force)
    if (buy1 === "eco" || buy1 === "force") chance1 += ps1.ecoWinBonus;
    if (buy2 === "eco" || buy2 === "force") chance1 -= ps2.ecoWinBonus;

    chance1 = Math.max(0.15, Math.min(0.85, chance1));

    const noise = randFloat(-0.08, 0.08);
    const t1Wins = Math.random() < chance1 + noise;

    // Spike plant — 40% chance per round
    const spikePlanted = Math.random() < 0.4;
    // Estimate kills for winning team (2-4)
    const winnerKills = Math.floor(randFloat(2, 4.99));

    // Update scores
    if (t1Wins) {
      s1++;
    } else {
      s2++;
    }

    // Previous streaks (before this round's result)
    const prevT1Streak = t1WinStreak;
    const prevT2Streak = t2WinStreak;

    // Update streaks and economy
    if (t1Wins) {
      t1WinStreak++;
      t2WinStreak = 0;
      t1LossStreak = 0;
      t2LossStreak++;

      // Winner income
      budget1 += 3000 + winnerKills * 200;
      // Loser income
      budget2 += lossIncome(t2LossStreak);
      // Spike plant bonus (for attacker side — applies even on loss)
      if (spikePlanted) {
        if (attackerIsT1) budget1 += 300;
        else budget2 += 300;
      }
    } else {
      t2WinStreak++;
      t1WinStreak = 0;
      t2LossStreak = 0;
      t1LossStreak++;

      budget2 += 3000 + winnerKills * 200;
      budget1 += lossIncome(t1LossStreak);
      if (spikePlanted) {
        if (attackerIsT1) budget1 += 300;
        else budget2 += 300;
      }
    }

    // ── Event generation ──
    const winTeam = t1Wins ? team1 : team2;
    const winTeamName = winTeam.name;
    const loserBuy = t1Wins ? buy2 : buy1;
    const winnerBuy = t1Wins ? buy1 : buy2;

    // Is this an eco win? (winner was on eco/force and opponent was on half/full)
    const isEcoWin =
      (winnerBuy === "eco" || winnerBuy === "force") &&
      (loserBuy === "full" || loserBuy === "half");

    // Is this a momentum break? (opponent had 3+ streak)
    const brokenStreak = t1Wins ? prevT2Streak : prevT1Streak;
    const isMomentumBreak = brokenStreak >= 3;

    // Budget mismatch
    const isBudgetMismatch =
      (buy1 === "full" && buy2 === "eco") || (buy2 === "full" && buy1 === "eco");

    // Base event chance: 30%
    let eventChance = 0.30;
    if (isPistol) eventChance += 0.30;
    if (Math.abs(s1 - s2) <= 1 && (s1 + s2) > 2) eventChance += 0.15;
    if (isOT) eventChance += 0.25;
    if ((t1Wins && prevT1Streak >= 2) || (!t1Wins && prevT2Streak >= 2)) eventChance += 0.10;
    if (isBudgetMismatch) eventChance += 0.20;

    // Eco wins and momentum breaks are near-automatic
    if (isEcoWin) eventChance = 0.90;

    let event: RoundEventDetail | null = null;

    if (Math.random() < eventChance) {
      // Determine event type
      if (isEcoWin) {
        event = {
          type: "eco_win",
          text: ecoWinText(winTeamName, roundNum, s1, s2),
          weight: 3,
        };
      } else if (isMomentumBreak) {
        event = {
          type: "momentum_break",
          text: momentumBreakText(winTeamName, brokenStreak, roundNum),
          weight: 4,
        };
      } else {
        // Playstyle influence — aggressive teams generate more first-blood events
        const winnerIsT1 = t1Wins;
        const winnerPs = winnerIsT1 ? ps1 : ps2;
        // Roll for event type (tilted by winner's playstyle first blood bonus)
        const typeRoll = Math.random() - winnerPs.firstBloodBonus;
        if (typeRoll < 0.25) {
          // Clutch
          const clutch = rollClutchSize();
          const player = pickWeightedPlayer(winTeam.players);
          const ign = player?.ign ?? winTeamName;
          event = {
            type: "clutch",
            text: clutchText(ign, clutch.n, map, roundNum),
            playerIgn: ign,
            weight: clutch.weight,
            clutchSize: `1v${clutch.n}`,
          };
        } else if (typeRoll < 0.33) {
          // Ace
          const player = pickWeightedPlayer(winTeam.players);
          const ign = player?.ign ?? winTeamName;
          event = {
            type: "ace",
            text: aceText(ign, map, roundNum, s1, s2),
            playerIgn: ign,
            weight: 6,
          };
        } else if (typeRoll < 0.53) {
          // First blood
          const player = pickWeightedPlayer(winTeam.players);
          const ign = player?.ign ?? winTeamName;
          event = {
            type: "first_blood",
            text: firstBloodText(ign, roundNum),
            playerIgn: ign,
            weight: 1,
          };
        } else if (typeRoll < 0.68) {
          // Defuse clutch
          const player = pickWeightedPlayer(winTeam.players);
          const ign = player?.ign ?? winTeamName;
          event = {
            type: "defuse_clutch",
            text: defuseClutchText(ign, winTeamName, roundNum),
            playerIgn: ign,
            weight: 5,
          };
        } else if (typeRoll < 0.73) {
          // Flawless
          event = {
            type: "flawless",
            text: `FLAWLESS — ${winTeamName} perfect round · Round ${roundNum}`,
            weight: 3,
          };
        } else {
          // No special event even though chance triggered — standard round
          event = null;
        }
      }
    }

    rounds.push({
      round: roundNum,
      winner: t1Wins ? 1 : 2,
      half,
      score1: s1,
      score2: s2,
      team1Buy: buy1,
      team2Buy: buy2,
      team1Budget: postBuyBudget1,
      team2Budget: postBuyBudget2,
      event,
      kills: [],
      loadouts: [],
      plantTime: null,
      spikeDefused: false,
    });
  }

  // First half: 12 rounds, team1 attacks
  for (let i = 0; i < 12 && s1 < 13 && s2 < 13; i++) {
    playRound(1, true);
  }

  // Reset economy for second half
  budget1 = 800;
  budget2 = 800;
  t1LossStreak = 0; t2LossStreak = 0;
  t1WinStreak = 0; t2WinStreak = 0;

  // Second half: 12 rounds, team2 attacks
  for (let i = 0; i < 12 && s1 < 13 && s2 < 13; i++) {
    playRound(2, false);
  }

  // Overtime if 12-12 — MR2: always play BOTH rounds, repeat if still tied
  while (s1 === s2) {
    playRound("OT", true);   // round 1 of OT pair
    playRound("OT", false);  // round 2 of OT pair (always played)
    // If still tied after pair → loop continues with another pair
  }

  return { score1: s1, score2: s2, rounds };
}

// ── Simulate a single map (delegates to duel engine) ──

import { simulateMapDuel } from "./duelEngine";

export function simulateMap(
  team1: SimTeam,
  team2: SimTeam,
  mapName: string,
  options?: SimMapOptions & { priorHotness?: Record<string, number> },
): MapResult & { endOfMapHotness?: Record<string, number> } {
  const result = simulateMapDuel(team1, team2, mapName, {
    team1Agents: options?.team1Agents?.map((a) => ({ playerId: a.playerId, agentName: a.agentName })),
    team2Agents: options?.team2Agents?.map((a) => ({ playerId: a.playerId, agentName: a.agentName })),
    team1StartsAttack: options?.team1StartsAttack,
    currentWeek: options?.currentWeek,
    agentMastery: options?.agentMastery,
    team1CoachBoost: options?.team1CoachBoost,
    team2CoachBoost: options?.team2CoachBoost,
    priorHotness: options?.priorHotness,
    team1Pairs: options?.team1Pairs,
    team2Pairs: options?.team2Pairs,
  });

  const highlights = generateHighlights(mapName, team1.name, team2.name, result.score1, result.score2, result.playerStats);

  return {
    map: mapName,
    score1: result.score1,
    score2: result.score2,
    rounds: result.rounds,
    playerStats: result.playerStats,
    highlights,
    endOfMapHotness: result.endOfMapHotness,
  };
}

// ── Main export ──

export function simulateMatch(
  team1: SimTeam,
  team2: SimTeam,
  format: MatchFormat,
  mapOverride?: string[],
  mapPool?: string[],
  matchOptions?: {
    team1CoachBoost?: number;
    team2CoachBoost?: number;
    team1Pairs?: Map<string, number>;
    team2Pairs?: Map<string, number>;
  },
): MatchResult {
  const mapsNeeded = format === "BO1" ? 1 : format === "BO3" ? 2 : 3;
  const mapCount = format === "BO1" ? 1 : format === "BO3" ? 3 : 5;

  const pool = mapPool ?? MAP_POOLS.POOL_A;
  const mapPick = mapOverride ?? shuffle([...pool]).slice(0, mapCount);

  const maps: MapResult[] = [];
  let t1Wins = 0;
  let t2Wins = 0;
  let priorHotness: Record<string, number> | undefined;

  for (const mapName of mapPick) {
    if (t1Wins >= mapsNeeded || t2Wins >= mapsNeeded) break;

    const result = simulateMap(team1, team2, mapName, {
      team1CoachBoost: matchOptions?.team1CoachBoost,
      team2CoachBoost: matchOptions?.team2CoachBoost,
      team1Pairs: matchOptions?.team1Pairs,
      team2Pairs: matchOptions?.team2Pairs,
      priorHotness, // carry confidence between maps
    });
    maps.push(result);
    priorHotness = result.endOfMapHotness;

    if (result.score1 > result.score2) t1Wins++;
    else t2Wins++;
  }

  return {
    winnerId: t1Wins > t2Wins ? team1.id : team2.id,
    score: { team1: t1Wins, team2: t2Wins },
    maps,
  };
}
