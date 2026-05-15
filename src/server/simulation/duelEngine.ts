/**
 * Duel-based simulation engine for Valorant.
 * Replaces the aggregate "team score" approach with real round-by-round
 * duel resolution, agent impact, trades, phases, momentum, and anti-reads.
 *
 * Core flow:
 *   simulateMap
 *     for each round:
 *       buildRoundContext (economy, positions, momentum)
 *       simulateFullRound
 *         phase SETUP       → occasional early duels
 *         phase EXECUTION   → cascade of duels on chosen site
 *         phase POSTPLANT   → retake duels
 *       accumulate kills/deaths/fk/fd
 *       update momentum, economy
 *     build playerStats from accumulated round data
 */

import type { Role, Playstyle } from "@/generated/prisma/client";
import { AGENT_META } from "@/constants/meta";
import { VALORANT_AGENTS } from "@/constants/agents";
import { getMapProfile, type MapProfile, type SiteProfile } from "./mapProfiles";

// ──────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────

export type BuyType = "pistol" | "eco" | "force" | "half" | "full";

export interface SimPlayerInput {
  id: string;
  ign: string;
  acs: number;
  kd: number;
  adr: number;
  kast: number;
  hs: number;
  role: Role;
  mapFactors?: Record<string, number>;
  joinedWeek?: number;
  /** V4 — 0-20 FM-style overall. Undefined treated as 10 (neutral). */
  overall?: number;
  /** Form momentum [-10, +10]. Tilts gameDay roll ±5%. */
  formMomentum?: number;
}

export interface SimTeamInput {
  id: string;
  name: string;
  tag: string;
  players: SimPlayerInput[];
  skillAim: number;
  skillUtility: number;
  skillTeamplay: number;
  playstyle?: Playstyle;
  /** Tier 2 — eco discipline (0-100, default 50). Compounds with playstyle on save threshold. */
  ecoDiscipline?: number;
  /** Tier 2 — per-map preparation level (0-100, default 50). Subtle rating multiplier on that map. */
  mapPrep?: Record<string, number>;
  /** Tier 2 — adaptation rating (0-100, default 50). Drives mid-match audibles + halftime shifts. */
  adaptationRating?: number;
}

interface RoundStats {
  k: number;
  d: number;
  a: number;
  fk: number;
  fd: number;
  damage: number; // accumulates for ADR
}

/** Runtime state for a player during simulation */
interface PlayerState {
  input: SimPlayerInput;
  agent: string;
  teamId: string;
  rating: number;
  hotness: number; // Combined multiplier: rolling KD (map form) + duel streak (on fire now)
  rollingImpact: number; // Smoothed K/D impact over last 3 rounds (-0.05..+0.05)
  consecutiveDuelsWon: number; // Resets on any duel loss
  consecutiveDuelsLost: number; // Resets on any duel win
  tiltResistance: number; // 0.35..0.95
  clutchRating: number;  // 0..1 — boost applied in 1vN situations
  /** Current ultimate points accumulated this map (resets at map start). */
  ultPoints: number;
  /** Points required to activate this agent's ultimate (7 default, 8 for heavy ults). */
  ultMax: number;
  /** Whether the player has popped their ult during the current round. */
  isUsingUltThisRound: boolean;
  /** When the player pops a duel-type ult, the +mechEdge bonus for their own duels this round. */
  ultMechEdgeThisRound: number;
  // ── Tier 3 micro stats (0-100) — derived from existing player attrs. ──
  /** Game IQ: positional sense + crosshair placement decisions. Affects duel edge. */
  gameIQ: number;
  /** Aggression: peek-first vs hold-the-angle tendency. Weights entry-fragger pick. */
  aggression: number;
  /** Utility IQ: how impactful the player's ability usage is. Scales ability emit prob. */
  utilityIQ: number;
  /** Consistency: variance of per-map performance. Star instable (low) vs role-player stable (high). */
  consistencyRating: number;
  total: RoundStats;
  perRound: RoundStats[];
}

/** Economy state for a player — credits and loadout */
interface Economy {
  credits: number;
  /** Weapon name — keyed into WEAPON_CATALOG for price + tier lookups */
  weapon: WeaponName;
  armor: ArmorType;
  /** Derived from WEAPON_CATALOG[weapon].tier — cached for duel math */
  weaponTier: number;
  /** True if the current weapon came from a pickup (dead teammate) — free this round */
  fromPickup: boolean;
}

type ArmorType = "heavy" | "light" | "none";

interface TeamRuntime {
  input: SimTeamInput;
  players: PlayerState[];
  score: number;
  lossStreak: number;
  winStreak: number;
  lossesBonus: number; // counts consecutive losses for loss bonus
  sitePreference: Record<string, number>; // "A" | "B" | "M" — chosen site counts for anti-read
  economy: Map<string, Economy>; // playerId → economy
  /** Weapons available at next round's buy phase (from dead teammates of previous round) */
  weaponPool: Array<{ weapon: WeaponName }>;
  /** Designated entry fragger for the current round (set during planBuys) */
  roundEntryId: string | null;
  /** Designated AWPer — set via options (tactics) with fallback to Duelist/Sentinel */
  awperId: string | null;
  /** True if team chose to save this round — slight stall in duels */
  inSaveMode: boolean;
  /**
   * Mercato V3 — typed pair strengths for intra-team relationships. Key =
   * "playerALoId|playerBHiId|TYPE" (IDs sorted lexicographically, TYPE in
   * DUO|CLASH). Strength 0-1 from the PlayerRelation row. MENTOR does not
   * affect duels.
   */
  pairs?: Map<string, number>;
  /** Cached map attack bias — same for both teams in the same match. */
  mapAtkBias: number;
  /** Cached playstyle behavioral multipliers (Tier 1 wiring). */
  playstyleMods: PlaystyleMods;
  /** Coach adaptation 0-100 (default 50) — dampens loss-streak tilt for this team. */
  coachAdaptation: number;
  /** Coach mental 0-100 (default 50) — raises tilt resistance for this team's players. */
  coachMental: number;
  /** Team adaptation rating (0-100). Drives halftime + loss-streak audibles. */
  adaptationRating: number;
  /**
   * Cumulative duel-prob boost the team has earned from successful tactical
   * adaptations this match. Halftime success = +0.025; intra-half loss-streak
   * audible = +0.015. Capped at +0.06 to avoid runaway. Applied as a small
   * edge in duelWinProb. The leading team can't gain this — it represents
   * "the trailing side figured something out", not "the leader got better".
   */
  adaptationEdge: number;
  /** True once this team has used its intra-half audible. Resets at halftime. */
  lossStreakAdaptedThisHalf: boolean;
  // ── Team-level ult effects active THIS ROUND ──
  /** Info-ult active (Sova/Fade/Cypher/Skye): infoEdge across all team duels. */
  ultInfoEdge: number;
  /** Zone control (Viper/Astra/Harbor/Brimstone): positional/ability edge in exec+postplant. */
  ultZoneEdge: number;
  /** Lockdown (Killjoy/Breach/Tejo/Deadlock/Vyse/Kayo): area-denial edge any phase. */
  ultLockdownEdge: number;
  /** Ability-edge component of zone/lockdown ults (separate from positional). */
  ultAbilityEdge: number;
}

export interface RoundEventDetail {
  type: "clutch" | "ace" | "eco_win" | "first_blood" | "momentum_break" | "defuse_clutch" | "flawless";
  text: string;
  playerIgn?: string;
  weight: number;
  clutchSize?: string;
}

/** Kill entry in a round's event feed — what actually happened in the sim */
export interface RoundKillEvent {
  killerId: string;
  victimId: string;
  assistIds: string[];
  isFirstKill: boolean;
  /** Time into the round (seconds) when the kill occurred */
  timing: number;
}

/** Per-player loadout snapshot taken just AFTER buys, just BEFORE the round plays */
export interface PlayerLoadoutSnapshot {
  playerId: string;
  weapon: string;     // weapon name (e.g. "Vandal", "Operator", "Spectre")
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
  team1Buy: BuyType;
  team2Buy: BuyType;
  team1Budget: number;
  team2Budget: number;
  event: RoundEventDetail | null;
  /** Real per-round kill log — drives round-by-round stat accumulation in the UI */
  kills: RoundKillEvent[];
  /** Post-buy loadouts for all 10 players — drives the scoreboard shield/weapon/creds columns */
  loadouts: PlayerLoadoutSnapshot[];
  /** When spike plant completed (seconds into round). null = never planted */
  plantTime: number | null;
  /** True if spike was defused by defenders (only meaningful when plantTime !== null) */
  spikeDefused: boolean;
}

