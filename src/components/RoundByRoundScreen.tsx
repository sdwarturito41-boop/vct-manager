"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ── Types ──

export type EcoType = "Full buy" | "Force buy" | "Eco" | "Pistol";
export type RoundWinner = "my" | "opp";
export type EventType = "clutch" | "eco" | "pistol" | "ace";

export interface Player {
  ign: string;
  agent: string;
  agentColor: string;
  agentPortraitUrl?: string;
  role: string;
}

export interface RoundEventData {
  type: EventType;
  description: string;
}

export interface RoundKillFeedEntry {
  killerIgn: string;
  killerTeam: "my" | "opp";
  victimIgn: string;
  weapon?: string;
  isFirstKill: boolean;
  timing: number;
  assistIgns: string[];
}

export interface RoundData {
  roundNumber: number;
  winner: RoundWinner;
  myEco: EcoType;
  oppEco: EcoType;
  myCredits: number;
  oppCredits: number;
  event?: RoundEventData;
  coachComment: string;
  /** Ordered kill feed for this round */
  killFeed?: RoundKillFeedEntry[];
  /** When spike plant completed, in seconds. null = no plant */
  plantTime?: number | null;
  /** True if defenders defused */
  spikeDefused?: boolean;
}

export interface PlayerStats {
  ign: string;
  k: number;
  d: number;
  a: number;
  acs: number;
  adr: number;
  kast: number;
  hs: number;
  fk: number;
  // ── Loadout (snapshot for the round currently displayed) ──
  credits?: number;
  weapon?: string; // "Vandal" | "Phantom" | "Operator" | "Spectre" | "Sheriff" | "Ghost" | "Classic" | "Stinger"
  armor?: "heavy" | "light" | "none";
  /** Q / E / C / X availability + ult charge (0-1). fromPickup flags a dropped weapon. */
  abilities?: { q: boolean; e: boolean; c: boolean; x: boolean; ultCharge?: number };
  fromPickup?: boolean;
}

export interface TeamData {
  name: string;
  color: string;
  logo?: string;
  players: Player[];
}

export interface RoundByRoundScreenProps {
  mapName: string;
  mapImageUrl?: string;
  stage: string;
  myTeam: TeamData;
  oppTeam: TeamData;
  rounds: RoundData[];
  getStatsAtRound: (round: number) => { my: PlayerStats[]; opp: PlayerStats[] };
  onMapEnd: (result: "win" | "loss", finalScore: { my: number; opp: number }) => void;
  /** User's side in the 1st half — drives the "Attack"/"Defense" label in the header.
   * Sides flip in 2nd half. Defaults to "attack" (legacy behavior) if not provided. */
  myFirstHalfSide?: "attack" | "defense";
}

// ── Constants ──

const COLORS = {
  bgPrimary: "#0F0F14",
  bgSurface: "#16161E",
  bgCard: "#13131A",
  accentRed: "#FF4655",
  accentGreen: "#4CAF7D",
  accentGold: "#C69B3A",
  accentAmber: "#EF9F27",
  textPrimary: "#ECE8E1",
  textMuted: "#6B6B80",
  border: "rgba(255,255,255,0.08)",
  borderFaint: "rgba(255,255,255,0.04)",
} as const;

const ECO_STYLES: Record<EcoType, { bg: string; color: string }> = {
  "Full buy": { bg: "rgba(76,175,125,0.1)", color: COLORS.accentGreen },
  "Force buy": { bg: "rgba(239,159,39,0.1)", color: COLORS.accentAmber },
  Eco: { bg: "rgba(255,70,85,0.1)", color: COLORS.accentRed },
  Pistol: { bg: "rgba(255,255,255,0.05)", color: COLORS.textPrimary },
};

const EVENT_STYLES: Record<EventType, { bg: string; border: string; color: string }> = {
  clutch: { bg: "rgba(198,155,58,0.1)", border: "rgba(198,155,58,0.25)", color: COLORS.accentGold },
  eco: { bg: "rgba(76,175,125,0.1)", border: "rgba(76,175,125,0.2)", color: COLORS.accentGreen },
  pistol: { bg: "rgba(255,255,255,0.06)", border: "rgba(255,255,255,0.1)", color: COLORS.textPrimary },
  ace: { bg: "rgba(198,155,58,0.1)", border: "rgba(198,155,58,0.25)", color: COLORS.accentGold },
};

// ── Helpers ──

function agentAbbr(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

function formatCredits(n: number): string {
  return `$${n.toLocaleString("en-US")}`;
}

// ── Subcomponents ──

function TeamBlock({
  team,
  score,
  winning,
  align,
}: {
  team: TeamData;
  score: number;
  winning: boolean;
  align: "left" | "right";
}) {
  return (
    <div
      className="flex items-center gap-2.5"
      style={{ flexDirection: align === "right" ? "row-reverse" : "row" }}
    >
      {team.logo ? (
        <img
          src={team.logo}
          alt={team.name}
          className="h-8 w-8 shrink-0 object-contain"
        />
      ) : (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center">
          <span className="text-[11px] font-medium" style={{ color: COLORS.textPrimary }}>
            {team.name.slice(0, 2).toUpperCase()}
          </span>
        </div>
      )}
      <span className="text-[14px] font-medium" style={{ color: COLORS.textPrimary }}>
        {team.name}
      </span>
      <span
        className="text-[30px] font-medium tabular-nums"
        style={{ color: winning ? COLORS.accentGreen : COLORS.textPrimary }}
      >
        {score}
      </span>
    </div>
  );
}

function EcoBadge({ label, eco, credits }: { label: string; eco: EcoType; credits: number }) {
  const style = ECO_STYLES[eco];
  return (
    <div
      className="flex-1 rounded-md px-[10px] py-[6px]"
      style={{ background: style.bg }}
    >
      <div
        className="text-[9px] font-medium uppercase tracking-wider"
        style={{ color: COLORS.textMuted }}
      >
        {label}
      </div>
      <div className="text-[11px] font-medium" style={{ color: style.color }}>
        {eco}
      </div>
      <div className="text-[10px] tabular-nums" style={{ color: COLORS.textMuted }}>
        {formatCredits(credits)}
      </div>
    </div>
  );
}

function AgentIcon({ agent, color }: { agent: string; color: string }) {
  return (
    <div
      className="flex h-5 w-5 items-center justify-center rounded-[3px]"
      style={{ background: color }}
    >
      <span className="text-[8px] font-medium text-white">{agentAbbr(agent)}</span>
    </div>
  );
}

function StatCell({
  value,
  color,
  bold = false,
  flashKey,
}: {
  value: string | number;
  color?: string;
  bold?: boolean;
  flashKey: string | number;
}) {
  const firstRender = useRef(true);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 150);
    return () => clearTimeout(t);
  }, [flashKey]);

  return (
    <motion.div
      animate={{ opacity: flash ? 0.5 : 1 }}
      transition={{ duration: 0.15 }}
      className="text-center text-[13px] tabular-nums"
      style={{ color: color ?? COLORS.textMuted, fontWeight: bold ? 500 : 400 }}
    >
      {value}
    </motion.div>
  );
}

