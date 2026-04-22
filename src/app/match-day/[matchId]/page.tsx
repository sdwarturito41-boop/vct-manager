"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";

import { trpc } from "@/lib/trpc-client";
import { getMapImage } from "@/constants/maps";
import { VALORANT_AGENTS } from "@/constants/agents";
import type { ValorantAgent } from "@/constants/agents";
import { formatStat } from "@/lib/format";
import RoundByRoundScreen, {
  type RoundData as RBRRoundData,
  type PlayerStats as RBRPlayerStats,
  type Player as RBRPlayer,
  type EcoType as RBREcoType,
} from "@/components/RoundByRoundScreen";

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

interface RoundEventDetail {
  type: "clutch" | "ace" | "eco_win" | "first_blood" | "momentum_break" | "defuse_clutch" | "flawless";
  text: string;
  playerIgn?: string;
  weight: number;
  clutchSize?: string;
}

interface RoundKillEvent {
  killerId: string;
  victimId: string;
  assistIds: string[];
  isFirstKill: boolean;
  timing: number;
}

interface PlayerLoadoutSnapshot {
  playerId: string;
  weapon: string;
  armor: "heavy" | "light" | "none";
  creditsAfterBuy: number;
  fromPickup: boolean;
}

interface RoundEvent {
  round: number;
  winner: 1 | 2;
  half: 1 | 2 | "OT";
  score1: number;
  score2: number;
  team1Buy: "pistol" | "eco" | "force" | "half" | "full";
  team2Buy: "pistol" | "eco" | "force" | "half" | "full";
  team1Budget: number;
  team2Budget: number;
  event: RoundEventDetail | null;
  kills?: RoundKillEvent[];
  loadouts?: PlayerLoadoutSnapshot[];
  plantTime?: number | null;
  spikeDefused?: boolean;
}

// ── Phase state machine ──

type Phase =
  | "VETO"
  | "SIDE_SELECT"
  | "AGENTS"
  | "SIMULATING"
  | "LIVE"
  | "RESULT"
  | "TIMEOUT"
  | "FINAL";

interface TimeoutBonus {
  type: "tactical" | "motivational" | "medical" | "skip";
  counterBonusDelta?: number;
  teamplayDelta?: number;
  resetVariancePlayerId?: string;
}

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
  surface: "#12121a",
  red: "#FF4655",
  white: "#ECE8E1",
  gold: "#C69B3A",
  green: "#4AE68A",
  gray: "#383844",
  team1: "#FF4655",
  team2: "#4A90D9",
} as const;

