"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";

import { trpc } from "@/lib/trpc-client";
import { getMapImage } from "@/constants/maps";
import { VALORANT_AGENTS } from "@/constants/agents";
import type { ValorantAgent } from "@/constants/agents";
import { formatStat } from "@/lib/format";

// ── Types ──

type TeamSide = "team1" | "team2";
type Side = "attack" | "defense";

interface VetoStep {
  type: "ban" | "pick";
  team: TeamSide;
}

interface VetoAction {
  type: "ban" | "pick";
  map: string;
  team: TeamSide;
}

interface MapEntry {
  mapName: string;
  pickedBy: TeamSide | "decider";
  sidePickedBy: TeamSide | "random";
  playerSide: Side;
}

interface PlayerAgentPick {
  playerId: string;
  agentName: string;
}

interface PlayerStat {
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

interface MapResultData {
  map: string;
  score1: number;
  score2: number;
  playerStats: PlayerStat[];
  highlights: { type: string; round: number; playerIgn?: string; text: string }[];
}

interface StoredMapResult {
  map: string;
  score1: number;
  score2: number;
}

// ── Phase state machine ──

type Phase =
  | "VETO"
  | "SIDE_SELECT"
  | "AGENTS"
  | "SIMULATING"
  | "RESULT"
  | "FINAL";

// ── Veto sequences ──

const BO3_VETO: VetoStep[] = [
  { type: "ban", team: "team1" },
  { type: "ban", team: "team2" },
  { type: "pick", team: "team1" },
  { type: "pick", team: "team2" },
  { type: "ban", team: "team1" },
  { type: "ban", team: "team2" },
];

const BO5_VETO: VetoStep[] = [
  { type: "ban", team: "team1" },
  { type: "ban", team: "team2" },
  { type: "pick", team: "team1" },
  { type: "pick", team: "team2" },
  { type: "pick", team: "team1" },
  { type: "pick", team: "team2" },
];

// ── Agent roles for grouped grid ──
const AGENT_ROLES: ValorantAgent["role"][] = [
  "Duelist",
  "Initiator",
  "Sentinel",
  "Controller",
];

const ROLE_COLORS: Record<ValorantAgent["role"], string> = {
  Duelist: "#FF4655",
  Initiator: "#7BBFA5",
  Sentinel: "#F0C75E",
  Controller: "#9B59B6",
};

// ── Colors ──
const C = {
  bg: "#0a0a0f",
  surface: "#16161E",
  red: "#FF4655",
  white: "#ECE8E1",
  gold: "#C69B3A",
  green: "#4AE68A",
  gray: "#383844",
} as const;

// ── CSS keyframes injected via style tag ──
function GlobalStyles() {
  return (
    <style>{`
      @keyframes vct-pulse-red {
        0%, 100% { box-shadow: 0 0 0 0 rgba(255,70,85,0.4); }
        50% { box-shadow: 0 0 20px 4px rgba(255,70,85,0.25); }
      }
      @keyframes vct-pulse-gold {
        0%, 100% { box-shadow: 0 0 0 0 rgba(198,155,58,0.4); }
        50% { box-shadow: 0 0 24px 6px rgba(198,155,58,0.3); }
      }
      @keyframes vct-pulse-green {
        0%, 100% { box-shadow: 0 0 0 0 rgba(74,230,138,0.3); }
        50% { box-shadow: 0 0 16px 4px rgba(74,230,138,0.2); }
      }
      @keyframes vct-slide-up {
        from { opacity: 0; transform: translateY(30px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes vct-fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes vct-scale-in {
        from { opacity: 0; transform: scale(0.9); }
        to { opacity: 1; transform: scale(1); }
      }
      @keyframes vct-zoom-slow {
        0% { transform: scale(1); }
        100% { transform: scale(1.08); }
      }
      @keyframes vct-banned-slash {
        from { width: 0; }
        to { width: 141%; }
      }
      @keyframes vct-confetti {
        0% { transform: translateY(0) rotate(0deg); opacity: 1; }
        100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
      }
      @keyframes vct-dot-bounce {
        0%, 80%, 100% { transform: scale(0); }
        40% { transform: scale(1); }
      }
      @keyframes vct-glow-sweep {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(100%); }
      }
      @keyframes vct-locked-flash {
        0% { opacity: 1; transform: scale(1); }
        50% { opacity: 1; transform: scale(1.1); }
        100% { opacity: 0; transform: scale(1.3); }
      }
      .vct-animate-slide-up { animation: vct-slide-up 0.6s cubic-bezier(0.22,1,0.36,1) both; }
      .vct-animate-fade { animation: vct-fade-in 0.5s ease both; }
      .vct-animate-scale { animation: vct-scale-in 0.5s cubic-bezier(0.22,1,0.36,1) both; }
      .vct-animate-zoom { animation: vct-zoom-slow 20s ease-in-out infinite alternate; }
      .vct-pulse-red { animation: vct-pulse-red 2s ease-in-out infinite; }
      .vct-pulse-gold { animation: vct-pulse-gold 2s ease-in-out infinite; }
      .vct-pulse-green { animation: vct-pulse-green 2s ease-in-out infinite; }
    `}</style>
  );
}

// ── Component ──

export default function MatchDayPage() {
  const params = useParams<{ matchId: string }>();
  const router = useRouter();
  const matchId = params.matchId;

  // ── Data fetching ──
  const { data: vetoState, isLoading } = trpc.veto.getVetoState.useQuery(
    { matchId },
    { enabled: !!matchId }
  );
  const { data: roster } = trpc.player.rosterAll.useQuery(undefined, {
    retry: false,
  });

  const simulateMapMut = trpc.match.simulateMap.useMutation();
  const finalizeMatchMut = trpc.match.finalizeMatch.useMutation();
  const executeVetoMut = trpc.veto.executeVeto.useMutation();

  // ── Core state ──
  const [phase, setPhase] = useState<Phase>("VETO");
  const [vetoActions, setVetoActions] = useState<VetoAction[]>([]);
  const [vetoStep, setVetoStep] = useState(0);
  const [aiThinking, setAiThinking] = useState(false);
  const aiThinkingRef = useRef(false);
  const [mapLineup, setMapLineup] = useState<MapEntry[]>([]);
  const [pendingSideForMap, setPendingSideForMap] = useState<{
    mapName: string;
    pickedBy: TeamSide;
    index: number;
  } | null>(null);
  const [currentMapIndex, setCurrentMapIndex] = useState(0);
  const [agentPicks, setAgentPicks] = useState<Record<string, string>>({});
  const [expandedPlayerId, setExpandedPlayerId] = useState<string | null>(null);
  const [enemyAgents, setEnemyAgents] = useState<Record<number, string[]>>({});
  const [enemyRevealed, setEnemyRevealed] = useState(false);
  const [enemyRevealIndex, setEnemyRevealIndex] = useState(-1);
  const [mapResults, setMapResults] = useState<MapResultData[]>([]);
  const [seriesScore, setSeriesScore] = useState({ team1: 0, team2: 0 });
  const [lockedIn, setLockedIn] = useState(false);
  const [phaseTransition, setPhaseTransition] = useState(false);

  // ── Derived data ──
  const format = vetoState && !vetoState.done ? vetoState.format : "BO3";
  const vetoSequence = format === "BO5" ? BO5_VETO : BO3_VETO;
  const isTeam1 = vetoState && !vetoState.done ? vetoState.isTeam1 : true;
  const playerSide: TeamSide = isTeam1 ? "team1" : "team2";
  const aiSide: TeamSide = isTeam1 ? "team2" : "team1";
  const mapPool = vetoState && !vetoState.done ? vetoState.mapPool : [];

  const match = vetoState?.match;
  const team1Name = match?.team1?.name ?? "Team 1";
  const team2Name = match?.team2?.name ?? "Team 2";
  const team1Tag = match?.team1?.tag ?? "T1";
  const team2Tag = match?.team2?.tag ?? "T2";
  const team1Logo = match?.team1?.logoUrl ?? "";
  const team2Logo = match?.team2?.logoUrl ?? "";
  const team1Id = match?.team1Id ?? "";
  const team2Id = match?.team2Id ?? "";

  const winsNeeded = format === "BO5" ? 3 : 2;

  const bannedMaps = vetoActions
    .filter((a) => a.type === "ban")
    .map((a) => a.map);
  const pickedMaps = vetoActions
    .filter((a) => a.type === "pick")
    .map((a) => a.map);
  const availableMaps = mapPool.filter(
    (m) => !bannedMaps.includes(m) && !pickedMaps.includes(m)
  );

  const currentStepInfo =
    vetoStep < vetoSequence.length ? vetoSequence[vetoStep] : null;
  const isPlayerVetoTurn = currentStepInfo?.team === playerSide;

  const activePlayers = (roster ?? []).filter((p) => p.isActive).slice(0, 5);
  const currentMap = mapLineup[currentMapIndex] as MapEntry | undefined;
  const pickedAgentNames = Object.values(agentPicks);

  const playerTeamName = isTeam1 ? team1Name : team2Name;
  const playerTeamTag = isTeam1 ? team1Tag : team2Tag;
  const playerTeamLogo = isTeam1 ? team1Logo : team2Logo;
  const enemyTeamName = isTeam1 ? team2Name : team1Name;
  const enemyTeamTag = isTeam1 ? team2Tag : team1Tag;
  const enemyTeamLogo = isTeam1 ? team2Logo : team1Logo;

  // ── Phase transition helper ──
  const transitionTo = useCallback((newPhase: Phase) => {
    setPhaseTransition(true);
    setTimeout(() => {
      setPhase(newPhase);
      setPhaseTransition(false);
    }, 400);
  }, []);

  // ── Generate random enemy agents ──
  function generateEnemyAgents(): string[] {
    const roles: ValorantAgent["role"][] = [
      "Duelist",
      "Initiator",
      "Sentinel",
      "Controller",
      "Initiator",
    ];
    const taken = new Set<string>();
    const result: string[] = [];
    for (const role of roles) {
      const candidates = VALORANT_AGENTS.filter(
        (a) => a.role === role && !taken.has(a.name)
      );
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      if (pick) {
        taken.add(pick.name);
        result.push(pick.name);
      }
    }
    return result;
  }

  // ── Veto: handle player map selection ──
  const handleVetoSelect = useCallback(
    (map: string) => {
      if (!currentStepInfo || !isPlayerVetoTurn || phase !== "VETO" || aiThinking)
        return;

      const action: VetoAction = {
        type: currentStepInfo.type,
        map,
        team: playerSide,
      };
      const newActions = [...vetoActions, action];
      setVetoActions(newActions);

      if (currentStepInfo.type === "pick") {
        setPendingSideForMap({
          mapName: map,
          pickedBy: playerSide,
          index: pickedMaps.length,
        });
        setPhase("SIDE_SELECT");
        return;
      }

      if (vetoStep + 1 >= vetoSequence.length) {
        finalizeVeto(newActions);
      } else {
        setVetoStep(vetoStep + 1);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      currentStepInfo,
      isPlayerVetoTurn,
      phase,
      aiThinking,
      vetoActions,
      vetoStep,
      playerSide,
      pickedMaps.length,
      vetoSequence.length,
    ]
  );

  // ── Side selection ──
  const handleSideSelect = useCallback(
    (side: Side) => {
      if (!pendingSideForMap) return;

      const entry: MapEntry = {
        mapName: pendingSideForMap.mapName,
        pickedBy: pendingSideForMap.pickedBy,
        sidePickedBy:
          pendingSideForMap.pickedBy === playerSide ? aiSide : playerSide,
        playerSide: side,
      };
      setMapLineup((prev) => [...prev, entry]);
      setPendingSideForMap(null);

      const nextStep = vetoStep + 1;
      if (nextStep >= vetoSequence.length) {
        finalizeVeto([...vetoActions], [...mapLineup, entry]);
      } else {
        setVetoStep(nextStep);
        setPhase("VETO");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      pendingSideForMap,
      playerSide,
      aiSide,
      vetoStep,
      vetoSequence.length,
      vetoActions,
      mapLineup,
    ]
  );

  // ── AI auto-side selection ──
  useEffect(() => {
    if (phase !== "SIDE_SELECT" || !pendingSideForMap) return;

    if (pendingSideForMap.pickedBy === playerSide) {
      const timer = setTimeout(() => {
        const aiChosenSide: Side =
          Math.random() > 0.5 ? "attack" : "defense";
        const playerGets: Side =
          aiChosenSide === "attack" ? "defense" : "attack";
        handleSideSelect(playerGets);
      }, 800 + Math.floor(Math.random() * 400));
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, pendingSideForMap?.mapName]);

  // ── AI auto-veto ──
  useEffect(() => {
    if (
      phase !== "VETO" ||
      !currentStepInfo ||
      isPlayerVetoTurn ||
      aiThinkingRef.current ||
      mapPool.length === 0
    )
      return;

    aiThinkingRef.current = true;
    setAiThinking(true);

    const currentAvailable = mapPool.filter(
      (m) =>
        !vetoActions
          .filter((a) => a.type === "ban")
          .map((a) => a.map)
          .includes(m) &&
        !vetoActions
          .filter((a) => a.type === "pick")
          .map((a) => a.map)
          .includes(m)
    );

    const delay = 800 + Math.floor(Math.random() * 400);
    const timer = setTimeout(() => {
      const randomIndex = Math.floor(Math.random() * currentAvailable.length);
      const aiMap = currentAvailable[randomIndex];
      if (!aiMap) {
        aiThinkingRef.current = false;
        setAiThinking(false);
        return;
      }

      const action: VetoAction = {
        type: currentStepInfo.type,
        map: aiMap,
        team: aiSide,
      };
      const newActions = [...vetoActions, action];
      setVetoActions(newActions);
      aiThinkingRef.current = false;
      setAiThinking(false);

      if (currentStepInfo.type === "pick") {
        setPendingSideForMap({
          mapName: aiMap,
          pickedBy: aiSide,
          index: vetoActions.filter((a) => a.type === "pick").length,
        });
        setPhase("SIDE_SELECT");
        return;
      }

      if (vetoStep + 1 >= vetoSequence.length) {
        finalizeVeto(newActions);
      } else {
        setVetoStep(vetoStep + 1);
      }
    }, delay);

    return () => {
      clearTimeout(timer);
      aiThinkingRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vetoStep, phase, isPlayerVetoTurn]);

  // ── Finalize veto ──
  function finalizeVeto(
    allActions: VetoAction[],
    currentLineup?: MapEntry[]
  ) {
    const picked = allActions
      .filter((a) => a.type === "pick")
      .map((a) => a.map);
    const banned = allActions
      .filter((a) => a.type === "ban")
      .map((a) => a.map);
    const remaining = mapPool.filter(
      (m) => !picked.includes(m) && !banned.includes(m)
    );

    const lineup = currentLineup ?? [...mapLineup];

    const mapCount = format === "BO5" ? 5 : 3;
    const neededDeciders = mapCount - lineup.length;
    for (let i = 0; i < neededDeciders && i < remaining.length; i++) {
      const decidedSide: Side =
        Math.random() > 0.5 ? "attack" : "defense";
      lineup.push({
        mapName: remaining[i]!,
        pickedBy: "decider",
        sidePickedBy: "random",
        playerSide: decidedSide,
      });
    }

    setMapLineup(lineup);
    executeVetoMut.mutate({ matchId, actions: allActions });

    setCurrentMapIndex(0);
    setAgentPicks({});
    setExpandedPlayerId(null);
    setEnemyRevealed(false);
    setEnemyRevealIndex(-1);
    setLockedIn(false);
    transitionTo("AGENTS");
  }

  // ── Agent selection ──
  function handleAgentPick(playerId: string, agentName: string) {
    if (phase !== "AGENTS") return;
    setAgentPicks((prev) => ({ ...prev, [playerId]: agentName }));
    setExpandedPlayerId(null);
  }

  function allAgentsLocked(): boolean {
    return activePlayers.every(
      (p) => agentPicks[p.id] && agentPicks[p.id] !== ""
    );
  }

  async function handleLockIn() {
    if (!allAgentsLocked() || !currentMap) return;

    setLockedIn(true);

    // Generate enemy agents and reveal with stagger
    const enemies = generateEnemyAgents();
    setEnemyAgents((prev) => ({ ...prev, [currentMapIndex]: enemies }));
    setEnemyRevealed(false);
    setEnemyRevealIndex(-1);

    await new Promise((r) => setTimeout(r, 800));
    setEnemyRevealed(true);

    // Staggered reveal
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 300));
      setEnemyRevealIndex(i);
    }

    await new Promise((r) => setTimeout(r, 800));

    transitionTo("SIMULATING");

    const playerAgentArr: PlayerAgentPick[] = activePlayers.map((p) => ({
      playerId: p.id,
      agentName: agentPicks[p.id]!,
    }));

    try {
      const result = await simulateMapMut.mutateAsync({
        matchId,
        mapName: currentMap.mapName,
        side: currentMap.playerSide,
        playerAgents: playerAgentArr,
      });

      const mapResult: MapResultData = {
        map: result.map,
        score1: result.score1,
        score2: result.score2,
        playerStats: result.playerStats,
        highlights: result.highlights,
      };

      const newResults = [...mapResults, mapResult];
      setMapResults(newResults);

      const team1Won = result.score1 > result.score2;
      const newSeriesScore = {
        team1: seriesScore.team1 + (team1Won ? 1 : 0),
        team2: seriesScore.team2 + (team1Won ? 0 : 1),
      };
      setSeriesScore(newSeriesScore);

      // Brief pause before showing result
      await new Promise((r) => setTimeout(r, 600));
      transitionTo("RESULT");
    } catch {
      transitionTo("AGENTS");
    }
  }

  // ── Next map / match complete ──
  function handleNextMap() {
    const nextIdx = currentMapIndex + 1;
    if (nextIdx >= mapLineup.length) {
      handleMatchComplete();
      return;
    }
    setCurrentMapIndex(nextIdx);
    setAgentPicks({});
    setExpandedPlayerId(null);
    setEnemyRevealed(false);
    setEnemyRevealIndex(-1);
    setLockedIn(false);
    transitionTo("AGENTS");
  }

  function isSeriesDecided(): boolean {
    return seriesScore.team1 >= winsNeeded || seriesScore.team2 >= winsNeeded;
  }

  async function handleMatchComplete() {
    const winnerId = seriesScore.team1 >= winsNeeded ? team1Id : team2Id;

    const maps: StoredMapResult[] = mapResults.map((r) => ({
      map: r.map,
      score1: r.score1,
      score2: r.score2,
    }));

    try {
      await finalizeMatchMut.mutateAsync({
        matchId,
        maps,
        winnerId,
        score: seriesScore,
      });
    } catch {
      // ignore finalize errors
    }

    transitionTo("FINAL");
  }

  // ── Loading / error states ──

  if (isLoading) {
    return (
      <div
        className="flex min-h-screen items-center justify-center"
        style={{ background: C.bg }}
      >
        <GlobalStyles />
        <div className="vct-animate-fade flex flex-col items-center gap-6">
          <div className="relative h-16 w-16">
            <div
              className="absolute inset-0 rounded-full border-2 border-transparent"
              style={{ borderTopColor: C.red }}
            >
              <div className="h-full w-full animate-spin rounded-full border-2 border-transparent" style={{ borderTopColor: C.red }} />
            </div>
          </div>
          <div className="flex flex-col items-center gap-2">
            <span
              className="text-xs font-black uppercase tracking-[0.4em]"
              style={{ color: "rgba(236,232,225,0.3)" }}
            >
              PREPARING BROADCAST
            </span>
            <div className="flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-1 w-1 rounded-full"
                  style={{
                    background: C.red,
                    animation: `vct-dot-bounce 1.4s ${i * 0.16}s infinite both`,
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!vetoState) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center gap-6"
        style={{ background: C.bg }}
      >
        <GlobalStyles />
        <div
          className="text-sm font-bold uppercase tracking-[0.2em]"
          style={{ color: C.red }}
        >
          Match not found
        </div>
        <button
          onClick={() => router.push("/dashboard")}
          className="rounded-lg px-8 py-3 text-sm font-black uppercase tracking-[0.15em] transition-all duration-300 hover:scale-105"
          style={{
            background: "rgba(255,255,255,0.05)",
            color: "rgba(255,255,255,0.5)",
            border: "1px solid rgba(255,255,255,0.1)",
          }}
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  if (vetoState.done) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center gap-8"
        style={{ background: C.bg }}
      >
        <GlobalStyles />
        <div
          className="text-sm uppercase tracking-[0.2em]"
          style={{ color: "rgba(255,255,255,0.3)" }}
        >
          This match has already been completed
        </div>
        <button
          onClick={() => router.push(`/match/${matchId}`)}
          className="vct-pulse-red rounded-xl px-10 py-4 text-sm font-black uppercase tracking-[0.2em] transition-all duration-300 hover:scale-105"
          style={{ background: C.red, color: C.white }}
        >
          View Match Result
        </button>
      </div>
    );
  }

  // ── Render ──
  return (
    <div
      className="relative min-h-screen overflow-hidden"
      style={{
        background: C.bg,
        transition: "opacity 0.4s ease",
        opacity: phaseTransition ? 0 : 1,
      }}
    >
      <GlobalStyles />

      {/* ═══════════════════════════════════════════════════════ */}
      {/* ─── VETO PHASE ─── */}
      {/* ═══════════════════════════════════════════════════════ */}
      {(phase === "VETO" || phase === "SIDE_SELECT") && (
        <div className="flex min-h-screen flex-col">
          {/* Cinematic background gradient */}
          <div
            className="pointer-events-none fixed inset-0"
            style={{
              background: `radial-gradient(ellipse 80% 40% at 50% 0%, rgba(255,70,85,0.08) 0%, transparent 70%), ${C.bg}`,
            }}
          />

          {/* Format Badge */}
          <div className="vct-animate-fade relative z-10 pt-8 text-center">
            <span
              className="inline-block rounded-full px-5 py-1.5 text-[10px] font-black uppercase tracking-[0.4em]"
              style={{
                background: "rgba(255,70,85,0.1)",
                color: C.red,
                border: `1px solid rgba(255,70,85,0.2)`,
              }}
            >
              {format} -- MAP VETO
            </span>
          </div>

          {/* Match Header - HUGE team logos with VS */}
          <div
            className="vct-animate-slide-up relative z-10 flex items-center justify-center gap-12 px-8 pt-8 pb-8"
          >
            {/* Team 1 */}
            <div className="flex items-center gap-6">
              {team1Logo && (
                <div
                  className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl"
                  style={{ background: "rgba(255,255,255,0.05)" }}
                >
                  <img
                    src={team1Logo}
                    alt={team1Name}
                    className="h-14 w-14 object-contain"
                  />
                </div>
              )}
              <div className="text-right">
                <div
                  className="text-3xl font-black uppercase tracking-wide"
                  style={{
                    color:
                      playerSide === "team1"
                        ? C.white
                        : "rgba(236,232,225,0.4)",
                  }}
                >
                  {team1Name}
                </div>
                <div
                  className="text-xs font-bold uppercase tracking-[0.3em]"
                  style={{ color: "rgba(236,232,225,0.2)" }}
                >
                  {team1Tag}
                  {playerSide === "team1" && (
                    <span
                      className="ml-3 rounded px-2 py-0.5 text-[9px]"
                      style={{ background: "rgba(255,70,85,0.15)", color: C.red }}
                    >
                      YOU
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* VS */}
            <div className="flex flex-col items-center">
              <span
                className="text-5xl font-black"
                style={{ color: "rgba(236,232,225,0.1)" }}
              >
                VS
              </span>
            </div>

            {/* Team 2 */}
            <div className="flex items-center gap-6">
              <div className="text-left">
                <div
                  className="text-3xl font-black uppercase tracking-wide"
                  style={{
                    color:
                      playerSide === "team2"
                        ? C.white
                        : "rgba(236,232,225,0.4)",
                  }}
                >
                  {team2Name}
                </div>
                <div
                  className="text-xs font-bold uppercase tracking-[0.3em]"
                  style={{ color: "rgba(236,232,225,0.2)" }}
                >
                  {playerSide === "team2" && (
                    <span
                      className="mr-3 rounded px-2 py-0.5 text-[9px]"
                      style={{ background: "rgba(255,70,85,0.15)", color: C.red }}
                    >
                      YOU
                    </span>
                  )}
                  {team2Tag}
                </div>
              </div>
              {team2Logo && (
                <div
                  className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl"
                  style={{ background: "rgba(255,255,255,0.05)" }}
                >
                  <img
                    src={team2Logo}
                    alt={team2Name}
                    className="h-14 w-14 object-contain"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Veto Step Tracker - horizontal bar */}
          <div className="relative z-10 flex items-center justify-center gap-1 px-4 pb-4">
            {vetoSequence.map((step, i) => {
              const isDone = i < vetoStep;
              const isCurrent = i === vetoStep && phase === "VETO";
              const action = vetoActions[i];

              return (
                <div
                  key={i}
                  className="relative flex flex-col items-center rounded-lg px-5 py-3 transition-all duration-500"
                  style={{
                    background: isCurrent
                      ? "rgba(255,70,85,0.1)"
                      : isDone
                        ? "rgba(255,255,255,0.03)"
                        : "rgba(255,255,255,0.01)",
                    opacity: !isDone && !isCurrent ? 0.35 : 1,
                    boxShadow: isCurrent
                      ? "0 0 20px rgba(255,70,85,0.15)"
                      : "none",
                    border: isCurrent
                      ? "1px solid rgba(255,70,85,0.3)"
                      : "1px solid transparent",
                    animation: isCurrent ? "vct-pulse-red 2s ease-in-out infinite" : "none",
                  }}
                >
                  <span
                    className="text-[10px] font-black uppercase tracking-[0.15em]"
                    style={{
                      color: step.type === "ban" ? C.red : C.green,
                    }}
                  >
                    {step.type}
                  </span>
                  <span
                    className="text-[10px] font-medium"
                    style={{ color: "rgba(236,232,225,0.35)" }}
                  >
                    {step.team === "team1" ? team1Tag : team2Tag}
                  </span>
                  {isDone && action && (
                    <span
                      className="mt-0.5 text-[9px] font-bold"
                      style={{ color: "rgba(236,232,225,0.6)" }}
                    >
                      {action.map}
                    </span>
                  )}
                  {isCurrent && (
                    <div
                      className="absolute -bottom-0.5 left-1/2 h-[2px] w-5 -translate-x-1/2 rounded-full"
                      style={{ background: C.red }}
                    />
                  )}
                </div>
              );
            })}
            {/* Decider indicator */}
            <div
              className="flex flex-col items-center rounded-lg px-5 py-3"
              style={{
                background: "rgba(255,255,255,0.01)",
                opacity: vetoStep >= vetoSequence.length ? 1 : 0.35,
              }}
            >
              <span
                className="text-[10px] font-black uppercase tracking-[0.15em]"
                style={{ color: C.gold }}
              >
                Decider
              </span>
              <span
                className="text-[10px] font-medium"
                style={{ color: "rgba(236,232,225,0.35)" }}
              >
                Auto
              </span>
            </div>
          </div>

          {/* Turn Indicator */}
          <div className="relative z-10 mb-6 text-center">
            {phase === "VETO" && aiThinking && (
              <div
                className="vct-animate-fade inline-flex items-center gap-4 rounded-full px-8 py-3"
                style={{ background: "rgba(255,255,255,0.04)" }}
              >
                <div className="flex gap-1.5">
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="h-2 w-2 rounded-full"
                      style={{
                        background: C.red,
                        animation: `vct-dot-bounce 1.4s ${i * 0.16}s infinite both`,
                      }}
                    />
                  ))}
                </div>
                <span
                  className="text-sm font-semibold"
                  style={{ color: "rgba(236,232,225,0.5)" }}
                >
                  {enemyTeamName} is{" "}
                  {currentStepInfo?.type === "ban" ? "banning" : "picking"}...
                </span>
              </div>
            )}
            {phase === "VETO" && !aiThinking && isPlayerVetoTurn && (
              <div
                className="vct-animate-scale inline-flex items-center gap-3 rounded-full px-8 py-3"
                style={{
                  background: "rgba(255,70,85,0.08)",
                  border: "1px solid rgba(255,70,85,0.2)",
                }}
              >
                <div
                  className="h-2 w-2 rounded-full animate-pulse"
                  style={{ background: C.red }}
                />
                <span
                  className="text-sm font-bold"
                  style={{ color: C.white }}
                >
                  Your turn to{" "}
                  <span
                    className="font-black uppercase"
                    style={{
                      color:
                        currentStepInfo?.type === "ban" ? C.red : C.green,
                    }}
                  >
                    {currentStepInfo?.type === "ban" ? "BAN" : "PICK"}
                  </span>{" "}
                  a map
                </span>
              </div>
            )}
            {phase === "SIDE_SELECT" &&
              pendingSideForMap &&
              pendingSideForMap.pickedBy === playerSide && (
                <div
                  className="vct-animate-fade inline-flex items-center gap-4 rounded-full px-8 py-3"
                  style={{ background: "rgba(255,255,255,0.04)" }}
                >
                  <div className="flex gap-1.5">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className="h-2 w-2 rounded-full"
                        style={{
                          background: C.red,
                          animation: `vct-dot-bounce 1.4s ${i * 0.16}s infinite both`,
                        }}
                      />
                    ))}
                  </div>
                  <span
                    className="text-sm font-semibold"
                    style={{ color: "rgba(236,232,225,0.5)" }}
                  >
                    {enemyTeamName} is choosing side on{" "}
                    {pendingSideForMap.mapName}...
                  </span>
                </div>
              )}
          </div>

          {/* ── Map Cards - 7 tall cards ── */}
          {phase === "VETO" && (
            <div className="relative z-10 flex flex-1 items-start justify-center px-8 pb-8">
              <div className="flex gap-3">
                {mapPool.map((mapName) => {
                  const isBanned = bannedMaps.includes(mapName);
                  const isPicked = pickedMaps.includes(mapName);
                  const isAvail = availableMaps.includes(mapName);
                  const isDecider =
                    !isBanned &&
                    !isPicked &&
                    availableMaps.length === 1 &&
                    availableMaps[0] === mapName &&
                    vetoStep >= vetoSequence.length;
                  const canSelect =
                    isPlayerVetoTurn && isAvail && !aiThinking;
                  const whoActed = vetoActions.find(
                    (a) => a.map === mapName
                  );

                  return (
                    <button
                      key={mapName}
                      onClick={() => canSelect && handleVetoSelect(mapName)}
                      disabled={!canSelect}
                      className="group relative overflow-hidden rounded-xl transition-all duration-500"
                      style={{
                        width: "180px",
                        height: "280px",
                        filter: isBanned
                          ? "saturate(0.1) brightness(0.5)"
                          : "none",
                        opacity: isBanned ? 0.5 : 1,
                        cursor: canSelect ? "pointer" : "default",
                        border: isPicked
                          ? `2px solid ${C.green}`
                          : isDecider
                            ? `2px solid ${C.gold}`
                            : canSelect
                              ? "2px solid transparent"
                              : "2px solid transparent",
                        animation: isPicked
                          ? "vct-pulse-green 2s ease-in-out infinite"
                          : isDecider
                            ? "vct-pulse-gold 2s ease-in-out infinite"
                            : canSelect && isPlayerVetoTurn
                              ? "vct-pulse-red 2.5s ease-in-out infinite"
                              : "none",
                      }}
                    >
                      {/* Map image */}
                      <div
                        className="absolute inset-0 bg-cover bg-center transition-transform duration-700"
                        style={{
                          backgroundImage: `url(${getMapImage(mapName)})`,
                          transform: canSelect ? undefined : "scale(1)",
                        }}
                      />
                      {/* Hover zoom */}
                      <div
                        className="absolute inset-0 bg-cover bg-center opacity-0 transition-all duration-700 group-hover:opacity-100"
                        style={{
                          backgroundImage: `url(${getMapImage(mapName)})`,
                          transform: "scale(1.12)",
                        }}
                      />

                      {/* Gradient overlay */}
                      <div
                        className="absolute inset-0"
                        style={{
                          background:
                            "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.3) 40%, rgba(0,0,0,0.1) 100%)",
                        }}
                      />

                      {/* Hover glow for selectable */}
                      {canSelect && (
                        <div
                          className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                          style={{
                            background:
                              "linear-gradient(to top, rgba(255,70,85,0.15) 0%, transparent 50%)",
                          }}
                        />
                      )}

                      {/* BANNED overlay */}
                      {isBanned && (
                        <div
                          className="absolute inset-0 flex flex-col items-center justify-center"
                          style={{ background: "rgba(255,70,85,0.08)" }}
                        >
                          {/* Diagonal banned text */}
                          <div
                            className="absolute font-black uppercase tracking-[0.3em]"
                            style={{
                              color: "rgba(255,70,85,0.6)",
                              fontSize: "18px",
                              transform: "rotate(-35deg)",
                              letterSpacing: "0.15em",
                            }}
                          >
                            BANNED
                          </div>
                          {whoActed && (
                            <div
                              className="absolute bottom-14 text-[10px] font-bold uppercase tracking-wider"
                              style={{ color: "rgba(255,70,85,0.5)" }}
                            >
                              {whoActed.team === "team1"
                                ? team1Tag
                                : team2Tag}
                            </div>
                          )}
                        </div>
                      )}

                      {/* PICKED overlay */}
                      {isPicked && (
                        <div
                          className="absolute inset-0 flex flex-col items-center justify-center"
                          style={{ background: "rgba(74,230,138,0.05)" }}
                        >
                          <div
                            className="rounded-full px-4 py-1.5 text-xs font-black uppercase tracking-[0.2em]"
                            style={{
                              background: "rgba(74,230,138,0.15)",
                              color: C.green,
                              border: `1px solid rgba(74,230,138,0.3)`,
                            }}
                          >
                            PICKED
                          </div>
                          {whoActed && (
                            <div
                              className="mt-2 text-[10px] font-bold uppercase tracking-wider"
                              style={{ color: "rgba(74,230,138,0.6)" }}
                            >
                              {whoActed.team === "team1"
                                ? team1Tag
                                : team2Tag}
                            </div>
                          )}
                        </div>
                      )}

                      {/* DECIDER overlay */}
                      {isDecider && (
                        <div
                          className="absolute inset-0 flex flex-col items-center justify-center"
                          style={{ background: "rgba(198,155,58,0.05)" }}
                        >
                          <div
                            className="text-2xl"
                            style={{ color: C.gold }}
                          >
                            &#9733;
                          </div>
                          <div
                            className="mt-1 rounded-full px-4 py-1.5 text-xs font-black uppercase tracking-[0.2em]"
                            style={{
                              background: "rgba(198,155,58,0.15)",
                              color: C.gold,
                              border: `1px solid rgba(198,155,58,0.3)`,
                            }}
                          >
                            DECIDER
                          </div>
                        </div>
                      )}

                      {/* Map name at bottom */}
                      <div className="absolute inset-x-0 bottom-0 p-4">
                        <div
                          className="text-lg font-black uppercase tracking-wider"
                          style={{
                            color: C.white,
                            textShadow: "0 2px 8px rgba(0,0,0,0.8)",
                          }}
                        >
                          {mapName}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Side Select Overlay ── */}
          {phase === "SIDE_SELECT" &&
            pendingSideForMap &&
            pendingSideForMap.pickedBy !== playerSide && (
              <div className="vct-animate-fade relative z-20 flex flex-1 flex-col items-center justify-center gap-10 px-8">
                {/* Map preview */}
                <div
                  className="relative w-full max-w-4xl overflow-hidden rounded-2xl"
                  style={{ aspectRatio: "21/9" }}
                >
                  <div
                    className="absolute inset-0 bg-cover bg-center vct-animate-zoom"
                    style={{
                      backgroundImage: `url(${getMapImage(pendingSideForMap.mapName)})`,
                    }}
                  />
                  <div
                    className="absolute inset-0"
                    style={{
                      background:
                        "linear-gradient(to bottom, rgba(10,10,15,0.4) 0%, rgba(10,10,15,0.8) 100%)",
                      backdropFilter: "blur(2px)",
                    }}
                  />
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span
                      className="text-xs font-bold uppercase tracking-[0.4em]"
                      style={{ color: "rgba(236,232,225,0.35)" }}
                    >
                      {enemyTeamName} picked
                    </span>
                    <span
                      className="mt-2 text-5xl font-black uppercase tracking-wider"
                      style={{
                        color: C.white,
                        textShadow: "0 4px 20px rgba(0,0,0,0.5)",
                      }}
                    >
                      {pendingSideForMap.mapName}
                    </span>
                    <span
                      className="mt-4 text-sm font-semibold uppercase tracking-[0.2em]"
                      style={{ color: "rgba(236,232,225,0.4)" }}
                    >
                      Choose your starting side
                    </span>
                  </div>
                </div>

                {/* Side buttons */}
                <div className="flex gap-8">
                  <button
                    onClick={() => handleSideSelect("attack")}
                    className="group relative overflow-hidden rounded-2xl px-20 py-10 transition-all duration-500 hover:scale-105"
                    style={{
                      background:
                        "linear-gradient(135deg, rgba(255,100,70,0.08) 0%, rgba(255,60,40,0.15) 100%)",
                      border: "2px solid rgba(255,100,70,0.3)",
                    }}
                  >
                    <div
                      className="absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                      style={{
                        background:
                          "linear-gradient(135deg, rgba(255,100,70,0.15) 0%, rgba(255,60,40,0.25) 100%)",
                      }}
                    />
                    <div className="relative text-center">
                      <div
                        className="text-xs font-bold uppercase tracking-[0.4em]"
                        style={{ color: "rgba(255,120,80,0.5)" }}
                      >
                        Starting Side
                      </div>
                      <div
                        className="mt-2 text-4xl font-black uppercase tracking-wider"
                        style={{ color: "#FF7850" }}
                      >
                        ATTACK
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => handleSideSelect("defense")}
                    className="group relative overflow-hidden rounded-2xl px-20 py-10 transition-all duration-500 hover:scale-105"
                    style={{
                      background:
                        "linear-gradient(135deg, rgba(60,200,180,0.08) 0%, rgba(40,180,160,0.15) 100%)",
                      border: "2px solid rgba(60,200,180,0.3)",
                    }}
                  >
                    <div
                      className="absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                      style={{
                        background:
                          "linear-gradient(135deg, rgba(60,200,180,0.15) 0%, rgba(40,180,160,0.25) 100%)",
                      }}
                    />
                    <div className="relative text-center">
                      <div
                        className="text-xs font-bold uppercase tracking-[0.4em]"
                        style={{ color: "rgba(60,200,180,0.5)" }}
                      >
                        Starting Side
                      </div>
                      <div
                        className="mt-2 text-4xl font-black uppercase tracking-wider"
                        style={{ color: "#3CC8B4" }}
                      >
                        DEFENSE
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════ */}
      {/* ─── AGENTS PHASE ─── */}
      {/* ═══════════════════════════════════════════════════════ */}
      {phase === "AGENTS" && currentMap && (
        <div className="relative min-h-screen">
          {/* Background map - blurred & dark */}
          <div
            className="fixed inset-0 bg-cover bg-center vct-animate-zoom"
            style={{
              backgroundImage: `url(${getMapImage(currentMap.mapName)})`,
              filter: "blur(24px) brightness(0.15) saturate(0.6)",
            }}
          />
          <div
            className="fixed inset-0"
            style={{ background: "rgba(10,10,15,0.8)" }}
          />

          <div className="relative z-10 flex min-h-screen flex-col px-8 py-6">
            {/* Map banner */}
            <div className="vct-animate-slide-up mb-2">
              <div
                className="relative mx-auto h-32 w-full max-w-6xl overflow-hidden rounded-2xl"
              >
                <div
                  className="absolute inset-0 bg-cover bg-center"
                  style={{
                    backgroundImage: `url(${getMapImage(currentMap.mapName)})`,
                    filter: "brightness(0.4)",
                  }}
                />
                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      "linear-gradient(to right, rgba(10,10,15,0.8) 0%, rgba(10,10,15,0.3) 50%, rgba(10,10,15,0.8) 100%)",
                  }}
                />
                <div className="absolute inset-0 flex items-center justify-between px-10">
                  <div className="flex items-center gap-4">
                    <span
                      className="text-xs font-bold uppercase tracking-[0.3em]"
                      style={{ color: "rgba(236,232,225,0.3)" }}
                    >
                      Map {currentMapIndex + 1} / {mapLineup.length}
                    </span>
                    {currentMap.pickedBy === "decider" && (
                      <span
                        className="rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-wider"
                        style={{
                          background: "rgba(198,155,58,0.15)",
                          color: C.gold,
                          border: "1px solid rgba(198,155,58,0.3)",
                        }}
                      >
                        Decider
                      </span>
                    )}
                  </div>
                  <div className="text-center">
                    <div
                      className="text-4xl font-black uppercase tracking-wider"
                      style={{
                        color: C.white,
                        textShadow: "0 2px 12px rgba(0,0,0,0.5)",
                      }}
                    >
                      {currentMap.mapName}
                    </div>
                    <div
                      className="mt-1 text-xs font-bold uppercase tracking-[0.3em]"
                      style={{ color: "rgba(236,232,225,0.35)" }}
                    >
                      Agent Select
                    </div>
                  </div>
                  <div
                    className="rounded-full px-4 py-1.5 text-xs font-black uppercase tracking-wider"
                    style={{
                      background:
                        currentMap.playerSide === "attack"
                          ? "rgba(255,120,80,0.1)"
                          : "rgba(60,200,180,0.1)",
                      color:
                        currentMap.playerSide === "attack"
                          ? "#FF7850"
                          : "#3CC8B4",
                      border:
                        currentMap.playerSide === "attack"
                          ? "1px solid rgba(255,120,80,0.25)"
                          : "1px solid rgba(60,200,180,0.25)",
                    }}
                  >
                    Starting {currentMap.playerSide}
                  </div>
                </div>
              </div>
            </div>

            {/* Map lineup mini bar */}
            <div className="mb-6 flex items-center justify-center gap-2">
              {mapLineup.map((entry, i) => {
                const result = mapResults[i];
                const isCurrent = i === currentMapIndex;

                return (
                  <div
                    key={i}
                    className="flex flex-col items-center rounded-lg px-3 py-2 transition-all duration-300"
                    style={{
                      background: isCurrent
                        ? "rgba(255,255,255,0.08)"
                        : result
                          ? "rgba(255,255,255,0.03)"
                          : "rgba(255,255,255,0.01)",
                      border: isCurrent
                        ? "1px solid rgba(255,70,85,0.3)"
                        : "1px solid transparent",
                      opacity: !isCurrent && !result ? 0.4 : 1,
                    }}
                  >
                    <div className="relative h-8 w-14 overflow-hidden rounded">
                      <div
                        className="absolute inset-0 bg-cover bg-center"
                        style={{
                          backgroundImage: `url(${getMapImage(entry.mapName)})`,
                        }}
                      />
                      <div
                        className="absolute inset-0"
                        style={{ background: "rgba(0,0,0,0.4)" }}
                      />
                    </div>
                    <span
                      className="mt-1 text-[9px] font-bold uppercase tracking-wider"
                      style={{ color: "rgba(236,232,225,0.5)" }}
                    >
                      {entry.mapName}
                    </span>
                    {result && (
                      <span
                        className="text-[10px] font-bold"
                        style={{ color: "rgba(236,232,225,0.4)" }}
                      >
                        {result.score1}-{result.score2}
                      </span>
                    )}
                    {entry.pickedBy === "decider" && !result && (
                      <span
                        className="text-[8px] font-bold uppercase"
                        style={{ color: "rgba(198,155,58,0.6)" }}
                      >
                        Decider
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Two-column agent select */}
            <div className="mx-auto flex w-full max-w-6xl flex-1 gap-6">
              {/* ── YOUR TEAM (left) ── */}
              <div className="flex-1">
                <div className="mb-4 flex items-center gap-3">
                  {playerTeamLogo && (
                    <div
                      className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg"
                      style={{ background: "rgba(255,255,255,0.05)" }}
                    >
                      <img
                        src={playerTeamLogo}
                        alt={playerTeamName}
                        className="h-6 w-6 object-contain"
                      />
                    </div>
                  )}
                  <div>
                    <div
                      className="text-[10px] font-black uppercase tracking-[0.25em]"
                      style={{ color: C.green }}
                    >
                      Your Team
                    </div>
                    <div
                      className="text-lg font-black uppercase tracking-wide"
                      style={{ color: C.white }}
                    >
                      {playerTeamTag}
                    </div>
                  </div>
                  <div
                    className="ml-auto text-[10px] font-bold uppercase tracking-[0.2em]"
                    style={{ color: "rgba(236,232,225,0.25)" }}
                  >
                    Agent Select
                  </div>
                </div>

                <div className="space-y-2">
                  {activePlayers.map((player, playerIdx) => {
                    const selectedAgent = agentPicks[player.id];
                    const agentData = selectedAgent
                      ? VALORANT_AGENTS.find(
                          (a) => a.name === selectedAgent
                        )
                      : null;
                    const isExpanded = expandedPlayerId === player.id;

                    return (
                      <div
                        key={player.id}
                        className="vct-animate-slide-up"
                        style={{
                          animationDelay: `${playerIdx * 80}ms`,
                        }}
                      >
                        {/* Player row */}
                        <button
                          onClick={() =>
                            !lockedIn &&
                            setExpandedPlayerId(
                              isExpanded ? null : player.id
                            )
                          }
                          disabled={lockedIn}
                          className="flex w-full items-center gap-4 rounded-xl px-4 py-3 text-left transition-all duration-300"
                          style={{
                            background: isExpanded
                              ? "rgba(255,255,255,0.08)"
                              : "rgba(255,255,255,0.02)",
                            border: isExpanded
                              ? "1px solid rgba(255,255,255,0.15)"
                              : "1px solid rgba(255,255,255,0.04)",
                            cursor: lockedIn ? "default" : "pointer",
                          }}
                        >
                          {/* Agent portrait or empty circle */}
                          <div className="relative h-12 w-12 shrink-0">
                            {agentData ? (
                              <div
                                className="relative h-12 w-12 overflow-hidden rounded-full transition-all duration-300"
                                style={{
                                  border: `2px solid ${C.green}`,
                                  boxShadow: `0 0 12px rgba(74,230,138,0.2)`,
                                }}
                              >
                                <img
                                  src={agentData.portraitUrl}
                                  alt={agentData.name}
                                  className="h-full w-full object-cover"
                                />
                              </div>
                            ) : (
                              <div
                                className="flex h-12 w-12 items-center justify-center rounded-full"
                                style={{
                                  border:
                                    "2px dashed rgba(255,255,255,0.12)",
                                }}
                              >
                                <span
                                  className="text-lg font-bold"
                                  style={{
                                    color: "rgba(255,255,255,0.12)",
                                  }}
                                >
                                  ?
                                </span>
                              </div>
                            )}
                          </div>

                          {/* Player info */}
                          <div className="flex-1 min-w-0">
                            <div
                              className="truncate text-sm font-bold"
                              style={{ color: C.white }}
                            >
                              {player.ign}
                            </div>
                            <div
                              className="text-[10px] font-bold uppercase tracking-[0.15em]"
                              style={{ color: "rgba(236,232,225,0.25)" }}
                            >
                              {player.role}
                            </div>
                          </div>

                          {/* Selected agent name badge */}
                          {selectedAgent && (
                            <span
                              className="rounded-full px-3 py-1 text-xs font-bold"
                              style={{
                                background: "rgba(74,230,138,0.1)",
                                color: C.green,
                                border: "1px solid rgba(74,230,138,0.2)",
                              }}
                            >
                              {selectedAgent}
                            </span>
                          )}

                          {/* Expand arrow */}
                          {!lockedIn && (
                            <svg
                              className="h-4 w-4 transition-transform duration-300"
                              style={{
                                color: "rgba(236,232,225,0.25)",
                                transform: isExpanded
                                  ? "rotate(180deg)"
                                  : "rotate(0deg)",
                              }}
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M19 9l-7 7-7-7"
                              />
                            </svg>
                          )}
                        </button>

                        {/* Agent picker grid (expanded) */}
                        {isExpanded && !lockedIn && (
                          <div
                            className="vct-animate-slide-up mt-1 rounded-xl p-4"
                            style={{
                              background: "rgba(22,22,30,0.95)",
                              border: "1px solid rgba(255,255,255,0.06)",
                            }}
                          >
                            {AGENT_ROLES.map((role) => {
                              const agents = VALORANT_AGENTS.filter(
                                (a) => a.role === role
                              );
                              return (
                                <div key={role} className="mb-3 last:mb-0">
                                  <div
                                    className="mb-2 text-[9px] font-black uppercase tracking-[0.25em]"
                                    style={{
                                      color: ROLE_COLORS[role],
                                      opacity: 0.7,
                                    }}
                                  >
                                    {role}s
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {agents.map((agent) => {
                                      const isSelected =
                                        selectedAgent === agent.name;
                                      const isTaken =
                                        !isSelected &&
                                        pickedAgentNames.includes(
                                          agent.name
                                        );

                                      return (
                                        <button
                                          key={agent.name}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (!isTaken)
                                              handleAgentPick(
                                                player.id,
                                                agent.name
                                              );
                                          }}
                                          disabled={isTaken}
                                          className="group relative flex flex-col items-center gap-1 rounded-lg p-1.5 transition-all duration-200"
                                          style={{
                                            background: isSelected
                                              ? "rgba(74,230,138,0.12)"
                                              : "transparent",
                                            border: isSelected
                                              ? `1px solid rgba(74,230,138,0.4)`
                                              : "1px solid transparent",
                                            opacity: isTaken ? 0.15 : 1,
                                            filter: isTaken
                                              ? "grayscale(1)"
                                              : "none",
                                            cursor: isTaken
                                              ? "not-allowed"
                                              : "pointer",
                                          }}
                                        >
                                          <div
                                            className="relative h-10 w-10 overflow-hidden rounded-full transition-all duration-200"
                                            style={{
                                              border: isSelected
                                                ? `2px solid ${C.green}`
                                                : "2px solid rgba(255,255,255,0.15)",
                                              transform:
                                                isSelected
                                                  ? "scale(1.1)"
                                                  : "scale(1)",
                                            }}
                                          >
                                            <img
                                              src={agent.portraitUrl}
                                              alt={agent.name}
                                              className="h-full w-full object-cover"
                                            />
                                          </div>
                                          <span
                                            className="text-[8px] font-semibold"
                                            style={{
                                              color: isSelected
                                                ? C.green
                                                : "rgba(236,232,225,0.4)",
                                            }}
                                          >
                                            {agent.name}
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── ENEMY TEAM (right) ── */}
              <div className="flex-1">
                <div className="mb-4 flex items-center gap-3">
                  {enemyTeamLogo && (
                    <div
                      className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg"
                      style={{ background: "rgba(255,255,255,0.05)" }}
                    >
                      <img
                        src={enemyTeamLogo}
                        alt={enemyTeamName}
                        className="h-6 w-6 object-contain"
                      />
                    </div>
                  )}
                  <div>
                    <div
                      className="text-[10px] font-black uppercase tracking-[0.25em]"
                      style={{ color: C.red }}
                    >
                      Enemy Team
                    </div>
                    <div
                      className="text-lg font-black uppercase tracking-wide"
                      style={{ color: C.white }}
                    >
                      {enemyTeamTag}
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  {[0, 1, 2, 3, 4].map((idx) => {
                    const isRevealed =
                      enemyRevealed && enemyRevealIndex >= idx;
                    const agentName = isRevealed
                      ? enemyAgents[currentMapIndex]?.[idx]
                      : undefined;
                    const agentData = agentName
                      ? VALORANT_AGENTS.find(
                          (a) => a.name === agentName
                        )
                      : null;

                    return (
                      <div
                        key={idx}
                        className="flex items-center gap-4 rounded-xl px-4 py-3 transition-all duration-500"
                        style={{
                          background: isRevealed
                            ? "rgba(255,70,85,0.04)"
                            : "rgba(255,255,255,0.02)",
                          border: isRevealed
                            ? "1px solid rgba(255,70,85,0.1)"
                            : "1px solid rgba(255,255,255,0.04)",
                          animationDelay: `${idx * 300}ms`,
                        }}
                      >
                        <div className="relative h-12 w-12 shrink-0">
                          {agentData ? (
                            <div
                              className="vct-animate-scale relative h-12 w-12 overflow-hidden rounded-full"
                              style={{
                                border: `2px solid rgba(255,70,85,0.4)`,
                                boxShadow:
                                  "0 0 12px rgba(255,70,85,0.15)",
                              }}
                            >
                              <img
                                src={agentData.portraitUrl}
                                alt={agentData.name}
                                className="h-full w-full object-cover"
                              />
                            </div>
                          ) : (
                            <div
                              className="flex h-12 w-12 items-center justify-center rounded-full"
                              style={{
                                border:
                                  "2px dashed rgba(255,255,255,0.08)",
                              }}
                            >
                              <span
                                className="text-lg font-bold"
                                style={{
                                  color: "rgba(255,255,255,0.08)",
                                }}
                              >
                                ?
                              </span>
                            </div>
                          )}
                        </div>
                        <div className="flex-1">
                          <div
                            className="text-sm font-bold"
                            style={{
                              color: isRevealed
                                ? C.white
                                : "rgba(236,232,225,0.3)",
                            }}
                          >
                            {isRevealed && agentData
                              ? agentData.name
                              : `Player ${idx + 1}`}
                          </div>
                          <div
                            className="text-[10px] font-bold uppercase tracking-wider"
                            style={{
                              color: isRevealed && agentData
                                ? ROLE_COLORS[agentData.role]
                                : "rgba(236,232,225,0.15)",
                              opacity: 0.7,
                            }}
                          >
                            {isRevealed && agentData
                              ? agentData.role
                              : "Unknown"}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Lock In Button */}
            <div className="mt-6 flex justify-center pb-6">
              {lockedIn ? (
                <div
                  className="vct-animate-scale rounded-xl px-16 py-4 text-center"
                  style={{
                    background: "rgba(74,230,138,0.1)",
                    border: `1px solid rgba(74,230,138,0.3)`,
                  }}
                >
                  <span
                    className="text-base font-black uppercase tracking-[0.3em]"
                    style={{ color: C.green }}
                  >
                    LOCKED IN
                  </span>
                </div>
              ) : (
                <button
                  onClick={handleLockIn}
                  disabled={!allAgentsLocked()}
                  className="group relative overflow-hidden rounded-xl px-16 py-4 transition-all duration-500"
                  style={{
                    background: allAgentsLocked()
                      ? C.red
                      : "rgba(255,255,255,0.03)",
                    color: allAgentsLocked()
                      ? C.white
                      : "rgba(255,255,255,0.15)",
                    cursor: allAgentsLocked()
                      ? "pointer"
                      : "not-allowed",
                    boxShadow: allAgentsLocked()
                      ? "0 0 30px rgba(255,70,85,0.3)"
                      : "none",
                    animation: allAgentsLocked()
                      ? "vct-pulse-red 2s ease-in-out infinite"
                      : "none",
                    transform: allAgentsLocked()
                      ? "scale(1)"
                      : "scale(0.97)",
                  }}
                >
                  {allAgentsLocked() && (
                    <div
                      className="absolute inset-0 overflow-hidden"
                      style={{
                        background:
                          "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%)",
                        animation: "vct-glow-sweep 2s ease infinite",
                      }}
                    />
                  )}
                  <span className="relative text-base font-black uppercase tracking-[0.3em]">
                    Lock In
                  </span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════ */}
      {/* ─── SIMULATING PHASE ─── */}
      {/* ═══════════════════════════════════════════════════════ */}
      {phase === "SIMULATING" && currentMap && (
        <div className="relative flex min-h-screen items-center justify-center">
          <div
            className="fixed inset-0 bg-cover bg-center vct-animate-zoom"
            style={{
              backgroundImage: `url(${getMapImage(currentMap.mapName)})`,
              filter: "blur(12px) brightness(0.12) saturate(0.5)",
            }}
          />
          <div
            className="fixed inset-0"
            style={{
              background:
                "radial-gradient(ellipse at center, rgba(255,70,85,0.05) 0%, rgba(10,10,15,0.85) 70%)",
            }}
          />

          <div className="relative z-10 text-center vct-animate-scale">
            <div
              className="text-xs font-bold uppercase tracking-[0.4em]"
              style={{ color: "rgba(236,232,225,0.25)" }}
            >
              Map {currentMapIndex + 1}
            </div>
            <div
              className="mt-3 text-6xl font-black uppercase tracking-wider"
              style={{
                color: C.white,
                textShadow: "0 4px 24px rgba(0,0,0,0.6)",
              }}
            >
              {currentMap.mapName}
            </div>
            <div className="mt-8 flex items-center justify-center gap-3">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-2.5 w-2.5 rounded-full"
                  style={{
                    background: C.red,
                    animation: `vct-dot-bounce 1.4s ${i * 0.2}s infinite both`,
                  }}
                />
              ))}
            </div>
            <div
              className="mt-5 text-sm font-bold uppercase tracking-[0.4em]"
              style={{ color: "rgba(236,232,225,0.3)" }}
            >
              Simulating Match
            </div>

            {/* Team vs Team mini display */}
            <div
              className="mt-10 flex items-center justify-center gap-6 rounded-xl px-8 py-4"
              style={{ background: "rgba(255,255,255,0.03)" }}
            >
              <div className="flex items-center gap-3">
                {team1Logo && (
                  <img
                    src={team1Logo}
                    alt={team1Tag}
                    className="h-8 w-8 object-contain"
                  />
                )}
                <span
                  className="text-sm font-black uppercase"
                  style={{ color: "rgba(236,232,225,0.5)" }}
                >
                  {team1Tag}
                </span>
              </div>
              <span
                className="text-lg font-black"
                style={{ color: "rgba(236,232,225,0.1)" }}
              >
                VS
              </span>
              <div className="flex items-center gap-3">
                <span
                  className="text-sm font-black uppercase"
                  style={{ color: "rgba(236,232,225,0.5)" }}
                >
                  {team2Tag}
                </span>
                {team2Logo && (
                  <img
                    src={team2Logo}
                    alt={team2Tag}
                    className="h-8 w-8 object-contain"
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════ */}
      {/* ─── RESULT PHASE ─── */}
      {/* ═══════════════════════════════════════════════════════ */}
      {phase === "RESULT" && currentMap && mapResults[currentMapIndex] && (
        <ResultPhase
          mapResult={mapResults[currentMapIndex]}
          mapName={currentMap.mapName}
          mapNumber={currentMapIndex + 1}
          totalMaps={mapLineup.length}
          team1Name={team1Name}
          team1Tag={team1Tag}
          team1Id={team1Id}
          team1Logo={team1Logo}
          team2Name={team2Name}
          team2Tag={team2Tag}
          team2Id={team2Id}
          team2Logo={team2Logo}
          seriesScore={seriesScore}
          winsNeeded={winsNeeded}
          isSeriesDecided={isSeriesDecided()}
          onNext={isSeriesDecided() ? handleMatchComplete : handleNextMap}
        />
      )}

      {/* ═══════════════════════════════════════════════════════ */}
      {/* ─── FINAL PHASE ─── */}
      {/* ═══════════════════════════════════════════════════════ */}
      {phase === "FINAL" && (
        <FinalPhase
          team1Name={team1Name}
          team1Tag={team1Tag}
          team1Logo={team1Logo}
          team2Name={team2Name}
          team2Tag={team2Tag}
          team2Logo={team2Logo}
          seriesScore={seriesScore}
          winsNeeded={winsNeeded}
          mapResults={mapResults}
          mapLineup={mapLineup}
          matchId={matchId}
          router={router}
        />
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ── Result sub-component ──
// ══════════════════════════════════════════════════════════════

function ResultPhase({
  mapResult,
  mapName,
  mapNumber,
  totalMaps,
  team1Name,
  team1Tag,
  team1Id,
  team1Logo,
  team2Name,
  team2Tag,
  team2Id,
  team2Logo,
  seriesScore,
  winsNeeded,
  isSeriesDecided,
  onNext,
}: {
  mapResult: MapResultData;
  mapName: string;
  mapNumber: number;
  totalMaps: number;
  team1Name: string;
  team1Tag: string;
  team1Id: string;
  team1Logo: string;
  team2Name: string;
  team2Tag: string;
  team2Id: string;
  team2Logo: string;
  seriesScore: { team1: number; team2: number };
  winsNeeded: number;
  isSeriesDecided: boolean;
  onNext: () => void;
}) {
  const team1Won = mapResult.score1 > mapResult.score2;
  const team1Stats = mapResult.playerStats.filter((p) => p.teamId === team1Id);
  const team2Stats = mapResult.playerStats.filter((p) => p.teamId === team2Id);
  const mvp = [...mapResult.playerStats].sort((a, b) => b.acs - a.acs)[0];

  // Check if one win away from winning
  const isMatchPoint =
    !isSeriesDecided &&
    (seriesScore.team1 === winsNeeded - 1 ||
      seriesScore.team2 === winsNeeded - 1);

  return (
    <div className="relative min-h-screen">
      <GlobalStyles />
      {/* Background map image */}
      <div
        className="fixed inset-0 bg-cover bg-center vct-animate-zoom"
        style={{
          backgroundImage: `url(${getMapImage(mapName)})`,
          filter: "blur(20px) brightness(0.12) saturate(0.4)",
        }}
      />
      <div
        className="fixed inset-0"
        style={{ background: "rgba(10,10,15,0.7)" }}
      />

      <div className="relative z-10 mx-auto max-w-5xl px-8 py-10">
        {/* Map label */}
        <div className="vct-animate-fade mb-3 text-center">
          <span
            className="text-xs font-bold uppercase tracking-[0.4em]"
            style={{ color: "rgba(236,232,225,0.25)" }}
          >
            Map {mapNumber} of {totalMaps} -- {mapName}
          </span>
        </div>

        {/* BIG score display */}
        <div className="vct-animate-scale mb-4 flex items-center justify-center gap-8">
          {/* Team 1 side */}
          <div className="flex items-center gap-5">
            {team1Logo && (
              <div
                className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl"
                style={{ background: "rgba(255,255,255,0.05)" }}
              >
                <img
                  src={team1Logo}
                  alt={team1Name}
                  className="h-10 w-10 object-contain"
                />
              </div>
            )}
            <div className="text-right">
              <div
                className="text-xl font-black uppercase tracking-wide"
                style={{
                  color: team1Won ? C.white : "rgba(236,232,225,0.35)",
                }}
              >
                {team1Name}
              </div>
            </div>
          </div>

          {/* Score */}
          <div className="flex items-center gap-5">
            <span
              className="tabular-nums font-black"
              style={{
                fontSize: "5rem",
                lineHeight: 1,
                color: team1Won ? C.green : "rgba(255,70,85,0.4)",
                textShadow: team1Won
                  ? "0 0 30px rgba(74,230,138,0.3)"
                  : "none",
              }}
            >
              {mapResult.score1}
            </span>
            <span
              className="text-3xl font-black"
              style={{ color: "rgba(236,232,225,0.1)" }}
            >
              :
            </span>
            <span
              className="tabular-nums font-black"
              style={{
                fontSize: "5rem",
                lineHeight: 1,
                color: !team1Won ? C.green : "rgba(255,70,85,0.4)",
                textShadow: !team1Won
                  ? "0 0 30px rgba(74,230,138,0.3)"
                  : "none",
              }}
            >
              {mapResult.score2}
            </span>
          </div>

          {/* Team 2 side */}
          <div className="flex items-center gap-5">
            <div className="text-left">
              <div
                className="text-xl font-black uppercase tracking-wide"
                style={{
                  color: !team1Won ? C.white : "rgba(236,232,225,0.35)",
                }}
              >
                {team2Name}
              </div>
            </div>
            {team2Logo && (
              <div
                className="relative flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl"
                style={{ background: "rgba(255,255,255,0.05)" }}
              >
                <img
                  src={team2Logo}
                  alt={team2Name}
                  className="h-10 w-10 object-contain"
                />
              </div>
            )}
          </div>
        </div>

        {/* MVP callout */}
        {mvp && (
          <div className="vct-animate-slide-up mb-3 flex justify-center">
            <div
              className="inline-flex items-center gap-3 rounded-full px-6 py-2.5"
              style={{
                background: "rgba(198,155,58,0.08)",
                border: "1px solid rgba(198,155,58,0.2)",
              }}
            >
              <svg
                className="h-5 w-5"
                style={{ color: C.gold }}
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
              <span
                className="text-sm font-black uppercase tracking-wider"
                style={{ color: C.gold }}
              >
                MVP: {mvp.ign}
              </span>
              <span
                className="text-xs font-bold"
                style={{ color: "rgba(198,155,58,0.5)" }}
              >
                {formatStat(mvp.acs, 0)} ACS
              </span>
            </div>
          </div>
        )}

        {/* Series score */}
        <div className="mb-8 text-center">
          <span
            className="text-xs font-bold uppercase tracking-[0.3em]"
            style={{ color: "rgba(236,232,225,0.25)" }}
          >
            Series: {team1Tag} {seriesScore.team1} - {seriesScore.team2}{" "}
            {team2Tag}
          </span>
        </div>

        {/* Scoreboard */}
        <div
          className="vct-animate-slide-up overflow-hidden rounded-xl"
          style={{
            background: "rgba(22,22,30,0.8)",
            border: "1px solid rgba(255,255,255,0.05)",
            backdropFilter: "blur(12px)",
          }}
        >
          <table className="w-full text-sm">
            <thead>
              <tr
                style={{
                  borderBottom: "1px solid rgba(255,255,255,0.05)",
                }}
              >
                {["Player", "ACS", "K", "D", "A", "K/D", "FK", "FD"].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-[10px] font-black uppercase tracking-[0.25em]"
                      style={{ color: "rgba(236,232,225,0.2)" }}
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {/* Team 1 header */}
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-2"
                  style={{
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                    background: team1Won
                      ? "rgba(74,230,138,0.03)"
                      : "rgba(255,70,85,0.02)",
                  }}
                >
                  <div className="flex items-center gap-2">
                    {team1Logo && (
                      <img
                        src={team1Logo}
                        alt={team1Tag}
                        className="h-4 w-4 object-contain"
                      />
                    )}
                    <span
                      className="text-[10px] font-black uppercase tracking-[0.2em]"
                      style={{
                        color: team1Won
                          ? "rgba(74,230,138,0.7)"
                          : "rgba(255,70,85,0.5)",
                      }}
                    >
                      {team1Name}
                      {team1Won && " -- WINNER"}
                    </span>
                  </div>
                </td>
              </tr>
              {team1Stats
                .sort((a, b) => b.acs - a.acs)
                .map((entry) => (
                  <ScoreboardRow
                    key={entry.playerId}
                    entry={entry}
                    isMvp={entry.playerId === mvp?.playerId}
                  />
                ))}
              {/* Team 2 header */}
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-2"
                  style={{
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                    borderTop: "1px solid rgba(255,255,255,0.04)",
                    background: !team1Won
                      ? "rgba(74,230,138,0.03)"
                      : "rgba(255,70,85,0.02)",
                  }}
                >
                  <div className="flex items-center gap-2">
                    {team2Logo && (
                      <img
                        src={team2Logo}
                        alt={team2Tag}
                        className="h-4 w-4 object-contain"
                      />
                    )}
                    <span
                      className="text-[10px] font-black uppercase tracking-[0.2em]"
                      style={{
                        color: !team1Won
                          ? "rgba(74,230,138,0.7)"
                          : "rgba(255,70,85,0.5)",
                      }}
                    >
                      {team2Name}
                      {!team1Won && " -- WINNER"}
                    </span>
                  </div>
                </td>
              </tr>
              {team2Stats
                .sort((a, b) => b.acs - a.acs)
                .map((entry) => (
                  <ScoreboardRow
                    key={entry.playerId}
                    entry={entry}
                    isMvp={entry.playerId === mvp?.playerId}
                  />
                ))}
            </tbody>
          </table>
        </div>

        {/* Highlights */}
        {mapResult.highlights.length > 0 && (
          <div
            className="vct-animate-slide-up mt-6 rounded-xl p-5"
            style={{
              background: "rgba(22,22,30,0.6)",
              border: "1px solid rgba(255,255,255,0.04)",
            }}
          >
            <div
              className="mb-3 text-[10px] font-black uppercase tracking-[0.25em]"
              style={{ color: "rgba(236,232,225,0.2)" }}
            >
              Match Highlights
            </div>
            <ul className="space-y-2.5">
              {mapResult.highlights.map((highlight, i) => (
                <li
                  key={i}
                  className="flex items-start gap-3 text-sm"
                  style={{ color: "rgba(236,232,225,0.5)" }}
                >
                  <span
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: C.red }}
                  />
                  {highlight.text}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Next button */}
        <div className="mt-8 flex flex-col items-center gap-3 pb-8">
          {isMatchPoint && !isSeriesDecided && (
            <div
              className="vct-animate-scale rounded-full px-6 py-1.5 text-xs font-black uppercase tracking-[0.3em]"
              style={{
                background: "rgba(255,70,85,0.1)",
                color: C.red,
                border: "1px solid rgba(255,70,85,0.2)",
                animation: "vct-pulse-red 2s ease-in-out infinite",
              }}
            >
              Match Point
            </div>
          )}
          <button
            onClick={onNext}
            className="group relative overflow-hidden rounded-xl px-14 py-4 transition-all duration-500 hover:scale-105"
            style={{
              background: C.red,
              color: C.white,
              boxShadow: "0 0 30px rgba(255,70,85,0.25)",
            }}
          >
            <div
              className="absolute inset-0 overflow-hidden"
              style={{
                background:
                  "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%)",
                animation: "vct-glow-sweep 2s ease infinite",
              }}
            />
            <span className="relative flex items-center gap-3 text-base font-black uppercase tracking-[0.2em]">
              {isSeriesDecided ? "Match Complete" : "Next Map"}
              {!isSeriesDecided && (
                <svg
                  className="h-5 w-5 transition-transform duration-300 group-hover:translate-x-1"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13 7l5 5m0 0l-5 5m5-5H6"
                  />
                </svg>
              )}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ── Scoreboard row ──
// ══════════════════════════════════════════════════════════════

function ScoreboardRow({
  entry,
  isMvp,
}: {
  entry: PlayerStat;
  isMvp: boolean;
}) {
  const kd =
    entry.deaths > 0 ? entry.kills / entry.deaths : entry.kills;

  return (
    <tr
      style={{
        borderBottom: "1px solid rgba(255,255,255,0.02)",
        background: isMvp
          ? "rgba(198,155,58,0.04)"
          : "transparent",
        transition: "background 0.2s",
      }}
    >
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className="font-bold"
            style={{ color: C.white }}
          >
            {entry.ign}
          </span>
          {isMvp && (
            <span
              className="rounded px-2 py-0.5 text-[8px] font-black uppercase tracking-wider"
              style={{
                background: "rgba(198,155,58,0.12)",
                color: C.gold,
                border: "1px solid rgba(198,155,58,0.25)",
              }}
            >
              MVP
            </span>
          )}
        </div>
      </td>
      <td
        className="px-4 py-2.5 font-bold"
        style={{ color: C.white }}
      >
        {formatStat(entry.acs, 0)}
      </td>
      <td className="px-4 py-2.5" style={{ color: C.green }}>
        {entry.kills}
      </td>
      <td className="px-4 py-2.5" style={{ color: C.red }}>
        {entry.deaths}
      </td>
      <td
        className="px-4 py-2.5"
        style={{ color: "rgba(236,232,225,0.4)" }}
      >
        {entry.assists}
      </td>
      <td
        className="px-4 py-2.5"
        style={{ color: "rgba(236,232,225,0.4)" }}
      >
        {formatStat(kd, 2)}
      </td>
      <td
        className="px-4 py-2.5"
        style={{ color: "rgba(236,232,225,0.4)" }}
      >
        {entry.fk}
      </td>
      <td
        className="px-4 py-2.5"
        style={{ color: "rgba(236,232,225,0.4)" }}
      >
        {entry.fd}
      </td>
    </tr>
  );
}

// ══════════════════════════════════════════════════════════════
// ── Final Phase ──
// ══════════════════════════════════════════════════════════════

function FinalPhase({
  team1Name,
  team1Tag,
  team1Logo,
  team2Name,
  team2Tag,
  team2Logo,
  seriesScore,
  winsNeeded,
  mapResults,
  mapLineup,
  matchId,
  router,
}: {
  team1Name: string;
  team1Tag: string;
  team1Logo: string;
  team2Name: string;
  team2Tag: string;
  team2Logo: string;
  seriesScore: { team1: number; team2: number };
  winsNeeded: number;
  mapResults: MapResultData[];
  mapLineup: MapEntry[];
  matchId: string;
  router: ReturnType<typeof useRouter>;
}) {
  const team1Won = seriesScore.team1 >= winsNeeded;
  const winnerName = team1Won ? team1Name : team2Name;
  const winnerLogo = team1Won ? team1Logo : team2Logo;

  // Confetti particles
  const confettiParticles = Array.from({ length: 30 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 4,
    duration: 3 + Math.random() * 4,
    size: 3 + Math.random() * 5,
  }));

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden">
      <GlobalStyles />

      {/* Dark base */}
      <div className="fixed inset-0" style={{ background: C.bg }} />

      {/* Radial gold glow */}
      <div
        className="fixed inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 45%, rgba(198,155,58,0.1) 0%, transparent 70%)",
        }}
      />

      {/* Confetti particles */}
      {confettiParticles.map((p) => (
        <div
          key={p.id}
          className="pointer-events-none fixed"
          style={{
            left: `${p.left}%`,
            top: "-10px",
            width: `${p.size}px`,
            height: `${p.size}px`,
            background:
              p.id % 3 === 0
                ? C.gold
                : p.id % 3 === 1
                  ? "rgba(236,232,225,0.5)"
                  : "rgba(198,155,58,0.4)",
            borderRadius: p.id % 2 === 0 ? "50%" : "1px",
            animation: `vct-confetti ${p.duration}s ${p.delay}s linear infinite`,
            zIndex: 5,
          }}
        />
      ))}

      <div className="relative z-10 flex flex-col items-center gap-8 px-8">
        {/* Winner announcement */}
        <div className="text-center">
          <div
            className="vct-animate-fade text-xs font-bold uppercase tracking-[0.5em]"
            style={{ color: "rgba(236,232,225,0.25)" }}
          >
            Series Complete
          </div>

          {winnerLogo && (
            <div
              className="vct-animate-scale mx-auto mt-8 flex h-32 w-32 items-center justify-center overflow-hidden rounded-2xl"
              style={{
                background: "rgba(255,255,255,0.05)",
                border: "2px solid rgba(198,155,58,0.2)",
                animation: "vct-pulse-gold 2.5s ease-in-out infinite",
              }}
            >
              <img
                src={winnerLogo}
                alt={winnerName}
                className="h-20 w-20 object-contain"
              />
            </div>
          )}

          <div
            className="vct-animate-slide-up mt-6 text-6xl font-black uppercase tracking-wider"
            style={{
              color: C.white,
              textShadow: "0 4px 24px rgba(0,0,0,0.5)",
            }}
          >
            {winnerName}
          </div>
          <div
            className="vct-animate-slide-up mt-3 text-2xl font-black uppercase tracking-[0.4em]"
            style={{
              color: C.gold,
              textShadow: "0 2px 16px rgba(198,155,58,0.3)",
              animationDelay: "0.15s",
            }}
          >
            WINS
          </div>

          {/* Series score with team logos */}
          <div
            className="vct-animate-slide-up mt-8 flex items-center justify-center gap-8"
            style={{ animationDelay: "0.3s" }}
          >
            <div className="flex items-center gap-3">
              {team1Logo && (
                <div
                  className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg"
                  style={{ background: "rgba(255,255,255,0.05)" }}
                >
                  <img
                    src={team1Logo}
                    alt={team1Tag}
                    className="h-7 w-7 object-contain"
                  />
                </div>
              )}
              <span
                className="text-lg font-black uppercase"
                style={{ color: "rgba(236,232,225,0.5)" }}
              >
                {team1Tag}
              </span>
            </div>

            <div className="flex items-center gap-4">
              <span
                className="text-5xl font-black tabular-nums"
                style={{
                  color: team1Won ? C.white : "rgba(236,232,225,0.25)",
                  textShadow: team1Won
                    ? "0 0 20px rgba(198,155,58,0.3)"
                    : "none",
                }}
              >
                {seriesScore.team1}
              </span>
              <span
                className="text-2xl font-black"
                style={{ color: "rgba(236,232,225,0.1)" }}
              >
                :
              </span>
              <span
                className="text-5xl font-black tabular-nums"
                style={{
                  color: !team1Won ? C.white : "rgba(236,232,225,0.25)",
                  textShadow: !team1Won
                    ? "0 0 20px rgba(198,155,58,0.3)"
                    : "none",
                }}
              >
                {seriesScore.team2}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <span
                className="text-lg font-black uppercase"
                style={{ color: "rgba(236,232,225,0.5)" }}
              >
                {team2Tag}
              </span>
              {team2Logo && (
                <div
                  className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg"
                  style={{ background: "rgba(255,255,255,0.05)" }}
                >
                  <img
                    src={team2Logo}
                    alt={team2Tag}
                    className="h-7 w-7 object-contain"
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Mini map result cards */}
        <div
          className="vct-animate-slide-up flex gap-4"
          style={{ animationDelay: "0.45s" }}
        >
          {mapResults.map((result, i) => {
            const mapEntry = mapLineup[i];
            const t1Won = result.score1 > result.score2;

            return (
              <div
                key={i}
                className="w-48 overflow-hidden rounded-xl"
                style={{
                  background: "rgba(22,22,30,0.8)",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}
              >
                <div className="relative h-24">
                  <div
                    className="absolute inset-0 bg-cover bg-center"
                    style={{
                      backgroundImage: `url(${getMapImage(mapEntry?.mapName ?? result.map)})`,
                    }}
                  />
                  <div
                    className="absolute inset-0"
                    style={{ background: "rgba(0,0,0,0.55)" }}
                  />
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <div
                      className="text-[9px] font-bold uppercase tracking-[0.3em]"
                      style={{ color: "rgba(236,232,225,0.35)" }}
                    >
                      Map {i + 1}
                    </div>
                    <div
                      className="mt-1 text-sm font-black uppercase tracking-wider"
                      style={{
                        color: C.white,
                        textShadow: "0 2px 8px rgba(0,0,0,0.5)",
                      }}
                    >
                      {mapEntry?.mapName ?? result.map}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-center gap-3 py-4">
                  <span
                    className="text-xl font-black tabular-nums"
                    style={{
                      color: t1Won ? C.green : "rgba(236,232,225,0.25)",
                    }}
                  >
                    {result.score1}
                  </span>
                  <span
                    className="text-sm"
                    style={{ color: "rgba(236,232,225,0.1)" }}
                  >
                    :
                  </span>
                  <span
                    className="text-xl font-black tabular-nums"
                    style={{
                      color: !t1Won ? C.green : "rgba(236,232,225,0.25)",
                    }}
                  >
                    {result.score2}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div
          className="vct-animate-slide-up flex gap-5 pt-4"
          style={{ animationDelay: "0.6s" }}
        >
          <button
            onClick={() => router.push(`/match/${matchId}`)}
            className="group relative overflow-hidden rounded-xl px-10 py-4 transition-all duration-500 hover:scale-105"
            style={{
              background: C.red,
              color: C.white,
              boxShadow: "0 0 25px rgba(255,70,85,0.25)",
            }}
          >
            <div
              className="absolute inset-0 overflow-hidden"
              style={{
                background:
                  "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%)",
                animation: "vct-glow-sweep 2s ease infinite",
              }}
            />
            <span className="relative text-sm font-black uppercase tracking-[0.15em]">
              View Full Match Details
            </span>
          </button>
          <button
            onClick={() => router.push("/dashboard")}
            className="rounded-xl px-10 py-4 text-sm font-bold uppercase tracking-[0.15em] transition-all duration-300 hover:scale-105"
            style={{
              background: "rgba(255,255,255,0.04)",
              color: "rgba(236,232,225,0.45)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