// ── Loadout cells ──

// Map weapon name → image category subfolder
const WEAPON_CATEGORY: Record<string, string> = {
  Vandal: "RIFLES", Phantom: "RIFLES", Bulldog: "RIFLES", Guardian: "RIFLES",
  Classic: "SIDEARMS", Ghost: "SIDEARMS", Frenzy: "SIDEARMS", Shorty: "SIDEARMS", Bandit: "SIDEARMS",
  Spectre: "SMGS", Stinger: "SMGS",
  Operator: "SNIPERS", Marshal: "SNIPERS", Outlaw: "SNIPERS",
  Bucky: "SHOTGUNS", Judge: "SHOTGUNS",
  Ares: "MACHINEGUNS", Odin: "MACHINEGUNS",
};

function weaponImageSrc(weapon: string): string | null {
  const cat = WEAPON_CATEGORY[weapon];
  if (!cat) return null;
  return `/images/WEAPONS/${cat}/${weapon}.png`;
}

function ShieldCell({ armor }: { armor?: "heavy" | "light" | "none" }) {
  if (!armor || armor === "none") {
    return <div className="flex items-center justify-center" style={{ opacity: 0.18 }}>
      <img src="/images/SHIELDS/Low.png" alt="no shield" className="h-[14px] w-auto" style={{ filter: "grayscale(1)" }} />
    </div>;
  }
  const src = armor === "heavy" ? "/images/SHIELDS/Big.png" : "/images/SHIELDS/Low.png";
  return (
    <div className="flex items-center justify-center">
      <img src={src} alt={armor} className="h-[16px] w-auto" draggable={false} />
    </div>
  );
}

function WeaponCell({ weapon, fromPickup }: { weapon?: string; fromPickup?: boolean }) {
  if (!weapon) {
    return <div className="text-center text-[11px]" style={{ color: COLORS.textMuted }}>—</div>;
  }
  const src = weaponImageSrc(weapon);
  return (
    <div className="flex items-center justify-center gap-1">
      {fromPickup && (
        <span style={{ color: COLORS.accentGreen, fontSize: 10, lineHeight: 1 }} title="picked up">↙</span>
      )}
      {src ? (
        <img
          src={src}
          alt={weapon}
          title={weapon}
          draggable={false}
          className="h-[14px] w-auto"
          style={{ maxWidth: 56, objectFit: "contain" }}
        />
      ) : (
        <span className="truncate text-[11px]" style={{ color: COLORS.textPrimary }}>{weapon}</span>
      )}
    </div>
  );
}

function CredsCell({ credits }: { credits?: number }) {
  if (credits === undefined) return <div className="text-center text-[11px]" style={{ color: COLORS.textMuted }}>—</div>;
  const color = credits >= 5800 ? COLORS.accentGreen : credits >= 2000 ? COLORS.accentAmber : COLORS.accentRed;
  const formatted = credits >= 1000 ? `${(credits / 1000).toFixed(1)}k` : `${credits}`;
  return (
    <div className="text-center text-[11px] tabular-nums" style={{ color, fontWeight: 500 }}>
      ${formatted}
    </div>
  );
}

function AbilitiesCell({ abilities }: { abilities?: { q: boolean; e: boolean; c: boolean; x: boolean; ultCharge?: number } }) {
  const a = abilities ?? { q: false, e: false, c: false, x: false, ultCharge: 0 };
  const dot = (on: boolean, color: string) => (
    <div
      className="h-[7px] w-[7px] rounded-[1px]"
      style={{ background: on ? color : "rgba(255,255,255,0.1)" }}
    />
  );
  // Ult: if fully charged show solid gold, else show faded gold proportional to charge
  const ultCharge = a.ultCharge ?? (a.x ? 1 : 0);
  const ultColor = ultCharge >= 1
    ? COLORS.accentGold
    : `rgba(198,155,58,${0.15 + ultCharge * 0.6})`;
  return (
    <div className="flex items-center justify-center gap-[2px]">
      {dot(a.q, COLORS.textPrimary)}
      {dot(a.e, COLORS.textPrimary)}
      {dot(a.c, COLORS.textPrimary)}
      <div
        className="h-[7px] w-[7px] rounded-[1px]"
        style={{ background: ultColor }}
      />
    </div>
  );
}

// ── Kill Feed ──