export interface PlayerMapStatsOut {
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

export interface MapResultOut {
  map: string;
  score1: number;
  score2: number;
  rounds: RoundEvent[];
  playerStats: PlayerMapStatsOut[];
  /** Hotness at end of this map (playerId → hotness). Pass as `priorHotness` to next map in series. */
  endOfMapHotness: EndOfMapHotness;
}

export interface DuelMapOptions {
  team1Agents?: Array<{ playerId: string; agentName: string }>;
  team2Agents?: Array<{ playerId: string; agentName: string }>;
  team1StartsAttack?: boolean;
  currentWeek?: number;
  agentMastery?: Record<string, number>;
  team1CoachBoost?: number;        // utilityBoost (prep)
  team2CoachBoost?: number;
  team1CoachAdaptation?: number;   // scoutingSkill — mid-match reads, dampens snowball
  team2CoachAdaptation?: number;
  team1CoachMental?: number;       // trainingEff — raises player tilt resistance
  team2CoachMental?: number;
  /**
   * Optional: carryover hotness from the previous map in a BO3/BO5 series.
   * playerId → end-of-previous-map hotness. 50% is retained as starting confidence.
   * Duel streaks (consecutive wins/losses) always reset — they're map-specific.
   */
  priorHotness?: Record<string, number>;
  /** Designated AWPer for team 1 (from tactics). Falls back to Duelist/Sentinel if unset. */
  team1AwperId?: string;
  /** Designated AWPer for team 2 (from tactics). Falls back to Duelist/Sentinel if unset. */
  team2AwperId?: string;
  /** Per-team relation pair maps (V3). Key = "idLo|idHi|TYPE", value = strength. */
  team1Pairs?: Map<string, number>;
  team2Pairs?: Map<string, number>;
}

/** End-of-map hotness per player — can be passed to the next map as priorHotness */
export type EndOfMapHotness = Record<string, number>;

// ──────────────────────────────────────────────────────────
// Agent duel modifiers
// ──────────────────────────────────────────────────────────

interface AgentDuelMod {
  inDuel: number; // direct duel win probability modifier
  entryProb: number; // likelihood of being the entry fragger
  infoAdvantage: number; // bonus when team has better info
  defenseBonus: number; // bonus on defense rounds
  postPlantBonus: number; // bonus in postplant phase
  tradeProb: number; // bonus to trade probability when teammate dies
}

const DEFAULT_MOD: AgentDuelMod = {
  inDuel: 0, entryProb: 0.2, infoAdvantage: 0, defenseBonus: 0, postPlantBonus: 0, tradeProb: 0,
};

const AGENT_MOD: Record<string, Partial<AgentDuelMod>> = {
  // Duelists
  Jett:    { inDuel: 0.08, entryProb: 0.35 },
  Raze:    { inDuel: 0.06, entryProb: 0.30, postPlantBonus: 0.05 },
  Neon:    { inDuel: 0.07, entryProb: 0.32 },
  Phoenix: { inDuel: 0.04, entryProb: 0.28 },
  Reyna:   { inDuel: 0.05, entryProb: 0.28 },
  Yoru:    { inDuel: 0.05, entryProb: 0.22 },
  Iso:     { inDuel: 0.06, entryProb: 0.25 },
  Waylay:  { inDuel: 0.07, entryProb: 0.30 },
  // Initiators
  Fade:    { infoAdvantage: 0.14, tradeProb: 0.05 },
  Sova:    { infoAdvantage: 0.15, tradeProb: 0.04 },
  Skye:    { infoAdvantage: 0.10, inDuel: 0.02 },
  "KAY/O": { infoAdvantage: 0.08, inDuel: 0.05 },
  Breach:  { infoAdvantage: 0.09, tradeProb: 0.04 },
  Gekko:   { infoAdvantage: 0.08, tradeProb: 0.06 },
  Tejo:    { infoAdvantage: 0.10, inDuel: 0.02 },
  // Controllers
  Omen:      { infoAdvantage: 0.07 },
  Brimstone: { postPlantBonus: 0.12 },
  Viper:     { postPlantBonus: 0.15, defenseBonus: 0.03 },
  Astra:     { infoAdvantage: 0.05, postPlantBonus: 0.05 },
  Harbor:    { postPlantBonus: 0.10 },
  Clove:     { inDuel: 0.03, entryProb: 0.15 },
  Miks:      { infoAdvantage: 0.05, postPlantBonus: 0.05 },
  // Sentinels
  Killjoy:  { defenseBonus: 0.12, postPlantBonus: 0.06 },
  Cypher:   { defenseBonus: 0.10, infoAdvantage: 0.08 },
  Sage:     { defenseBonus: 0.06, tradeProb: 0.04 },
  Chamber:  { defenseBonus: 0.05, inDuel: 0.10 },
  Deadlock: { defenseBonus: 0.10 },
  Vyse:     { defenseBonus: 0.08 },
};

function getAgentMod(agent: string): AgentDuelMod {
  const override = AGENT_MOD[agent] ?? {};
  return { ...DEFAULT_MOD, ...override };
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

function randFloat(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function rand(p: number): boolean {
  return Math.random() < p;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function gauss(mean: number, std: number): number {
  const u1 = Math.max(Math.random(), 1e-6);
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * std;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ──────────────────────────────────────────────────────────
// Hot hand / cold hand — personal duel streak tracker
// ──────────────────────────────────────────────────────────

/** Bonus from consecutive duels won (the "on fire RIGHT NOW" effect) */
function streakBonus(wins: number): number {
  if (wins <= 0) return 0;
  // Capped at +0.10 — the previous +0.16 cap stacked with rolling impact and
  // team tilt to snowball maps into 13-3 / 13-6 stomps even when the dashboard
  // showed close win probabilities. 1→0.02, 2→0.04, 3→0.06, 4→0.08, 5+→0.10.
  return Math.min(0.10, 0.02 * wins);
}

/** Penalty from consecutive duels lost (cold hand) */
function streakPenalty(losses: number): number {
  if (losses <= 1) return 0;
  // Capped at -0.06 (was -0.10) so cold-side compounding doesn't tank a map
  // beyond recovery.
  return Math.max(-0.06, -0.02 * (losses - 1));
}

/**
 * Recompute a player's hotness multiplier from both:
 *   - rolling K/D impact over last 3 rounds (map form)
 *   - current consecutive duel streak (in-the-moment confidence)
 * Losses are moderated by the player's tiltResistance.
 */
function recalcHotness(p: PlayerState): void {
  // ── Asymmetric tilt resistance ──
  // Wins: FULL bonus regardless of resistance (a cold-blooded Boaster still rides his 4-kill streak)
  // Losses: dampened by resistance (Boaster 0.85 → only 15% of loss impact; Duelist 0.5 → 50%)
  const rawStreakBonus = streakBonus(p.consecutiveDuelsWon); // >= 0
  const rawStreakPenalty = streakPenalty(p.consecutiveDuelsLost); // <= 0
  const adjStreakBonus = rawStreakBonus; // no scaling — resistance doesn't cap positive momentum
  const adjStreakPenalty = rawStreakPenalty * (1 - p.tiltResistance);
  const streakComponent = adjStreakBonus + adjStreakPenalty;

  // Combined: rolling 40%, streak 60% (streak weighs more — "on fire right now" > "good map so far")
  const combined = p.rollingImpact * 0.4 + streakComponent * 0.6;
  p.hotness = clamp(1.0 + combined, 0.82, 1.20);
}

// ──────────────────────────────────────────────────────────
// Player rating + state construction
// ──────────────────────────────────────────────────────────

function computeRating(p: SimPlayerInput, mapName: string, agentName: string, agentMastery?: Record<string, number>): number {
  // Base rating from ACS/KD (narrower band to prevent one-sided stomps)
  const acsScore = p.acs / 240;
  const kdScore = p.kd / 1.15;
  const baseRating = clamp(acsScore * 0.6 + kdScore * 0.4, 0.82, 1.18);

  // Map affinity — wider band so a team's bad/good map actually matters.
  // Real mapFactors in the seed range ~0.85 → ~1.40 (e.g. Haven outliers);
  // clamping to ±8% killed the signal entirely. [0.78, 1.22] gives a ~56%
  // delta between a player's worst and best map — enough that bad-map games
  // skew, without single-map factors swinging an entire match outright.
  const mapFactor = clamp(p.mapFactors?.[mapName] ?? 1.0, 0.78, 1.22);

  // Agent mastery (0-5 stars → 0.95-1.05)
  const masteryKey = `${p.id}:${agentName}`;
  const stars = agentMastery?.[masteryKey] ?? 2;
  const masteryBonus = 0.95 + (stars / 5) * 0.1;

  // Agent meta score (±5%)
  const metaBonus = clamp(AGENT_META[agentName] ?? 1.0, 0.95, 1.05);

  // V4 — FM-style overall multiplier. Overall 0-20, multiplier 0.7-1.3.
  const overall = p.overall ?? 10;
  const overallMultiplier = 0.7 + (overall / 20) * 0.6;

  return baseRating * mapFactor * masteryBonus * metaBonus * overallMultiplier;
}

function rollGameDay(consistencyRating: number = 50, formMomentum: number = 0): number {
  // Per-player game-day variance — moderately tight. Old ranges (career night
  // 1.25-1.55, disaster 0.62-0.78) compounded with mapFactor, teamPrepRoll and
  // overall multipliers to produce 13-0 stomps even when a team was an 80%
  // favorite. The tails are still meaningful but no longer override the
  // baseline rating gap.
  //
  // Tier 3 — consistency dampens the deviation from 1.0. A 100-consistency
  // role player rolls in a tight band (0.96-1.04 even on a "great" tier),
  // while a 0-consistency star inflates the tails further.
  const roll = Math.random();
  let raw: number;
  if (roll < 0.03) raw = randFloat(1.15, 1.30);
  else if (roll < 0.12) raw = randFloat(1.05, 1.15);
  else if (roll < 0.88) raw = randFloat(0.92, 1.08);
  else if (roll < 0.97) raw = randFloat(0.85, 0.92);
  else raw = randFloat(0.72, 0.85);

  // Variance scaling: consistency 50 = 1.0× (default), 100 = 0.4× (tight),
  // 0 = 1.2× (volatile). The deviation from 1.0 is rescaled, the median
  // stays at 1.0.
  const variance = consistencyRating >= 50
    ? 1.0 - (consistencyRating - 50) / 83  // 50→1.0, 100→0.4
    : 1.0 + (50 - consistencyRating) / 250; // 50→1.0, 0→1.2
  let scaled = 1.0 + (raw - 1.0) * variance;

  // Form momentum tilt — un joueur en forme (+10) bénéficie d'un boost
  // multiplicatif de +5% sur le gameDay roll, un joueur en méforme (-10)
  // de -5%. Linéaire entre les deux. Capture l'idée "j'ai gagné mes 5
  // derniers, j'arrive avec la flèche". Indépendant de la variance
  // (s'applique après le scaling consistency).
  if (formMomentum !== 0) {
    // Was 0.05 → momentum=+8 gave +4% (saturating with the ±8 soft cap to
    // +5% pre-cap). Reduced to 0.03 so the snowball is tamer: at the new
    // ±5 soft cap, max boost is ±1.5% (vs ±4% before). Form still matters
    // but doesn't single-handedly carry a streak.
    const momentumMul = 1 + (formMomentum / 10) * 0.03;
    scaled *= momentumMul;
  }
  return scaled;
}

/**
 * Derive Tier 3 micro stats from a player's underlying attributes. Lets every
 * player get differentiated game IQ / aggression / utility usage / consistency
 * without requiring new DB fields. All values clamped to [10, 95].
 */
function deriveMicroStats(p: SimPlayerInput): {
  gameIQ: number;
  aggression: number;
  utilityIQ: number;
  consistencyRating: number;
} {
  const roleBonus: Record<string, { iq: number; agg: number; util: number }> = {
    IGL:        { iq: 15, agg:  0,  util:  5 },
    Sentinel:   { iq: 10, agg: -10, util: 10 },
    Controller: { iq:  8, agg:  -5, util: 18 },
    Initiator:  { iq:  5, agg:   5, util: 15 },
    Duelist:    { iq:  0, agg:  20, util:  -5 },
    Flex:       { iq:  5, agg:   5, util:   5 },
  };
  const rb = roleBonus[p.role] ?? { iq: 0, agg: 0, util: 0 };
  const kast = p.kast ?? 70;
  const acs = p.acs ?? 200;

  // KAST is the strongest IQ proxy — players with high KAST consistently
  // contribute (kill / assist / survive / trade) round after round.
  const gameIQ = clamp(50 + (kast - 70) * 1.5 + rb.iq, 10, 95);
  // ACS reflects fragging volume which correlates with peeking + aggression.
  const aggression = clamp(50 + (acs - 200) / 5 + rb.agg, 10, 95);
  const utilityIQ = clamp(50 + rb.util + (kast - 70) * 0.5, 10, 95);
  // Consistency: closer to "central tendency" KAST → higher consistency,
  // wildly variable KAST → low consistency. Hard to model purely from
  // available fields; use KAST as a rough proxy on the assumption that
  // chronic high-KAST players are the most stable contributors.
  const consistencyRating = clamp(40 + (kast - 70) * 1.2, 15, 90);

  return { gameIQ, aggression, utilityIQ, consistencyRating };
}


function buildTeamRuntime(
  team: SimTeamInput,
  agents: Array<{ playerId: string; agentName: string }> | undefined,
  mapName: string,
  agentMastery: Record<string, number> | undefined,
  priorHotness?: Record<string, number>,
  designatedAwperId?: string,
): TeamRuntime {
  const agentByPlayer = new Map<string, string>();
  if (agents) {
    for (const a of agents) agentByPlayer.set(a.playerId, a.agentName);
  }

  // Ensure the comp covers the core roles (Duelist + Controller + Sentinel +
  // Initiator). Real Valorant comps need every primary role — when a team
  // lost their natural Duelist to mercato, *someone* still flexes onto a
  // duelist agent. Agent picks now respect each player's `agentPool` mastery
  // (via `agentMastery`) instead of defaulting everyone to Jett / Omen / etc.
  const roster = team.players.slice(0, 5);
  const initialAgents = new Map<string, string>();
  const ALL_CLASSES: ReadonlyArray<"Duelist" | "Initiator" | "Controller" | "Sentinel"> = [
    "Duelist", "Initiator", "Controller", "Sentinel",
  ];
  for (const p of roster) {
    const preset = agentByPlayer.get(p.id);
    if (preset) {
      initialAgents.set(p.id, preset);
      continue;
    }
    // Map player role → agent class. IGL / Flex pick the class they're most
    // mastered in across all 4. Single-class roles pick best agent in that
    // class.
    let cls: "Duelist" | "Initiator" | "Controller" | "Sentinel";
    if (p.role === "IGL" || p.role === "Flex") {
      cls = bestMasteredClassForPlayer(p.id, agentMastery, ALL_CLASSES);
    } else {
      cls = p.role as "Duelist" | "Initiator" | "Controller" | "Sentinel";
    }
    initialAgents.set(p.id, bestMasteredAgentForClass(p.id, cls, agentMastery));
  }
  function agentClass(agent: string): "Duelist" | "Initiator" | "Controller" | "Sentinel" {
    const meta = VALORANT_AGENTS.find((a) => a.name === agent);
    if (meta) return meta.role;
    return "Duelist";
  }
  const classesPresent = new Set<"Duelist" | "Initiator" | "Controller" | "Sentinel">();
  for (const a of initialAgents.values()) classesPresent.add(agentClass(a));

  // Flex priority for a forced role override: explicit Flex role first, then
  // a high-ACS non-IGL player, then any non-IGL, then anyone.
  function pickFlex(excludePlayerIds: Set<string>): typeof roster[number] | undefined {
    const remaining = roster.filter((p) => !excludePlayerIds.has(p.id));
    return (
      remaining.find((p) => p.role === "Flex") ??
      [...remaining].filter((p) => p.role !== "IGL").sort((a, b) => b.acs - a.acs)[0] ??
      remaining[0]
    );
  }
  // Gap-fill order: Duelist > Controller > Sentinel > Initiator. Duelist
  // first because no-entry comps are catastrophic; Initiator last because
  // many teams already cover info via Sova/Fade naturally and going without
  // is the least crippling gap.
  const requiredClasses: ReadonlyArray<"Duelist" | "Controller" | "Sentinel" | "Initiator"> = [
    "Duelist", "Controller", "Sentinel", "Initiator",
  ];
  const claimed = new Set<string>();
  // Players already filling a required role can't be re-overridden.
  for (const [pid, a] of initialAgents) {
    const cls = agentClass(a);
    if (requiredClasses.includes(cls as typeof requiredClasses[number])) claimed.add(pid);
  }
  for (const cls of requiredClasses) {
    if (classesPresent.has(cls)) continue;
    const candidate = pickFlex(claimed);
    if (!candidate) continue;
    // Pick the best-mastered agent of the missing class for this candidate
    // instead of hardcoding Jett / Omen / Killjoy / Fade.
    initialAgents.set(candidate.id, bestMasteredAgentForClass(candidate.id, cls, agentMastery));
    classesPresent.add(cls);
    claimed.add(candidate.id);
  }
  // Push the overrides back into agentByPlayer so the buildTeamRuntime map
  // below uses them as the source of truth.
  for (const [pid, a] of initialAgents) agentByPlayer.set(pid, a);

  // Per-match team preparation roll — represents scrims, prep, chemistry, tactics.
  // Tightened from ±10% to ±5%: combined with per-player gameDay variance, the
  // old range produced too many lopsided upsets. Underdogs can still take maps
  // (mapFactor + agent mastery + lucky duels) but not because of one prep roll.
  const teamPrepRoll = randFloat(0.95, 1.05);

  // Tier 2 — per-map preparation level. A team that practised Haven hard
  // performs measurably better on Haven (±10% multiplier on rating). Combines
  // with per-player `mapFactor` (which is individual map affinity) so a
  // team-wide bonus + an individual's natural map preference both matter.
  const mapPrepValue =
    typeof team.mapPrep === "object" && team.mapPrep
      ? team.mapPrep[mapName] ?? 50
      : 50;
  const mapPrepMultiplier = 1.0 + (mapPrepValue - 50) / 500;

  const players: PlayerState[] = team.players.slice(0, 5).map((p) => {
    const agent = agentByPlayer.get(p.id) ?? defaultAgentForRole(p.role);
    const baseRating = computeRating(p, mapName, agent, agentMastery);
    // Tier 3 — derive per-player micro stats from underlying attrs. Used for
    // gameIQ (duel edge), aggression (entry pick weight), utilityIQ (ability
    // emit prob), and consistencyRating (per-player variance damping).
    const micro = deriveMicroStats(p);
    const gameDay = rollGameDay(micro.consistencyRating, p.formMomentum ?? 0);
    const rating = baseRating * gameDay * teamPrepRoll * mapPrepMultiplier;

    // Tilt resistance — high = doesn't tilt easily (Boaster, Chronicle types).
    // Derived from role/leadership:
    //   IGLs = 0.85 (handle pressure)
    //   Sentinels = 0.75 (anchors, stable)
    //   Controllers = 0.7
    //   Initiators = 0.6
    //   Duelists = 0.5 (most emotional)
    //   Flex = 0.65
    // Plus KAST% contributes: consistent players tilt less.
    const roleResist: Record<string, number> = {
      IGL: 0.85, Sentinel: 0.75, Controller: 0.7, Initiator: 0.6, Duelist: 0.5, Flex: 0.65,
    };
    const base = roleResist[p.role] ?? 0.65;
    const kastBonus = clamp((p.kast - 70) / 200, -0.08, 0.08); // ±8% based on KAST
    const tiltResistance = clamp(base + kastBonus, 0.35, 0.95);

    // Clutch rating — how well a player performs as the last alive (1vN).
    // Derived from KAST consistency + role temperament. Duelists / Flex tend
    // to thrive in clutch, Controllers / Sentinels less so on average. Boost
    // is applied in `duelWinProb` when attacker or defender is solo.
    const clutchKast = clamp((p.kast - 70) / 50, -0.4, 0.6);
    const clutchRoleBonus: Record<string, number> = {
      Duelist: 0.30, Flex: 0.25, IGL: 0.20, Initiator: 0.10, Sentinel: 0.05, Controller: -0.05,
    };
    const clutchRating = clamp(0.5 + clutchKast + (clutchRoleBonus[p.role] ?? 0.10), 0, 1);

    // Carry over 50% of prior-map hotness (confidence across maps in a series).
    // Streaks always reset between maps — they're a "right now" signal.
    // Carryover between maps in a series. Old 50% retention with [0.9, 1.10]
    // clamp made the leading team start map 3 nearly neutral — the trailing
    // side could roll career-night gameDays and reverse-sweep through pure
    // variance. 80% retention with [0.85, 1.15] preserves more of the form
    // a player carries out of a dominant map, so reverse sweeps require the
    // trailing team to actually outplay (not just outroll) the favorite.
    const prior = priorHotness?.[p.id];
    const initialHotness = prior !== undefined ? clamp(1.0 + (prior - 1.0) * 0.8, 0.85, 1.15) : 1.0;
    // Translate back to rolling component so recalc stays consistent
    const initialRolling = (initialHotness - 1.0) / 0.4; // inverse of rolling*0.4 contribution

    return {
      input: p,
      agent,
      teamId: team.id,
      rating,
      hotness: initialHotness,
      rollingImpact: clamp(initialRolling, -0.05, 0.05),
      consecutiveDuelsWon: 0,
      consecutiveDuelsLost: 0,
      tiltResistance,
      clutchRating,
      ultPoints: 0,
      ultMax: ULT_MAX_BY_AGENT[agent] ?? 7,
      isUsingUltThisRound: false,
      ultMechEdgeThisRound: 0,
      gameIQ: micro.gameIQ,
      aggression: micro.aggression,
      utilityIQ: micro.utilityIQ,
      consistencyRating: micro.consistencyRating,
      total: { k: 0, d: 0, a: 0, fk: 0, fd: 0, damage: 0 },
      perRound: [],
    };
  });

  const economy = new Map<string, Economy>();
  for (const p of players) {
    economy.set(p.input.id, {
      credits: 800,
      weapon: "Classic",
      armor: "none",
      weaponTier: 0,
      fromPickup: false,
    });
  }

  // AWPer: explicit designation (from tactics) if that player is on this team, else
  // fallback to a Duelist or Sentinel (Jett/Chamber/Cypher/Killjoy archetype).
  let awperId: string | null = null;
  if (designatedAwperId && players.some((p) => p.input.id === designatedAwperId)) {
    awperId = designatedAwperId;
  } else {
    const fallback = players.find((p) => p.input.role === "Duelist" || p.input.role === "Sentinel");
    awperId = fallback?.input.id ?? null;
  }

  return {
    input: team,
    players,
    score: 0,
    lossStreak: 0,
    winStreak: 0,
    lossesBonus: 0,
    sitePreference: {},
    economy,
    weaponPool: [],
    roundEntryId: null,
    awperId,
    inSaveMode: false,
    mapAtkBias: getMapProfile(mapName).attackBias,
    playstyleMods: getPlaystyleMods(team.playstyle),
    coachAdaptation: 50,
    coachMental: 50,
    adaptationRating: team.adaptationRating ?? 50,
    adaptationEdge: 0,
    lossStreakAdaptedThisHalf: false,
    ultInfoEdge: 0,
    ultZoneEdge: 0,
    ultLockdownEdge: 0,
    ultAbilityEdge: 0,
  };
}

/**
 * Ultimate point caps per agent (mirrors real Valorant). Defaults to 7 if the
 * agent isn't catalogued. The heavier ults (Sage rez, Killjoy lockdown, Viper
 * pit, Raze nade, Breach quake, Chamber sniper, Deadlock annihilation) sit at 8.
 */
const ULT_MAX_BY_AGENT: Record<string, number> = {
  Sage: 8, Killjoy: 8, Viper: 8, Raze: 8, Breach: 8, Chamber: 8, Deadlock: 8,
  Phoenix: 6, Reyna: 6,
  // All others default to 7
};

/**
 * Categorized ultimate effects. Real Valorant ults split into a handful of
 * archetypes that should each affect duels differently:
 *   - duel        : booster for the user's own duels (Jett, Reyna, Raze nade)
 *   - info        : team-wide info advantage for the round (Sova, Fade, Cypher)
 *   - zone_control: defenders gain positional hold or attackers gain area
 *                   (Viper pit, Astra divide, Harbor reckoning, Brim strike)
 *   - lockdown    : forced site abandon / mass-CC (Killjoy, Breach, Tejo,
 *                   Deadlock); huge but slow
 *
 * `mechEdge` is per-duel boost when the user is in the duel. The team-level
 * fields propagate into TeamRuntime when the ult fires so EVERY duel of that
 * team gets the bonus where applicable.
 */
type UltType = "duel" | "info" | "zone_control" | "lockdown" | "revive";
interface UltConfig {
  type: UltType;
  mechEdge?: number;     // applied only to duels the user is in
  infoEdge?: number;     // team-wide, applies all phases
  positionalEdge?: number; // team-wide, applies in execution + postplant
  abilityEdge?: number;  // team-wide ability boost (lockdown, AOE forcing)
}
const ULT_CONFIG: Record<string, UltConfig> = {
  // Duel ults — entry frags & 1v1 finishers
  Jett:     { type: "duel", mechEdge: 0.22 },
  Reyna:    { type: "duel", mechEdge: 0.20 },
  Raze:     { type: "duel", mechEdge: 0.18 },
  Phoenix:  { type: "duel", mechEdge: 0.16 },
  Chamber:  { type: "duel", mechEdge: 0.17 },
  Neon:     { type: "duel", mechEdge: 0.15 },
  Yoru:     { type: "duel", mechEdge: 0.14 },
  Iso:      { type: "duel", mechEdge: 0.16 },
  Waylay:   { type: "duel", mechEdge: 0.17 },
  Clove:    { type: "duel", mechEdge: 0.12 }, // self-revive mode

  // Revive — special case, handled inline mid-round
  Sage:     { type: "revive" },

  // Info ults — guaranteed scans
  Sova:     { type: "info", infoEdge: 0.15 },
  Fade:     { type: "info", infoEdge: 0.12 },
  Cypher:   { type: "info", infoEdge: 0.18 }, // neural theft = full reveal
  Skye:     { type: "info", infoEdge: 0.10 },

  // Zone control — area denial / massive positional advantage
  Viper:    { type: "zone_control", positionalEdge: 0.15 },
  Astra:    { type: "zone_control", positionalEdge: 0.10, abilityEdge: 0.05 },
  Brimstone:{ type: "zone_control", abilityEdge: 0.12 },
  Omen:     { type: "zone_control", positionalEdge: 0.10 }, // From the Shadows = global repositioning

  // Lockdown — mass CC / forced vacate
  Killjoy:  { type: "lockdown", positionalEdge: 0.18, infoEdge: 0.05 },
  Breach:   { type: "lockdown", abilityEdge: 0.15 },
  Tejo:     { type: "lockdown", abilityEdge: 0.13 },
  Deadlock: { type: "lockdown", abilityEdge: 0.12 },
  Vyse:     { type: "lockdown", abilityEdge: 0.10 },
  Kayo:     { type: "lockdown", abilityEdge: 0.13 }, // null/cmd suppress = mass disable
  Gekko:    { type: "lockdown", abilityEdge: 0.11 }, // thrash area denial creature
  Harbor:   { type: "lockdown", positionalEdge: 0.14 }, // Reckoning forces vacate
};

/**
 * Per-playstyle behavioral multipliers. Wired into the round + buy logic so
 * an "Aggressive" team peeks more, force-buys earlier, and pressures sites
 * harder; a "Defensive" team holds angles, abuses utility, and saves more.
 *
 * All values are multipliers against baseline so the default ("Balanced")
 * stays at 1.0 and the engine behaves identically to the pre-Tier-1 path.
 */
interface PlaystyleMods {
  /** Multiplier on the 12% setup-phase duel chance + 15% info-phase duel chance. */
  setupDuelChance: number;
  /** Multiplier on the 3000 save-threshold (lower = forces force buys, higher = saves more). */
  forceBuyThreshold: number;
  /** Multiplier on postplant duel cadence — higher = more rapid duels (aggressive retake feel). */
  postplantAggression: number;
  /** Multiplier on team utility (ability) edge — applied team-wide. */
  midRoundUtility: number;
}
function getPlaystyleMods(ps: Playstyle | undefined): PlaystyleMods {
  switch (ps) {
    case "Aggressive":
      return { setupDuelChance: 1.5, forceBuyThreshold: 0.85, postplantAggression: 1.20, midRoundUtility: 0.90 };
    case "Tactical":
      return { setupDuelChance: 0.75, forceBuyThreshold: 1.00, postplantAggression: 1.00, midRoundUtility: 1.30 };
    case "Defensive":
      return { setupDuelChance: 0.65, forceBuyThreshold: 1.10, postplantAggression: 0.85, midRoundUtility: 1.10 };
    case "Balanced":
    case "Flex":
    default:
      return { setupDuelChance: 1.00, forceBuyThreshold: 1.00, postplantAggression: 1.00, midRoundUtility: 1.00 };
  }
}

function defaultAgentForRole(role: Role): string {
  switch (role) {
    case "Duelist": return "Jett";
    case "Initiator": return "Fade";
    case "Controller": return "Omen";
    case "Sentinel": return "Killjoy";
    case "IGL": return "Omen";
    default: return "Jett";
  }
}

/**
 * Mastery-aware agent picker. Among agents of a given class (Duelist /
 * Initiator / Controller / Sentinel), returns the one the player has the
 * most stars on. Falls back to the class default when no mastery data.
 * Used so AI teams play agents their players actually know, instead of
 * everyone defaulting to Jett / Omen / Killjoy / Fade.
 */
function bestMasteredAgentForClass(
  playerId: string,
  agentClass: "Duelist" | "Initiator" | "Controller" | "Sentinel",
  agentMastery: Record<string, number> | undefined,
): string {
  const candidates = VALORANT_AGENTS.filter((a) => a.role === agentClass);
  if (candidates.length === 0) return defaultAgentForRole(agentClass as Role);
  if (!agentMastery) {
    // No data — return the class default (Jett / Fade / Omen / Killjoy).
    return defaultAgentForRole(agentClass as Role);
  }
  let bestAgent = candidates[0].name;
  let bestStars = -1;
  for (const a of candidates) {
    const stars = agentMastery[`${playerId}:${a.name}`] ?? 0;
    if (stars > bestStars) {
      bestStars = stars;
      bestAgent = a.name;
    }
  }
  // If no agent has any mastery (all 0), prefer the class default — keeps
  // historical agent picks (Jett / Omen / etc.) for teams without mastery
  // data, instead of arbitrarily picking the first agent in the list.
  if (bestStars <= 0) return defaultAgentForRole(agentClass as Role);
  return bestAgent;
}

/**
 * For a player with a flexible role (IGL / Flex), pick the agent class
 * they're most mastered in across all 4 classes. Used by the gap-fill step
 * so a Flex who's 5-star on Killjoy gets put on Sentinel rather than the
 * hardcoded Jett.
 */
function bestMasteredClassForPlayer(
  playerId: string,
  agentMastery: Record<string, number> | undefined,
  classesAvailable: ReadonlyArray<"Duelist" | "Initiator" | "Controller" | "Sentinel">,
): "Duelist" | "Initiator" | "Controller" | "Sentinel" {
  if (!agentMastery || classesAvailable.length === 0) {
    return classesAvailable[0] ?? "Duelist";
  }
  let bestClass = classesAvailable[0];
  let bestStars = -1;
  for (const cls of classesAvailable) {
    for (const a of VALORANT_AGENTS.filter((x) => x.role === cls)) {
      const stars = agentMastery[`${playerId}:${a.name}`] ?? 0;
      if (stars > bestStars) {
        bestStars = stars;
        bestClass = cls;
      }
    }
  }
  return bestClass;
}

// ──────────────────────────────────────────────────────────
// Economy — individual buys with drops, pickups, and save mode
// ──────────────────────────────────────────────────────────

// ── Real Valorant weapon catalog ──
// Each player buys a SPECIFIC weapon from this list based on credits + role.
// Tier drives the duel-math weaponEdge. "preferred" flags which weapons different
// archetypes reach for first at each credit band.
export type WeaponName =
  | "Classic" | "Shorty" | "Frenzy" | "Ghost" | "Bandit" | "Sheriff"
  | "Stinger" | "Spectre"
  | "Bucky" | "Judge"
  | "Bulldog" | "Guardian" | "Phantom" | "Vandal"
  | "Marshal" | "Outlaw" | "Operator"
  | "Ares" | "Odin";

interface WeaponSpec {
  price: number;
  tier: 0 | 1 | 2 | 3;
  category: "sidearm" | "smg" | "shotgun" | "rifle-half" | "rifle" | "sniper" | "sniper-op" | "mg";
}

const WEAPON_CATALOG: Record<WeaponName, WeaponSpec> = {
  // Sidearms
  Classic:  { price: 0,    tier: 0, category: "sidearm" },
  Shorty:   { price: 150,  tier: 0, category: "sidearm" },
  Frenzy:   { price: 450,  tier: 0, category: "sidearm" },
  Ghost:    { price: 500,  tier: 0, category: "sidearm" },
  Bandit:   { price: 600,  tier: 0, category: "sidearm" },
  Sheriff:  { price: 800,  tier: 1, category: "sidearm" },
  // SMGs
  Stinger:  { price: 950,  tier: 1, category: "smg" },
  Spectre:  { price: 1600, tier: 1, category: "smg" },
  // Shotguns
  Bucky:    { price: 850,  tier: 1, category: "shotgun" },
  Judge:    { price: 1850, tier: 1, category: "shotgun" },
  // Rifles (half = scout/bulldog/guardian, full = vandal/phantom)
  Bulldog:  { price: 2050, tier: 1, category: "rifle-half" },
  Guardian: { price: 2250, tier: 1, category: "rifle-half" },
  Phantom:  { price: 2900, tier: 2, category: "rifle" },
  Vandal:   { price: 2900, tier: 2, category: "rifle" },
  // Snipers
  Marshal:  { price: 950,  tier: 1, category: "sniper" },
  Outlaw:   { price: 2400, tier: 2, category: "sniper" },
  Operator: { price: 4700, tier: 3, category: "sniper-op" },
  // MG
  Ares:     { price: 1550, tier: 1, category: "mg" },
  Odin:     { price: 3200, tier: 2, category: "mg" },
};

const PRICE = {
  heavyArmor: 1000,
  lightArmor: 400,
} as const;

function weaponPrice(w: WeaponName): number { return WEAPON_CATALOG[w].price; }
function weaponTierOf(w: WeaponName): number { return WEAPON_CATALOG[w].tier; }

/**
 * Choose the best weapon a player can actually afford, given team strategy and role.
 * Returns a weapon name — the caller then deducts its price from the player's credits.
 */
function chooseWeapon(
  credits: number,
  strategy: BuyType,
  isAwper: boolean,
  isDuelist: boolean,
  rnd: () => number,
): WeaponName {
  const afford = (w: WeaponName) => credits >= WEAPON_CATALOG[w].price;

  if (strategy === "pistol") return "Classic";

  // Full buy: rifle (+ Op for awper)
  if (strategy === "full") {
    if (isAwper && afford("Operator")) return "Operator";
    if (afford("Vandal")) {
      // Duelists lean Vandal (1-shot headshot), others split Vandal/Phantom
      return isDuelist ? "Vandal" : (rnd() < 0.5 ? "Vandal" : "Phantom");
    }
    // Can't full-rifle — downgrade to half rifle
    if (afford("Guardian")) return rnd() < 0.5 ? "Bulldog" : "Guardian";
    if (afford("Spectre")) return "Spectre";
    if (afford("Sheriff")) return "Sheriff";
    return afford("Ghost") ? "Ghost" : "Classic";
  }

  // Half buy: half-rifle or SMG/shotgun
  if (strategy === "half") {
    if (isAwper && afford("Outlaw")) return "Outlaw";
    if (afford("Bulldog")) return rnd() < 0.55 ? "Bulldog" : "Guardian";
    if (afford("Spectre")) return "Spectre";
    if (afford("Ares")) return "Ares";
    if (afford("Judge")) return "Judge";
    if (afford("Sheriff")) return "Sheriff";
    return afford("Ghost") ? "Ghost" : "Classic";
  }

  // Force buy: SMG or shotgun
  if (strategy === "force") {
    if (isAwper && afford("Marshal")) return "Marshal";
    if (afford("Spectre")) return "Spectre";
    if (afford("Judge")) return "Judge";
    if (afford("Stinger")) return "Stinger";
    if (afford("Bucky")) return "Bucky";
    if (afford("Sheriff")) return "Sheriff";
    if (afford("Bandit")) return "Bandit";
    return afford("Ghost") ? "Ghost" : "Classic";
  }

  // Eco: keep credits, best sidearm
  if (afford("Sheriff") && credits >= 1200) return "Sheriff"; // leave ~400 for armor
  if (afford("Bandit")) return "Bandit";
  if (afford("Ghost")) return "Ghost";
  if (afford("Frenzy")) return "Frenzy";
  return "Classic";
}

function setEconomyWeapon(e: Economy, weapon: WeaponName, fromPickup: boolean): void {
  e.weapon = weapon;
  e.weaponTier = weaponTierOf(weapon);
  e.fromPickup = fromPickup;
}

/**
 * Abilities are per-round purchases and cost ~300 on a normal buy (2-3 charges
 * across the team roles). Eco rounds save on utility (~150). Flat deduction so
 * R2/R3 budgets match real Valorant flow from the user's spec.
 */
function deductAbilitiesCost(e: Economy, strategy: BuyType): void {
  const cost = strategy === "eco" ? 150 : 300;
  e.credits = Math.max(0, e.credits - cost);
}

/**
 * Pre-round entry designation. We look at who would make the best entry this round:
 *   entryProb (agent archetype) × hotness² (carry on a streak gets priority).
 * Called once per round before buys so drops can be routed to this player.
 */
function pickRoundEntry(team: TeamRuntime): string | null {
  if (team.players.length === 0) return null;
  const weights = team.players.map((p) => getAgentMod(p.agent).entryProb * Math.pow(p.hotness, 2));
  const total = weights.reduce((s, w) => s + w, 0);
  if (total === 0) return team.players[0].input.id;
  let best = 0;
  for (let i = 1; i < team.players.length; i++) {
    if (weights[i] > weights[best]) best = i;
  }
  return team.players[best].input.id;
}

/**
 * Distribute a queued weapon pickup (from a dead teammate last round) to the
 * lowest-tier player on the team. Receiver keeps their credits — pickups are free.
 *
 * Role-respect: a sniper (Op/Outlaw/Marshal) only goes to the team's awper. A
 * Duelist would walk past an Outlaw in real play, not pick it up — without this,
 * a round-3 Outlaw drop could end up stuck on a Duelist for the rest of the map.
 */
function applyPickup(team: TeamRuntime, pickup: { weapon: WeaponName }): boolean {
  const pickupTier = weaponTierOf(pickup.weapon);
  const isSniperPickup =
    pickup.weapon === "Operator" ||
    pickup.weapon === "Outlaw" ||
    pickup.weapon === "Marshal";

  let candidates = team.players
    .map((p) => ({ p, e: team.economy.get(p.input.id)! }))
    .filter(({ e }) => e.weaponTier < pickupTier);

  if (isSniperPickup) {
    candidates = candidates.filter(({ p }) => p.input.id === team.awperId);
  }

  if (candidates.length === 0) return false;
  candidates.sort((a, b) => a.e.weaponTier - b.e.weaponTier);
  setEconomyWeapon(candidates[0].e, pickup.weapon, true);
  return true;
}

/**
 * Spend armor first (heavy if possible, else light), then pick a weapon with what's left.
 * Spends the weapon's price on success.
 */
function doBuy(
  e: Economy,
  strategy: BuyType,
  isAwper: boolean,
  isDuelist: boolean,
  rnd: () => number,
): void {
  // Pistol round: pro meta prioritizes UTILITY over armor. Ghost + abilities (~800)
  // is standard; Sheriff no armor for aggressive duelist; Shorty rare on tight maps.
  // Armor is usually skipped — 400 credits is better spent on a second ability charge.
  if (strategy === "pistol") {
    e.armor = "none"; // pros skip pistol armor in favor of utility

    // Aggressive Sheriff play (40% for duelists) — one-shot headshot potential
    if (isDuelist && rnd() < 0.4 && e.credits >= weaponPrice("Sheriff")) {
      e.credits -= weaponPrice("Sheriff");
      setEconomyWeapon(e, "Sheriff", false);
      return;
    }
    // Rare Shorty for close-range maps (Bind B, etc.)
    if (rnd() < 0.08 && e.credits >= weaponPrice("Shorty")) {
      e.credits -= weaponPrice("Shorty");
      setEconomyWeapon(e, "Shorty", false);
      return;
    }
    // Default: Ghost
    if (e.credits >= weaponPrice("Ghost")) {
      e.credits -= weaponPrice("Ghost");
      setEconomyWeapon(e, "Ghost", false);
      return;
    }
    setEconomyWeapon(e, "Classic", false);
    return;
  }

  // Non-pistol: armor first, then weapon
  if (strategy === "full" || strategy === "half") {
    if (e.credits >= PRICE.heavyArmor) { e.credits -= PRICE.heavyArmor; e.armor = "heavy"; }
    else if (e.credits >= PRICE.lightArmor) { e.credits -= PRICE.lightArmor; e.armor = "light"; }
    else { e.armor = "none"; }
  } else if (strategy === "force") {
    if (e.credits >= PRICE.lightArmor) { e.credits -= PRICE.lightArmor; e.armor = "light"; }
    else { e.armor = "none"; }
  } else {
    // eco — only buy armor if we can still afford a Ghost after
    if (e.credits >= PRICE.lightArmor + weaponPrice("Ghost")) {
      e.credits -= PRICE.lightArmor; e.armor = "light";
    } else {
      e.armor = "none";
    }
  }

  const weapon = chooseWeapon(e.credits, strategy, isAwper, isDuelist, rnd);
  e.credits -= weaponPrice(weapon);
  setEconomyWeapon(e, weapon, false);
}

/**
 * Plan buys for a team this round. Replaces the old team-average decideBuy+applyBuy.
 * Flow:
 *   1. Reset per-round state (save mode, entry, pickup flags on survivors kept).
 *   2. Apply carried weapons — any survivor from last round keeps their tier for free.
 *   3. Apply pickups from weaponPool (weapons of dead teammates) to neediest players.
 *   4. Decide team strategy: pistol / save / half / full / force based on credit distribution.
 *   5. Designate entry fragger.
 *   6. Individual buys — each player buys according to their credits and the strategy.
 *   7. Entry drop — if entry ended up below tier 2, richest teammate buys+drops a rifle.
 * Returns the team-level BuyType for display.
 */
function planBuys(
  team: TeamRuntime,
  isPistol: boolean,
  survivedLastRound: Set<string>,
): BuyType {
  team.inSaveMode = false;
  team.roundEntryId = null;
  const rnd = Math.random;

  // Dead players lose everything. Survivors keep their weapon but NOT armor — shield
  // absorbs damage and must be re-bought each round (even if the player survived
  // unscathed, this abstracts the degradation + abilities needing refresh).
  for (const p of team.players) {
    const e = team.economy.get(p.input.id)!;
    if (!survivedLastRound.has(p.input.id)) {
      setEconomyWeapon(e, "Classic", false);
    }
    e.armor = "none"; // shield doesn't carry — rebuy each round
  }

  if (isPistol) {
    for (const p of team.players) {
      const e = team.economy.get(p.input.id)!;
      doBuy(e, "pistol", p.input.id === team.awperId, p.input.role === "Duelist", rnd);
      deductAbilitiesCost(e, "pistol");
    }
    team.weaponPool = [];
    return "pistol";
  }

  // ── Pickups first — cheaper than buying, saves credits for utility/drops ──
  while (team.weaponPool.length > 0) {
    const pickup = team.weaponPool.shift()!;
    const applied = applyPickup(team, pickup);
    if (!applied) break;
  }

  // ── Team economic assessment ──
  const creditsArr = team.players.map((p) => team.economy.get(p.input.id)!.credits);
  const avgCredits = creditsArr.reduce((s, c) => s + c, 0) / team.players.length;
  const riflePrice = weaponPrice("Vandal");
  const halfPrice = weaponPrice("Bulldog");
  const armedCount = team.players.filter((p) => team.economy.get(p.input.id)!.weaponTier >= 2).length;

  // Save threshold: after a pistol loss the team sits ~2700 credits. With the
  // old 2500 cap they fell just outside save range and force-bought SMGs at
  // R2, which depleted their economy and meant R3 (with loss-bonus stacked)
  // still couldn't full-buy rifles. Pros actually full-eco R2 to GUARANTEE
  // a rifle buy at R3 — bumping the cap to 3000 matches that behavior.
  //
  // Playstyle scales the threshold: Aggressive teams (0.85×) save less and
  // force-buy with whatever they have. Defensive teams (1.10×) save deeper
  // to guarantee the next round's full buy. Multiplier ≤1 = more force-buy.
  //
  // Tier 2 — eco discipline compounds: a 100-discipline team waits patiently
  // for the right buy round (×1.20), a 0-discipline team forces relentlessly
  // (×0.80). At default 50 the multiplier is 1.0 so behaviour is unchanged.
  const ecoFactor = 1.0 + ((team.input.ecoDiscipline ?? 50) - 50) / 250;
  const saveCap = 3000 * team.playstyleMods.forceBuyThreshold * ecoFactor;
  const shouldSave = avgCredits < saveCap && armedCount < 3;

  if (shouldSave) {
    team.inSaveMode = true;
    // Deep save: Classic + minimal abilities, NO armor. This preserves credits
    // so that the next loss bonus pushes the team into full-buy territory for R3.
    // Pros save aggressively after pistol loss to guarantee rifle next round.
    for (const p of team.players) {
      const e = team.economy.get(p.input.id)!;
      if (e.weaponTier >= 1) {
        // Survivor with a weapon — keep it, skip armor (preserve credits), pay minimal utility
        deductAbilitiesCost(e, "eco");
        continue;
      }
      // No weapon → full save: stay Classic, no armor, just minimal abilities
      setEconomyWeapon(e, "Classic", false);
      e.armor = "none";
      deductAbilitiesCost(e, "eco");
    }
    return "eco";
  }

  team.roundEntryId = pickRoundEntry(team);

  const canFullCount = team.players.filter((p) => {
    const e = team.economy.get(p.input.id)!;
    return e.weaponTier >= 2 || e.credits >= riflePrice + PRICE.heavyArmor;
  }).length;
  const canHalfCount = team.players.filter((p) => {
    const e = team.economy.get(p.input.id)!;
    return e.weaponTier >= 1 || e.credits >= halfPrice + PRICE.heavyArmor;
  }).length;

  let strategy: BuyType;
  if (canFullCount >= 4) strategy = "full";
  else if (canHalfCount >= 4) strategy = "half";
  else if (avgCredits >= 2000) strategy = "force";
  else strategy = "eco";

  // ── Individual buys ──
  // Survivors keep their weapon across rounds — no re-buy. They may still top up
  // armor (shield doesn't carry over in this sim) and abilities (not modeled yet).
  for (const p of team.players) {
    const e = team.economy.get(p.input.id)!;
    const isSurvivor = survivedLastRound.has(p.input.id);

    if (isSurvivor && e.weaponTier >= 1) {
      // Carryover: keep weapon, rebuy armor (already reset to "none" above).
      // Picked-up weapons stay with the survivor until they die — same as real
      // Valorant. The pickup flag is cleared after one round of carryover so it
      // doesn't display as "fresh pickup" forever.
      e.fromPickup = false;
      if (strategy === "full" || strategy === "half") {
        if (e.credits >= PRICE.heavyArmor) {
          e.credits -= PRICE.heavyArmor; e.armor = "heavy";
        } else if (e.credits >= PRICE.lightArmor) {
          e.credits -= PRICE.lightArmor; e.armor = "light";
        }
      } else if (strategy === "force") {
        if (e.credits >= PRICE.lightArmor) {
          e.credits -= PRICE.lightArmor; e.armor = "light";
        }
      }
      deductAbilitiesCost(e, strategy);
      continue;
    }

    if (e.weaponTier >= 2) continue; // dead-but-somehow-armed edge case

    doBuy(e, strategy, p.input.id === team.awperId, p.input.role === "Duelist", rnd);
    deductAbilitiesCost(e, strategy);
  }

  // ── Entry drop ──
  // Entry below rifle tier? Richest teammate with a rifle buys a second one to drop.
  if (team.roundEntryId) {
    const entryEco = team.economy.get(team.roundEntryId)!;
    if (entryEco.weaponTier < 2) {
      const donors = team.players
        .filter((p) => p.input.id !== team.roundEntryId)
        .map((p) => ({ p, e: team.economy.get(p.input.id)! }))
        .filter(({ e }) => e.weaponTier >= 2 && e.credits >= riflePrice)
        .sort((a, b) => b.e.credits - a.e.credits);
      if (donors.length > 0) {
        const donor = donors[0];
        // Donor buys a drop rifle — prefer Phantom (versatile), Vandal for Duelist entries
        const entryPlayer = team.players.find((p) => p.input.id === team.roundEntryId);
        const dropWeapon: WeaponName = entryPlayer?.input.role === "Duelist" ? "Vandal" : "Phantom";
        donor.e.credits -= weaponPrice(dropWeapon);
        setEconomyWeapon(entryEco, dropWeapon, true);
      }
    }
  }

  return strategy;
}

/**
 * Collect rifle-tier weapons of dead teammates into the pool for next round.
 * SMGs/shotguns aren't worth the pickup slot — only tier ≥ 2.
 */
function collectWeaponPool(team: TeamRuntime, alive: Set<string>): void {
  team.weaponPool = [];
  for (const p of team.players) {
    if (alive.has(p.input.id)) continue;
    const e = team.economy.get(p.input.id)!;
    if (e.weaponTier >= 2) {
      team.weaponPool.push({ weapon: e.weapon });
    }
  }
}

/** Award credits after round (real Valorant values) */
function awardCredits(team: TeamRuntime, wonRound: boolean, teamPlanted: boolean): void {
  for (const p of team.players) {
    const e = team.economy.get(p.input.id)!;
    if (wonRound) {
      // Win bonus 3000 + kill rewards 200/kill (this player's own kills this round)
      e.credits += 3000;
      const lastRoundKills = p.perRound[p.perRound.length - 1]?.k ?? 0;
      e.credits += 200 * lastRoundKills;
    } else {
      // Loss bonus: 1900 → 2400 → 2900 (escalating)
      const lossBonus = Math.min(2900, 1900 + team.lossesBonus * 500);
      e.credits += lossBonus;
      // Plant bonus: +300 per player IF their team planted (consolation for losing team)
      if (teamPlanted) e.credits += 300;
      // Kill rewards still apply on losing rounds in real Valorant
      const lastRoundKills = p.perRound[p.perRound.length - 1]?.k ?? 0;
      e.credits += 200 * lastRoundKills;
    }
    e.credits = Math.min(9000, e.credits);
  }
}

// ──────────────────────────────────────────────────────────
// Duel resolution
// ──────────────────────────────────────────────────────────

interface DuelContext {
  phase: "setup" | "execution" | "postplant";
  attackerHasInfo: boolean;
  defenderHasAngle: boolean;
  abilityBonus: number;
  /**
   * Map ATK/DEF win-rate skew baked into each duel. Positive = ATK-favored
   * map (Haven, Sunset), negative = DEF-favored (Bind, Ascent). Applied at
   * ~0.5× scale per duel so cumulative round-level bias matches mapProfile
   * intent (~3-5% round win-rate swing on the most lopsided maps).
   * Set negative for postplant retake duels (defender becomes the entry).
   */
  mapAtkBias?: number;
}

/** Key-building helper shared with the backend relationships module. */
function relationPairKey(a: string, b: string, type: "DUO" | "CLASH"): string {
  return a < b ? `${a}|${b}|${type}` : `${b}|${a}|${type}`;
}

/**
 * Sums the net DUO/CLASH edge contribution for a side in the current duel.
 * +0.03 × strength per alive DUO teammate, −0.02 × strength per alive CLASH
 * teammate. MENTOR is intentionally excluded (it's a stat-growth mechanic,
 * not a duel bonus).
 */
function relationEdgeForSide(
  playerId: string,
  teamRuntime: TeamRuntime | undefined,
  aliveMates: Set<string> | undefined,
): number {
  if (!teamRuntime?.pairs || !aliveMates) return 0;
  let edge = 0;
  for (const mateId of aliveMates) {
    if (mateId === playerId) continue;
    const duo = teamRuntime.pairs.get(relationPairKey(playerId, mateId, "DUO"));
    if (duo) edge += 0.03 * duo;
    const clash = teamRuntime.pairs.get(relationPairKey(playerId, mateId, "CLASH"));
    if (clash) edge -= 0.02 * clash;
  }
  return edge;
}

function duelWinProb(
  attacker: PlayerState,
  defender: PlayerState,
  attackerEco: Economy,
  defenderEco: Economy,
  ctx: DuelContext,
  attackerTeam?: TeamRuntime,
  defenderTeam?: TeamRuntime,
  attackerAliveMates?: Set<string>,
  defenderAliveMates?: Set<string>,
): number {
  // Mechanical edge (rating × hotness captures both form and personal streak via recalcHotness)
  const mechanicalEdge = (attacker.rating * attacker.hotness - defender.rating * defender.hotness) * 0.12;

  // ── Team tilt (team-wide, subtler) ──
  // Coach adaptation dampens loss-streak tilt: a 100-scout coach halves the
  // negative drag from losing rounds (mid-match reads + tactical reset).
  const attAdaptScale = attackerTeam ? 1 - (attackerTeam.coachAdaptation - 50) / 100 : 1;
  const defAdaptScale = defenderTeam ? 1 - (defenderTeam.coachAdaptation - 50) / 100 : 1;
  const attTilt = attackerTeam
    ? Math.max(-0.05, -0.012 * attackerTeam.lossStreak) * attAdaptScale +
      Math.min(0.03, 0.008 * attackerTeam.winStreak)
    : 0;
  const defTilt = defenderTeam
    ? Math.max(-0.05, -0.012 * defenderTeam.lossStreak) * defAdaptScale +
      Math.min(0.03, 0.008 * defenderTeam.winStreak)
    : 0;
  // Moderated by individual tiltResistance
  const attTiltScaled = attTilt * (1.2 - attacker.tiltResistance);
  const defTiltScaled = defTilt * (1.2 - defender.tiltResistance);
  const tiltEdge = attTiltScaled - defTiltScaled;

  // Positional edge
  const positionalEdge = ctx.defenderHasAngle ? -0.10 : 0;

  // Info edge
  const infoEdge = ctx.attackerHasInfo ? 0.08 : 0;

  // Agent modifiers (scaled down)
  const attMod = getAgentMod(attacker.agent);
  const defMod = getAgentMod(defender.agent);
  const agentInDuelEdge = (attMod.inDuel - defMod.inDuel) * 0.7;
  const agentInfoEdge = (ctx.attackerHasInfo ? attMod.infoAdvantage : -defMod.infoAdvantage) * 0.7;
  const agentPhaseBonus = ctx.phase === "postplant" ? (attMod.postPlantBonus - defMod.postPlantBonus) * 0.7 : 0;
  const agentDefBonus = ctx.phase === "setup" ? -(defMod.defenseBonus) * 0.7 : 0;

  // Weapon edge (reduced from 0.08 to 0.05 per tier)
  const weaponEdge = getWeaponEdge(attackerEco, defenderEco);

  // Armor edge — heavy beats light beats none; scaled by kit delta
  const armorRank = (a: ArmorType) => a === "heavy" ? 2 : a === "light" ? 1 : 0;
  const armorEdge = (armorRank(attackerEco.armor) - armorRank(defenderEco.armor)) * 0.035;

  // Ability bonus from context
  const abilityEdge = ctx.abilityBonus * 0.7;

  // Per-duel random luck (±8% — represents aim duels, pixel peeks, crosshair placement, lag)
  const luck = (Math.random() - 0.5) * 0.16;

  // Relation edge — attacker's DUO/CLASH with their alive teammates, net against defender's
  const attRelation = relationEdgeForSide(attacker.input.id, attackerTeam, attackerAliveMates);
  const defRelation = relationEdgeForSide(defender.input.id, defenderTeam, defenderAliveMates);
  const relationEdge = attRelation - defRelation;

  // Map ATK/DEF asymmetry — Haven / Sunset / Lotus favor attackers, Bind /
  // Pearl / Ascent favor defenders. Scaled to ~half the raw bias so that ~5
  // duels per round sum to roughly the map's real-world atk win-rate skew.
  const mapBiasEdge = (ctx.mapAtkBias ?? 0) * 0.5;

  // Clutch factor — solo attackers and solo defenders get a +/- swing based
  // on their clutchRating. A 1.0-rated Aspas/Zekken type gets +5%; a 0.0
  // sentinel-anchor type gets -5%. Centered on 0.5 so most players are
  // neutral. The boost helps the lone clutcher in their duel.
  const attSolo = (attackerAliveMates?.size ?? 999) === 1;
  const defSolo = (defenderAliveMates?.size ?? 999) === 1;
  const attClutchEdge = attSolo ? (attacker.clutchRating - 0.5) * 0.10 : 0;
  const defClutchEdge = defSolo ? -(defender.clutchRating - 0.5) * 0.10 : 0;
  const clutchEdge = attClutchEdge + defClutchEdge;

  // Ultimate impact — categorized per agent archetype.
  //   - Duel ults (Jett/Reyna/Raze…): boost only when the user is in the duel
  //   - Info ults (Sova/Fade/Cypher): boost ALL teammate duels this round
  //   - Zone control (Viper/Astra/Brim/Harbor): positional + ability edge in
  //     exec / postplant phases for the user's team
  //   - Lockdown (Killjoy/Breach/Tejo/Deadlock/Vyse/Kayo): persistent area
  //     denial edge any phase for the user's team
  const zonePhaseRelevant = ctx.phase === "execution" || ctx.phase === "postplant";

  const attUltDuel = attacker.ultMechEdgeThisRound;
  const defUltDuel = defender.ultMechEdgeThisRound;

  const attTeamUltInfo = attackerTeam?.ultInfoEdge ?? 0;
  const defTeamUltInfo = defenderTeam?.ultInfoEdge ?? 0;

  const attTeamUltZone = zonePhaseRelevant ? (attackerTeam?.ultZoneEdge ?? 0) : 0;
  const defTeamUltZone = zonePhaseRelevant ? (defenderTeam?.ultZoneEdge ?? 0) : 0;

  const attTeamUltAbility = (attackerTeam?.ultAbilityEdge ?? 0);
  const defTeamUltAbility = (defenderTeam?.ultAbilityEdge ?? 0);

  const attTeamUltLockdown = (attackerTeam?.ultLockdownEdge ?? 0);
  const defTeamUltLockdown = (defenderTeam?.ultLockdownEdge ?? 0);

  const ultEdge =
    (attUltDuel + attTeamUltInfo + attTeamUltZone + attTeamUltAbility * 0.7 + attTeamUltLockdown * 0.6) -
    (defUltDuel + defTeamUltInfo + defTeamUltZone + defTeamUltAbility * 0.7 + defTeamUltLockdown * 0.6);

  // Tier 3 — Game IQ edge: crosshair placement, positional reads, pre-aim.
  // Range 10-95 (centered 50). At max delta (95 vs 10 = ±85) this is ±5%, so
  // a smart player without raw rating advantage can still nick duels. Defender
  // gets a slight boost (1.2×) because positional reads matter more when
  // holding angles — pre-aim beats peek mechanics.
  const gameIQEdge = ((attacker.gameIQ - 50) - (defender.gameIQ - 50) * 1.2) / 1700;

  // Tier 2 — adaptation edge: trailing side gains a small duel-prob boost
  // when their adaptation rating triggers a successful tactical shift (see
  // tryHalftimeAdapt + tryMidHalfAdapt). Max ±0.06.
  const adaptEdge = (attackerTeam?.adaptationEdge ?? 0) - (defenderTeam?.adaptationEdge ?? 0);

  const raw = 0.5 + mechanicalEdge + tiltEdge + positionalEdge + infoEdge + agentInDuelEdge + agentInfoEdge + agentPhaseBonus + agentDefBonus + weaponEdge + armorEdge + abilityEdge + relationEdge + mapBiasEdge + clutchEdge + ultEdge + gameIQEdge + adaptEdge + luck;
  // Tighter clamp — no duel is ever a guaranteed win
  return clamp(raw, 0.15, 0.85);
}

function getWeaponEdge(att: Economy, def: Economy): number {
  // 0.06 per tier (was 0.10) — at 0.10 a good pistol player couldn't kill a
  // rifle even with positional advantage. At 0.06, Vandal vs Classic = ±12%
  // which keeps anti-eco rounds favored without making them deterministic.
  // The round-level win rate of anti-eco still ends up ~75-80% due to
  // economy snowball and multiple duels per round.
  return (att.weaponTier - def.weaponTier) * 0.06;
}

// ──────────────────────────────────────────────────────────
// Round simulation
// ──────────────────────────────────────────────────────────

type AssistType = "damage" | "flash" | "ability" | "cast";

interface PendingAssist {
  playerId: string;
  teamId: string;
  type: AssistType;
  /** If set, only applies when this specific enemy is killed. null = any enemy. */
  targetVictimId: string | null;
  /** Round timer (seconds) when assist expires */
  expiresAt: number;
  /** Flash/ability = single-use; damage/cast = reusable within window */
  oneShot: boolean;
  /** For display/events */
  source: string;
}

interface DamageEntry {
  dealerId: string;
  victimId: string;
  damage: number;
  roundTime: number;
}

interface RoundContext {
  time: number;
  pendingAssists: PendingAssist[];
  damageLog: DamageEntry[];
  /** Who is traded (victim was killed within 1.5s of their teammate being killed) */
  tradedVictims: Set<string>;
}

interface KillRecord {
  killerId: string;
  killerTeamId: string;
  victimId: string;
  victimTeamId: string;
  isFirstKill: boolean;
  damage: number;
  /** Player IDs that get credit for assisting this kill */
  assistantIds: string[];
  /** Was the victim traded (someone on their team got a retaliatory kill within the window)? */
  wasTraded?: boolean;
  /** Time in round (seconds) */
  timing: number;
}

interface RoundOutcome {
  winner: 1 | 2;
  kills: KillRecord[];
  spiked: boolean;
  event: RoundEventDetail | null;
  /** Per-player KAST contribution this round */
  kastContrib: Map<string, { k: boolean; a: boolean; s: boolean; t: boolean }>;
  /** When spike plant completed (null if never planted) */
  plantTime: number | null;
  /** True if defenders defused the spike before detonation */
  spikeDefused: boolean;
}

/**
 * Compute info phase: how much do attackers' initiators scout before execution,
 * countered by defender sentinels' trips/alarms/turrets.
 */
function computeInfoPhase(
  attackers: TeamRuntime,
  defenders: TeamRuntime,
  mapProfile: MapProfile,
): { infoLevel: number; counterInfo: number } {
  let infoLevel = 0;
  for (const p of attackers.players) {
    const mod = getAgentMod(p.agent);
    infoLevel += mod.infoAdvantage * 0.5;
  }
  infoLevel += (attackers.input.skillUtility / 100) * 0.05;
  infoLevel *= mapProfile.utilityImpact;

  let counterInfo = 0;
  for (const p of defenders.players) {
    const mod = getAgentMod(p.agent);
    // Sentinels with defenseBonus also contribute counter-info (trips, cameras)
    counterInfo += mod.defenseBonus * 0.4;
    counterInfo += mod.infoAdvantage * 0.3; // Cypher/KJ also have info tools
  }

  return {
    infoLevel: clamp(infoLevel, 0, 0.30),
    counterInfo: clamp(counterInfo, 0, 0.20),
  };
}

/**
 * Utility strength during execution — smokes, flashes, molly.
 * Higher = cleaner executes, better trade windows.
 */
function computeUtilityStrength(attackers: TeamRuntime): number {
  let util = 0;
  for (const p of attackers.players) {
    const mod = getAgentMod(p.agent);
    // Controllers contribute smokes (executionBonus conceptually), initiators contribute flashes
    util += mod.infoAdvantage * 0.3 + mod.postPlantBonus * 0.3;
  }
  util += (attackers.input.skillUtility / 100) * 0.1;
  return clamp(util, 0, 0.25);
}

/**
 * Rotation penalty: if attackers heavily prefer one site, defenders stack it.
 * An attacker who diversifies enjoys less rotation from defenders.
 * Returns a PENALTY (subtract from ability bonus).
 */
function computeRotationPenalty(
  attackers: TeamRuntime,
  defenders: TeamRuntime,
  site: string,
  siteProfile: SiteProfile,
): number {
  const totalPushes = Object.values(attackers.sitePreference).reduce((s, v) => s + v, 0);
  if (totalPushes < 3) return 0; // not enough history to stack

  const thisSiteRatio = (attackers.sitePreference[site] ?? 0) / totalPushes;
  // If attackers go this site > 60% of the time, defenders stack it → -5 to -10% ability
  const stackPenalty = thisSiteRatio > 0.6 ? (thisSiteRatio - 0.5) * 0.15 : 0;
  // Defensive rotation difficulty — easier rotation = harsher penalty
  const rotationFactor = 1 - siteProfile.rotateDifficulty * 0.5;
  void defenders;
  return stackPenalty * rotationFactor;
}

/**
 * Postplant advantage: Viper walls, Brimstone mollies, Killjoy lockdown deny retakes.
 */
function computePostPlantAdvantage(attackers: TeamRuntime): number {
  let adv = 0;
  for (const p of attackers.players) {
    const mod = getAgentMod(p.agent);
    adv += mod.postPlantBonus * 0.6;
  }
  return clamp(adv, 0, 0.20);
}

// ──────────────────────────────────────────────────────────
// Pending-assist emitters
// ──────────────────────────────────────────────────────────
// Assists emerge from gameplay: an Initiator's recon reveals enemies, a Duelist's
// flash pops right as the entry takes a duel, a Controller's smoke sets up the take,
// a Sentinel's trap reveals the retaker. Each ability emits a PendingAssist with
// a lifetime window; the next kill by the caster's team consumes it.

const INFO_AGENTS: Record<string, { chance: number; source: string }> = {
  Fade:    { chance: 0.65, source: "haunt" },
  Sova:    { chance: 0.70, source: "recon_dart" },
  Skye:    { chance: 0.45, source: "trailblazer" },
  "KAY/O": { chance: 0.50, source: "zero_point" },
  Breach:  { chance: 0.45, source: "fault_line" },
  Gekko:   { chance: 0.50, source: "dizzy" },
  Tejo:    { chance: 0.55, source: "guided_salvo" },
};

const FLASH_AGENTS: Record<string, string> = {
  "KAY/O": "flash_drive",
  Phoenix: "curveball",
  Reyna:   "leer",
  Skye:    "guiding_light",
  Yoru:    "blindside",
  Breach:  "flashpoint",
  Omen:    "paranoia",
};

const CONTROLLER_AGENTS: Record<string, string> = {
  Omen:      "smoke",
  Brimstone: "smoke",
  Viper:     "toxic_screen",
  Astra:     "nebula",
  Harbor:    "cascade",
  Clove:     "smoke",
};

const POSTPLANT_LOCKDOWN_AGENTS: Record<string, string> = {
  Viper:     "snake_bite",
  Brimstone: "incendiary",
  Killjoy:   "nanoswarm",
  Cypher:    "cyber_cage",
};

const SENTINEL_AGENTS: Record<string, string> = {
  Killjoy:  "alarmbot",
  Cypher:   "trapwire",
  Chamber:  "trademark",
  Deadlock: "gravnet",
  Vyse:     "razorvine",
};

// Tier 3 — Utility IQ scales per-ability emit probability. A high-utilityIQ
// initiator/controller (Crashies, FNS) lands more flashes / well-timed darts /
// proper smokes per round; a low-utilityIQ player wastes utility or mis-times
// it. 10-95 maps to 0.60× - 1.40× of base emit probability.
function utilityIQFactor(p: PlayerState): number {
  return 0.6 + (p.utilityIQ - 10) / 85 * 0.8;
}

function emitInfoPhaseAssists(attackers: TeamRuntime, ctx: RoundContext): void {
  const teamUtilMul = attackers.playstyleMods.midRoundUtility;
  for (const p of attackers.players) {
    const entry = INFO_AGENTS[p.agent];
    if (!entry) continue;
    if (!rand(entry.chance * utilityIQFactor(p) * teamUtilMul)) continue;
    ctx.pendingAssists.push({
      playerId: p.input.id,
      teamId: p.teamId,
      type: "ability",
      targetVictimId: null,
      expiresAt: ctx.time + 5,
      oneShot: true,
      source: entry.source,
    });
  }
}

function emitExecutionFlashes(attackers: TeamRuntime, ctx: RoundContext, utilityStrength: number): void {
  const teamUtilMul = attackers.playstyleMods.midRoundUtility;
  for (const p of attackers.players) {
    const source = FLASH_AGENTS[p.agent];
    if (!source) continue;
    // Higher utility → more flashes land, scaled by per-player utilityIQ
    // and team playstyle midRoundUtility (Tactical 1.30 / Aggressive 0.90).
    if (!rand((0.45 + utilityStrength * 1.5) * utilityIQFactor(p) * teamUtilMul)) continue;
    ctx.pendingAssists.push({
      playerId: p.input.id,
      teamId: p.teamId,
      type: "flash",
      targetVictimId: null,
      expiresAt: ctx.time + 1.5,
      oneShot: true,
      source,
    });
  }
}

function emitControllerSmokes(attackers: TeamRuntime, ctx: RoundContext): void {
  const teamUtilMul = attackers.playstyleMods.midRoundUtility;
  for (const p of attackers.players) {
    const source = CONTROLLER_AGENTS[p.agent];
    if (!source) continue;
    if (!rand(0.75 * utilityIQFactor(p) * teamUtilMul)) continue;
    ctx.pendingAssists.push({
      playerId: p.input.id,
      teamId: p.teamId,
      type: "cast",
      targetVictimId: null,
      expiresAt: ctx.time + 15,
      oneShot: false,
      source,
    });
  }
}

function emitPostPlantLockdown(attackers: TeamRuntime, ctx: RoundContext): void {
  const teamUtilMul = attackers.playstyleMods.midRoundUtility;
  for (const p of attackers.players) {
    const source = POSTPLANT_LOCKDOWN_AGENTS[p.agent];
    if (!source) continue;
    if (!rand(0.6 * utilityIQFactor(p) * teamUtilMul)) continue;
    ctx.pendingAssists.push({
      playerId: p.input.id,
      teamId: p.teamId,
      type: "cast",
      targetVictimId: null,
      expiresAt: ctx.time + 25,
      oneShot: false,
      source,
    });
  }
}

function emitSentinelTraps(defenders: TeamRuntime, ctx: RoundContext): void {
  const teamUtilMul = defenders.playstyleMods.midRoundUtility;
  for (const p of defenders.players) {
    const source = SENTINEL_AGENTS[p.agent];
    if (!source) continue;
    if (!rand(0.55 * utilityIQFactor(p) * teamUtilMul)) continue;
    ctx.pendingAssists.push({
      playerId: p.input.id,
      teamId: p.teamId,
      type: "cast",
      targetVictimId: null,
      expiresAt: ctx.time + 30,
      oneShot: false,
      source,
    });
  }
}

/**
 * Register a non-killing damage contribution. Before an execution duel, there's a chance
 * the defender was previously damaged by a teammate of the attacker (body shots, prefires).
 */
function maybeRegisterPriorDamage(
  attackers: TeamRuntime,
  victim: PlayerState,
  ctx: RoundContext,
): void {
  if (!rand(0.22)) return;
  const teammates = attackers.players.filter((p) => p.input.id !== victim.input.id);
  if (teammates.length === 0) return;
  const dealer = pick(teammates);
  ctx.damageLog.push({
    dealerId: dealer.input.id,
    victimId: victim.input.id,
    damage: 40 + Math.floor(Math.random() * 50),
    roundTime: Math.max(0, ctx.time - randFloat(1, 4)),
  });
}

/**
 * Smart site choice: uses attacker history + defender's stack tendency.
 * If defenders have been caught stacking where attackers went, switch sites.
 */
function chooseSiteSmart(
  attackers: TeamRuntime,
  defenders: TeamRuntime,
  mapProfile: MapProfile,
): string {
  void defenders;
  const sites = mapProfile.sites;
  if (sites.length === 0) return "A";

  const totalPushes = Object.values(attackers.sitePreference).reduce((s, v) => s + v, 0);

  // Early round: random weighted by attack site win rates
  if (totalPushes < 2) {
    const weights = sites.map((s) => mapProfile.siteProfiles[s]?.attackSiteWinRate ?? 0.5);
    const total = weights.reduce((s, w) => s + w, 0);
    let r = Math.random() * total;
    for (let i = 0; i < sites.length; i++) {
      r -= weights[i];
      if (r <= 0) return sites[i];
    }
    return sites[0];
  }

  // If one site pushed >50%, there's a 60% chance to switch to a less-used site (anti-read)
  const maxSite = sites.reduce((best, s) => (attackers.sitePreference[s] ?? 0) > (attackers.sitePreference[best] ?? 0) ? s : best, sites[0]);
  const maxRatio = (attackers.sitePreference[maxSite] ?? 0) / totalPushes;

  if (maxRatio > 0.5 && rand(0.6)) {
    // Pick least-used site
    const otherSites = sites.filter((s) => s !== maxSite);
    if (otherSites.length > 0) {
      return otherSites.reduce((best, s) => (attackers.sitePreference[s] ?? 0) < (attackers.sitePreference[best] ?? 0) ? s : best, otherSites[0]);
    }
  }

  // Otherwise, weighted random with small preference for under-used sites
  const weights = sites.map((s) => {
    const winRate = mapProfile.siteProfiles[s]?.attackSiteWinRate ?? 0.5;
    const pushRatio = (attackers.sitePreference[s] ?? 0) / totalPushes;
    return winRate * (1.2 - pushRatio); // prefer less-pushed sites slightly
  });
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < sites.length; i++) {
    r -= weights[i];
    if (r <= 0) return sites[i];
  }
  return sites[0];
}

/**
 * Clutch simulation: a single survivor against multiple opponents.
 * Different dynamics from normal duels — clutcher plays angles, uses clock,
 * may fake defuse, etc.
 */
function simulateClutch(
  attackers: TeamRuntime,
  defenders: TeamRuntime,
  alive: { attackers: Set<string>; defenders: Set<string> },
  kills: RoundOutcome["kills"],
  time: number,
  spiked: boolean,
  siteProfile: SiteProfile,
  roundCtx: RoundContext,
): void {
  let tick = 0;

  while (alive.attackers.size > 0 && alive.defenders.size > 0 && tick < 10) {
    // Identify clutcher side and opponents
    const attSolo = alive.attackers.size === 1;
    const defSolo = alive.defenders.size === 1;

    if (!attSolo && !defSolo) break; // no longer a clutch

    const clutcherTeam = attSolo ? attackers : defenders;
    const opponentTeam = attSolo ? defenders : attackers;
    const clutcherAliveSet = attSolo ? alive.attackers : alive.defenders;
    const opponentAliveSet = attSolo ? alive.defenders : alive.attackers;

    const clutcher = clutcherTeam.players.find((p) => clutcherAliveSet.has(p.input.id));
    if (!clutcher) break;
    // Clutcher picks the weakest opponent (plays the angle)
    const opponents = opponentTeam.players.filter((p) => opponentAliveSet.has(p.input.id));
    if (opponents.length === 0) break;
    const weakest = opponents.reduce((best, p) => (p.rating * p.hotness < best.rating * best.hotness) ? p : best, opponents[0]);

    // Clutcher plays tight angle (defender-like positioning) and has slight "clutch mentality" bonus
    const clutchBonus = 0.05 + clutcher.tiltResistance * 0.04;

    const ctx: DuelContext = {
      phase: spiked ? "postplant" : "execution",
      attackerHasInfo: false,
      defenderHasAngle: true,
      abilityBonus: clutchBonus + (attSolo && spiked ? siteProfile.postPlantDifficulty * 0.05 : 0),
    };

    roundCtx.time = time + tick * 3;
    resolveDuel(weakest, clutcher, opponentTeam, clutcherTeam, alive, kills, false, ctx, roundCtx);

    tick++;
  }
}

/**
 * Sage's ultimate is the only revive in the roster — it can flip a 4v5 back
 * to 5v5 mid-round. Called after every duel resolution to check whether a
 * ready Sage on either team should pop her ult to bring back a fallen
 * teammate. Trigger conditions:
 *   - Sage is on the team, alive, has ult ready, and hasn't ulted this round
 *   - Her team is at a numeric disadvantage (fewer alive than the opponent)
 *   - At least one teammate is dead and can be revived
 *
 * The revived player rejoins the alive set on Classic + no shield (their
 * gear is lost at death). They also pick up a small one-round duel boost
 * to represent the "fresh life" surge.
 */
function maybeSageRevive(
  team: TeamRuntime,
  ourAlive: Set<string>,
  theirAlive: Set<string>,
): void {
  const sage = team.players.find(
    (p) =>
      p.agent === "Sage" &&
      ourAlive.has(p.input.id) &&
      p.ultPoints >= p.ultMax &&
      !p.isUsingUltThisRound,
  );
  if (!sage) return;

  // Only triggers when at a numeric disadvantage. A Sage with ult ready won't
  // pop it in 5v5 — that's the whole reason the ult charges 8 points.
  if (ourAlive.size >= theirAlive.size) return;

  // Find the highest-rated dead teammate (excluding Sage herself).
  const deadMates = team.players
    .filter((p) => !ourAlive.has(p.input.id) && p.input.id !== sage.input.id)
    .sort((a, b) => b.rating - a.rating);
  if (deadMates.length === 0) return;
  const revived = deadMates[0];

  // Revive: rejoin the alive set on Classic + no shield. Their weapon was
  // dropped to the pool on death; the revived player is at high risk.
  ourAlive.add(revived.input.id);
  const e = team.economy.get(revived.input.id);
  if (e) {
    setEconomyWeapon(e, "Classic", false);
    e.armor = "none";
  }
  // Reset the revived player's per-round duel stats (they're getting a fresh
  // chance — clean slate on the streak counters, not the totals).
  revived.consecutiveDuelsLost = 0;

  // Mark Sage as having used the ult. She also gets a small duel boost for
  // the rest of the round (clutch heal mode).
  sage.isUsingUltThisRound = true;
  sage.ultPoints = 0;
  sage.ultMechEdgeThisRound = 0.08;
}

function simulateRound(
  team1: TeamRuntime,
  team2: TeamRuntime,
  roundNum: number,
  team1Attacking: boolean,
  mapName: string,
): RoundOutcome {
  void roundNum;
  const attackers = team1Attacking ? team1 : team2;
  const defenders = team1Attacking ? team2 : team1;
  const mapProfile = getMapProfile(mapName);

  const kills: RoundOutcome["kills"] = [];
  const alive = {
    attackers: new Set(attackers.players.map((p) => p.input.id)),
    defenders: new Set(defenders.players.map((p) => p.input.id)),
  };

  // RoundContext: carries time + pending assists + damage log across every duel in the round.
  const roundCtx: RoundContext = {
    time: 0,
    pendingAssists: [],
    damageLog: [],
    tradedVictims: new Set<string>(),
  };

  let spiked = false;

  // ═════════════════════════════════════════════════
  // PHASE 1 — SETUP (0s to 15s)
  // ═════════════════════════════════════════════════
  roundCtx.time = 5;
  if (rand(0.12 * mapProfile.midImportance * attackers.playstyleMods.setupDuelChance)) {
    const att = pickAliveAttacker(attackers, alive.attackers, false);
    const def = pickAliveDefender(defenders, alive.defenders);
    if (att && def) {
      resolveDuel(att, def, attackers, defenders, alive, kills, true, {
        phase: "setup",
        attackerHasInfo: false,
        defenderHasAngle: true,
        abilityBonus: 0,
      }, roundCtx);
      roundCtx.time += 3;
    }
  }

  // ═════════════════════════════════════════════════
  // PHASE 2 — INFO GATHERING (15s to 25s)
  // ═════════════════════════════════════════════════
  roundCtx.time = 18;
  // Initiator abilities scout enemies → pending ability assists (5s window)
  emitInfoPhaseAssists(attackers, roundCtx);
  // Defensive sentinel traps arm on setup, persist long into postplant
  emitSentinelTraps(defenders, roundCtx);

  const { infoLevel, counterInfo } = computeInfoPhase(attackers, defenders, mapProfile);
  const netInfoAdvantage = clamp(infoLevel - counterInfo, 0, 0.20);

  if (rand(0.15 * attackers.playstyleMods.setupDuelChance)) {
    const att = pickAliveAttacker(attackers, alive.attackers, false);
    const def = pickAliveDefender(defenders, alive.defenders);
    if (att && def) {
      resolveDuel(att, def, attackers, defenders, alive, kills, kills.length === 0, {
        phase: "setup",
        attackerHasInfo: infoLevel > 0.05,
        defenderHasAngle: true,
        abilityBonus: 0,
      }, roundCtx);
    }
  }

  // ═════════════════════════════════════════════════
  // PHASE 3 — EXECUTION DECISION (25s)
  // ═════════════════════════════════════════════════
  roundCtx.time = 25;
  const execScore = (attackers.input.skillTeamplay + attackers.input.skillUtility) / 2;
  const defScore = (defenders.input.skillTeamplay + defenders.input.skillUtility) / 2;
  // Save mode: attackers hoard their guns — no execute, just scattered stalls.
  // A small stall rather than a full pacifism: occasional picks still happen.
  const willExecute =
    !attackers.inSaveMode &&
    (execScore > defScore * 0.75 || alive.attackers.size >= 4) &&
    alive.attackers.size > 0;

  const site = willExecute
    ? chooseSiteSmart(attackers, defenders, mapProfile)
    : mapProfile.sites[0];
  attackers.sitePreference[site] = (attackers.sitePreference[site] ?? 0) + 1;
  const siteProfile = mapProfile.siteProfiles[site] ?? mapProfile.siteProfiles[mapProfile.sites[0]];

  if (willExecute && alive.attackers.size > 0 && alive.defenders.size > 0) {
    // ═════════════════════════════════════════════════
    // PHASE 4 — EXECUTION (25s to 50s)
    // ═════════════════════════════════════════════════

    // 4a. Utility deployment — smokes @ 27s (15s lifetime), flashes @ 29s (1.5s window)
    roundCtx.time = 27;
    emitControllerSmokes(attackers, roundCtx);
    roundCtx.time = 29;
    const utilityStrength = computeUtilityStrength(attackers) * mapProfile.utilityImpact;
    emitExecutionFlashes(attackers, roundCtx, utilityStrength);

    const rotationPenalty = computeRotationPenalty(attackers, defenders, site, siteProfile);
    const executionAbility = clamp(netInfoAdvantage + utilityStrength - rotationPenalty, 0, 0.30);

    // 4b. Entry fragger goes in @ 30s — flash just popped, entry takes first duel
    roundCtx.time = 30;
    {
      const entry = pickEntryFragger(attackers, alive.attackers);
      const firstDefender = pickHolder(defenders, alive.defenders);
      if (entry && firstDefender) {
        const result = resolveDuel(entry, firstDefender, attackers, defenders, alive, kills, true, {
          phase: "execution",
          attackerHasInfo: netInfoAdvantage > 0.05,
          defenderHasAngle: true,
          abilityBonus: executionAbility,
        }, roundCtx);

        roundCtx.time += 1.5;
        if (result.killed && rand(0.50 + utilityStrength * 0.8)) {
          const victimTeam = result.victim.teamId === team1.input.id ? team1 : team2;
          const victimAliveSet = result.victim.teamId === attackers.input.id ? alive.attackers : alive.defenders;
          const killerTeam = result.killer.teamId === team1.input.id ? team1 : team2;
          const trader = pickTrader(victimTeam, victimAliveSet);
          if (trader) {
            resolveDuel(trader, result.killer, victimTeam, killerTeam, alive, kills, false, {
              phase: "execution",
              attackerHasInfo: true,
              defenderHasAngle: false,
              abilityBonus: 0.05,
            }, roundCtx);
          }
        }
      }
    }

    // 4c. Site take duels (32s to 45s) — defenders may rotate from other site
    roundCtx.time = 32;
    let didRotate = false;
    while (roundCtx.time < 45 && alive.attackers.size > 0 && alive.defenders.size > 0 && kills.length < 8) {
      if (alive.attackers.size === 1 || alive.defenders.size === 1) break;

      if (!didRotate && rand(0.4)) {
        didRotate = true;
        if (rand(0.5)) {
          const att = pickAliveAttacker(attackers, alive.attackers, false);
          const def = pickAliveDefender(defenders, alive.defenders);
          if (att && def) {
            resolveDuel(att, def, attackers, defenders, alive, kills, false, {
              phase: "execution",
              attackerHasInfo: false,
              defenderHasAngle: true,
              abilityBonus: executionAbility * 0.5,
            }, roundCtx);
            roundCtx.time += 2.5;
            continue;
          }
        } else {
          const att = pickAliveAttacker(attackers, alive.attackers, false);
          const def = pickAliveDefender(defenders, alive.defenders);
          if (att && def) {
            resolveDuel(att, def, attackers, defenders, alive, kills, false, {
              phase: "execution",
              attackerHasInfo: true,
              defenderHasAngle: false,
              abilityBonus: executionAbility,
            }, roundCtx);
            roundCtx.time += 2;
            continue;
          }
        }
      }

      const att = pickAliveAttacker(attackers, alive.attackers, false);
      const def = pickAliveDefender(defenders, alive.defenders);
      if (!att || !def) break;

      const result = resolveDuel(att, def, attackers, defenders, alive, kills, false, {
        phase: "execution",
        attackerHasInfo: netInfoAdvantage > 0.03,
        defenderHasAngle: Math.random() < siteProfile.defenderAngleStrength * 3,
        abilityBonus: executionAbility * 0.7,
      }, roundCtx);

      roundCtx.time += 2;
      if (result.killed && rand(0.45)) {
        const victimTeam = result.victim.teamId === team1.input.id ? team1 : team2;
        const victimAliveSet = result.victim.teamId === attackers.input.id ? alive.attackers : alive.defenders;
        const killerTeam = result.killer.teamId === team1.input.id ? team1 : team2;
        const trader = pickTrader(victimTeam, victimAliveSet);
        if (trader) {
          resolveDuel(trader, result.killer, victimTeam, killerTeam, alive, kills, false, {
            phase: "execution",
            attackerHasInfo: true,
            defenderHasAngle: false,
            abilityBonus: 0.03,
          }, roundCtx);
          roundCtx.time += 1.5;
        }
      }
    }

    // 4d. PLANT attempt
    // Realistic probabilities by attacker/defender ratio:
    //   D=0:   free plant (attackers wiped defense)
    //   N vs 0-1: near-guaranteed (88%)
    //   N vs 2: situational (65%)
    //   1 vs 0-1 with att > def: clutch plant (55%)
    //   1 vs 2+ : solo lurk/late plant (30%) — covers "last attacker plants" case
    //
    // Plant TIMING varies with the situation:
    //   Dominant execute (ATT>DEF, early clear): 38-46s  — fast plant
    //   Contested (close to even): 48-58s            — normal plant
    //   Solo / lurk plant (ATT<DEF): 62-85s          — late plant
    let plantStartTime = 48;
    if (alive.attackers.size > alive.defenders.size && alive.defenders.size <= 1) {
      plantStartTime = 38 + Math.floor(Math.random() * 8); // fast plant after dominant execute
    } else if (alive.attackers.size <= alive.defenders.size) {
      plantStartTime = 60 + Math.floor(Math.random() * 20); // lurk / solo late plant
    } else {
      plantStartTime = 46 + Math.floor(Math.random() * 10); // normal
    }
    roundCtx.time = plantStartTime;

    if (alive.attackers.size >= 1 && alive.defenders.size === 0) {
      spiked = true;
    } else if (alive.attackers.size >= 2 && alive.defenders.size <= 1) {
      spiked = rand(0.88);
    } else if (alive.attackers.size >= 2 && alive.defenders.size <= 2) {
      spiked = rand(0.65);
    } else if (alive.attackers.size >= 1 && alive.defenders.size <= 1 && alive.attackers.size > alive.defenders.size) {
      spiked = rand(0.55);
    } else if (alive.attackers.size === 1 && alive.defenders.size >= 2) {
      // Last attacker sneaking a plant while defenders are scattered / reloading
      spiked = rand(0.30);
    }

    // Plant animation = 4s
    if (spiked) roundCtx.time = plantStartTime + 4;
  } else {
    // ═════════════════════════════════════════════════
    // STALL — attackers hesitate, defenders hold time
    // ═════════════════════════════════════════════════
    roundCtx.time = 35;
    for (let i = 0; i < 3; i++) {
      if (alive.attackers.size === 0 || alive.defenders.size === 0) break;
      if (roundCtx.time > 90) break;
      if (rand(0.35)) {
        const a = pickAliveAttacker(attackers, alive.attackers, false);
        const d = pickAliveDefender(defenders, alive.defenders);
        if (a && d) {
          resolveDuel(a, d, attackers, defenders, alive, kills, kills.length === 0, {
            phase: "setup",
            attackerHasInfo: netInfoAdvantage > 0.05,
            defenderHasAngle: true,
            abilityBonus: 0.05,
          }, roundCtx);
          roundCtx.time += randFloat(8, 15);
        }
      }
    }
  }

  // ═════════════════════════════════════════════════
  // PHASE 5 — CLUTCH (mid-round if any side is solo)
  // ═════════════════════════════════════════════════
  if (!spiked && (alive.attackers.size === 1 || alive.defenders.size === 1) &&
      alive.attackers.size > 0 && alive.defenders.size > 0) {
    simulateClutch(attackers, defenders, alive, kills, roundCtx.time, spiked, siteProfile, roundCtx);
  }

  // ═════════════════════════════════════════════════
  // PHASE 6 — POSTPLANT / RETAKE (if spiked)
  // ═════════════════════════════════════════════════
  // Real Valorant timing:
  //   Plant: 4s to complete — so plantTime ≈ time when plant animation finished
  //   Fuse: 45s from plant completion
  //   Defuse: 7s full / 3.5s half (risky, can be picked back up)
  //   Detonation time = plantTime + 45
  const SPIKE_FUSE = 45;
  const DEFUSE_FULL = 7;
  const DEFUSE_HALF = 3.5;
  const plantTime = spiked ? roundCtx.time : null;
  const detonationTime = plantTime !== null ? plantTime + SPIKE_FUSE : null;
  let spikeDefused = false;
  let defuserId: string | null = null;

  // Award the planter +1 ult point. Pick a random alive attacker as the
  // planter — most pro plants are done by the player closest to spike site
  // after the area is cleared, which is essentially random among alive
  // attackers in the sim.
  if (spiked) {
    const alivePlanters = attackers.players.filter((p) =>
      alive.attackers.has(p.input.id),
    );
    if (alivePlanters.length > 0) {
      const planter = alivePlanters[Math.floor(Math.random() * alivePlanters.length)];
      planter.ultPoints = Math.min(planter.ultMax, planter.ultPoints + 1);
    }
  }

  if (spiked && plantTime !== null && detonationTime !== null && alive.defenders.size > 0) {
    roundCtx.time = plantTime + 2; // retake starts ~2s after plant completes
    emitPostPlantLockdown(attackers, roundCtx);
    const postPlantAdvantage = computePostPlantAdvantage(attackers) - siteProfile.postPlantDifficulty * 0.1;

    // Loop until detonation OR one side wiped. Leave a 1s buffer for final decision.
    while (roundCtx.time < detonationTime - 1 && alive.attackers.size > 0 && alive.defenders.size > 0) {
      if (alive.defenders.size === 1 && alive.attackers.size >= 1) {
        simulateClutch(attackers, defenders, alive, kills, roundCtx.time, spiked, siteProfile, roundCtx);
        break;
      }

      const attacker = pickAliveAttacker(attackers, alive.attackers, false);
      const defender = pickAliveDefender(defenders, alive.defenders);
      if (!attacker || !defender) break;

      resolveDuel(attacker, defender, attackers, defenders, alive, kills, false, {
        phase: "postplant",
        attackerHasInfo: false,
        defenderHasAngle: false,
        abilityBonus: clamp(0.03 + postPlantAdvantage, 0, 0.20),
      }, roundCtx);

      // Postplant cadence — defenders' aggression dictates how quickly they
      // commit to retake duels. Aggressive defense pushes site faster (lower
      // cadence), defensive defense waits for picks (higher cadence).
      const cadenceScale = 1 / defenders.playstyleMods.postplantAggression;
      roundCtx.time += randFloat(3 * cadenceScale, 6 * cadenceScale);
    }

    // Defuse decision — defenders alive AND attackers wiped → attempt defuse.
    // Guard against simulateClutch leaving roundCtx.time past detonation time.
    if (alive.attackers.size === 0 && alive.defenders.size > 0) {
      // Clamp current time to not exceed detonationTime (clutch can over-advance)
      if (roundCtx.time > detonationTime) roundCtx.time = detonationTime;
      const timeRemaining = detonationTime - roundCtx.time;
      // Pick a defuser from alive defenders — random among them, since the
      // closest-to-spike defender typically commits to the defuse.
      const aliveDefusers = defenders.players.filter((p) =>
        alive.defenders.has(p.input.id),
      );
      const defuserCandidate = aliveDefusers.length > 0
        ? aliveDefusers[Math.floor(Math.random() * aliveDefusers.length)]
        : null;
      if (timeRemaining >= DEFUSE_FULL) {
        spikeDefused = true; // safe full defuse
        roundCtx.time += DEFUSE_FULL;
        defuserId = defuserCandidate?.input.id ?? null;
      } else if (timeRemaining >= DEFUSE_HALF) {
        // Risky half-defuse — 70% chance to land it
        spikeDefused = rand(0.7);
        if (spikeDefused) {
          roundCtx.time += timeRemaining;
          defuserId = defuserCandidate?.input.id ?? null;
        }
      }
      // else: no time left, spike detonates
    }
  }

  // Successful defuse awards +1 ult point to the defuser.
  if (spikeDefused && defuserId) {
    const defuser = defenders.players.find((p) => p.input.id === defuserId);
    if (defuser) {
      defuser.ultPoints = Math.min(defuser.ultMax, defuser.ultPoints + 1);
    }
  }

  // ── Determine winner (covers all 9 round cases) ──
  // Spike planted: attackers win if detonation (default), defenders only on defuse
  // No plant: defenders win by default; attackers only if all defenders eliminated pre-plant
  // Safety guard: if defenders are all dead, the defuse flag is nonsensical — clear it.
  // (Addresses edge cases where the flag could drift out of sync with alive state.)
  if (alive.defenders.size === 0 && spikeDefused) {
    spikeDefused = false;
  }
  let winner: 1 | 2;
  if (spiked) {
    winner = spikeDefused
      ? (team1Attacking ? 2 : 1)   // Case 6: defused → DEF win
      : (team1Attacking ? 1 : 2);  // Cases 1, 4, 7, 8: detonates → ATT win
  } else {
    if (alive.defenders.size === 0 && alive.attackers.size > 0) {
      winner = team1Attacking ? 1 : 2;
    } else {
      winner = team1Attacking ? 2 : 1;
    }
  }

  // ── Build KAST contribution per player ──
  const kastContrib = new Map<string, { k: boolean; a: boolean; s: boolean; t: boolean }>();
  for (const p of [...team1.players, ...team2.players]) {
    kastContrib.set(p.input.id, { k: false, a: false, s: false, t: false });
  }
  for (const kill of kills) {
    const k = kastContrib.get(kill.killerId);
    if (k) k.k = true;
    for (const aid of kill.assistantIds) {
      const a = kastContrib.get(aid);
      if (a) a.a = true;
    }
    if (kill.wasTraded) {
      const v = kastContrib.get(kill.victimId);
      if (v) v.t = true;
    }
  }
  for (const pid of alive.attackers) {
    const s = kastContrib.get(pid);
    if (s) s.s = true;
  }
  for (const pid of alive.defenders) {
    const s = kastContrib.get(pid);
    if (s) s.s = true;
  }

  const event = detectEvent(kills, team1, team2, winner, alive, spiked);

  return { winner, kills, spiked, event, kastContrib, plantTime, spikeDefused };
}

interface DuelResult {
  killed: boolean;
  killer: PlayerState;
  victim: PlayerState;
  kill: KillRecord;
}

/**
 * Resolve assistants for a kill from pendingAssists (flashes, abilities, smokes, traps)
 * and damageLog (prior non-killing damage). Priority: flash > ability > cast > damage.
 * Max 2 assists. Consumes oneShot entries.
 */
function resolveAssistants(
  killer: PlayerState,
  victim: PlayerState,
  ctx: RoundContext,
): string[] {
  const now = ctx.time;
  const assistantIds: string[] = [];

  // Collect valid pending assists from killer's team, not expired, matching this victim
  const valid = ctx.pendingAssists.filter((a) =>
    a.teamId === killer.teamId &&
    a.playerId !== killer.input.id &&
    a.expiresAt >= now &&
    (a.targetVictimId === null || a.targetVictimId === victim.input.id),
  );

  const typeOrder: Record<AssistType, number> = { flash: 1, ability: 2, cast: 3, damage: 4 };
  valid.sort((a, b) => typeOrder[a.type] - typeOrder[b.type]);

  const toConsume: PendingAssist[] = [];
  for (const a of valid) {
    if (assistantIds.length >= 2) break;
    if (assistantIds.includes(a.playerId)) continue; // one credit per assister
    // Non-one-shot abilities (controller smokes, sentinel traps, post-plant
    // lockdowns) sit in pendingAssists for 15-30s and would otherwise credit
    // the caster on EVERY kill that happens in that window. In real Valorant
    // a smoke / trap assist requires the kill to actually go through the
    // utility — gate with a probability roll so Controllers don't post 40+
    // assists per map.
    if (a.type === "cast" && Math.random() > 0.20) continue;
    assistantIds.push(a.playerId);
    if (a.oneShot) toConsume.push(a);
  }

  for (const a of toConsume) {
    const idx = ctx.pendingAssists.indexOf(a);
    if (idx >= 0) ctx.pendingAssists.splice(idx, 1);
  }

  // Damage assists — teammates of killer who dealt ≥50 damage to victim earlier this round
  if (assistantIds.length < 2) {
    const seen = new Set<string>(assistantIds);
    // Iterate from most recent backwards
    for (let i = ctx.damageLog.length - 1; i >= 0; i--) {
      if (assistantIds.length >= 2) break;
      const d = ctx.damageLog[i];
      if (d.victimId !== victim.input.id) continue;
      if (d.dealerId === killer.input.id) continue;
      if (seen.has(d.dealerId)) continue;
      if (d.damage < 50) continue;
      assistantIds.push(d.dealerId);
      seen.add(d.dealerId);
    }
  }

  return assistantIds;
}

function resolveDuel(
  attacker: PlayerState,
  defender: PlayerState,
  attackerTeam: TeamRuntime,
  defenderTeam: TeamRuntime,
  alive: { attackers: Set<string>; defenders: Set<string> },
  kills: RoundOutcome["kills"],
  isFirstDuel: boolean,
  ctx: DuelContext,
  roundCtx: RoundContext,
): DuelResult {
  const attEco = attackerTeam.economy.get(attacker.input.id)!;
  const defEco = defenderTeam.economy.get(defender.input.id)!;

  // Small chance of prior damage softening whoever ends up the victim.
  // Recorded before the duel resolves — we pre-register both directions lightly.
  maybeRegisterPriorDamage(attackerTeam, defender, roundCtx);

  // Resolve which alive set belongs to each team (teams don't straddle).
  // Used by duelWinProb for the relation edge (DUO/CLASH with alive mates).
  const attackerIsRoundAttacker = attackerTeam.players.some((p) => alive.attackers.has(p.input.id));
  const attackerAliveMates = attackerIsRoundAttacker ? alive.attackers : alive.defenders;
  const defenderAliveMates = attackerIsRoundAttacker ? alive.defenders : alive.attackers;

  // Inject the map ATK bias into the duel context. In setup/execution phases
  // the duel attacker is on the round's ATK side, so positive bias favors them.
  // In postplant retake duels the defender becomes the entry — invert the sign.
  const cachedBias = attackerTeam.mapAtkBias;
  const ctxWithBias: DuelContext = {
    ...ctx,
    mapAtkBias:
      ctx.phase === "postplant" && !attackerIsRoundAttacker
        ? -cachedBias
        : ctx.phase === "postplant"
          ? -cachedBias // postplant retake reverses who's "attacking"
          : attackerIsRoundAttacker
            ? cachedBias
            : -cachedBias,
  };

  const winProb = duelWinProb(
    attacker,
    defender,
    attEco,
    defEco,
    ctxWithBias,
    attackerTeam,
    defenderTeam,
    attackerAliveMates,
    defenderAliveMates,
  );

  const attackerWins = Math.random() < winProb;

  const killer = attackerWins ? attacker : defender;
  const victim = attackerWins ? defender : attacker;
  // Victim's alive set is determined by their ROLE IN THE ROUND, not by the duel
  // "attacker"/"defender" params — because trades invert those params (the trader
  // is the "attacker" argument but may be a round-defender). We identify the correct
  // set by checking which one currently contains the victim.
  const victimSet = alive.attackers.has(victim.input.id) ? alive.attackers : alive.defenders;

  // ── Update personal duel streaks + immediate hotness recalc ──
  killer.consecutiveDuelsWon += 1;
  killer.consecutiveDuelsLost = 0;
  victim.consecutiveDuelsLost += 1;
  victim.consecutiveDuelsWon = 0;
  recalcHotness(killer);
  recalcHotness(victim);

  // Remove victim from alive
  victimSet.delete(victim.input.id);

  // Damage: ~140 for a kill
  const damage = 140 + Math.floor(Math.random() * 20);

  // Resolve assistants from pending assists + damage log
  const assistantIds = resolveAssistants(killer, victim, roundCtx);

  // Trade detection: if any prior kill within 1.5s had a victim on the killer's team,
  // that prior victim was traded by this kill.
  for (let i = kills.length - 1; i >= 0; i--) {
    const prev = kills[i];
    if (roundCtx.time - prev.timing > 1.5) break;
    if (prev.victimTeamId === killer.teamId && prev.killerTeamId === victim.teamId) {
      prev.wasTraded = true;
      roundCtx.tradedVictims.add(prev.victimId);
    }
  }

  const kill: KillRecord = {
    killerId: killer.input.id,
    killerTeamId: killer.teamId,
    victimId: victim.input.id,
    victimTeamId: victim.teamId,
    isFirstKill: isFirstDuel,
    damage,
    assistantIds,
    timing: roundCtx.time,
  };
  kills.push(kill);

  // Sage revive check — fires when a teammate's death drops a Sage's team
  // into numeric disadvantage. Both sides are checked because Sage could be
  // on either team. Idempotent: each Sage can only trigger once per round.
  // `attackerAliveMates` / `defenderAliveMates` are pre-computed earlier in
  // this function and reflect which alive set each team's players occupy.
  maybeSageRevive(attackerTeam, attackerAliveMates, defenderAliveMates);
  maybeSageRevive(defenderTeam, defenderAliveMates, attackerAliveMates);

  return { killed: true, killer, victim, kill };
}

// ──────────────────────────────────────────────────────────
// Picks (who fights who)
// ──────────────────────────────────────────────────────────

function pickEntryFragger(team: TeamRuntime, alive: Set<string>): PlayerState | null {
  const candidates = team.players.filter((p) => alive.has(p.input.id));
  if (candidates.length === 0) return null;

  // If the team designated an entry this round (set by planBuys so the drop could
  // route to them) and that player is still alive, they entry. Overrides agent
  // weighting — this is the guy who got dropped a rifle expecting to go first.
  if (team.roundEntryId) {
    const designated = candidates.find((p) => p.input.id === team.roundEntryId);
    if (designated) return designated;
  }

  // Weighted by entryProb (agent) × hotness^2 × aggression factor. Aggression
  // 10-95 maps to a 0.55-1.45 multiplier — a high-aggression Aspas/Less type
  // takes entry duels even off a non-Duelist agent, while a passive star
  // (low aggression, high gameIQ) takes second contact more often.
  const weights = candidates.map((p) => {
    const aggrFactor = 0.55 + (p.aggression - 10) / 85 * 0.9;
    return getAgentMod(p.agent).entryProb * Math.pow(p.hotness, 2) * aggrFactor;
  });
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[0];
}

function pickAliveAttacker(team: TeamRuntime, alive: Set<string>, isFirst: boolean): PlayerState | null {
  if (isFirst) return pickEntryFragger(team, alive);
  const candidates = team.players.filter((p) => alive.has(p.input.id));
  if (candidates.length === 0) return null;
  // Weighted by rating
  const weights = candidates.map((p) => p.rating * p.hotness);
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[0];
}

function pickAliveDefender(team: TeamRuntime, alive: Set<string>): PlayerState | null {
  // Defenders are picked slightly weighted by defense bonus agents
  const candidates = team.players.filter((p) => alive.has(p.input.id));
  if (candidates.length === 0) return null;
  // Equal weighting for defenders, slightly boost sentinels
  const weights = candidates.map((p) => 1 + getAgentMod(p.agent).defenseBonus * 2);
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[0];
}

function pickHolder(team: TeamRuntime, alive: Set<string>): PlayerState | null {
  return pickAliveDefender(team, alive);
}

function pickTrader(team: TeamRuntime, alive: Set<string>): PlayerState | null {
  const candidates = team.players.filter((p) => alive.has(p.input.id));
  if (candidates.length === 0) return null;
  // Weighted by trade prob + rating
  const weights = candidates.map((p) => (1 + getAgentMod(p.agent).tradeProb * 2) * p.rating);
  const total = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i];
    if (r <= 0) return candidates[i];
  }
  return candidates[0];
}

// ──────────────────────────────────────────────────────────
// Site choice + anti-read
// ──────────────────────────────────────────────────────────

function chooseSite(attackers: TeamRuntime, defenders: TeamRuntime): string {
  // If attackers have gone the same site 3+ times recently, switch
  const lastChoice = maxKey(attackers.sitePreference);
  const defRead = defenders.sitePreference; // defenders might also stack based on attacker history (implicitly)
  void defRead;

  // Simple strategy: if we've pushed A 3+ times, go B. Otherwise random weighted.
  if ((attackers.sitePreference[lastChoice] ?? 0) >= 3) {
    const other = lastChoice === "A" ? "B" : "A";
    return other;
  }
  return pick(["A", "A", "B", "B", "M"]);
}

function maxKey(record: Record<string, number>): string {
  const entries = Object.entries(record);
  if (entries.length === 0) return "A";
  return entries.reduce((max, e) => e[1] > max[1] ? e : max)[0];
}

// ──────────────────────────────────────────────────────────
// Ability advantage
// ──────────────────────────────────────────────────────────

function computeAbilityAdvantage(team: TeamRuntime): number {
  let total = 0;
  for (const p of team.players) {
    const mod = getAgentMod(p.agent);
    total += mod.infoAdvantage * 0.5; // info from the whole team contributes
  }
  // Utility skill of the team adds on top
  total += (team.input.skillUtility / 100) * 0.08;
  return clamp(total, 0, 0.25);
}

// ──────────────────────────────────────────────────────────
// Event detection
// ──────────────────────────────────────────────────────────

function detectEvent(
  kills: RoundOutcome["kills"],
  team1: TeamRuntime,
  team2: TeamRuntime,
  winner: 1 | 2,
  alive: { attackers: Set<string>; defenders: Set<string> },
  spiked: boolean,
): RoundEventDetail | null {
  void spiked;
  if (kills.length === 0) return null;

  // Ace: single player with 5 kills this round
  const kcount = new Map<string, number>();
  for (const k of kills) kcount.set(k.killerId, (kcount.get(k.killerId) ?? 0) + 1);
  for (const [pid, cnt] of kcount) {
    if (cnt >= 5) {
      const p = [...team1.players, ...team2.players].find((x) => x.input.id === pid);
      if (p) {
        return {
          type: "ace",
          text: `ACE — ${p.input.ign} takes out all 5`,
          playerIgn: p.input.ign,
          weight: 10,
        };
      }
    }
  }

  // Clutch: last alive player got 2+ kills in the round while outnumbered
  const winTeam = winner === 1 ? team1 : team2;
  const aliveOfWinner = winner === 1
    ? new Set([...alive.attackers, ...alive.defenders].filter((id) => winTeam.players.some((p) => p.input.id === id)))
    : new Set([...alive.attackers, ...alive.defenders].filter((id) => winTeam.players.some((p) => p.input.id === id)));
  if (aliveOfWinner.size === 1) {
    const survivor = winTeam.players.find((p) => aliveOfWinner.has(p.input.id));
    if (survivor) {
      const killsByHim = kcount.get(survivor.input.id) ?? 0;
      if (killsByHim >= 2) {
        return {
          type: "clutch",
          text: `CLUTCH — ${survivor.input.ign} ${killsByHim}K while alone`,
          playerIgn: survivor.input.ign,
          weight: 8,
          clutchSize: `1v${killsByHim}`,
        };
      }
    }
  }

  // First blood
  if (kills[0].isFirstKill) {
    const p = [...team1.players, ...team2.players].find((x) => x.input.id === kills[0].killerId);
    if (p && Math.random() < 0.3) {
      return {
        type: "first_blood",
        text: `First Blood — ${p.input.ign}`,
        playerIgn: p.input.ign,
        weight: 3,
      };
    }
  }

  return null;
}

// ──────────────────────────────────────────────────────────
// Apply round results to player stats
// ──────────────────────────────────────────────────────────

function applyRoundStats(
  outcome: RoundOutcome,
  team1: TeamRuntime,
  team2: TeamRuntime,
): void {
  const statsThisRound = new Map<string, RoundStats>();
  for (const p of [...team1.players, ...team2.players]) {
    statsThisRound.set(p.input.id, { k: 0, d: 0, a: 0, fk: 0, fd: 0, damage: 0 });
  }

  for (const kill of outcome.kills) {
    const ks = statsThisRound.get(kill.killerId)!;
    const vs = statsThisRound.get(kill.victimId)!;
    ks.k += 1;
    ks.damage += kill.damage;
    vs.d += 1;
    if (kill.isFirstKill) {
      ks.fk += 1;
      vs.fd += 1;
    }
    // Assists emerge from gameplay: each kill's assistantIds were filled by
    // resolveDuel from pendingAssists (flashes, abilities, smokes, traps) and
    // damageLog (prior non-killing damage). Fade haunts, Omen smokes, Skye flashes
    // all naturally credit their casters here.
    for (const aid of kill.assistantIds) {
      const as = statsThisRound.get(aid);
      if (as) as.a += 1;
    }
  }

  // Commit to player totals and history + accrue ultimate points.
  // Ult charge sources (per real Valorant):
  //   - +1 per kill
  //   - +1 per death (consolation, prevents losing-side from never ulting)
  //   - +1 every other round (proxy for the two ult orbs scattered on the map)
  // The player who just popped their ult had `ultPoints` reset to 0 before
  // round resolution; gains this round stick for the next one.
  for (const p of [...team1.players, ...team2.players]) {
    const s = statsThisRound.get(p.input.id)!;
    p.perRound.push(s);
    p.total.k += s.k;
    p.total.d += s.d;
    p.total.a += s.a;
    p.total.fk += s.fk;
    p.total.fd += s.fd;
    p.total.damage += s.damage;

    // Ult accrual — capped at ultMax so we don't overshoot.
    let gain = s.k + s.d;
    // Every 2nd round, +1 from orb collection (deterministic, alternates per
    // player's history length to vary per-player so the team doesn't all
    // hit ult readiness on the same exact round).
    if ((p.perRound.length + p.input.id.charCodeAt(0)) % 2 === 0) gain += 1;
    p.ultPoints = Math.min(p.ultMax, p.ultPoints + gain);
  }
}

function updateHotness(team: TeamRuntime): void {
  // Called at end of each round — recomputes the "map form" rolling component.
  // IMPORTANT: we use the 3 rounds BEFORE the one just played (N-3, N-2, N-1),
  // not including the current round N. This prevents the rolling from collapsing
  // immediately on one bad round — a carry who dominated rounds 4-6 and lost a duel
  // in round 7 should still have a high rolling entering round 8, because rounds
  // 4, 5, 6 are still his recent history. Round 7's impact is reflected via the
  // streak (which resets on duel loss), not via the rolling.
  for (const p of team.players) {
    const total = p.perRound.length;
    // Window: last 3 rounds excluding the one just played
    const start = Math.max(0, total - 4);
    const end = Math.max(start, total - 1); // exclude the most recent
    const recent = p.perRound.slice(start, end);
    if (recent.length === 0) {
      p.rollingImpact = 0;
    } else {
      const avgImpact = recent.reduce((s, r) => s + r.k - r.d * 0.5, 0) / recent.length;
      p.rollingImpact = clamp(avgImpact * 0.02, -0.05, 0.05);
    }
    recalcHotness(p);
  }
}

function updateMomentum(team: TeamRuntime, wonRound: boolean): void {
  if (wonRound) {
    team.winStreak += 1;
    team.lossStreak = 0;
    team.lossesBonus = 0;
  } else {
    team.lossStreak += 1;
    team.winStreak = 0;
    team.lossesBonus += 1;
  }
}

/**
 * Halftime adaptation — only the trailing side rolls. The deeper the deficit,
 * the higher the chance their coaching staff finds something in the H1 vods.
 * On success, +0.025 adaptationEdge propagates into every H2 duel.
 */
function tryHalftimeAdapt(team: TeamRuntime, opponent: TeamRuntime): void {
  const deficit = opponent.score - team.score;
  if (deficit < 3) return; // 9-3 minimum to even consider; comfortable lead = no shift
  // Probability scales with adaptationRating AND deficit. A 50-rated staff
  // trailing 3-9 fires ~40% of the time; 80-rated trailing 2-10 fires ~75%.
  const deficitBoost = Math.min(0.25, (deficit - 3) * 0.05);
  const prob = (team.adaptationRating / 100) * 0.6 + deficitBoost;
  if (Math.random() >= prob) return;
  team.adaptationEdge = Math.min(0.06, team.adaptationEdge + 0.025);
}

/**
 * Intra-half audible — fires once per half when a team's lossStreak hits
 * 3+. Smaller bonus than halftime (the IGL is calling it on the fly without
 * coaching input). One-shot per half so we don't snowball this.
 */
function tryMidHalfAdapt(team: TeamRuntime): void {
  if (team.lossStreakAdaptedThisHalf) return;
  if (team.lossStreak < 3) return;
  // 50-rated team has 25% chance after a 3-round streak, 95-rated has ~48%.
  const prob = (team.adaptationRating / 100) * 0.5;
  if (Math.random() >= prob) return;
  team.adaptationEdge = Math.min(0.06, team.adaptationEdge + 0.015);
  team.lossStreakAdaptedThisHalf = true;
}

// ──────────────────────────────────────────────────────────
// Main exports
// ──────────────────────────────────────────────────────────

export function simulateMapDuel(
  team1Input: SimTeamInput,
  team2Input: SimTeamInput,
  mapName: string,
  options: DuelMapOptions = {},
): MapResultOut {
  const team1 = buildTeamRuntime(team1Input, options.team1Agents, mapName, options.agentMastery, options.priorHotness, options.team1AwperId);
  const team2 = buildTeamRuntime(team2Input, options.team2Agents, mapName, options.agentMastery, options.priorHotness, options.team2AwperId);
  team1.pairs = options.team1Pairs;
  team2.pairs = options.team2Pairs;

  if (options.team1CoachBoost) team1.input.skillUtility += options.team1CoachBoost * 0.05;
  if (options.team2CoachBoost) team2.input.skillUtility += options.team2CoachBoost * 0.05;

  // Coach decomposition (Tier 1) — adaptation dampens loss-streak tilt,
  // mental raises team tilt resistance. Defaults 50 keep behavior neutral.
  team1.coachAdaptation = options.team1CoachAdaptation ?? 50;
  team2.coachAdaptation = options.team2CoachAdaptation ?? 50;
  team1.coachMental = options.team1CoachMental ?? 50;
  team2.coachMental = options.team2CoachMental ?? 50;
  // Apply mental coach to every player's tilt resistance retroactively. Goes
  // from -0.10 at 0 to +0.10 at 100 (centered on 50).
  const applyMentalBoost = (team: TeamRuntime) => {
    const bonus = (team.coachMental - 50) / 500;
    for (const p of team.players) {
      p.tiltResistance = clamp(p.tiltResistance + bonus, 0.35, 0.95);
    }
  };
  applyMentalBoost(team1);
  applyMentalBoost(team2);

  const team1StartsAttack = options.team1StartsAttack ?? true;
  const rounds: RoundEvent[] = [];
  let roundNum = 1;

  // Survivors from the prior round — drives which players keep their weapons and
  // whose deaths feed the weaponPool. At round 1 everyone is "alive" (no prior round).
  let team1Survivors = new Set(team1.players.map((p) => p.input.id));
  let team2Survivors = new Set(team2.players.map((p) => p.input.id));

  const runRound = (half: 1 | 2 | "OT", t1Attack: boolean, isPistol: boolean): void => {
    const buy1 = planBuys(team1, isPistol, team1Survivors);
    const buy2 = planBuys(team2, isPistol, team2Survivors);

    // Ult usage decision — every round, each player with a ready ult has a
    // chance to pop it. Pros don't ult every round even when ready: they save
    // for high-impact moments. 50% chance per round if ready captures the
    // pacing roughly (typically ult-ready 2-3 rounds before usage).
    // Pistol rounds: no ults (insufficient orbs collected anyway).
    //
    // Effects are categorized per-agent (see ULT_CONFIG). Per-player buffs go
    // on PlayerState; team-wide effects (info, zone, lockdown) propagate to
    // the team's runtime fields so EVERY duel of that team gets the bonus.
    for (const team of [team1, team2]) {
      // Reset team-level ult effects from last round.
      team.ultInfoEdge = 0;
      team.ultZoneEdge = 0;
      team.ultLockdownEdge = 0;
      team.ultAbilityEdge = 0;
      for (const p of team.players) {
        p.isUsingUltThisRound = false;
        p.ultMechEdgeThisRound = 0;
        if (isPistol) continue;
        if (p.ultPoints < p.ultMax) continue;
        const cfg = ULT_CONFIG[p.agent];
        // Sage holds her ult for mid-round revive (triggered by maybeSageRevive
        // when her team falls into numeric disadvantage). Don't fire at round
        // start.
        if (cfg?.type === "revive") continue;
        if (Math.random() >= 0.5) continue;
        p.isUsingUltThisRound = true;
        p.ultPoints = 0;
        if (!cfg) {
          // Unknown agent — generic small duel boost as fallback.
          p.ultMechEdgeThisRound = 0.12;
          continue;
        }
        if (cfg.type === "duel") {
          p.ultMechEdgeThisRound = cfg.mechEdge ?? 0.15;
        }
        // Team-wide effects stack across multiple ulters via Math.max — two
        // Sovas double-info doesn't double-stack the edge.
        if (cfg.infoEdge) team.ultInfoEdge = Math.max(team.ultInfoEdge, cfg.infoEdge);
        if (cfg.positionalEdge) team.ultZoneEdge = Math.max(team.ultZoneEdge, cfg.positionalEdge);
        if (cfg.abilityEdge) team.ultAbilityEdge = Math.max(team.ultAbilityEdge, cfg.abilityEdge);
        if (cfg.type === "lockdown") {
          team.ultLockdownEdge = Math.max(
            team.ultLockdownEdge,
            cfg.positionalEdge ?? cfg.abilityEdge ?? 0.12,
          );
        }
      }
    }

    const budget1 = avgCredits(team1);
    const budget2 = avgCredits(team2);

    // Snapshot post-buy loadouts BEFORE the round plays
    const loadouts: PlayerLoadoutSnapshot[] = [];
    for (const team of [team1, team2]) {
      for (const p of team.players) {
        const e = team.economy.get(p.input.id)!;
        loadouts.push({
          playerId: p.input.id,
          weapon: e.weapon,
          armor: e.armor,
          creditsAfterBuy: e.credits,
          fromPickup: e.fromPickup,
        });
      }
    }

    const outcome = simulateRound(team1, team2, roundNum, t1Attack, mapName);
    applyRoundStats(outcome, team1, team2);
    updateHotness(team1);
    updateHotness(team2);

    if (outcome.winner === 1) team1.score += 1; else team2.score += 1;
    updateMomentum(team1, outcome.winner === 1);
    updateMomentum(team2, outcome.winner === 2);
    // Tier 2 — intra-half audible. After 3+ rounds lost in a row, the losing
    // team rolls adaptation. Capped at one trigger per half.
    tryMidHalfAdapt(team1);
    tryMidHalfAdapt(team2);
    awardCredits(team1, outcome.winner === 1, outcome.spiked && t1Attack);
    awardCredits(team2, outcome.winner === 2, outcome.spiked && !t1Attack);

    // Snapshot survivors from the round's KAST contribution — these keep their
    // weapons next round. The dead feed the weaponPool for pickup.
    team1Survivors = new Set(
      team1.players.filter((p) => outcome.kastContrib.get(p.input.id)?.s).map((p) => p.input.id),
    );
    team2Survivors = new Set(
      team2.players.filter((p) => outcome.kastContrib.get(p.input.id)?.s).map((p) => p.input.id),
    );
    collectWeaponPool(team1, team1Survivors);
    collectWeaponPool(team2, team2Survivors);

    rounds.push({
      round: roundNum,
      winner: outcome.winner,
      half,
      score1: team1.score,
      score2: team2.score,
      team1Buy: buy1,
      team2Buy: buy2,
      team1Budget: budget1,
      team2Budget: budget2,
      event: outcome.event,
      kills: outcome.kills.map((k) => ({
        killerId: k.killerId,
        victimId: k.victimId,
        assistIds: k.assistantIds,
        isFirstKill: k.isFirstKill,
        timing: k.timing,
      })),
      loadouts,
      plantTime: outcome.plantTime,
      spikeDefused: outcome.spikeDefused,
    });

    roundNum++;
  };

  // ── First half: 12 rounds ──
  for (let i = 0; i < 12; i++) {
    runRound(1, team1StartsAttack, i === 0);
    if (team1.score >= 13 || team2.score >= 13) break;
  }

  // ── Second half ──
  if (team1.score < 13 && team2.score < 13) {
    // Halftime reset — economy AND mental momentum. Without resetting
    // hotness / streaks, the team that dominated H1 carried a huge "hot
    // hand" buff into the H2 pistol round, which in real Valorant is much
    // closer to a coin flip. Without this reset 10-2 first halves were
    // turning into 11-round losing streaks because the cold side could
    // never break out of the snowball.
    for (const t of [team1, team2]) {
      for (const p of t.players) {
        t.economy.set(p.input.id, {
          credits: 800,
          weapon: "Classic",
          armor: "none",
          weaponTier: 0,
          fromPickup: false,
        });
        // Reset per-player streaks/hotness so H2 starts fresh-headed.
        p.consecutiveDuelsWon = 0;
        p.consecutiveDuelsLost = 0;
        p.rollingImpact = 0;
        p.hotness = 1.0;
      }
      t.weaponPool = [];
      t.roundEntryId = null;
      t.inSaveMode = false;
      // Team-level streaks too (drives tilt and loss-bonus escalation).
      t.winStreak = 0;
      t.lossStreak = 0;
      t.lossesBonus = 0;
      // Reset intra-half audible flag — both sides get one fresh chance in H2.
      t.lossStreakAdaptedThisHalf = false;
    }
    // Tier 2 — halftime adaptation roll. The trailing side checks if their
    // coaching staff found something. Applies before any H2 round so the
    // H2 pistol already feels the shift.
    tryHalftimeAdapt(team1, team2);
    tryHalftimeAdapt(team2, team1);
    team1Survivors = new Set(team1.players.map((p) => p.input.id));
    team2Survivors = new Set(team2.players.map((p) => p.input.id));

    for (let i = 0; i < 12; i++) {
      runRound(2, !team1StartsAttack, i === 0);
      if (team1.score >= 13 || team2.score >= 13) break;
    }
  }

  // ── Overtime (MR2: always play both rounds) ──
  while (team1.score === team2.score && team1.score >= 12) {
    for (let otPair = 0; otPair < 2; otPair++) {
      runRound("OT", otPair === 0, false);
    }
  }

  // ── Build player stats ──
  const playerStats: PlayerMapStatsOut[] = [];
  for (const p of [...team1.players, ...team2.players]) {
    const totalRounds = p.perRound.length;
    const adr = totalRounds > 0 ? Math.round(p.total.damage / totalRounds) : 0;
    const acs = totalRounds > 0 ? Math.round((p.total.k * 160 + p.total.a * 55 + adr * totalRounds * 0.8) / totalRounds) : 0;
    playerStats.push({
      playerId: p.input.id,
      teamId: p.teamId,
      ign: p.input.ign,
      kills: p.total.k,
      deaths: p.total.d,
      assists: p.total.a,
      acs,
      fk: p.total.fk,
      fd: p.total.fd,
    });
  }

  // Ensure kills_A ≈ deaths_B via slight rebalance if needed (should be tight already)
  // Our duel system naturally enforces this: each kill = 1 death.

  // Ignore unused var warning
  void gauss;

  // End-of-map hotness for series continuity
  const endOfMapHotness: EndOfMapHotness = {};
  for (const p of [...team1.players, ...team2.players]) {
    endOfMapHotness[p.input.id] = p.hotness;
  }

  return {
    map: mapName,
    score1: team1.score,
    score2: team2.score,
    rounds,
    playerStats,
    endOfMapHotness,
  };
}

function avgCredits(team: TeamRuntime): number {
  return Math.round([...team.economy.values()].reduce((s, e) => s + e.credits, 0) / team.players.length);
}