const BUY_COLORS: Record<string, string> = {
  full: "#4AE68A",
  half: "#C69B3A",
  force: "#FF8C42",
  eco: "#FF4655",
  pistol: "#ECE8E1",
};

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
      @keyframes vct-live-card-in {
        from { opacity: 0; transform: translateY(20px) scale(0.95); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes vct-live-card-out {
        from { opacity: 1; transform: translateY(0) scale(1); }
        to { opacity: 0; transform: translateY(-10px) scale(0.98); }
      }
      @keyframes vct-live-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(255,70,85,0.5); }
        50% { box-shadow: 0 0 12px 4px rgba(255,70,85,0.3); }
      }
      @keyframes vct-live-score-pop {
        0% { transform: scale(1); }
        50% { transform: scale(1.15); }
        100% { transform: scale(1); }
      }
      @keyframes vct-overlay-in {
        from { opacity: 0; transform: scale(0.8); }
        to { opacity: 1; transform: scale(1); }
      }
      @keyframes vct-match-point-pulse {
        0%, 100% { opacity: 0.7; }
        50% { opacity: 1; }
      }
      @keyframes vct-event-glow {
        0%, 100% { text-shadow: 0 0 10px currentColor; }
        50% { text-shadow: 0 0 25px currentColor, 0 0 50px currentColor; }
      }
      @keyframes vct-ban-x {
        from { opacity: 0; transform: scale(0.3) rotate(-10deg); }
        to { opacity: 1; transform: scale(1) rotate(0deg); }
      }
      @keyframes vct-winner-glow {
        0%, 100% { filter: drop-shadow(0 0 20px rgba(198,155,58,0.3)); }
        50% { filter: drop-shadow(0 0 40px rgba(198,155,58,0.6)); }
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
  const { data: teamMapStats } = trpc.player.teamMapStats.useQuery(undefined, { retry: false });
  const masteryPlayerIds = (teamMapStats?.players ?? []).map((p: { id: string }) => p.id);
  const { data: agentMasteryData } = trpc.player.agentMastery.useQuery(
    { playerIds: masteryPlayerIds },
    { enabled: masteryPlayerIds.length > 0 }
  );
  const { data: winProbs } = trpc.veto.mapWinProbabilities.useQuery(
    { matchId },
    { enabled: !!matchId }
  );

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
  const [selectingPlayerId, setSelectingPlayerId] = useState<string | null>(null);
  const [showLockedComp, setShowLockedComp] = useState(false);
  const [phaseTransition, setPhaseTransition] = useState(false);
  const [timeoutBonus, setTimeoutBonus] = useState<TimeoutBonus | null>(null);
  const [timeoutApplied, setTimeoutApplied] = useState(false);

  // ── LIVE phase state ──
  const [liveRounds, setLiveRounds] = useState<RoundEvent[]>([]);
  const [displayedRoundCount, setDisplayedRoundCount] = useState(0);
  const [liveOverlay, setLiveOverlay] = useState<string | null>(null);
  const liveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [timeoutUsedThisHalf, setTimeoutUsedThisHalf] = useState(false);

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

  const activePlayers = ((roster ?? []) as Array<{ id: string; ign: string; role: string; imageUrl: string | null; isActive: boolean }>).filter((p) => p.isActive).slice(0, 5);
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
    const newPicks = { ...agentPicks, [playerId]: agentName };
    setAgentPicks(newPicks);
    setExpandedPlayerId(null);
    // Auto-advance to next unassigned player
    const nextUnassigned = activePlayers.find((p) => p.id !== playerId && !newPicks[p.id]);
    setSelectingPlayerId(nextUnassigned?.id ?? null);
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

    // Brief pause then show broadcast comp screen
    await new Promise((r) => setTimeout(r, 600));
    setShowLockedComp(true);
    setEnemyRevealed(true);

    // Staggered reveal of enemy agents
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 350));
      setEnemyRevealIndex(i);
    }

    // Hold the comp screen for 2.5s so user can see it
    await new Promise((r) => setTimeout(r, 2500));
    setShowLockedComp(false);

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

      // Store rounds for LIVE phase and transition
      const rounds = (result as { rounds?: RoundEvent[] }).rounds ?? [];
      setLiveRounds(rounds);
      setDisplayedRoundCount(0);
      setLiveOverlay(null);

      await new Promise((r) => setTimeout(r, 600));
      transitionTo("LIVE");
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
    // Go to TIMEOUT between maps instead of directly to AGENTS
    setTimeoutBonus(null);
    setTimeoutApplied(false);
    transitionTo("TIMEOUT");
  }

  // ── Timeout: apply chosen option and proceed to AGENTS ──
  function handleTimeoutChoice(choice: TimeoutBonus) {
    setTimeoutBonus(choice);
    setTimeoutApplied(true);
    setTimeout(() => {
      const nextIdx = currentMapIndex + 1;
      setCurrentMapIndex(nextIdx);
      setAgentPicks({});
      setExpandedPlayerId(null);
      setEnemyRevealed(false);
      setEnemyRevealIndex(-1);
      setLockedIn(false);
      transitionTo("AGENTS");
    }, 1200);
  }

  // ── Timeout availability helpers ──
  function didPlayerTeamLosePreviousMap(): boolean {
    const lastResult = mapResults[currentMapIndex];
    if (!lastResult) return false;
    const playerIsTeam1 = isTeam1;
    const playerWon = playerIsTeam1
      ? lastResult.score1 > lastResult.score2
      : lastResult.score2 > lastResult.score1;
    return !playerWon;
  }

  function getWorstPerformingPlayer(): PlayerStat | null {
    const lastResult = mapResults[currentMapIndex];
    if (!lastResult) return null;
    const playerTeamId = isTeam1 ? team1Id : team2Id;
    const teamStats = lastResult.playerStats.filter(
      (p) => p.teamId === playerTeamId
    );
    const worst = teamStats.reduce<PlayerStat | null>((acc, p) => {
      const kd = p.deaths > 0 ? p.kills / p.deaths : p.kills;
      if (kd < 0.5) {
        if (!acc) return p;
        const accKd = acc.deaths > 0 ? acc.kills / acc.deaths : acc.kills;
        return kd < accKd ? p : acc;
      }
      return acc;
    }, null);
    return worst;
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

  // Legacy LIVE auto-advance removed — RoundByRoundScreen drives its own pacing.

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

  // ── Helper: get buy state label/color ──
  function getBuyLabel(buy: string): { label: string; color: string } {
    const labels: Record<string, string> = {
      full: "FULL BUY", half: "HALF BUY", force: "FORCE", eco: "ECO", pistol: "PISTOL",
    };
    return { label: labels[buy] ?? buy.toUpperCase(), color: BUY_COLORS[buy] ?? C.white };
  }

  // ── Helper: get round event label for LIVE feed ──
  function getRoundLabel(r: RoundEvent): { text: string; color: string; accent: boolean; badge?: string } {
    const winnerTag = r.winner === 1 ? team1Tag : team2Tag;
    const isPistol = r.team1Buy === "pistol" || r.team2Buy === "pistol";

    if (r.event) {
      switch (r.event.type) {
        case "clutch":
          return {
            text: `${r.event.playerIgn ?? winnerTag} wins a ${r.event.clutchSize ?? "1vX"}`,
            color: C.gold,
            accent: true,
            badge: "CLUTCH",
          };
        case "ace":
          return {
            text: `${r.event.playerIgn ?? winnerTag} takes all five`,
            color: "#E74C3C",
            accent: true,
            badge: "ACE",
          };
        case "eco_win":
          return {
            text: `${winnerTag} force buy succeeds`,
            color: C.green,
            accent: true,
            badge: "ECO WIN",
          };
        case "flawless":
          return {
            text: `${winnerTag} perfect round`,
            color: "#9B59B6",
            accent: true,
            badge: "FLAWLESS",
          };
        case "first_blood":
          return {
            text: `${r.event.playerIgn ?? winnerTag} opens with first blood`,
            color: "#E67E22",
            accent: true,
            badge: "FIRST BLOOD",
          };
        case "momentum_break":
          return {
            text: r.event.text,
            color: "#3498DB",
            accent: true,
            badge: "STREAK BROKEN",
          };
        case "defuse_clutch":
          return {
            text: `${r.event.playerIgn ?? winnerTag} clutch defuse`,
            color: "#1ABC9C",
            accent: true,
            badge: "DEFUSE CLUTCH",
          };
      }
    }

    if (isPistol) {
      return {
        text: `${winnerTag} wins`,
        color: C.white,
        accent: true,
        badge: "PISTOL",
      };
    }

    return {
      text: `${winnerTag} wins`,
      color: "rgba(236,232,225,0.6)",
      accent: false,
    };
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

      {/* ================================================================ */}
      {/* ─── VETO PHASE ─── Full-screen immersive                         */}
      {/* ================================================================ */}
      {(phase === "VETO" || phase === "SIDE_SELECT") && (
        <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden" style={{ background: "#0a0a14" }}>
          {/* Background ambient glow */}
          <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 80% 50% at 50% 50%, rgba(255,70,85,0.04) 0%, transparent 70%)" }} />

          {/* ── Title ── */}
          <div className="vct-animate-fade relative z-10 mb-2 text-center">
            <h1 className="text-4xl font-black uppercase tracking-[0.4em]" style={{ color: C.white }}>MAP VETO</h1>
            <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.5em]" style={{ color: "rgba(236,232,225,0.2)" }}>
              BEST OF {format === "BO5" ? "5" : "3"} · {team1Tag} vs {team2Tag}
            </p>
          </div>

          {/* ── Map cards — all 7, tall portrait, directly clickable ── */}
          {phase === "VETO" && (
            <div className="relative z-10 flex w-full flex-col items-center px-6">

              {/* Cards row */}
              <div className="my-8 flex w-full max-w-[1400px] gap-3" style={{ height: "min(58vh, 520px)" }}>
                {mapPool.map((mapName) => {
                  const isBanned = bannedMaps.includes(mapName);
                  const isPicked = pickedMaps.includes(mapName);
                  const isAvail = availableMaps.includes(mapName);
                  const isDecider = !isBanned && !isPicked && availableMaps.length === 1 && availableMaps[0] === mapName && vetoStep >= vetoSequence.length;
                  const canSelect = isPlayerVetoTurn && isAvail && !aiThinking && !isDecider;
                  const whoActed = vetoActions.find((a) => a.map === mapName);

                  return (
                    <button
                      key={mapName}
                      onClick={() => canSelect && handleVetoSelect(mapName)}
                      disabled={!canSelect}
                      className="group relative flex-1 overflow-hidden rounded-xl transition-all duration-500"
                      style={{
                        cursor: canSelect ? "pointer" : "default",
                        border: isPicked
                          ? `2px solid ${C.green}`
                          : isDecider
                            ? `2px solid ${C.gold}`
                            : canSelect
                              ? "2px solid rgba(255,255,255,0.1)"
                              : "2px solid rgba(255,255,255,0.04)",
                        opacity: isBanned ? 0.35 : 1,
                        filter: isBanned ? "saturate(0.1) brightness(0.45)" : "none",
                      }}
                    >
                      {/* Map image */}
                      <div className="absolute inset-0 bg-cover bg-center transition-transform duration-700 group-hover:scale-110" style={{ backgroundImage: `url(${getMapImage(mapName)})` }} />
                      <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.15) 50%, rgba(0,0,0,0.05) 100%)" }} />

                      {/* Hover glow */}
                      {canSelect && (
                        <>
                          <div className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100" style={{ background: currentStepInfo?.type === "ban" ? "rgba(255,70,85,0.12)" : "rgba(74,230,138,0.1)" }} />
                          <div className="absolute inset-x-0 top-0 h-[2px] opacity-0 transition-opacity duration-300 group-hover:opacity-100" style={{ background: currentStepInfo?.type === "ban" ? C.red : C.green }} />
                        </>
                      )}

                      {/* BAN overlay — prohibition circle like VCT broadcast */}
                      {isBanned && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
                          <svg width="72" height="72" viewBox="0 0 72 72" style={{ opacity: 0.65 }}>
                            <circle cx="36" cy="36" r="28" stroke={C.red} strokeWidth="4" fill="none" />
                            <line x1="16" y1="56" x2="56" y2="16" stroke={C.red} strokeWidth="4" strokeLinecap="round" />
                          </svg>
                          {whoActed && (
                            <span className="text-[9px] font-bold uppercase tracking-[0.15em]" style={{ color: "rgba(255,70,85,0.5)" }}>
                              {whoActed.team === "team1" ? team1Tag : team2Tag}
                            </span>
                          )}
                        </div>
                      )}

                      {/* PICK overlay */}
                      {isPicked && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: "rgba(74,230,138,0.05)" }}>
                          <span className="rounded px-4 py-1.5 text-xs font-black uppercase tracking-[0.2em]" style={{ background: "rgba(74,230,138,0.15)", color: C.green, border: "1px solid rgba(74,230,138,0.3)" }}>
                            PICKED
                          </span>
                          {whoActed && (
                            <span className="mt-2 text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: "rgba(74,230,138,0.5)" }}>
                              {whoActed.team === "team1" ? team1Tag : team2Tag}
                            </span>
                          )}
                        </div>
                      )}

                      {/* DECIDER overlay */}
                      {isDecider && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ background: "rgba(198,155,58,0.05)" }}>
                          <span className="rounded px-4 py-1.5 text-xs font-black uppercase tracking-[0.2em]" style={{ background: "rgba(198,155,58,0.15)", color: C.gold, border: "1px solid rgba(198,155,58,0.3)" }}>
                            DECIDER
                          </span>
                        </div>
                      )}

                      {/* Map name + win% at bottom */}
                      <div className="absolute inset-x-0 bottom-0 px-4 pb-4 pt-10">
                        <div className="text-lg font-black uppercase tracking-wider" style={{ color: C.white, textShadow: "0 2px 12px rgba(0,0,0,0.9)" }}>
                          {mapName}
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          {teamMapStats && (() => {
                            const players = (teamMapStats.players ?? []) as Array<{ id: string; mapFactors: unknown }>;
                            let strong = 0, weak = 0;
                            for (const p of players) {
                              const factors = (p.mapFactors ?? {}) as Record<string, number>;
                              const f = factors[mapName] ?? 0.8;
                              if (f >= 1.08) strong++;
                              if (f <= 0.89) weak++;
                            }
                            const label = strong >= 3 ? "STRONG" : weak >= 3 ? "WEAK" : strong >= 2 ? "GOOD" : weak >= 2 ? "RISKY" : "NEUTRAL";
                            const dotColor = strong >= 3 ? C.green : weak >= 3 ? C.red : strong >= 2 ? "#4AE68A" : weak >= 2 ? C.gold : "rgba(236,232,225,0.3)";
                            return (
                              <>
                                <div className="h-2 w-2 rounded-full" style={{ background: dotColor }} />
                                <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: dotColor }}>{label}</span>
                              </>
                            );
                          })()}
                          {winProbs && (() => {
                            const wp = winProbs[mapName] ?? 50;
                            const wpColor = wp >= 55 ? C.green : wp <= 45 ? C.red : "rgba(236,232,225,0.5)";
                            return <span className="text-sm font-black tabular-nums" style={{ color: wpColor }}>{wp}%</span>;
                          })()}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* ── Bottom: instruction or AI thinking ── */}
              {!aiThinking && isPlayerVetoTurn && currentStepInfo && (
                <div className="vct-animate-fade flex flex-col items-center gap-3">
                  <p className="text-sm font-medium" style={{ color: "rgba(236,232,225,0.45)" }}>
                    Select the Map you want to{" "}
                    <span className="font-black uppercase" style={{ color: currentStepInfo.type === "ban" ? C.red : C.green }}>
                      {currentStepInfo.type}
                    </span>
                  </p>
                  <div className="rounded-lg px-10 py-3 text-sm font-black uppercase tracking-[0.25em]"
                    style={{ background: currentStepInfo.type === "ban" ? "rgba(255,70,85,0.08)" : "rgba(74,230,138,0.08)", border: `1px solid ${currentStepInfo.type === "ban" ? "rgba(255,70,85,0.25)" : "rgba(74,230,138,0.25)"}`, color: currentStepInfo.type === "ban" ? C.red : C.green }}>
                    SELECT MAP TO {currentStepInfo.type.toUpperCase()}
                  </div>
                </div>
              )}

              {aiThinking && (
                <div className="vct-animate-fade flex items-center gap-3">
                  <div className="flex gap-1.5">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="h-2 w-2 rounded-full" style={{ background: C.red, animation: `vct-dot-bounce 1.4s ${i * 0.16}s infinite both` }} />
                    ))}
                  </div>
                  <span className="text-sm font-semibold" style={{ color: "rgba(236,232,225,0.35)" }}>
                    {enemyTeamName} is {currentStepInfo?.type === "ban" ? "banning" : "picking"}...
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ── Side Select Overlay ── */}
          {phase === "SIDE_SELECT" && pendingSideForMap && pendingSideForMap.pickedBy !== playerSide && (
            <div className="vct-animate-fade relative z-20 flex flex-1 flex-col items-center justify-center gap-10 px-8">
              {/* Map preview */}
              <div className="relative w-full max-w-3xl overflow-hidden rounded-xl" style={{ aspectRatio: "21/9" }}>
                <div className="absolute inset-0 bg-cover bg-center vct-animate-zoom" style={{ backgroundImage: `url(${getMapImage(pendingSideForMap.mapName)})` }} />
                <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, rgba(10,10,15,0.3) 0%, rgba(10,10,15,0.85) 100%)" }} />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-[10px] font-bold uppercase tracking-[0.4em]" style={{ color: "rgba(236,232,225,0.3)" }}>
                    {enemyTeamName} picked
                  </span>
                  <span className="mt-2 text-5xl font-black uppercase tracking-wider" style={{ color: C.white, textShadow: "0 4px 20px rgba(0,0,0,0.5)" }}>
                    {pendingSideForMap.mapName}
                  </span>
                  <span className="mt-4 text-xs font-semibold uppercase tracking-[0.25em]" style={{ color: "rgba(236,232,225,0.35)" }}>
                    Choose your starting side
                  </span>
                </div>
              </div>
              {/* Side buttons */}
              <div className="flex gap-6">
                <button
                  onClick={() => handleSideSelect("attack")}
                  className="group relative overflow-hidden rounded-xl px-16 py-8 transition-all duration-500 hover:scale-105"
                  style={{ background: "linear-gradient(135deg, rgba(255,100,70,0.06) 0%, rgba(255,60,40,0.12) 100%)", border: "2px solid rgba(255,100,70,0.25)" }}
                >
                  <div className="absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100" style={{ background: "linear-gradient(135deg, rgba(255,100,70,0.12) 0%, rgba(255,60,40,0.2) 100%)" }} />
                  <div className="relative text-center">
                    <div className="text-[10px] font-bold uppercase tracking-[0.4em]" style={{ color: "rgba(255,120,80,0.4)" }}>Starting Side</div>
                    <div className="mt-2 text-3xl font-black uppercase tracking-wider" style={{ color: "#FF7850" }}>ATTACK</div>
                  </div>
                </button>
                <button
                  onClick={() => handleSideSelect("defense")}
                  className="group relative overflow-hidden rounded-xl px-16 py-8 transition-all duration-500 hover:scale-105"
                  style={{ background: "linear-gradient(135deg, rgba(60,200,180,0.06) 0%, rgba(40,180,160,0.12) 100%)", border: "2px solid rgba(60,200,180,0.25)" }}
                >
                  <div className="absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100" style={{ background: "linear-gradient(135deg, rgba(60,200,180,0.12) 0%, rgba(40,180,160,0.2) 100%)" }} />
                  <div className="relative text-center">
                    <div className="text-[10px] font-bold uppercase tracking-[0.4em]" style={{ color: "rgba(60,200,180,0.4)" }}>Starting Side</div>
                    <div className="mt-2 text-3xl font-black uppercase tracking-wider" style={{ color: "#3CC8B4" }}>DEFENSE</div>
                  </div>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* ─── AGENTS PHASE ─── In-game style + VCT broadcast after lock   */}
      {/* ================================================================ */}
      {phase === "AGENTS" && currentMap && (
        <div className="relative min-h-screen">
          {/* Background map - blurred */}
          <div className="fixed inset-0 bg-cover bg-center vct-animate-zoom" style={{ backgroundImage: `url(${getMapImage(currentMap.mapName)})`, filter: "blur(30px) brightness(0.12) saturate(0.5)" }} />
          <div className="fixed inset-0" style={{ background: "rgba(10,10,15,0.82)" }} />

          {/* ═══ LOCKED-IN COMP VIEW — VCT Broadcast Style (capture 2) ═══ */}
          {showLockedComp ? (
            <div className="relative z-10 flex min-h-screen flex-col items-center justify-center">
              {/* Top bar: DEFENDERS label — map — ATTACKERS label */}
              <div className="vct-animate-fade flex w-full max-w-5xl items-center justify-between px-8">
                <div className="flex flex-col items-center gap-2">
                  <span className="text-xs font-black uppercase tracking-[0.3em]" style={{ color: currentMap.playerSide === "defense" ? "#3CC8B4" : "rgba(236,232,225,0.3)" }}>
                    {currentMap.playerSide === "defense" ? "DEFENDERS" : "ATTACKERS"}
                  </span>
                  {playerTeamLogo && <img src={playerTeamLogo} alt={playerTeamTag} className="h-14 w-14 object-contain" />}
                  <span className="text-lg font-black uppercase tracking-wider" style={{ color: C.white }}>{playerTeamTag}</span>
                </div>

                {/* Center — map preview */}
                <div className="flex flex-col items-center">
                  <span className="text-[10px] font-bold uppercase tracking-[0.4em]" style={{ color: "rgba(236,232,225,0.25)" }}>NEXT MAP</span>
                  <div className="relative mt-2 overflow-hidden rounded-xl" style={{ width: 280, height: 180 }}>
                    <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${getMapImage(currentMap.mapName)})` }} />
                    <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.1) 50%)" }} />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-4xl font-black uppercase tracking-wider" style={{ color: C.white, textShadow: "0 4px 20px rgba(0,0,0,0.8)" }}>
                        {currentMap.mapName}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col items-center gap-2">
                  <span className="text-xs font-black uppercase tracking-[0.3em]" style={{ color: currentMap.playerSide === "attack" ? "#FF7850" : "rgba(236,232,225,0.3)" }}>
                    {currentMap.playerSide === "attack" ? "DEFENDERS" : "ATTACKERS"}
                  </span>
                  {enemyTeamLogo && <img src={enemyTeamLogo} alt={enemyTeamTag} className="h-14 w-14 object-contain" />}
                  <span className="text-lg font-black uppercase tracking-wider" style={{ color: C.white }}>{enemyTeamTag}</span>
                </div>
              </div>

              {/* Agent comp rows — side by side */}
              <div className="mt-10 flex w-full max-w-5xl items-start justify-between px-8">
                {/* Your team agents */}
                <div className="flex gap-3">
                  {activePlayers.map((player, i) => {
                    const agentName = agentPicks[player.id];
                    const agentData = agentName ? VALORANT_AGENTS.find((a) => a.name === agentName) : null;
                    return (
                      <div key={player.id} className="vct-animate-slide-up flex flex-col items-center gap-1.5" style={{ animationDelay: `${i * 100}ms` }}>
                        <div className="h-16 w-16 overflow-hidden rounded-lg" style={{ border: "2px solid rgba(198,155,58,0.4)" }}>
                          {agentData && <img src={agentData.portraitUrl} alt={agentData.name} className="h-full w-full object-cover" />}
                        </div>
                        <span className="text-[9px] font-bold uppercase" style={{ color: C.white }}>{agentName}</span>
                        <span className="text-[8px] font-medium" style={{ color: "rgba(236,232,225,0.3)" }}>{player.ign}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Enemy team agents */}
                <div className="flex gap-3">
                  {[0, 1, 2, 3, 4].map((idx) => {
                    const isRevealed = enemyRevealed && enemyRevealIndex >= idx;
                    const agentName = isRevealed ? enemyAgents[currentMapIndex]?.[idx] : undefined;
                    const agentData = agentName ? VALORANT_AGENTS.find((a) => a.name === agentName) : null;
                    return (
                      <div key={idx} className="flex flex-col items-center gap-1.5 transition-all duration-500" style={{ opacity: isRevealed ? 1 : 0.15 }}>
                        <div className="h-16 w-16 overflow-hidden rounded-lg" style={{ border: isRevealed ? "2px solid rgba(236,232,225,0.3)" : "2px solid rgba(255,255,255,0.06)" }}>
                          {agentData ? (
                            <img src={agentData.portraitUrl} alt={agentData.name} className="vct-animate-scale h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center" style={{ background: "rgba(255,255,255,0.03)" }}>
                              <span style={{ color: "rgba(255,255,255,0.1)" }}>?</span>
                            </div>
                          )}
                        </div>
                        <span className="text-[9px] font-bold uppercase" style={{ color: isRevealed ? C.white : "rgba(236,232,225,0.15)" }}>
                          {agentName ?? "???"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
          /* ═══ AGENT SELECT — Coach Draft Style ═══ */
          <div className="relative z-10 flex h-screen flex-col overflow-hidden">
            {/* Map bg — visible */}
            <div className="pointer-events-none absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${getMapImage(currentMap.mapName)})`, filter: "blur(1.5px) brightness(0.3) saturate(0.7)", transform: "scale(1.02)" }} />
            <div className="pointer-events-none absolute inset-0" style={{ background: "linear-gradient(to bottom, rgba(10,10,15,0.55) 0%, rgba(10,10,15,0.7) 100%)" }} />

            {/* ── Context bar (top) ── */}
            <div className="relative z-10 flex shrink-0 items-center justify-between px-5 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
              {/* Map + side + game */}
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium" style={{ color: C.white }}>{currentMap.mapName}</span>
                <span style={{ color: "rgba(255,255,255,0.15)" }}>·</span>
                <span className="text-sm" style={{ color: currentMap.playerSide === "attack" ? "#FF7850" : "#3CC8B4" }}>
                  {currentMap.playerSide === "attack" ? "Attaque" : "Défense"}
                </span>
                <span style={{ color: "rgba(255,255,255,0.15)" }}>·</span>
                <span className="text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>
                  {format} game {currentMapIndex + 1} · {seriesScore.team1}-{seriesScore.team2}
                </span>
              </div>

              {/* Selecting for */}
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>Sélection pour :</span>
                {(() => {
                  const sp = selectingPlayerId ? activePlayers.find((p) => p.id === selectingPlayerId) : null;
                  const spAgent = sp ? VALORANT_AGENTS.find((a) => a.name === agentPicks[sp.id]) : null;
                  return sp ? (
                    <div className="flex items-center gap-1.5">
                      <div className="flex h-6 w-6 items-center justify-center overflow-hidden rounded" style={{ background: "rgba(255,255,255,0.08)" }}>
                        {sp.imageUrl ? <img src={sp.imageUrl} alt="" className="h-full w-full object-cover" /> : <span className="text-[10px] font-medium" style={{ color: "rgba(255,255,255,0.3)" }}>{sp.ign.charAt(0)}</span>}
                      </div>
                      <span className="text-sm font-medium" style={{ color: C.white }}>{sp.ign}</span>
                    </div>
                  ) : <span className="text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>—</span>;
                })()}
              </div>

              {/* Opponent picks */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.2)" }}>Adversaire</span>
                <div className="flex gap-1">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-5 w-5 rounded" style={{
                      background: i < (enemyRevealed ? 5 : 0) ? "rgba(255,70,85,0.25)" : "transparent",
                      border: i < (enemyRevealed ? 5 : 0) ? "1px solid rgba(255,70,85,0.4)" : "1px dashed rgba(255,255,255,0.1)",
                    }} />
                  ))}
                </div>
              </div>

              {/* Timer placeholder (static for now) */}
              <span className="tabular-nums text-sm font-medium" style={{ color: "rgba(255,255,255,0.4)" }}>0:45</span>
            </div>

            {/* ── Main: agent grid (left) + comp/preview (right 280px) ── */}
            <div className="relative z-10 flex min-h-0 flex-1">

              {/* LEFT — Agent grid grouped by role */}
              <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 py-4" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent" }}>
                {selectingPlayerId ? (
                  (["Duelist", "Initiator", "Controller", "Sentinel"] as const).map((role) => {
                    const agents = VALORANT_AGENTS.filter((a) => a.role === role);
                    if (agents.length === 0) return null;
                    return (
                      <div key={role} className="mb-6">
                        <div className="mb-2.5 text-xs font-medium uppercase tracking-[0.08em]" style={{ color: "rgba(255,255,255,0.3)" }}>{role.toUpperCase()}</div>
                        <div className="flex flex-wrap gap-3">
                          {agents.map((agent) => {
                            const isSelected = agentPicks[selectingPlayerId] === agent.name;
                            const isTaken = !isSelected && pickedAgentNames.includes(agent.name);
                            const takenByPlayer = isTaken ? activePlayers.find((p) => agentPicks[p.id] === agent.name) : null;
                            const isPreviewed = expandedPlayerId === agent.name;

                            const pickedRoles = Object.values(agentPicks).filter(Boolean).map((name) => VALORANT_AGENTS.find((a) => a.name === name)?.role).filter(Boolean);
                            const roleCount = pickedRoles.filter((r) => r === agent.role).length;
                            const synergyColor = roleCount === 0 ? "#22C55E" : roleCount === 1 ? "#F59E0B" : "#EF4444";

                            // Mastery % for selecting player on this agent+map (fallback to avg across all maps)
                            const playerMasteryArr = agentMasteryData?.[selectingPlayerId] ?? [];
                            const mapEntry = playerMasteryArr.find((m: { agentName: string; mapName: string }) => m.agentName === agent.name && m.mapName === currentMap.mapName);
                            const allEntriesForAgent = playerMasteryArr.filter((m: { agentName: string }) => m.agentName === agent.name);
                            const masteryPct = mapEntry
                              ? Math.round((mapEntry.stars / 5) * 100)
                              : allEntriesForAgent.length > 0
                                ? Math.round((allEntriesForAgent.reduce((sum: number, e: { stars: number }) => sum + e.stars, 0) / allEntriesForAgent.length / 5) * 100)
                                : null;
                            const masteryColor = masteryPct !== null ? (masteryPct >= 70 ? "#22C55E" : masteryPct >= 40 ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.3)") : "rgba(255,255,255,0.2)";

                            return (
                              <button
                                key={agent.name}
                                onClick={() => !isTaken && handleAgentPick(selectingPlayerId, agent.name)}
                                onMouseEnter={() => !isTaken && setExpandedPlayerId(agent.name)}
                                onMouseLeave={() => expandedPlayerId === agent.name && setExpandedPlayerId(null)}
                                disabled={isTaken}
                                className="group relative flex flex-col overflow-hidden rounded-xl transition-all duration-150"
                                style={{
                                  width: 110,
                                  border: isPreviewed ? "2px solid rgba(96,165,250,0.7)" : isSelected ? `2px solid ${C.gold}` : "1px solid rgba(255,255,255,0.06)",
                                  background: isPreviewed ? "rgba(96,165,250,0.06)" : isSelected ? "rgba(198,155,58,0.06)" : isTaken ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.03)",
                                  opacity: isTaken ? 0.55 : 1,
                                  cursor: isTaken ? "not-allowed" : "pointer",
                                }}
                              >
                                {/* Portrait */}
                                <div className="relative flex items-center justify-center" style={{ height: 80 }}>
                                  <img src={agent.portraitUrl} alt={agent.name} className="h-full w-full object-cover" />
                                  {!isTaken && (
                                    <div className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full" style={{ background: synergyColor }} />
                                  )}
                                  {!isTaken && !isSelected && !isPreviewed && (
                                    <div className="absolute inset-0 border border-transparent transition-all duration-150 group-hover:border-white/20" />
                                  )}
                                </div>
                                {/* Name + mastery % */}
                                <div className="flex flex-col items-center px-1 py-1.5" style={{ background: "rgba(0,0,0,0.3)" }}>
                                  <span className="text-xs font-medium" style={{ color: C.white }}>{agent.name}</span>
                                  {isTaken && takenByPlayer ? (
                                    <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.3)" }}>pris · {takenByPlayer.ign}</span>
                                  ) : (
                                    <span className="tabular-nums text-[11px] font-medium" style={{ color: masteryColor }}>
                                      {masteryPct !== null ? `${masteryPct}%` : "—"}
                                    </span>
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <span className="text-base font-medium" style={{ color: "rgba(255,255,255,0.15)" }}>
                      Sélectionnez un joueur pour choisir son agent
                    </span>
                  </div>
                )}
              </div>

              {/* RIGHT — Composition + Preview (340px) */}
              <div className="flex w-[340px] shrink-0 flex-col gap-4 overflow-y-auto px-5 py-4" style={{ borderLeft: "1px solid rgba(255,255,255,0.06)" }}>

                {/* ── Composition ── */}
                <div>
                  <div className="mb-3 text-xs font-medium uppercase tracking-[0.08em]" style={{ color: "rgba(255,255,255,0.3)" }}>Composition</div>
                  <div className="flex flex-col gap-1.5">
                    {activePlayers.map((player) => {
                      const pickedAgent = agentPicks[player.id];
                      const agentData = pickedAgent ? VALORANT_AGENTS.find((a) => a.name === pickedAgent) : null;
                      const isActive = selectingPlayerId === player.id;

                      return (
                        <button
                          key={player.id}
                          onClick={() => !lockedIn && setSelectingPlayerId(player.id)}
                          className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all duration-150"
                          style={{
                            background: isActive ? "rgba(96,165,250,0.08)" : "transparent",
                            border: isActive ? "1.5px solid rgba(96,165,250,0.35)" : pickedAgent ? "1px solid rgba(255,255,255,0.06)" : "1px dashed rgba(255,255,255,0.08)",
                          }}
                        >
                          {/* Avatar */}
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg" style={{
                            background: agentData ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.04)",
                            border: agentData ? "none" : "1px dashed rgba(255,255,255,0.1)",
                          }}>
                            {agentData ? (
                              <img src={agentData.portraitUrl} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <span className="text-sm font-medium" style={{ color: "rgba(255,255,255,0.2)" }}>{player.ign.charAt(0)}</span>
                            )}
                          </div>
                          {/* Info */}
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium" style={{ color: C.white }}>{player.ign}</div>
                            <div className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                              {pickedAgent && agentData ? `${pickedAgent} · ${agentData.role}` : isActive ? "en cours de pick" : "—"}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Synergy section */}
                  <div className="mt-4">
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em]" style={{ color: "rgba(255,255,255,0.2)" }}>Synergie</div>
                    {(() => {
                      const pickedRoles = Object.values(agentPicks).filter(Boolean).map((name) => VALORANT_AGENTS.find((a) => a.name === name)?.role).filter(Boolean) as string[];
                      const hasDuelist = pickedRoles.includes("Duelist");
                      const hasController = pickedRoles.includes("Controller");
                      const hasInitiator = pickedRoles.includes("Initiator");
                      const hasSentinel = pickedRoles.includes("Sentinel");
                      const lines: { color: string; text: string }[] = [];
                      if (hasDuelist && hasController) lines.push({ color: "#22C55E", text: "Entry + smokes OK" });
                      if (hasDuelist && hasInitiator) lines.push({ color: "#22C55E", text: "Flash + entry combo" });
                      if (!hasController && pickedRoles.length >= 2) lines.push({ color: "#EF4444", text: "Pas de smokes" });
                      if (!hasInitiator && pickedRoles.length >= 3) lines.push({ color: "#F59E0B", text: "Flash manquant" });
                      if (!hasSentinel && pickedRoles.length >= 3) lines.push({ color: "#F59E0B", text: "Pas d'ancrage" });
                      if (hasSentinel && hasController) lines.push({ color: "#22C55E", text: "Défense solide" });
                      if (pickedRoles.length === 0) lines.push({ color: "rgba(255,255,255,0.15)", text: "Aucun pick" });
                      return lines.slice(0, 4).map((l, i) => (
                        <div key={i} className="flex items-center gap-2 py-0.5">
                          <div className="h-2 w-2 rounded-full" style={{ background: l.color }} />
                          <span className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>{l.text}</span>
                        </div>
                      ));
                    })()}
                  </div>
                </div>

                {/* ── Agent preview (on hover) ── */}
                {(() => {
                  const previewAgent = expandedPlayerId ? VALORANT_AGENTS.find((a) => a.name === expandedPlayerId) : null;
                  if (!previewAgent) return null;
                  const sp = selectingPlayerId ? activePlayers.find((p) => p.id === selectingPlayerId) : null;
                  return (
                    <div className="rounded-xl px-4 py-4" style={{ border: "1.5px solid rgba(96,165,250,0.4)", background: "rgba(96,165,250,0.04)" }}>
                      {/* Portrait + name */}
                      <div className="flex items-center gap-3">
                        <div className="h-14 w-14 overflow-hidden rounded-xl">
                          <img src={previewAgent.portraitUrl} alt="" className="h-full w-full object-cover" />
                        </div>
                        <div>
                          <div className="text-xl font-medium" style={{ color: C.white }}>{previewAgent.name}</div>
                          <div className="text-sm" style={{ color: ROLE_COLORS[previewAgent.role] ?? "rgba(255,255,255,0.3)" }}>{previewAgent.role}</div>
                        </div>
                      </div>
                      {/* Info lines */}
                      <div className="mt-3 space-y-1.5">
                        {sp && (() => {
                          const pMastery = agentMasteryData?.[sp.id] ?? [];
                          const mEntry = pMastery.find((m: { agentName: string; mapName: string }) => m.agentName === previewAgent.name && m.mapName === currentMap.mapName);
                          const allForAgent = pMastery.filter((m: { agentName: string }) => m.agentName === previewAgent.name);
                          const pct = mEntry
                            ? Math.round((mEntry.stars / 5) * 100)
                            : allForAgent.length > 0
                              ? Math.round((allForAgent.reduce((s: number, e: { stars: number }) => s + e.stars, 0) / allForAgent.length / 5) * 100)
                              : null;
                          const pctColor = pct !== null ? (pct >= 70 ? "#22C55E" : pct >= 40 ? "rgba(255,255,255,0.5)" : "#EF4444") : "rgba(255,255,255,0.3)";
                          const isMapSpecific = !!mEntry;
                          return (
                            <div className="text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>
                              {sp.ign} · <span style={{ color: pctColor, fontVariantNumeric: "tabular-nums" }}>{pct !== null ? `${pct}%${isMapSpecific ? "" : " moy."}` : "pas de données"}</span>
                            </div>
                          );
                        })()}
                        <div className="text-sm" style={{ color: "rgba(255,255,255,0.35)" }}>
                          {currentMap.mapName}
                        </div>
                      </div>
                      {/* Buttons */}
                      <div className="mt-4 flex gap-2">
                        <button className="flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors" style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.08)" }}>
                          Détails
                        </button>
                        <button
                          onClick={() => selectingPlayerId && handleAgentPick(selectingPlayerId, previewAgent.name)}
                          className="flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                          style={{ background: "rgba(96,165,250,0.9)", color: "white" }}
                        >
                          Assigner
                        </button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* ── Bottom bar: lock in ── */}
            <div className="relative z-10 flex shrink-0 items-center justify-end px-5 py-3" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <button
                onClick={handleLockIn}
                disabled={!allAgentsLocked()}
                className="group relative overflow-hidden rounded px-12 py-3 transition-all duration-300"
                style={{
                  background: allAgentsLocked() ? "#FF4655" : "rgba(255,255,255,0.04)",
                  color: allAgentsLocked() ? "white" : "rgba(255,255,255,0.12)",
                  cursor: allAgentsLocked() ? "pointer" : "not-allowed",
                  boxShadow: allAgentsLocked() ? "0 0 20px rgba(255,70,85,0.2)" : "none",
                }}
              >
                {allAgentsLocked() && (
                  <div className="absolute inset-0 overflow-hidden" style={{ background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.1) 50%, transparent 100%)", animation: "vct-glow-sweep 2.5s ease infinite" }} />
                )}
                <span className="relative text-sm font-medium uppercase tracking-[0.2em]">Valider la composition</span>
              </button>
            </div>
          </div>
          )}
        </div>
      )}

      {/* ================================================================ */}
      {/* ─── SIMULATING PHASE ───                                        */}
      {/* ================================================================ */}
      {phase === "SIMULATING" && currentMap && (
        <div className="relative flex min-h-screen items-center justify-center">
          <div className="fixed inset-0 bg-cover bg-center vct-animate-zoom" style={{ backgroundImage: `url(${getMapImage(currentMap.mapName)})`, filter: "blur(12px) brightness(0.12) saturate(0.5)" }} />
          <div className="fixed inset-0" style={{ background: "radial-gradient(ellipse at center, rgba(198,155,58,0.04) 0%, rgba(10,10,15,0.88) 70%)" }} />

          <div className="relative z-10 text-center vct-animate-scale">
            <div className="text-[10px] font-bold uppercase tracking-[0.4em]" style={{ color: "rgba(236,232,225,0.2)" }}>Map {currentMapIndex + 1}</div>
            <div className="mt-3 text-6xl font-black uppercase tracking-wider" style={{ color: C.white, textShadow: "0 4px 24px rgba(0,0,0,0.6)" }}>
              {currentMap.mapName}
            </div>
            <div className="mt-8 flex items-center justify-center gap-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-2.5 w-2.5 rounded-full" style={{ background: C.gold, animation: `vct-dot-bounce 1.4s ${i * 0.2}s infinite both` }} />
              ))}
            </div>
            <div className="mt-5 text-xs font-bold uppercase tracking-[0.4em]" style={{ color: "rgba(236,232,225,0.25)" }}>Simulating Match</div>

            <div className="mt-10 flex items-center justify-center gap-6 rounded-lg px-8 py-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.04)" }}>
              <div className="flex items-center gap-3">
                {team1Logo && <img src={team1Logo} alt={team1Tag} className="h-8 w-8 object-contain" />}
                <span className="text-sm font-black uppercase" style={{ color: "rgba(236,232,225,0.5)" }}>{team1Tag}</span>
              </div>
              <span className="text-lg font-black" style={{ color: "rgba(236,232,225,0.08)" }}>VS</span>
              <div className="flex items-center gap-3">
                <span className="text-sm font-black uppercase" style={{ color: "rgba(236,232,225,0.5)" }}>{team2Tag}</span>
                {team2Logo && <img src={team2Logo} alt={team2Tag} className="h-8 w-8 object-contain" />}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/* ─── LIVE PHASE ─── New RoundByRoundScreen component            */}
      {/* ================================================================ */}
      {phase === "LIVE" && currentMap && liveRounds.length > 0 && (() => {
        const mapResult = mapResults[currentMapIndex];
        // Map buy types to eco labels
        const buyToEco = (b: "pistol" | "eco" | "force" | "half" | "full"): RBREcoType => {
          if (b === "pistol") return "Pistol";
          if (b === "eco") return "Eco";
          if (b === "force") return "Force buy";
          if (b === "half" || b === "full") return "Full buy";
          return "Pistol";
        };

        // Build playerId → {ign, team} map from mapResult.playerStats
        // Needed to resolve kill feed entries (killerId/victimId → IGN + team side)
        const myTeamIdForFeed = isTeam1 ? team1Id : team2Id;
        const playerInfo = new Map<string, { ign: string; team: "my" | "opp" }>();
        if (mapResult) {
          for (const s of mapResult.playerStats) {
            playerInfo.set(s.playerId, {
              ign: s.ign,
              team: s.teamId === myTeamIdForFeed ? "my" : "opp",
            });
          }
        }

        // Build rounds data in RBR format — user's team always = "my"
        const rbrRounds: RBRRoundData[] = liveRounds.map((r) => {
          const winnerIsMy = isTeam1 ? r.winner === 1 : r.winner === 2;
          const myBuy = isTeam1 ? r.team1Buy : r.team2Buy;
          const oppBuy = isTeam1 ? r.team2Buy : r.team1Buy;
          const myBudget = isTeam1 ? r.team1Budget : r.team2Budget;
          const oppBudget = isTeam1 ? r.team2Budget : r.team1Budget;
          const eventData = r.event
            ? (() => {
                const t = r.event.type;
                const typeMapped: "clutch" | "eco" | "pistol" | "ace" =
                  t === "ace"
                    ? "ace"
                    : t === "eco_win"
                      ? "eco"
                      : t === "clutch" || t === "defuse_clutch"
                        ? "clutch"
                        : "pistol";
                return { type: typeMapped, description: r.event.text };
              })()
            : undefined;

          // Build kill feed for this round — resolve IDs → IGN, lookup weapon from loadouts
          const weaponByPid = new Map<string, string>();
          for (const l of r.loadouts ?? []) weaponByPid.set(l.playerId, l.weapon);
          const killFeed = (r.kills ?? []).map((k) => {
            const killer = playerInfo.get(k.killerId);
            const victim = playerInfo.get(k.victimId);
            return {
              killerIgn: killer?.ign ?? "?",
              killerTeam: killer?.team ?? "opp",
              victimIgn: victim?.ign ?? "?",
              weapon: weaponByPid.get(k.killerId),
              isFirstKill: k.isFirstKill,
              timing: k.timing,
              assistIgns: k.assistIds.map((aid) => playerInfo.get(aid)?.ign ?? "?"),
            };
          });

          return {
            roundNumber: r.round,
            winner: (winnerIsMy ? "my" : "opp") as "my" | "opp",
            myEco: buyToEco(myBuy),
            oppEco: buyToEco(oppBuy),
            myCredits: myBudget,
            oppCredits: oppBudget,
            event: eventData,
            coachComment:
              eventData?.description ??
              (winnerIsMy ? "Good round, keep the pressure up." : "Regroup and adjust the setup."),
            killFeed,
            plantTime: r.plantTime ?? null,
            spikeDefused: r.spikeDefused ?? false,
          };
        });

        // Build player objects for both teams
        const myPlayersRBR: RBRPlayer[] = activePlayers.map((p) => {
          const agentName = agentPicks[p.id] ?? "Jett";
          const agentData = VALORANT_AGENTS.find((a) => a.name === agentName);
          return {
            ign: p.ign,
            agent: agentName,
            agentColor: agentData ? ROLE_COLORS[agentData.role] ?? "#FF4655" : "#FF4655",
            agentPortraitUrl: agentData?.portraitUrl,
            role: p.role,
          };
        });

        const oppAgents = enemyAgents[currentMapIndex] ?? [];
        const oppPlayersData = vetoState && !vetoState.done
          ? (isTeam1 ? vetoState.match.team2 : vetoState.match.team1)
          : null;
        const oppRealPlayers = oppPlayersData && "players" in oppPlayersData
          ? (oppPlayersData.players as Array<{ id: string; ign: string; role: string; imageUrl: string | null }>)
          : [];
        const oppPlayersRBR: RBRPlayer[] = [0, 1, 2, 3, 4].map((idx) => {
          const agentName = oppAgents[idx] ?? "Jett";
          const agentData = VALORANT_AGENTS.find((a) => a.name === agentName);
          const realPlayer = oppRealPlayers[idx];
          return {
            ign: realPlayer?.ign ?? `Player ${idx + 1}`,
            agent: agentName,
            agentColor: agentData ? ROLE_COLORS[agentData.role] ?? "#888888" : "#888888",
            agentPortraitUrl: agentData?.portraitUrl,
            role: realPlayer?.role ?? agentData?.role ?? "Flex",
          };
        });

        // Build stats accessor from the REAL per-round kill log returned by the sim.
        // Each round carries its actual kills/assists/first-kill events, so we can
        // accumulate true per-round totals and compute real KAST% contributions.
        const myFinalTeamId = isTeam1 ? team1Id : team2Id;
        const myFinalStatsArr = mapResult?.playerStats.filter((s) => s.teamId === myFinalTeamId) ?? [];
        const oppFinalStatsArr = mapResult?.playerStats.filter((s) => s.teamId !== myFinalTeamId) ?? [];

        type PerRoundStat = { k: number; d: number; a: number; fk: number; kast: boolean };
        // Pre-compute per-player per-round stats from liveRounds[i].kills
        const buildPerRound = (playerIds: string[]): PerRoundStat[][] => {
          return playerIds.map((pid) => {
            const perRound: PerRoundStat[] = [];
            for (const r of liveRounds) {
              const kills = r.kills ?? [];
              let k = 0, d = 0, a = 0, fk = 0;
              let wasKiller = false, wasAssister = false, wasVictim = false, wasTraded = false;
              // K / A / D / FK
              for (const kill of kills) {
                if (kill.killerId === pid) {
                  k += 1; wasKiller = true;
                  if (kill.isFirstKill) fk += 1;
                }
                if (kill.victimId === pid) {
                  d += 1; wasVictim = true;
                }
                if (kill.assistIds.includes(pid)) {
                  a += 1; wasAssister = true;
                }
              }
              // Trade: a teammate killed the player who killed me, within 1.5s after my death
              if (wasVictim) {
                const myDeath = kills.find((kill) => kill.victimId === pid);
                if (myDeath) {
                  wasTraded = kills.some((kill) =>
                    kill.killerId !== pid &&
                    kill.victimId === myDeath.killerId &&
                    kill.timing >= myDeath.timing &&
                    kill.timing - myDeath.timing <= 1.5,
                  );
                }
              }
              const survived = !wasVictim;
              const kastHit = wasKiller || wasAssister || survived || wasTraded;
              perRound.push({ k, d, a, fk, kast: kastHit });
            }
            return perRound;
          });
        };

        const myPlayerIds = myFinalStatsArr.map((s) => s.playerId);
        const oppPlayerIds = oppFinalStatsArr.map((s) => s.playerId);
        const myPerRound = buildPerRound(myPlayerIds);
        const oppPerRound = buildPerRound(oppPlayerIds);

        // ── Helpers ──
        const hashIgn = (s: string): number => {
          let h = 0;
          for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
          return h >>> 0;
        };
        // Loadout is now REAL per-round data from the sim — look up by playerId.
        const loadoutFor = (playerId: string, roundIdx: number) => {
          const activeRound = liveRounds[Math.max(0, Math.min(liveRounds.length - 1, roundIdx - 1))];
          const snap = activeRound?.loadouts?.find((l) => l.playerId === playerId);
          if (!snap) return { weapon: undefined, armor: undefined, credits: undefined, fromPickup: false };
          return {
            weapon: snap.weapon,
            armor: snap.armor,
            credits: snap.creditsAfterBuy,
            fromPickup: snap.fromPickup,
          };
        };

        const getStatsAtRound = (roundIdx: number): { my: RBRPlayerStats[]; opp: RBRPlayerStats[] } => {
          if (!mapResult || mapResult.playerStats.length === 0) {
            return {
              my: myPlayersRBR.map((p) => ({ ign: p.ign, k: 0, d: 0, a: 0, acs: 0, adr: 0, kast: 75, hs: 25, fk: 0 })),
              opp: oppPlayersRBR.map((p) => ({ ign: p.ign, k: 0, d: 0, a: 0, acs: 0, adr: 0, kast: 75, hs: 25, fk: 0 })),
            };
          }

          const buildStats = (
            finalArr: typeof myFinalStatsArr,
            perRoundArr: PerRoundStat[][],
          ): RBRPlayerStats[] =>
            finalArr.map((final, pIdx): RBRPlayerStats => {
              const perRound = perRoundArr[pIdx] ?? [];
              let k = 0, d = 0, a = 0, fk = 0, kastHits = 0;
              const roundsToCount = Math.min(roundIdx, perRound.length);
              for (let i = 0; i < roundsToCount; i++) {
                k += perRound[i].k;
                d += perRound[i].d;
                a += perRound[i].a;
                fk += perRound[i].fk;
                if (perRound[i].kast) kastHits += 1;
              }
              const roundsPlayed = Math.max(1, roundsToCount);
              const estDamage = k * 145 + a * 35;
              const acs = Math.round((k * 160 + a * 55 + estDamage * 0.8) / roundsPlayed);
              const adr = Math.round(estDamage / roundsPlayed);
              const kast = Math.round((kastHits / roundsPlayed) * 100);
              const hsBase = 18 + (hashIgn(final.playerId) % 18);
              const hs = Math.max(12, Math.min(45, hsBase + (k >= d ? 2 : -2)));
              // Real loadout from the sim
              const loadout = loadoutFor(final.playerId, roundIdx);
              // Ult charge — still synthesized from match progress (sim doesn't track ult yet)
              const ultCharge = Math.min(1, (roundIdx * 0.09) + k * 0.12 + d * 0.04);
              return {
                ign: final.ign,
                k, d, a,
                acs: Math.max(0, acs),
                adr: Math.max(0, adr),
                kast,
                hs,
                fk,
                weapon: loadout.weapon,
                armor: loadout.armor,
                credits: loadout.credits,
                fromPickup: loadout.fromPickup,
                abilities: { q: true, e: true, c: true, x: ultCharge >= 1, ultCharge },
              };
            });

          const myStats = buildStats(myFinalStatsArr, myPerRound);
          const oppStats = buildStats(oppFinalStatsArr, oppPerRound);
          const oppStatsAligned = oppPlayersRBR.map((p, i) => oppStats[i] ? { ...oppStats[i], ign: p.ign } : { ign: p.ign, k: 0, d: 0, a: 0, acs: 0, adr: 0, kast: 75, hs: 25, fk: 0 });
          return { my: myStats, opp: oppStatsAligned };
        };

        const handleMapEnd = (_result: "win" | "loss", _finalScore: { my: number; opp: number }) => {
          transitionTo("RESULT");
        };

        return (
          <RoundByRoundScreen
            mapName={currentMap.mapName}
            mapImageUrl={getMapImage(currentMap.mapName)}
            stage={`${format} · VCT`}
            myTeam={{
              name: playerTeamName,
              color: C.red,
              logo: playerTeamLogo,
              players: myPlayersRBR,
            }}
            oppTeam={{
              name: enemyTeamName,
              color: "#555",
              logo: enemyTeamLogo,
              players: oppPlayersRBR,
            }}
            rounds={rbrRounds}
            getStatsAtRound={getStatsAtRound}
            onMapEnd={handleMapEnd}
            myFirstHalfSide={currentMap.playerSide}
          />
        );
      })()}

      {/* Legacy LIVE block (now unused, kept as noop) */}
      {false && phase === "LIVE" && currentMap && (() => {
        const displayed = liveRounds.slice(0, displayedRoundCount);
        const lastRound = displayed[displayed.length - 1];
        const currentScore1 = lastRound?.score1 ?? 0;
        const currentScore2 = lastRound?.score2 ?? 0;
        const currentRoundNum = lastRound?.round ?? 0;
        const currentHalf = lastRound?.half ?? 1;
        const halfLabel = currentHalf === "OT" ? "OVERTIME" : currentHalf === 2 ? "2ND HALF" : "1ST HALF";
        const isMatchPoint1 = currentScore1 === 12 && currentScore2 < 13;
        const isMatchPoint2 = currentScore2 === 12 && currentScore1 < 13;
        const recentEvents = displayed.slice(-4);
        const totalSlots = Math.max(24, liveRounds.length);

        // Win prob
        const s1 = currentScore1;
        const s2 = currentScore2;
        const roundsPlayed = s1 + s2;
        const lead = s1 - s2;
        const baseProb = 50 + lead * (roundsPlayed > 15 ? 8 : 5);
        const prob1 = Math.max(5, Math.min(95, Math.round(baseProb)));
        const prob2 = 100 - prob1;

        // Buy state for latest round
        const latestBuy1 = lastRound?.team1Buy ?? "pistol";
        const latestBuy2 = lastRound?.team2Buy ?? "pistol";
        const latestBudget1 = lastRound?.team1Budget ?? 0;
        const latestBudget2 = lastRound?.team2Budget ?? 0;

        return (
          <div className="relative flex min-h-screen flex-col" style={{ background: C.bg }}>
            {/* Clean dark background — no map image for broadcast look */}
            <div className="fixed inset-0" style={{ background: "linear-gradient(180deg, #0d0d14 0%, #0a0a0f 40%, #0e0e16 100%)" }} />

            {/* ── TOP BAR: Scoreboard ── */}
            <div className="relative z-10 flex items-center justify-between px-6 py-4" style={{ background: "#0d0d14", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
              {/* Team 1 side */}
              <div className="flex items-center gap-4">
                {team1Logo && <img src={team1Logo} alt={team1Tag} className="h-9 w-9 object-contain" />}
                <span className="text-base font-black uppercase tracking-wider" style={{ color: C.white }}>{team1Tag}</span>
                {isMatchPoint1 && (
                  <span className="rounded px-2 py-0.5 text-[9px] font-black uppercase tracking-wider" style={{ background: "rgba(255,70,85,0.12)", color: C.red, animation: "vct-match-point-pulse 1.5s ease-in-out infinite" }}>MATCH POINT</span>
                )}
                <span className="tabular-nums font-black" style={{ fontSize: "2.8rem", lineHeight: 1, color: currentScore1 >= currentScore2 ? C.white : "rgba(236,232,225,0.3)", animation: lastRound?.winner === 1 ? "vct-live-score-pop 0.3s ease both" : "none" }} key={`s1-${currentScore1}`}>
                  {currentScore1}
                </span>
              </div>

              {/* Center */}
              <div className="flex flex-col items-center">
                <span className="text-[9px] font-bold uppercase tracking-[0.3em]" style={{ color: "rgba(236,232,225,0.25)" }}>{halfLabel}</span>
                <span className="text-lg font-black uppercase tracking-wider" style={{ color: "rgba(236,232,225,0.5)" }}>ROUND {currentRoundNum}</span>
                <span className="text-[8px] font-medium uppercase tracking-[0.25em]" style={{ color: "rgba(236,232,225,0.12)" }}>Map {currentMapIndex + 1} -- {currentMap?.mapName}</span>
              </div>

              {/* Team 2 side */}
              <div className="flex items-center gap-4">
                <span className="tabular-nums font-black" style={{ fontSize: "2.8rem", lineHeight: 1, color: currentScore2 >= currentScore1 ? C.white : "rgba(236,232,225,0.3)", animation: lastRound?.winner === 2 ? "vct-live-score-pop 0.3s ease both" : "none" }} key={`s2-${currentScore2}`}>
                  {currentScore2}
                </span>
                {isMatchPoint2 && (
                  <span className="rounded px-2 py-0.5 text-[9px] font-black uppercase tracking-wider" style={{ background: "rgba(255,70,85,0.12)", color: C.red, animation: "vct-match-point-pulse 1.5s ease-in-out infinite" }}>MATCH POINT</span>
                )}
                <span className="text-base font-black uppercase tracking-wider" style={{ color: C.white }}>{team2Tag}</span>
                {team2Logo && <img src={team2Logo} alt={team2Tag} className="h-9 w-9 object-contain" />}
              </div>
            </div>

            {/* ── Economy indicators ── */}
            {displayedRoundCount > 0 && (
              <div className="relative z-10 flex items-center justify-between px-6 py-2" style={{ background: "rgba(13,13,20,0.6)" }}>
                <div className="flex items-center gap-3">
                  {(() => {
                    const b = getBuyLabel(latestBuy1);
                    return (
                      <span className="rounded px-2 py-0.5 text-[9px] font-black uppercase tracking-wider" style={{ background: `${b.color}15`, color: b.color, border: `1px solid ${b.color}25` }}>
                        {b.label}
                      </span>
                    );
                  })()}
                  <span className="text-[10px] font-bold tabular-nums" style={{ color: "rgba(236,232,225,0.2)" }}>${latestBudget1.toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-bold tabular-nums" style={{ color: "rgba(236,232,225,0.2)" }}>${latestBudget2.toLocaleString()}</span>
                  {(() => {
                    const b = getBuyLabel(latestBuy2);
                    return (
                      <span className="rounded px-2 py-0.5 text-[9px] font-black uppercase tracking-wider" style={{ background: `${b.color}15`, color: b.color, border: `1px solid ${b.color}25` }}>
                        {b.label}
                      </span>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* ── Win probability bar ── */}
            {displayedRoundCount > 0 && (
              <div className="relative z-10 px-6 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="w-8 text-right text-[9px] font-bold tabular-nums" style={{ color: C.team1 }}>{prob1}%</span>
                  <div className="flex h-1 flex-1 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.04)" }}>
                    <div className="h-full rounded-l-full transition-all duration-700" style={{ width: `${prob1}%`, background: C.team1 }} />
                    <div className="h-full rounded-r-full transition-all duration-700" style={{ width: `${prob2}%`, background: C.team2 }} />
                  </div>
                  <span className="w-8 text-[9px] font-bold tabular-nums" style={{ color: C.team2 }}>{prob2}%</span>
                </div>
              </div>
            )}

            {/* ── Round indicators ── */}
            <div className="relative z-10 flex items-center justify-center gap-[2px] px-6 py-3">
              {Array.from({ length: totalSlots }, (_, i) => {
                const round = liveRounds[i];
                const isPlayed = i < displayedRoundCount && round != null;
                const isCurrent = i === displayedRoundCount - 1;
                const isHalftimeDivider = i === 12;

                return (
                  <div key={i} className="flex items-center">
                    {isHalftimeDivider && <div className="mx-1 h-4 w-[1px] rounded-full" style={{ background: "rgba(236,232,225,0.08)" }} />}
                    <div className="rounded-[2px] transition-all duration-300" style={{
                      width: 16, height: 16,
                      background: isPlayed ? (round.winner === 1 ? C.team1 : C.team2) : "rgba(255,255,255,0.04)",
                      opacity: isPlayed ? (isCurrent ? 1 : 0.7) : 0.3,
                      boxShadow: isCurrent ? `0 0 8px 1px ${round?.winner === 1 ? "rgba(255,70,85,0.4)" : "rgba(74,144,217,0.4)"}` : "none",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "7px", fontWeight: 900, color: isPlayed ? "rgba(255,255,255,0.75)" : "transparent",
                    }}>
                      {isPlayed && (i + 1)}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ── Event feed: center of screen ── */}
            <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-8">
              <div className="flex w-full max-w-lg flex-col items-center gap-2.5">
                {recentEvents.map((round, idx) => {
                  const label = getRoundLabel(round);
                  const isLatest = idx === recentEvents.length - 1;

                  return (
                    <div
                      key={round.round}
                      className="w-full rounded-lg px-5 py-3.5 text-center transition-all duration-300"
                      style={{
                        background: isLatest ? "rgba(255,255,255,0.04)" : "rgba(255,255,255,0.015)",
                        border: isLatest && label.accent ? `1px solid ${label.color}22` : "1px solid transparent",
                        opacity: isLatest ? 1 : 0.3 + idx * 0.18,
                        animation: isLatest ? "vct-live-card-in 0.35s cubic-bezier(0.22,1,0.36,1) both" : "none",
                        transform: isLatest ? "none" : `scale(${0.94 + idx * 0.02})`,
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-bold uppercase tracking-[0.2em]" style={{ color: "rgba(236,232,225,0.2)" }}>Round {round.round}</span>
                        {label.badge && isLatest && (
                          <span className="rounded px-2 py-0.5 text-[8px] font-black uppercase tracking-[0.15em]" style={{ background: `${label.color}18`, color: label.color, border: `1px solid ${label.color}30` }}>
                            {label.badge}
                          </span>
                        )}
                        <span className="text-[9px] font-bold tabular-nums uppercase tracking-[0.15em]" style={{ color: "rgba(236,232,225,0.12)" }}>{round.score1} - {round.score2}</span>
                      </div>
                      <div className="mt-1 font-black uppercase tracking-wider" style={{
                        fontSize: label.accent && isLatest ? "1.15rem" : "0.9rem",
                        color: label.color,
                        textShadow: label.accent && isLatest ? `0 0 15px ${label.color}33` : "none",
                        animation: label.accent && isLatest ? "vct-event-glow 2s ease-in-out infinite" : "none",
                      }}>
                        {label.text}
                      </div>
                    </div>
                  );
                })}

                {displayedRoundCount === 0 && (
                  <div className="flex flex-col items-center gap-3 py-8">
                    <div className="flex gap-1.5">
                      {[0, 1, 2].map((i) => (
                        <div key={i} className="h-2 w-2 rounded-full" style={{ background: C.red, animation: `vct-dot-bounce 1.4s ${i * 0.16}s infinite both` }} />
                      ))}
                    </div>
                    <span className="text-xs font-black uppercase tracking-[0.4em]" style={{ color: "rgba(236,232,225,0.15)" }}>MATCH STARTING</span>
                  </div>
                )}
              </div>
            </div>

            {/* ── LIVE badge ── */}
            <div className="fixed right-6 top-6 z-20">
              <div className="flex items-center gap-2 rounded-full px-3.5 py-1" style={{ background: "rgba(255,70,85,0.08)", border: "1px solid rgba(255,70,85,0.2)" }}>
                <div className="h-1.5 w-1.5 rounded-full" style={{ background: C.red, animation: "vct-match-point-pulse 1s ease-in-out infinite" }} />
                <span className="text-[9px] font-black uppercase tracking-[0.3em]" style={{ color: C.red }}>LIVE</span>
              </div>
            </div>

            {/* ── Overlays (Halftime, Overtime, Timeout) ── */}
            {liveOverlay && (
              <div className="fixed inset-0 z-30 flex flex-col items-center justify-center" style={{ background: "rgba(10,10,15,0.94)" }}>
                <div style={{ animation: "vct-overlay-in 0.4s cubic-bezier(0.22,1,0.36,1) both" }} className="flex flex-col items-center gap-4">
                  {liveOverlay === "HALFTIME" && (
                    <>
                      <span className="text-5xl font-black uppercase tracking-[0.15em]" style={{ color: C.white, textShadow: "0 4px 24px rgba(0,0,0,0.5)" }}>HALFTIME</span>
                      <div className="flex items-center gap-6">
                        <span className="tabular-nums text-4xl font-black" style={{ color: C.white }}>{currentScore1}</span>
                        <span className="text-xl font-black" style={{ color: "rgba(236,232,225,0.12)" }}>:</span>
                        <span className="tabular-nums text-4xl font-black" style={{ color: C.white }}>{currentScore2}</span>
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-[0.4em]" style={{ color: "rgba(236,232,225,0.25)" }}>SIDES SWITCH</span>
                    </>
                  )}
                  {liveOverlay === "OVERTIME" && (
                    <>
                      <span className="text-5xl font-black uppercase tracking-[0.15em]" style={{ color: C.gold, textShadow: "0 0 30px rgba(198,155,58,0.3)" }}>OVERTIME</span>
                      <span className="text-xs font-bold uppercase tracking-[0.3em]" style={{ color: "rgba(198,155,58,0.45)" }}>12 -- 12</span>
                    </>
                  )}
                  {liveOverlay === "TIMEOUT" && (
                    <>
                      <span className="text-4xl font-black uppercase tracking-[0.2em]" style={{ color: C.gold, textShadow: "0 0 25px rgba(198,155,58,0.25)" }}>TACTICAL TIMEOUT</span>
                      <span className="text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: "rgba(198,155,58,0.4)" }}>Regrouping...</span>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Tactical Timeout button removed — RoundByRoundScreen handles pause/speed controls in its bottom bar */}

      {/* ================================================================ */}
      {/* ─── RESULT PHASE ───                                            */}
      {/* ================================================================ */}
      {phase === "RESULT" && currentMap && mapResults[currentMapIndex] && (() => {
        const mapResult = mapResults[currentMapIndex]!;
        const mapName = currentMap.mapName;
        const team1Won = mapResult.score1 > mapResult.score2;
        const team1Stats = mapResult.playerStats.filter((p) => p.teamId === team1Id);
        const team2Stats = mapResult.playerStats.filter((p) => p.teamId === team2Id);
        const mvp = [...mapResult.playerStats].sort((a, b) => b.acs - a.acs)[0];
        const bestHighlight = mapResult.highlights.length > 0 ? mapResult.highlights.reduce((best, h) => {
          const hWeight = (h as unknown as Record<string, number>).weight ?? 0;
          const bWeight = (best as unknown as Record<string, number>).weight ?? 0;
          return hWeight > bWeight ? h : best;
        }, mapResult.highlights[0]) : null;
        const isMatchPoint = !isSeriesDecided() && (seriesScore.team1 === winsNeeded - 1 || seriesScore.team2 === winsNeeded - 1);
        const decided = isSeriesDecided();

        return (
          <div className="relative min-h-screen">
            {/* Map background blurred */}
            <div className="fixed inset-0 bg-cover bg-center vct-animate-zoom" style={{ backgroundImage: `url(${getMapImage(mapName)})`, filter: "blur(24px) brightness(0.1) saturate(0.35)" }} />
            <div className="fixed inset-0" style={{ background: "rgba(10,10,15,0.75)" }} />

            <div className="relative z-10 mx-auto max-w-5xl px-8 py-10">
              {/* Map label */}
              <div className="vct-animate-fade mb-4 text-center">
                <span className="text-[10px] font-bold uppercase tracking-[0.4em]" style={{ color: "rgba(236,232,225,0.2)" }}>
                  Map {currentMapIndex + 1} of {mapLineup.length} -- {mapName}
                </span>
              </div>

              {/* Score display */}
              <div className="vct-animate-scale mb-5 flex items-center justify-center gap-8">
                <div className="flex items-center gap-4">
                  {team1Logo && (
                    <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-lg" style={{ background: "rgba(255,255,255,0.04)" }}>
                      <img src={team1Logo} alt={team1Name} className="h-9 w-9 object-contain" />
                    </div>
                  )}
                  <div className="text-right">
                    <div className="text-lg font-black uppercase tracking-wide" style={{ color: team1Won ? C.white : "rgba(236,232,225,0.3)" }}>{team1Name}</div>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <span className="tabular-nums font-black" style={{
                    fontSize: "4.5rem", lineHeight: 1,
                    color: team1Won ? C.green : "rgba(255,70,85,0.35)",
                    textShadow: team1Won ? "0 0 25px rgba(74,230,138,0.25)" : "none",
                  }}>{mapResult.score1}</span>
                  <span className="text-2xl font-black" style={{ color: "rgba(236,232,225,0.08)" }}>:</span>
                  <span className="tabular-nums font-black" style={{
                    fontSize: "4.5rem", lineHeight: 1,
                    color: !team1Won ? C.green : "rgba(255,70,85,0.35)",
                    textShadow: !team1Won ? "0 0 25px rgba(74,230,138,0.25)" : "none",
                  }}>{mapResult.score2}</span>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-left">
                    <div className="text-lg font-black uppercase tracking-wide" style={{ color: !team1Won ? C.white : "rgba(236,232,225,0.3)" }}>{team2Name}</div>
                  </div>
                  {team2Logo && (
                    <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-lg" style={{ background: "rgba(255,255,255,0.04)" }}>
                      <img src={team2Logo} alt={team2Name} className="h-9 w-9 object-contain" />
                    </div>
                  )}
                </div>
              </div>

              {/* MVP callout */}
              {mvp && (
                <div className="vct-animate-slide-up mb-3 flex justify-center">
                  <div className="inline-flex items-center gap-3 rounded-full px-5 py-2" style={{ background: "rgba(198,155,58,0.06)", border: "1px solid rgba(198,155,58,0.15)" }}>
                    <svg className="h-4 w-4" style={{ color: C.gold }} viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                    </svg>
                    <span className="text-xs font-black uppercase tracking-wider" style={{ color: C.gold }}>MVP: {mvp.ign}</span>
                    <span className="text-[10px] font-bold" style={{ color: "rgba(198,155,58,0.45)" }}>{formatStat(mvp.acs, 0)} ACS</span>
                  </div>
                </div>
              )}

              {/* Key moment */}
              {bestHighlight && (
                <div className="vct-animate-fade mb-3 text-center">
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: "rgba(236,232,225,0.3)" }}>{bestHighlight.text}</span>
                </div>
              )}

              {/* Series score */}
              <div className="mb-6 text-center">
                <span className="text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: "rgba(236,232,225,0.2)" }}>
                  Series: {team1Tag} {seriesScore.team1} - {seriesScore.team2} {team2Tag}
                </span>
              </div>

              {/* Compact scoreboard */}
              <div className="vct-animate-slide-up overflow-hidden rounded-lg" style={{ background: "rgba(18,18,26,0.85)", border: "1px solid rgba(255,255,255,0.04)", backdropFilter: "blur(12px)" }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                      {["Player", "ACS", "K", "D", "A", "K/D", "FK", "FD"].map((h) => (
                        <th key={h} className="px-4 py-2.5 text-left text-[9px] font-black uppercase tracking-[0.25em]" style={{ color: "rgba(236,232,225,0.15)" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* Team 1 header */}
                    <tr>
                      <td colSpan={8} className="px-4 py-1.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", background: team1Won ? "rgba(74,230,138,0.02)" : "rgba(255,70,85,0.015)" }}>
                        <div className="flex items-center gap-2">
                          {team1Logo && <img src={team1Logo} alt={team1Tag} className="h-3.5 w-3.5 object-contain" />}
                          <span className="text-[9px] font-black uppercase tracking-[0.2em]" style={{ color: team1Won ? "rgba(74,230,138,0.6)" : "rgba(255,70,85,0.4)" }}>
                            {team1Name}{team1Won && " -- WINNER"}
                          </span>
                        </div>
                      </td>
                    </tr>
                    {team1Stats.sort((a, b) => b.acs - a.acs).map((entry) => {
                      const kd = entry.deaths > 0 ? entry.kills / entry.deaths : entry.kills;
                      const isMvp = entry.playerId === mvp?.playerId;
                      return (
                        <tr key={entry.playerId} style={{ borderBottom: "1px solid rgba(255,255,255,0.02)", background: isMvp ? "rgba(198,155,58,0.03)" : "transparent" }}>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-2">
                              <span className="font-bold" style={{ color: C.white }}>{entry.ign}</span>
                              {isMvp && <span className="rounded px-1.5 py-0.5 text-[7px] font-black uppercase tracking-wider" style={{ background: "rgba(198,155,58,0.1)", color: C.gold, border: "1px solid rgba(198,155,58,0.2)" }}>MVP</span>}
                            </div>
                          </td>
                          <td className="px-4 py-2 font-bold" style={{ color: C.white }}>{formatStat(entry.acs, 0)}</td>
                          <td className="px-4 py-2" style={{ color: C.green }}>{entry.kills}</td>
                          <td className="px-4 py-2" style={{ color: C.red }}>{entry.deaths}</td>
                          <td className="px-4 py-2" style={{ color: "rgba(236,232,225,0.35)" }}>{entry.assists}</td>
                          <td className="px-4 py-2" style={{ color: "rgba(236,232,225,0.35)" }}>{formatStat(kd, 2)}</td>
                          <td className="px-4 py-2" style={{ color: "rgba(236,232,225,0.35)" }}>{entry.fk}</td>
                          <td className="px-4 py-2" style={{ color: "rgba(236,232,225,0.35)" }}>{entry.fd}</td>
                        </tr>
                      );
                    })}
                    {/* Team 2 header */}
                    <tr>
                      <td colSpan={8} className="px-4 py-1.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.03)", borderTop: "1px solid rgba(255,255,255,0.03)", background: !team1Won ? "rgba(74,230,138,0.02)" : "rgba(255,70,85,0.015)" }}>
                        <div className="flex items-center gap-2">
                          {team2Logo && <img src={team2Logo} alt={team2Tag} className="h-3.5 w-3.5 object-contain" />}
                          <span className="text-[9px] font-black uppercase tracking-[0.2em]" style={{ color: !team1Won ? "rgba(74,230,138,0.6)" : "rgba(255,70,85,0.4)" }}>
                            {team2Name}{!team1Won && " -- WINNER"}
                          </span>
                        </div>
                      </td>
                    </tr>
                    {team2Stats.sort((a, b) => b.acs - a.acs).map((entry) => {
                      const kd = entry.deaths > 0 ? entry.kills / entry.deaths : entry.kills;
                      const isMvp = entry.playerId === mvp?.playerId;
                      return (
                        <tr key={entry.playerId} style={{ borderBottom: "1px solid rgba(255,255,255,0.02)", background: isMvp ? "rgba(198,155,58,0.03)" : "transparent" }}>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-2">
                              <span className="font-bold" style={{ color: C.white }}>{entry.ign}</span>
                              {isMvp && <span className="rounded px-1.5 py-0.5 text-[7px] font-black uppercase tracking-wider" style={{ background: "rgba(198,155,58,0.1)", color: C.gold, border: "1px solid rgba(198,155,58,0.2)" }}>MVP</span>}
                            </div>
                          </td>
                          <td className="px-4 py-2 font-bold" style={{ color: C.white }}>{formatStat(entry.acs, 0)}</td>
                          <td className="px-4 py-2" style={{ color: C.green }}>{entry.kills}</td>
                          <td className="px-4 py-2" style={{ color: C.red }}>{entry.deaths}</td>
                          <td className="px-4 py-2" style={{ color: "rgba(236,232,225,0.35)" }}>{entry.assists}</td>
                          <td className="px-4 py-2" style={{ color: "rgba(236,232,225,0.35)" }}>{formatStat(kd, 2)}</td>
                          <td className="px-4 py-2" style={{ color: "rgba(236,232,225,0.35)" }}>{entry.fk}</td>
                          <td className="px-4 py-2" style={{ color: "rgba(236,232,225,0.35)" }}>{entry.fd}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Highlights */}
              {mapResult.highlights.length > 0 && (
                <div className="vct-animate-slide-up mt-5 rounded-lg p-4" style={{ background: "rgba(18,18,26,0.5)", border: "1px solid rgba(255,255,255,0.03)" }}>
                  <div className="mb-2 text-[9px] font-black uppercase tracking-[0.25em]" style={{ color: "rgba(236,232,225,0.15)" }}>Match Highlights</div>
                  <ul className="space-y-2">
                    {mapResult.highlights.map((highlight, i) => (
                      <li key={i} className="flex items-start gap-2.5 text-xs" style={{ color: "rgba(236,232,225,0.45)" }}>
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ background: C.red }} />
                        {highlight.text}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Next button */}
              <div className="mt-7 flex flex-col items-center gap-3 pb-8">
                {isMatchPoint && !decided && (
                  <div className="vct-animate-scale rounded-full px-5 py-1 text-[10px] font-black uppercase tracking-[0.3em]" style={{ background: "rgba(255,70,85,0.08)", color: C.red, border: "1px solid rgba(255,70,85,0.15)", animation: "vct-pulse-red 2s ease-in-out infinite" }}>
                    Match Point
                  </div>
                )}
                <button
                  onClick={decided ? handleMatchComplete : handleNextMap}
                  className="group relative overflow-hidden rounded-lg px-12 py-3.5 transition-all duration-500 hover:scale-105"
                  style={{ background: C.red, color: C.white, boxShadow: "0 0 25px rgba(255,70,85,0.2)" }}
                >
                  <div className="absolute inset-0 overflow-hidden" style={{ background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%)", animation: "vct-glow-sweep 2s ease infinite" }} />
                  <span className="relative flex items-center gap-2.5 text-sm font-black uppercase tracking-[0.2em]">
                    {decided ? "Match Complete" : "Next Map"}
                    {!decided && (
                      <svg className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    )}
                  </span>
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ================================================================ */}
      {/* ─── TIMEOUT PHASE ─── (between maps)                            */}
      {/* ================================================================ */}
      {phase === "TIMEOUT" && (() => {
        const lastMapResult = mapResults[currentMapIndex] ?? null;
        const didLose = didPlayerTeamLosePreviousMap();
        const worstPlayer = getWorstPerformingPlayer();
        const tacticalAvailable = didLose;
        const medicalAvailable = worstPlayer !== null;

        const options: {
          id: TimeoutBonus["type"];
          title: string;
          description: string;
          effect: string;
          available: boolean;
          unavailableReason: string;
          icon: React.ReactNode;
          bonus: TimeoutBonus;
        }[] = [
          {
            id: "tactical",
            title: "Tactical Pause",
            description: "Your analyst reviews the opponent's tendencies",
            effect: "+3% counter bonus on next map",
            available: tacticalAvailable,
            unavailableReason: "Only available after losing a map",
            icon: (
              <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
              </svg>
            ),
            bonus: { type: "tactical", counterBonusDelta: 0.03 },
          },
          {
            id: "motivational",
            title: "Motivational Talk",
            description: "Rally the team for the next map",
            effect: "+5 teamplay skill for next map",
            available: true,
            unavailableReason: "",
            icon: (
              <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
              </svg>
            ),
            bonus: { type: "motivational", teamplayDelta: 5 },
          },
          {
            id: "medical",
            title: "Medical Timeout",
            description: "Rest a struggling player",
            effect: worstPlayer
              ? `Reset ${worstPlayer.ign}\u2019s variance to neutral`
              : "Remove bad-game-day penalty from worst player",
            available: medicalAvailable,
            unavailableReason: "No player had K/D below 0.5",
            icon: (
              <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
              </svg>
            ),
            bonus: { type: "medical", resetVariancePlayerId: worstPlayer?.playerId },
          },
        ];

        return (
          <div className="relative min-h-screen">
            <div className="fixed inset-0" style={{ background: "linear-gradient(180deg, #0a0a0f 0%, #12121a 40%, #0e0e16 100%)" }} />
            <div className="fixed inset-0" style={{ background: "radial-gradient(ellipse at 50% 30%, rgba(198,155,58,0.03) 0%, transparent 60%)" }} />

            <div className="relative z-10 mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-8 py-10">
              {/* Previous map score */}
              {lastMapResult && (
                <div className="vct-animate-fade mb-5 text-center">
                  <span className="text-[10px] font-bold uppercase tracking-[0.3em]" style={{ color: "rgba(236,232,225,0.18)" }}>
                    Previous Map: {lastMapResult.map} -- {lastMapResult.score1} : {lastMapResult.score2}
                  </span>
                  <div className="mt-1">
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: "rgba(236,232,225,0.12)" }}>
                      Series: {team1Tag} {seriesScore.team1} - {seriesScore.team2} {team2Tag}
                    </span>
                  </div>
                </div>
              )}

              {/* TIMEOUT header */}
              <div className="vct-animate-scale mb-10 text-center">
                <h1 className="font-black uppercase tracking-[0.5em]" style={{ fontSize: "3rem", color: C.white, textShadow: "0 0 40px rgba(198,155,58,0.1)" }}>
                  TIMEOUT
                </h1>
                <div className="mx-auto mt-2 h-px w-28" style={{ background: "linear-gradient(90deg, transparent, rgba(198,155,58,0.3), transparent)" }} />
              </div>

              {/* Applied overlay */}
              {timeoutApplied && (
                <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(10,10,15,0.85)" }}>
                  <div className="flex flex-col items-center gap-4" style={{ animation: "vct-scale-in 0.5s cubic-bezier(0.22,1,0.36,1) both" }}>
                    <svg className="h-14 w-14" style={{ color: C.green }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="text-xl font-black uppercase tracking-[0.3em]" style={{ color: C.white }}>Applied</span>
                  </div>
                </div>
              )}

              {/* Option cards */}
              <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {options.map((opt, idx) => (
                  <button
                    key={opt.id}
                    disabled={!opt.available || timeoutApplied}
                    onClick={() => opt.available && !timeoutApplied && handleTimeoutChoice(opt.bonus)}
                    className="group relative overflow-hidden rounded-lg p-5 text-left transition-all duration-300"
                    style={{
                      background: opt.available ? (timeoutBonus?.type === opt.id ? "rgba(74,230,138,0.06)" : "rgba(18,18,26,0.8)") : "rgba(18,18,26,0.3)",
                      border: opt.available ? (timeoutBonus?.type === opt.id ? "1px solid rgba(74,230,138,0.25)" : "1px solid rgba(255,255,255,0.05)") : "1px solid rgba(255,255,255,0.02)",
                      cursor: opt.available && !timeoutApplied ? "pointer" : "default",
                      opacity: opt.available ? 1 : 0.35,
                      animation: `vct-slide-up 0.6s cubic-bezier(0.22,1,0.36,1) ${idx * 0.1}s both`,
                    }}
                    onMouseEnter={(e) => { if (opt.available && !timeoutApplied) { (e.currentTarget as HTMLElement).style.borderColor = "rgba(198,155,58,0.25)"; } }}
                    onMouseLeave={(e) => { if (opt.available && !timeoutApplied && timeoutBonus?.type !== opt.id) { (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.05)"; } }}
                  >
                    <div className="mb-3" style={{ color: opt.available ? C.gold : "rgba(236,232,225,0.12)" }}>{opt.icon}</div>
                    <div className="mb-1.5 text-sm font-black uppercase tracking-[0.1em]" style={{ color: opt.available ? C.white : "rgba(236,232,225,0.2)" }}>{opt.title}</div>
                    <div className="mb-2.5 text-[11px] leading-relaxed" style={{ color: "rgba(236,232,225,0.35)" }}>{opt.description}</div>
                    <div className="rounded px-2 py-1 text-[9px] font-bold uppercase tracking-wider" style={{ background: opt.available ? "rgba(74,230,138,0.05)" : "rgba(255,255,255,0.02)", color: opt.available ? C.green : "rgba(236,232,225,0.12)", border: `1px solid ${opt.available ? "rgba(74,230,138,0.08)" : "rgba(255,255,255,0.02)"}` }}>
                      {opt.effect}
                    </div>
                    {!opt.available && <div className="mt-2 text-[9px] italic" style={{ color: "rgba(255,70,85,0.35)" }}>{opt.unavailableReason}</div>}
                  </button>
                ))}

                {/* Skip option */}
                <button
                  disabled={timeoutApplied}
                  onClick={() => !timeoutApplied && handleTimeoutChoice({ type: "skip" })}
                  className="group relative overflow-hidden rounded-lg p-5 text-left transition-all duration-300"
                  style={{
                    background: timeoutBonus?.type === "skip" ? "rgba(74,230,138,0.06)" : "rgba(18,18,26,0.4)",
                    border: timeoutBonus?.type === "skip" ? "1px solid rgba(74,230,138,0.25)" : "1px solid rgba(255,255,255,0.03)",
                    cursor: timeoutApplied ? "default" : "pointer",
                    animation: `vct-slide-up 0.6s cubic-bezier(0.22,1,0.36,1) ${options.length * 0.1}s both`,
                  }}
                  onMouseEnter={(e) => { if (!timeoutApplied) (e.currentTarget as HTMLElement).style.borderColor = "rgba(236,232,225,0.12)"; }}
                  onMouseLeave={(e) => { if (!timeoutApplied && timeoutBonus?.type !== "skip") (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.03)"; }}
                >
                  <div className="mb-3" style={{ color: "rgba(236,232,225,0.2)" }}>
                    <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 8.689c0-.864.933-1.405 1.683-.977l7.108 4.062a1.125 1.125 0 010 1.953l-7.108 4.062A1.125 1.125 0 013 16.811V8.69zM12.75 8.689c0-.864.933-1.405 1.683-.977l7.108 4.062a1.125 1.125 0 010 1.953l-7.108 4.062a1.125 1.125 0 01-1.683-.977V8.69z" />
                    </svg>
                  </div>
                  <div className="mb-1.5 text-sm font-black uppercase tracking-[0.1em]" style={{ color: "rgba(236,232,225,0.45)" }}>Skip</div>
                  <div className="text-[11px] leading-relaxed" style={{ color: "rgba(236,232,225,0.2)" }}>Continue without timeout</div>
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ================================================================ */}
      {/* ─── FINAL PHASE ─── Gold radial glow                            */}
      {/* ================================================================ */}
      {phase === "FINAL" && (() => {
        const team1Won = seriesScore.team1 >= winsNeeded;
        const winnerName = team1Won ? team1Name : team2Name;
        const winnerLogo = team1Won ? team1Logo : team2Logo;

        const confettiParticles = Array.from({ length: 30 }, (_, i) => ({
          id: i,
          left: Math.random() * 100,
          delay: Math.random() * 4,
          duration: 3 + Math.random() * 4,
          size: 3 + Math.random() * 5,
        }));

        return (
          <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden">
            {/* Dark base */}
            <div className="fixed inset-0" style={{ background: C.bg }} />
            {/* Radial gold glow */}
            <div className="fixed inset-0" style={{ background: "radial-gradient(ellipse 55% 45% at 50% 45%, rgba(198,155,58,0.08) 0%, transparent 70%)" }} />

            {/* Confetti */}
            {confettiParticles.map((p) => (
              <div
                key={p.id}
                className="pointer-events-none fixed"
                style={{
                  left: `${p.left}%`, top: "-10px",
                  width: `${p.size}px`, height: `${p.size}px`,
                  background: p.id % 3 === 0 ? C.gold : p.id % 3 === 1 ? "rgba(236,232,225,0.5)" : "rgba(198,155,58,0.4)",
                  borderRadius: p.id % 2 === 0 ? "50%" : "1px",
                  animation: `vct-confetti ${p.duration}s ${p.delay}s linear infinite`,
                  zIndex: 5,
                }}
              />
            ))}

            <div className="relative z-10 flex flex-col items-center gap-7 px-8">
              {/* Winner announcement */}
              <div className="text-center">
                <div className="vct-animate-fade text-[10px] font-bold uppercase tracking-[0.5em]" style={{ color: "rgba(236,232,225,0.2)" }}>Series Complete</div>

                {winnerLogo && (
                  <div className="vct-animate-scale mx-auto mt-7 flex h-28 w-28 items-center justify-center overflow-hidden rounded-2xl" style={{ background: "rgba(255,255,255,0.04)", border: "2px solid rgba(198,155,58,0.2)", animation: "vct-winner-glow 3s ease-in-out infinite" }}>
                    <img src={winnerLogo} alt={winnerName} className="h-18 w-18 object-contain" />
                  </div>
                )}

                <div className="vct-animate-slide-up mt-5 text-5xl font-black uppercase tracking-wider" style={{ color: C.white, textShadow: "0 4px 24px rgba(0,0,0,0.5)" }}>
                  {winnerName}
                </div>
                <div className="vct-animate-slide-up mt-2 text-xl font-black uppercase tracking-[0.4em]" style={{ color: C.gold, textShadow: "0 2px 16px rgba(198,155,58,0.25)", animationDelay: "0.15s" }}>
                  WINS
                </div>

                {/* Series score */}
                <div className="vct-animate-slide-up mt-7 flex items-center justify-center gap-7" style={{ animationDelay: "0.3s" }}>
                  <div className="flex items-center gap-3">
                    {team1Logo && (
                      <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg" style={{ background: "rgba(255,255,255,0.04)" }}>
                        <img src={team1Logo} alt={team1Tag} className="h-6 w-6 object-contain" />
                      </div>
                    )}
                    <span className="text-base font-black uppercase" style={{ color: "rgba(236,232,225,0.45)" }}>{team1Tag}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-4xl font-black tabular-nums" style={{ color: team1Won ? C.white : "rgba(236,232,225,0.2)", textShadow: team1Won ? "0 0 18px rgba(198,155,58,0.25)" : "none" }}>{seriesScore.team1}</span>
                    <span className="text-xl font-black" style={{ color: "rgba(236,232,225,0.08)" }}>:</span>
                    <span className="text-4xl font-black tabular-nums" style={{ color: !team1Won ? C.white : "rgba(236,232,225,0.2)", textShadow: !team1Won ? "0 0 18px rgba(198,155,58,0.25)" : "none" }}>{seriesScore.team2}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-base font-black uppercase" style={{ color: "rgba(236,232,225,0.45)" }}>{team2Tag}</span>
                    {team2Logo && (
                      <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg" style={{ background: "rgba(255,255,255,0.04)" }}>
                        <img src={team2Logo} alt={team2Tag} className="h-6 w-6 object-contain" />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Mini map result cards */}
              <div className="vct-animate-slide-up flex gap-3" style={{ animationDelay: "0.45s" }}>
                {mapResults.map((result, i) => {
                  const mapEntry = mapLineup[i];
                  const t1Won = result.score1 > result.score2;
                  return (
                    <div key={i} className="w-44 overflow-hidden rounded-lg" style={{ background: "rgba(18,18,26,0.8)", border: "1px solid rgba(255,255,255,0.05)" }}>
                      <div className="relative h-20">
                        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${getMapImage(mapEntry?.mapName ?? result.map)})` }} />
                        <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.55)" }} />
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <div className="text-[8px] font-bold uppercase tracking-[0.3em]" style={{ color: "rgba(236,232,225,0.3)" }}>Map {i + 1}</div>
                          <div className="mt-0.5 text-xs font-black uppercase tracking-wider" style={{ color: C.white, textShadow: "0 2px 8px rgba(0,0,0,0.5)" }}>{mapEntry?.mapName ?? result.map}</div>
                        </div>
                      </div>
                      <div className="flex items-center justify-center gap-3 py-3">
                        <span className="text-lg font-black tabular-nums" style={{ color: t1Won ? C.green : "rgba(236,232,225,0.2)" }}>{result.score1}</span>
                        <span className="text-xs" style={{ color: "rgba(236,232,225,0.08)" }}>:</span>
                        <span className="text-lg font-black tabular-nums" style={{ color: !t1Won ? C.green : "rgba(236,232,225,0.2)" }}>{result.score2}</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Actions */}
              <div className="vct-animate-slide-up flex gap-4 pt-3" style={{ animationDelay: "0.6s" }}>
                <button
                  onClick={() => router.push(`/match/${matchId}`)}
                  className="group relative overflow-hidden rounded-lg px-9 py-3.5 transition-all duration-500 hover:scale-105"
                  style={{ background: C.red, color: C.white, boxShadow: "0 0 20px rgba(255,70,85,0.2)" }}
                >
                  <div className="absolute inset-0 overflow-hidden" style={{ background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%)", animation: "vct-glow-sweep 2s ease infinite" }} />
                  <span className="relative text-xs font-black uppercase tracking-[0.15em]">View Full Match Details</span>
                </button>
                <button
                  onClick={() => router.push("/dashboard")}
                  className="rounded-lg px-9 py-3.5 text-xs font-bold uppercase tracking-[0.15em] transition-all duration-300 hover:scale-105"
                  style={{ background: "rgba(255,255,255,0.03)", color: "rgba(236,232,225,0.4)", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  Back to Dashboard
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