function formatRoundTime(seconds: number): string {
  const mm = Math.floor(seconds / 60);
  const ss = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

function KillFeed({
  killFeed,
  plantTime,
  spikeDefused,
  winner,
  myTeamTag,
  oppTeamTag,
}: {
  killFeed: RoundKillFeedEntry[];
  plantTime: number | null | undefined;
  spikeDefused: boolean | undefined;
  winner: RoundWinner;
  myTeamTag: string;
  oppTeamTag: string;
}) {
  // Merge kills with plant + detonate/defuse markers, sorted by timing
  type Entry =
    | { kind: "kill"; data: RoundKillFeedEntry; t: number }
    | { kind: "plant"; team: "my" | "opp"; t: number }
    | { kind: "detonate"; t: number }
    | { kind: "defuse"; t: number };

  const entries: Entry[] = killFeed.map((k) => ({ kind: "kill" as const, data: k, t: k.timing }));

  // Infer plant team from round state — attackers side isn't directly exposed here,
  // so we guess: winner side planted if winner is attacker. For display we just pick
  // whichever team did the majority of kills in the first half as a heuristic. Simpler:
  // if plantTime exists, show the label without explicit team attribution.
  if (plantTime !== null && plantTime !== undefined) {
    entries.push({ kind: "plant", team: "my", t: plantTime });
    const detonationTime = plantTime + 45;
    const lastKillTime = killFeed.length > 0 ? killFeed[killFeed.length - 1].timing : plantTime;
    if (spikeDefused) {
      // Defuse ~7s after the last attacker kill (defender starts defusing then)
      entries.push({ kind: "defuse", t: Math.min(lastKillTime + 7, detonationTime - 1) });
    } else {
      // Detonation: if all defenders killed post-plant (team wipe), round ends at last
      // kill + short beat for the spike auto-detonating. Otherwise (attackers all dead),
      // spike fuses out naturally at detonationTime.
      const detTime = Math.min(lastKillTime + 3, detonationTime);
      entries.push({ kind: "detonate", t: detTime });
    }
  }

  entries.sort((a, b) => a.t - b.t);

  void winner; void myTeamTag; void oppTeamTag;

  if (entries.length === 0) {
    return (
      <div className="text-[11px]" style={{ color: COLORS.textMuted, padding: "8px 4px" }}>
        No events yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[3px]">
      {entries.map((e, i) => {
        if (e.kind === "kill") {
          const k = e.data;
          const killerColor = k.killerTeam === "my" ? COLORS.accentGreen : COLORS.accentRed;
          const victimColor = k.killerTeam === "my" ? COLORS.accentRed : COLORS.accentGreen;
          const weaponSrc = k.weapon ? weaponImageSrc(k.weapon) : null;
          return (
            <div
              key={`kill-${i}`}
              className="flex items-center gap-2 text-[11px] tabular-nums"
              style={{ padding: "2px 4px", fontWeight: 500 }}
            >
              <span style={{ color: COLORS.textMuted, width: 32 }}>{formatRoundTime(e.t)}</span>
              <span style={{ color: killerColor, minWidth: 0 }} className="truncate">{k.killerIgn}</span>
              {weaponSrc ? (
                <img src={weaponSrc} alt={k.weapon} className="h-[12px] w-auto" style={{ maxWidth: 40, objectFit: "contain" }} />
              ) : (
                <span style={{ color: COLORS.textMuted }}>×</span>
              )}
              <span style={{ color: victimColor, minWidth: 0 }} className="truncate">{k.victimIgn}</span>
              {k.isFirstKill && (
                <span
                  className="rounded px-1 text-[9px] font-medium uppercase tracking-wider"
                  style={{ background: "rgba(239,159,39,0.15)", color: COLORS.accentAmber }}
                >
                  FB
                </span>
              )}
              {k.assistIgns.length > 0 && (
                <span style={{ color: COLORS.textMuted, fontSize: 10 }}>
                  + {k.assistIgns.join(", ")}
                </span>
              )}
            </div>
          );
        }
        if (e.kind === "plant") {
          return (
            <div
              key={`plant-${i}`}
              className="flex items-center gap-2 text-[11px] tabular-nums"
              style={{
                padding: "3px 6px",
                background: "rgba(198,155,58,0.08)",
                borderLeft: `2px solid ${COLORS.accentGold}`,
                fontWeight: 500,
              }}
            >
              <span style={{ color: COLORS.textMuted, width: 32 }}>{formatRoundTime(e.t)}</span>
              <span style={{ color: COLORS.accentGold }}>▸ SPIKE PLANTED</span>
            </div>
          );
        }
        if (e.kind === "detonate") {
          return (
            <div
              key={`det-${i}`}
              className="flex items-center gap-2 text-[11px] tabular-nums"
              style={{
                padding: "3px 6px",
                background: "rgba(255,70,85,0.1)",
                borderLeft: `2px solid ${COLORS.accentRed}`,
                fontWeight: 500,
              }}
            >
              <span style={{ color: COLORS.textMuted, width: 32 }}>{formatRoundTime(e.t)}</span>
              <span style={{ color: COLORS.accentRed }}>▸ SPIKE DETONATED</span>
            </div>
          );
        }
        return (
          <div
            key={`def-${i}`}
            className="flex items-center gap-2 text-[11px] tabular-nums"
            style={{
              padding: "3px 6px",
              background: "rgba(76,175,125,0.1)",
              borderLeft: `2px solid ${COLORS.accentGreen}`,
              fontWeight: 500,
            }}
          >
            <span style={{ color: COLORS.textMuted, width: 32 }}>{formatRoundTime(e.t)}</span>
            <span style={{ color: COLORS.accentGreen }}>▸ SPIKE DEFUSED</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ──

export default function RoundByRoundScreen({
  mapName,
  mapImageUrl,
  stage,
  myTeam,
  oppTeam,
  rounds,
  getStatsAtRound,
  onMapEnd,
  myFirstHalfSide = "attack",
}: RoundByRoundScreenProps) {
  const [currentRound, setCurrentRound] = useState(0);
  const [isEnded, setIsEnded] = useState(false);
  const [speed, setSpeed] = useState<1 | 2 | 4>(1);
  const [isPaused, setIsPaused] = useState(false);

  const scores = useMemo(() => {
    let my = 0;
    let opp = 0;
    rounds.slice(0, currentRound).forEach((r) => {
      if (r.winner === "my") my++;
      else opp++;
    });
    return { my, opp };
  }, [currentRound, rounds]);

  const streak = useMemo(() => {
    let myStreak = 0;
    let oppStreak = 0;
    if (currentRound === 0) return { my: 0, opp: 0 };
    const lastWinner = rounds[currentRound - 1].winner;
    for (let i = currentRound - 1; i >= 0; i--) {
      if (rounds[i].winner !== lastWinner) break;
      if (lastWinner === "my") myStreak++;
      else oppStreak++;
    }
    return { my: myStreak, opp: oppStreak };
  }, [currentRound, rounds]);

  const currentRoundData = currentRound > 0 ? rounds[currentRound - 1] : null;

  const half =
    currentRound <= 12 ? "1st half" : currentRound <= 24 ? "2nd half" : "Overtime";
  // Side label honors the user's 1st-half choice and flips in 2nd half. OT uses 1st half side.
  const isSecondHalf = currentRound > 12 && currentRound <= 24;
  const currentSide =
    isSecondHalf
      ? (myFirstHalfSide === "attack" ? "defense" : "attack")
      : myFirstHalfSide;
  const side = currentSide === "attack" ? "Attack" : "Defense";

  const currentStats = useMemo(
    () => getStatsAtRound(Math.max(0, currentRound)),
    [currentRound, getStatsAtRound]
  );

  const mvpIgn = useMemo(() => {
    if (currentStats.my.length === 0) return "";
    return currentStats.my.reduce((best, p) => (p.acs > best.acs ? p : best), currentStats.my[0]).ign;
  }, [currentStats]);

  function handleNext() {
    if (isEnded) return;
    if (currentRound >= rounds.length) {
      setIsEnded(true);
      onMapEnd(scores.my > scores.opp ? "win" : "loss", scores);
      return;
    }
    setCurrentRound((prev) => prev + 1);
  }

  function handleSkipToEnd() {
    if (isEnded) return;
    setCurrentRound(rounds.length);
    setIsEnded(true);
    const finalScores = rounds.reduce(
      (acc, r) => {
        if (r.winner === "my") acc.my++;
        else acc.opp++;
        return acc;
      },
      { my: 0, opp: 0 }
    );
    onMapEnd(finalScores.my > finalScores.opp ? "win" : "loss", finalScores);
  }

  // Refs to access latest callbacks without causing the auto-advance effect to reset
  const onMapEndRef = useRef(onMapEnd);
  useEffect(() => { onMapEndRef.current = onMapEnd; }, [onMapEnd]);
  const scoresRef = useRef(scores);
  useEffect(() => { scoresRef.current = scores; }, [scores]);

  // ── Auto-advance through rounds ──
  useEffect(() => {
    if (isEnded || isPaused) return;
    const intervalMs = 2800 / speed;
    if (currentRound >= rounds.length) {
      // Pause briefly on last round then end
      const endT = setTimeout(() => {
        setIsEnded(true);
        const s = scoresRef.current;
        onMapEndRef.current(s.my > s.opp ? "win" : "loss", s);
      }, 900);
      return () => clearTimeout(endT);
    }
    const t = setTimeout(() => setCurrentRound((prev) => prev + 1), intervalMs);
    return () => clearTimeout(t);
    // deps: only the bits that actually change the cadence
  }, [currentRound, isEnded, isPaused, speed, rounds.length]);

  // Pips row
  const totalPips = Math.max(26, rounds.length);

  // Momentum
  const myStreakFlex = streak.my;
  const oppStreakFlex = streak.opp;
  const neutralFlex = Math.max(1, 8 - myStreakFlex - oppStreakFlex);

  const isWinning = scores.my > scores.opp;

  return (
    <div
      className="relative h-screen w-full overflow-hidden"
      style={{ background: COLORS.bgPrimary, fontFamily: "Inter, system-ui, sans-serif" }}
    >
      {/* Map background — very visible */}
      {mapImageUrl && (
        <>
          <div
            className="absolute inset-0 z-0"
            style={{
              backgroundImage: `url(${mapImageUrl})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              filter: "brightness(0.55) saturate(0.9)",
            }}
          />
          <div
            className="absolute inset-0 z-[1]"
            style={{ background: "linear-gradient(to bottom, rgba(10,10,15,0.35) 0%, rgba(10,10,15,0.55) 70%, rgba(10,10,15,0.95) 100%)" }}
          />
        </>
      )}

      <div className="relative z-[2] flex h-screen flex-col overflow-hidden">
        {/* ── 1. TOP BAR — big score hero with teams, map and round info ── */}
        <div
          className="relative flex shrink-0 items-center justify-between gap-8 px-12 pt-6 pb-5"
        >
          {/* T1 */}
          <div className="flex flex-1 items-center justify-end gap-4">
            <div className="flex flex-col items-end">
              <span
                className="text-[12px] font-medium uppercase tracking-[0.25em]"
                style={{ color: "rgba(236,232,225,0.55)", textShadow: "0 1px 4px rgba(0,0,0,0.9)" }}
              >
                {myTeam.name.split(" ")[0]}
              </span>
              <span
                className="text-[22px] font-medium uppercase tracking-[0.05em]"
                style={{ color: COLORS.textPrimary, textShadow: "0 2px 8px rgba(0,0,0,0.9)" }}
              >
                {myTeam.name}
              </span>
            </div>
            {myTeam.logo ? (
              <img src={myTeam.logo} alt={myTeam.name} className="h-14 w-14 shrink-0 object-contain" />
            ) : (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center">
                <span className="text-[16px] font-medium" style={{ color: COLORS.textPrimary }}>
                  {myTeam.name.slice(0, 2).toUpperCase()}
                </span>
              </div>
            )}
            <span
              className="ml-1 text-[56px] font-medium leading-none tabular-nums"
              style={{
                color: isWinning ? COLORS.accentGreen : COLORS.textPrimary,
                textShadow: "0 4px 16px rgba(0,0,0,0.95)",
              }}
            >
              {scores.my}
            </span>
          </div>

          {/* Center: map · round · side/half */}
          <div className="flex flex-col items-center gap-1.5">
            <div
              className="text-[11px] font-medium uppercase tracking-[0.4em]"
              style={{ color: "rgba(236,232,225,0.35)", textShadow: "0 1px 4px rgba(0,0,0,0.9)" }}
            >
              {stage}
            </div>
            <div
              className="text-[34px] font-medium uppercase leading-none tracking-[0.12em]"
              style={{ color: COLORS.textPrimary, textShadow: "0 3px 12px rgba(0,0,0,0.95)" }}
            >
              {mapName}
            </div>
            <div className="mt-1 flex items-center gap-2 rounded px-3 py-1" style={{ background: "rgba(10,10,15,0.55)", border: "1px solid rgba(255,255,255,0.08)" }}>
              <span className="text-[12px] font-medium tabular-nums" style={{ color: COLORS.textPrimary }}>
                ROUND {Math.max(1, currentRound)}
              </span>
              <span className="text-[10px]" style={{ color: "rgba(236,232,225,0.3)" }}>·</span>
              <span
                className="text-[11px] font-medium uppercase tracking-[0.15em]"
                style={{ color: side === "Attack" ? COLORS.accentRed : COLORS.accentGreen }}
              >
                {side}
              </span>
              <span className="text-[10px]" style={{ color: "rgba(236,232,225,0.3)" }}>·</span>
              <span
                className="text-[10px] uppercase tracking-[0.12em]"
                style={{ color: "rgba(236,232,225,0.45)" }}
              >
                {half}
              </span>
            </div>
          </div>

          {/* T2 — mirrored */}
          <div className="flex flex-1 items-center gap-4">
            <span
              className="mr-1 text-[56px] font-medium leading-none tabular-nums"
              style={{
                color: !isWinning && scores.opp > scores.my ? COLORS.accentGreen : COLORS.textPrimary,
                textShadow: "0 4px 16px rgba(0,0,0,0.95)",
              }}
            >
              {scores.opp}
            </span>
            {oppTeam.logo ? (
              <img src={oppTeam.logo} alt={oppTeam.name} className="h-14 w-14 shrink-0 object-contain" />
            ) : (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center">
                <span className="text-[16px] font-medium" style={{ color: COLORS.textPrimary }}>
                  {oppTeam.name.slice(0, 2).toUpperCase()}
                </span>
              </div>
            )}
            <div className="flex flex-col items-start">
              <span
                className="text-[12px] font-medium uppercase tracking-[0.25em]"
                style={{ color: "rgba(236,232,225,0.55)", textShadow: "0 1px 4px rgba(0,0,0,0.9)" }}
              >
                {oppTeam.name.split(" ")[0]}
              </span>
              <span
                className="text-[22px] font-medium uppercase tracking-[0.05em]"
                style={{ color: COLORS.textPrimary, textShadow: "0 2px 8px rgba(0,0,0,0.9)" }}
              >
                {oppTeam.name}
              </span>
            </div>
          </div>
        </div>

        {/* ── 2. MOMENTUM BAR ── */}
        <div className="flex h-[3px] w-full shrink-0 overflow-hidden">
          <motion.div
            animate={{ flex: myStreakFlex }}
            transition={{ duration: 0.4, ease: "easeInOut" }}
            style={{ background: COLORS.accentGreen, flex: myStreakFlex }}
          />
          <motion.div
            animate={{ flex: neutralFlex }}
            transition={{ duration: 0.4, ease: "easeInOut" }}
            style={{ background: "rgba(255,255,255,0.05)", flex: neutralFlex }}
          />
          <motion.div
            animate={{ flex: oppStreakFlex }}
            transition={{ duration: 0.4, ease: "easeInOut" }}
            style={{ background: COLORS.accentRed, flex: oppStreakFlex }}
          />
        </div>

        {/* ── 3+4+5. CENTER GRID — play-by-play | pips+round result | round history ── */}
        <div className="relative grid min-h-0 flex-1 grid-cols-[300px_1fr_300px] gap-5 px-10 pb-4 pt-3">

          {/* LEFT: Play-by-play kill feed for this round */}
          <div className="flex min-h-0 flex-col gap-2">
            <div className="shrink-0 text-[10px] font-medium uppercase tracking-[0.25em]" style={{ color: "rgba(236,232,225,0.35)", textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}>
              Play by play — Round {Math.max(1, currentRound)}
            </div>
            <div
              className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md"
              style={{
                background: "rgba(15,15,20,0.65)",
                border: "1px solid rgba(255,255,255,0.08)",
                backdropFilter: "blur(8px)",
              }}
            >
              <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                {currentRoundData && currentRoundData.killFeed && currentRoundData.killFeed.length > 0 ? (
                  <KillFeed
                    killFeed={currentRoundData.killFeed}
                    plantTime={currentRoundData.plantTime}
                    spikeDefused={currentRoundData.spikeDefused}
                    winner={currentRoundData.winner}
                    myTeamTag={myTeam.name}
                    oppTeamTag={oppTeam.name}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-[11px]" style={{ color: COLORS.textMuted }}>
                    Waiting for round…
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* CENTER: PIP row + Big round result + event highlight */}
          <div className="flex flex-col items-center gap-5">
            {/* PIP row — at top of center column */}
            <div className="flex shrink-0 items-center justify-center gap-2 pt-1">
              <div className="flex flex-wrap justify-center gap-[4px]" style={{ maxWidth: 440 }}>
                {Array.from({ length: totalPips }).map((_, i) => {
                  const roundIdx = i;
                  let bg: string;
                  let outline: string | undefined;
                  if (roundIdx < currentRound) {
                    const r = rounds[roundIdx];
                    bg = r?.winner === "my" ? COLORS.accentGreen : COLORS.accentRed;
                  } else if (roundIdx === currentRound) {
                    bg = COLORS.textPrimary;
                    outline = "1px solid rgba(255,255,255,0.4)";
                  } else {
                    bg = "rgba(255,255,255,0.12)";
                  }
                  return (
                    <motion.div
                      key={i}
                      initial={roundIdx === currentRound - 1 ? { scale: 0 } : false}
                      animate={{ scale: 1 }}
                      transition={{ duration: 0.2 }}
                      className="h-[10px] w-[10px] rounded-[2px]"
                      style={{ background: bg, outline, boxShadow: "0 1px 3px rgba(0,0,0,0.5)" }}
                    />
                  );
                })}
              </div>
              <span
                className="ml-3 text-[11px] tabular-nums"
                style={{ color: "rgba(236,232,225,0.4)", textShadow: "0 1px 3px rgba(0,0,0,0.8)" }}
              >
                R{Math.max(1, currentRound)}
              </span>
            </div>

            {/* Flex spacer to center round result vertically */}
            <div className="flex flex-1 flex-col items-center justify-center gap-5">
            <AnimatePresence mode="wait">
              {currentRoundData ? (
                <motion.div
                  key={`result-${currentRound}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="flex flex-col items-center gap-3"
                >
                  <span
                    className="text-[10px] font-medium uppercase tracking-[0.4em]"
                    style={{ color: "rgba(236,232,225,0.35)", textShadow: "0 1px 4px rgba(0,0,0,0.9)" }}
                  >
                    Round won
                  </span>
                  {(() => {
                    const winner = currentRoundData.winner === "my" ? myTeam : oppTeam;
                    const accent = currentRoundData.winner === "my" ? COLORS.accentGreen : COLORS.accentRed;
                    return winner.logo ? (
                      <img
                        src={winner.logo}
                        alt={winner.name}
                        className="h-20 w-20 object-contain"
                        style={{
                          filter: `drop-shadow(0 0 24px ${accent}88)`,
                        }}
                      />
                    ) : (
                      <span
                        className="text-[40px] font-medium"
                        style={{
                          color: accent,
                          textShadow: `0 0 24px ${accent}88`,
                        }}
                      >
                        {winner.name.slice(0, 3).toUpperCase()}
                      </span>
                    );
                  })()}
                </motion.div>
              ) : (
                <motion.div
                  key="waiting"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-[14px] uppercase tracking-[0.3em]"
                  style={{ color: "rgba(236,232,225,0.3)", textShadow: "0 1px 4px rgba(0,0,0,0.8)" }}
                >
                  Starting map…
                </motion.div>
              )}
            </AnimatePresence>

            {/* Event highlight */}
            <AnimatePresence mode="wait">
              {currentRoundData?.event && (
                <motion.div
                  key={`event-${currentRound}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="flex items-center gap-3 rounded-lg px-4 py-2.5"
                  style={{
                    background: "rgba(15,15,20,0.7)",
                    border: `1px solid ${EVENT_STYLES[currentRoundData.event.type].border}`,
                    backdropFilter: "blur(8px)",
                  }}
                >
                  <span className="text-[18px]" style={{ color: EVENT_STYLES[currentRoundData.event.type].color }}>★</span>
                  <span
                    className="text-[14px] font-medium"
                    style={{ color: EVENT_STYLES[currentRoundData.event.type].color }}
                  >
                    {currentRoundData.event.description}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
            </div>
          </div>

          {/* RIGHT: Round history */}
          <div
            className="flex min-h-0 flex-col overflow-hidden rounded-md"
            style={{
              background: "rgba(15,15,20,0.65)",
              backdropFilter: "blur(8px)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            <div
              className="shrink-0 px-3 pb-1.5 pt-2.5 text-[10px] font-medium uppercase tracking-[0.25em]"
              style={{ color: "rgba(236,232,225,0.45)" }}
            >
              Round history
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {Array.from({ length: currentRound })
                .map((_, i) => currentRound - 1 - i)
                .map((idx) => {
                  const r = rounds[idx];
                  if (!r) return null;
                  const isCurrent = idx === currentRound - 1;
                  const runningScore = rounds
                    .slice(0, idx + 1)
                    .reduce(
                      (acc, x) => {
                        if (x.winner === "my") acc.my++;
                        else acc.opp++;
                        return acc;
                      },
                      { my: 0, opp: 0 }
                    );
                  return (
                    <div
                      key={idx}
                      className="flex items-center gap-1.5 px-[10px] py-[5px] text-[11px]"
                      style={{
                        borderBottom: `1px solid ${COLORS.borderFaint}`,
                        background: isCurrent ? "rgba(255,255,255,0.04)" : "transparent",
                      }}
                    >
                      <span
                        className="text-[10px] tabular-nums"
                        style={{ color: COLORS.textMuted, minWidth: 22 }}
                      >
                        R{r.roundNumber}
                      </span>
                      <div
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{
                          background: r.winner === "my" ? COLORS.accentGreen : COLORS.accentRed,
                        }}
                      />
                      <span
                        className="flex-1 truncate text-[10px]"
                        style={{ color: COLORS.textMuted }}
                      >
                        {r.event?.description ?? `${r.winner === "my" ? myTeam.name : oppTeam.name} win`}
                      </span>
                      <span
                        className="text-[11px] font-medium tabular-nums"
                        style={{ color: COLORS.textPrimary }}
                      >
                        {runningScore.my}-{runningScore.opp}
                      </span>
                    </div>
                  );
                })}
              {currentRound === 0 && (
                <div
                  className="px-[10px] py-4 text-center text-[10px]"
                  style={{ color: COLORS.textMuted }}
                >
                  Press Next round to start
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── 6. SCOREBOARD SECTION — unified header + mirrored tables ── */}
        <div className="shrink-0" style={{ background: COLORS.bgPrimary }}>
          {/* Unified team header: T1 name | T2 name */}
          <div
            className="grid items-center"
            style={{
              gridTemplateColumns: "1fr 1fr",
              background: "rgba(255,255,255,0.02)",
              borderTop: `1px solid ${COLORS.border}`,
              borderBottom: `1px solid ${COLORS.borderFaint}`,
            }}
          >
            {/* Team 1 — left side, aligned left */}
            <div className="flex items-center gap-2.5 px-4 py-3">
              {myTeam.logo && (
                <img src={myTeam.logo} alt={myTeam.name} className="h-6 w-6 shrink-0 object-contain" />
              )}
              <span
                className="text-[13px] font-medium uppercase tracking-[0.05em]"
                style={{ color: COLORS.textPrimary }}
              >
                {myTeam.name}
              </span>
            </div>

            {/* Team 2 — right side, aligned right */}
            <div className="flex items-center justify-end gap-2.5 px-4 py-3" style={{ borderLeft: `1px solid ${COLORS.border}` }}>
              <span
                className="text-[13px] font-medium uppercase tracking-[0.05em]"
                style={{ color: COLORS.textPrimary }}
              >
                {oppTeam.name}
              </span>
              {oppTeam.logo && (
                <img src={oppTeam.logo} alt={oppTeam.name} className="h-6 w-6 shrink-0 object-contain" />
              )}
            </div>
          </div>

          {/* Mirrored tables */}
          <div className="grid grid-cols-2">
            <div style={{ borderRight: `1px solid ${COLORS.border}` }}>
              <ScoreboardTable
                players={myTeam.players}
                stats={currentStats.my}
                mvpIgn={mvpIgn}
                currentRound={currentRound}
              />
            </div>
            <div>
              <ScoreboardTable
                players={oppTeam.players}
                stats={currentStats.opp}
                mvpIgn={undefined}
                currentRound={currentRound}
                mirror
              />
            </div>
          </div>
        </div>

        {/* ── 7. BOTTOM BAR ── */}
        <div
          className="flex shrink-0 items-center gap-[10px] px-6 py-3"
          style={{
            background: "rgba(10,10,15,0.9)",
            borderTop: `1px solid ${COLORS.borderFaint}`,
          }}
        >
          {/* Pause / Resume */}
          <button
            onClick={() => setIsPaused((p) => !p)}
            disabled={isEnded}
            className="rounded-md px-4 py-[9px] text-[12px] font-medium transition-colors"
            style={{
              background: isPaused ? "rgba(76,175,125,0.12)" : "rgba(255,255,255,0.04)",
              border: `0.5px solid ${isPaused ? "rgba(76,175,125,0.3)" : "rgba(255,255,255,0.12)"}`,
              color: isPaused ? COLORS.accentGreen : COLORS.textPrimary,
              cursor: isEnded ? "not-allowed" : "pointer",
              opacity: isEnded ? 0.5 : 1,
              minWidth: 90,
            }}
          >
            {isPaused ? "▶ Resume" : "⏸ Pause"}
          </button>

          {/* Speed selector */}
          <div className="flex items-center gap-1">
            {([1, 2, 4] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSpeed(s)}
                disabled={isEnded}
                className="rounded-md px-3 py-[9px] text-[12px] font-medium transition-colors"
                style={{
                  background: speed === s ? "rgba(255,70,85,0.15)" : "transparent",
                  border: `0.5px solid ${speed === s ? "rgba(255,70,85,0.3)" : "rgba(255,255,255,0.08)"}`,
                  color: speed === s ? COLORS.accentRed : COLORS.textMuted,
                  cursor: isEnded ? "not-allowed" : "pointer",
                  minWidth: 44,
                }}
              >
                {s}x
              </button>
            ))}
          </div>

          <div className="flex-1" />

          {/* Skip to end */}
          <button
            onClick={handleSkipToEnd}
            disabled={isEnded}
            className="rounded-md px-4 py-[9px] text-[12px] transition-colors"
            style={{
              background: "transparent",
              border: `0.5px solid rgba(255,255,255,0.12)`,
              color: COLORS.textMuted,
              cursor: isEnded ? "not-allowed" : "pointer",
              opacity: isEnded ? 0.5 : 1,
            }}
          >
            Skip to end
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Scoreboard table (mirrored for opponent side) ──

function ScoreboardTable({
  players,
  stats,
  mvpIgn,
  currentRound,
  mirror = false,
}: {
  players: Player[];
  stats: PlayerStats[];
  mvpIgn: string | undefined;
  currentRound: number;
  mirror?: boolean;
}) {
  // Columns: agent | gap | IGN | K D A | ACS ADR KAST HS FK | Shield Weapon Creds Abils
  const leftCols = "28px minmax(0,1fr) 34px 34px 34px 48px 44px 46px 40px 34px 26px 62px 56px 56px";
  // Mirror = same columns reversed
  const rightCols = "56px 56px 62px 26px 34px 40px 46px 44px 48px 34px 34px 34px minmax(0,1fr) 28px";

  const gridCols = mirror ? rightCols : leftCols;

  const muted = { color: COLORS.textMuted } as const;
  const cellCls = "text-center text-[11px]";
  const headerCells = [
    <div key="player" className={`text-[11px] ${mirror ? "text-right" : "text-left"}`} style={muted}>Player</div>,
    <div key="k" className={cellCls} style={muted}>K</div>,
    <div key="d" className={cellCls} style={muted}>D</div>,
    <div key="a" className={cellCls} style={muted}>A</div>,
    <div key="acs" className={cellCls} style={muted}>ACS</div>,
    <div key="adr" className={cellCls} style={muted}>ADR</div>,
    <div key="kast" className={cellCls} style={muted}>KAST</div>,
    <div key="hs" className={cellCls} style={muted}>HS%</div>,
    <div key="fk" className={cellCls} style={muted}>FK</div>,
    <div key="shield" className={cellCls} style={muted}>Shld</div>,
    <div key="weapon" className={cellCls} style={muted}>Weapon</div>,
    <div key="creds" className={cellCls} style={muted}>Creds</div>,
    <div key="abil" className={cellCls} style={muted}>Abils</div>,
  ];

  return (
    <div>
      {/* Column headers */}
      <div
        className="grid items-center px-4 py-1.5"
        style={{
          gridTemplateColumns: gridCols,
          borderBottom: `1px solid ${COLORS.borderFaint}`,
        }}
      >
        {mirror ? (
          <>
            <div key="sp-abil" className={cellCls} style={muted}>Abils</div>
            <div key="sp-creds" className={cellCls} style={muted}>Creds</div>
            <div key="sp-weapon" className={cellCls} style={muted}>Weapon</div>
            <div key="sp-shield" className={cellCls} style={muted}>Shld</div>
            <div key="sp-fk" className={cellCls} style={muted}>FK</div>
            <div key="sp-hs" className={cellCls} style={muted}>HS%</div>
            <div key="sp-kast" className={cellCls} style={muted}>KAST</div>
            <div key="sp-adr" className={cellCls} style={muted}>ADR</div>
            <div key="sp-acs" className={cellCls} style={muted}>ACS</div>
            <div key="sp-a" className={cellCls} style={muted}>A</div>
            <div key="sp-d" className={cellCls} style={muted}>D</div>
            <div key="sp-k" className={cellCls} style={muted}>K</div>
            <div key="sp-p" className="text-right text-[11px]" style={muted}>Player</div>
            <div />
          </>
        ) : (
          <>
            <div />
            {headerCells}
          </>
        )}
      </div>

      {/* Player rows */}
      {players.map((player, i) => {
        const s = stats.find((x) => x.ign === player.ign) ?? {
          ign: player.ign,
          k: 0, d: 0, a: 0, acs: 0, adr: 0, kast: 0, hs: 0, fk: 0,
        };
        const isMvp = mvpIgn === player.ign;
        const kColor = s.k > s.d ? COLORS.accentGreen : s.k < s.d ? COLORS.accentRed : undefined;
        const adrColor = s.adr > 130 ? COLORS.accentGreen : undefined;
        const kastColor = s.kast >= 80 ? COLORS.accentGreen : s.kast < 65 ? COLORS.accentRed : undefined;
        const fkColor = s.fk >= 3 ? COLORS.accentGreen : COLORS.textMuted;
        const flashKey = `${currentRound}-${s.k}-${s.d}-${s.acs}`;

        // ── Loadout cells ──
        const loadoutShield = <ShieldCell armor={s.armor} />;
        const loadoutWeapon = <WeaponCell weapon={s.weapon} fromPickup={s.fromPickup} />;
        const loadoutCreds = <CredsCell credits={s.credits} />;
        const loadoutAbilities = <AbilitiesCell abilities={s.abilities} />;

        const agentBox = player.agentPortraitUrl ? (
          <div
            className="h-7 w-7 shrink-0 overflow-hidden rounded-[3px]"
            style={{ background: "rgba(255,255,255,0.04)" }}
          >
            <img src={player.agentPortraitUrl} alt={player.agent} className="h-full w-full object-cover" />
          </div>
        ) : (
          <div
            className="flex h-7 w-7 items-center justify-center rounded-[3px]"
            style={{ background: player.agentColor }}
          >
            <span className="text-[10px] font-medium text-white">{player.agent.slice(0, 2).toUpperCase()}</span>
          </div>
        );

        const ignBlock = (
          <div className={`flex min-w-0 flex-col ${mirror ? "items-end pr-3" : "pl-3"}`}>
            <div className="flex items-center gap-1.5">
              {mirror && isMvp && (
                <div className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: COLORS.accentGold }} />
              )}
              <span className="truncate text-[14px] font-medium" style={{ color: COLORS.textPrimary }}>
                {player.ign}
              </span>
              {!mirror && isMvp && (
                <div className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: COLORS.accentGold }} />
              )}
            </div>
            <div className="text-[11px]" style={{ color: COLORS.textMuted }}>
              {player.agent}
            </div>
          </div>
        );

        const statCells = (
          <>
            <StatCell value={s.k} color={kColor} bold flashKey={flashKey} />
            <StatCell value={s.d} flashKey={flashKey} />
            <StatCell value={s.a} flashKey={flashKey} />
            <StatCell value={s.acs} color={COLORS.accentGold} bold flashKey={flashKey} />
            <StatCell value={s.adr} color={adrColor} flashKey={flashKey} />
            <StatCell value={`${s.kast}%`} color={kastColor} flashKey={flashKey} />
            <StatCell value={`${s.hs}%`} flashKey={flashKey} />
            <StatCell value={s.fk} color={fkColor} flashKey={flashKey} />
            {loadoutShield}
            {loadoutWeapon}
            {loadoutCreds}
            {loadoutAbilities}
          </>
        );

        const reversedStatCells = (
          <>
            {loadoutAbilities}
            {loadoutCreds}
            {loadoutWeapon}
            {loadoutShield}
            <StatCell value={s.fk} color={fkColor} flashKey={flashKey} />
            <StatCell value={`${s.hs}%`} flashKey={flashKey} />
            <StatCell value={`${s.kast}%`} color={kastColor} flashKey={flashKey} />
            <StatCell value={s.adr} color={adrColor} flashKey={flashKey} />
            <StatCell value={s.acs} color={COLORS.accentGold} bold flashKey={flashKey} />
            <StatCell value={s.a} flashKey={flashKey} />
            <StatCell value={s.d} flashKey={flashKey} />
            <StatCell value={s.k} color={kColor} bold flashKey={flashKey} />
          </>
        );

        return (
          <div
            key={player.ign + i}
            className="grid items-center px-4 py-2 transition-colors"
            style={{
              gridTemplateColumns: gridCols,
              borderBottom: `1px solid ${COLORS.borderFaint}`,
              background: isMvp ? "rgba(198,155,58,0.04)" : "transparent",
            }}
            onMouseEnter={(e) => {
              if (!isMvp) e.currentTarget.style.background = "rgba(255,255,255,0.02)";
            }}
            onMouseLeave={(e) => {
              if (!isMvp) e.currentTarget.style.background = "transparent";
            }}
          >
            {mirror ? (
              <>
                {reversedStatCells}
                {ignBlock}
                {agentBox}
              </>
            ) : (
              <>
                {agentBox}
                {ignBlock}
                {statCells}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
