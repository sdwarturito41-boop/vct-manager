"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc-client";

import { getMapImage } from "@/constants/maps";

// ── Veto sequence definitions ──

type VetoActionType = "ban" | "pick";
type TeamSide = "team1" | "team2";

interface VetoStep {
  type: VetoActionType;
  team: TeamSide;
  label: string;
}

interface VetoAction {
  type: VetoActionType;
  map: string;
  team: TeamSide;
}

const BO3_SEQUENCE: VetoStep[] = [
  { type: "ban", team: "team1", label: "Team 1 Ban" },
  { type: "ban", team: "team2", label: "Team 2 Ban" },
  { type: "pick", team: "team1", label: "Team 1 Pick" },
  { type: "pick", team: "team2", label: "Team 2 Pick" },
  { type: "ban", team: "team1", label: "Team 1 Ban" },
  { type: "ban", team: "team2", label: "Team 2 Ban" },
];

const BO5_SEQUENCE: VetoStep[] = [
  { type: "ban", team: "team1", label: "Team 1 Ban" },
  { type: "ban", team: "team2", label: "Team 2 Ban" },
  { type: "pick", team: "team1", label: "Team 1 Pick" },
  { type: "pick", team: "team2", label: "Team 2 Pick" },
  { type: "pick", team: "team1", label: "Team 1 Pick" },
  { type: "pick", team: "team2", label: "Team 2 Pick" },
];

// ── Component ──

export default function VetoPage() {
  const params = useParams<{ matchId: string }>();
  const router = useRouter();
  const matchId = params.matchId;

  const { data: vetoState, isLoading } = trpc.veto.getVetoState.useQuery(
    { matchId },
    { enabled: !!matchId }
  );

  const executeVeto = trpc.veto.executeVeto.useMutation();
  const simulateMatch = trpc.match.simulate.useMutation();

  const [actions, setActions] = useState<VetoAction[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [isComplete, setIsComplete] = useState(false);
  const [finalMaps, setFinalMaps] = useState<string[]>([]);
  const [isSimulating, setIsSimulating] = useState(false);
  const [aiThinking, setAiThinking] = useState(false);

  // Derived state
  const format =
    vetoState && !vetoState.done ? vetoState.format : "BO3";
  const sequence = format === "BO5" ? BO5_SEQUENCE : BO3_SEQUENCE;
  const isTeam1 =
    vetoState && !vetoState.done ? vetoState.isTeam1 : true;
  const playerSide: TeamSide = isTeam1 ? "team1" : "team2";
  const mapPool =
    vetoState && !vetoState.done
      ? vetoState.mapPool
      : [];

  // Maps that are banned or picked
  const bannedMaps = actions
    .filter((a) => a.type === "ban")
    .map((a) => a.map);
  const pickedMaps = actions
    .filter((a) => a.type === "pick")
    .map((a) => a.map);
  const availableMaps = mapPool.filter(
    (m) => !bannedMaps.includes(m) && !pickedMaps.includes(m)
  );

  // Current step info
  const currentStepInfo = currentStep < sequence.length ? sequence[currentStep] : null;
  const isPlayerTurn = currentStepInfo?.team === playerSide;

  // Compute final maps when veto completes
  const computeFinalMaps = useCallback(
    (allActions: VetoAction[]) => {
      const picked = allActions
        .filter((a) => a.type === "pick")
        .map((a) => a.map);
      const banned = allActions
        .filter((a) => a.type === "ban")
        .map((a) => a.map);
      const remaining = mapPool.filter(
        (m) => !picked.includes(m) && !banned.includes(m)
      );
      const mapCount = format === "BO5" ? 5 : 3;
      return [...picked, ...remaining].slice(0, mapCount);
    },
    [mapPool, format]
  );

  // Handle player selecting a map
  const handleMapSelect = useCallback(
    (map: string) => {
      if (!currentStepInfo || !isPlayerTurn || isComplete || aiThinking) return;

      const action: VetoAction = {
        type: currentStepInfo.type,
        map,
        team: playerSide,
      };

      const newActions = [...actions, action];
      setActions(newActions);

      if (currentStep + 1 >= sequence.length) {
        // Veto sequence done, remaining map is decider
        const maps = computeFinalMaps(newActions);
        setFinalMaps(maps);
        setIsComplete(true);
      } else {
        setCurrentStep(currentStep + 1);
      }
    },
    [
      currentStepInfo,
      isPlayerTurn,
      isComplete,
      aiThinking,
      actions,
      currentStep,
      sequence.length,
      playerSide,
      computeFinalMaps,
    ]
  );

  // AI auto-select when it's the AI's turn
  const aiThinkingRef = useRef(false);

  useEffect(() => {
    if (
      !currentStepInfo ||
      isComplete ||
      isPlayerTurn ||
      aiThinkingRef.current ||
      mapPool.length === 0
    )
      return;

    aiThinkingRef.current = true;
    setAiThinking(true);

    const currentBanned = actions
      .filter((a) => a.type === "ban")
      .map((a) => a.map);
    const currentPicked = actions
      .filter((a) => a.type === "pick")
      .map((a) => a.map);
    const currentAvailable = mapPool.filter(
      (m) => !currentBanned.includes(m) && !currentPicked.includes(m)
    );

    const timer = setTimeout(() => {
      const randomIndex = Math.floor(Math.random() * currentAvailable.length);
      const aiMap = currentAvailable[randomIndex];
      if (!aiMap) { aiThinkingRef.current = false; setAiThinking(false); return; }

      const aiSide: TeamSide = isTeam1 ? "team2" : "team1";
      const action: VetoAction = {
        type: currentStepInfo.type,
        map: aiMap,
        team: aiSide,
      };

      const newActions = [...actions, action];
      setActions(newActions);
      aiThinkingRef.current = false;
      setAiThinking(false);

      if (currentStep + 1 >= sequence.length) {
        const maps = computeFinalMaps(newActions);
        setFinalMaps(maps);
        setIsComplete(true);
      } else {
        setCurrentStep(currentStep + 1);
      }
    }, 1000);

    return () => { clearTimeout(timer); aiThinkingRef.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentStep, isComplete, isPlayerTurn]);

  // Submit veto and simulate
  const handleSimulate = async () => {
    if (!isComplete || finalMaps.length === 0) return;
    setIsSimulating(true);

    try {
      await executeVeto.mutateAsync({ matchId, actions });
      await simulateMatch.mutateAsync({ matchId });
      router.push(`/match/${matchId}`);
    } catch {
      setIsSimulating(false);
    }
  };

  // ── Render ──

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-sm text-[var(--val-white)]/30">Loading...</div>
      </div>
    );
  }

  if (!vetoState) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-sm text-[var(--val-red)]">Match not found.</div>
      </div>
    );
  }

  if (vetoState.done) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <div className="text-sm text-[var(--val-white)]/30">
          Veto already completed for this match.
        </div>
        <button
          onClick={() => router.push(`/match/${matchId}`)}
          className="rounded bg-[var(--val-red)] px-6 py-2 text-sm font-bold uppercase tracking-wider text-white transition-colors hover:bg-[var(--val-red)]/80"
        >
          View Match
        </button>
      </div>
    );
  }

  const { match } = vetoState;
  const team1Name = match.team1.name;
  const team2Name = match.team2.name;

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* Back link */}
      <a
        href="/dashboard"
        className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-[var(--val-white)]/40 transition-colors hover:text-[var(--val-red)]"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M15 19l-7-7 7-7"
          />
        </svg>
        Back to Dashboard
      </a>

      {/* Match header */}
      <div className="rounded-lg border border-[var(--val-gray)] bg-[var(--val-surface)] p-6">
        <div className="mb-3 text-center text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--val-white)]/30">
          Map Veto &middot; {format}
        </div>
        <div className="flex items-center justify-center gap-6">
          <div className="text-right">
            <div
              className={`text-xl font-black uppercase tracking-[0.1em] ${
                isTeam1
                  ? "text-[var(--val-white)]"
                  : "text-[var(--val-white)]/60"
              }`}
            >
              {team1Name}
            </div>
            <div className="text-xs text-[var(--val-white)]/30">
              [{match.team1.tag}]
            </div>
          </div>
          <span className="text-lg font-bold text-[var(--val-red)]">VS</span>
          <div className="text-left">
            <div
              className={`text-xl font-black uppercase tracking-[0.1em] ${
                !isTeam1
                  ? "text-[var(--val-white)]"
                  : "text-[var(--val-white)]/60"
              }`}
            >
              {team2Name}
            </div>
            <div className="text-xs text-[var(--val-white)]/30">
              [{match.team2.tag}]
            </div>
          </div>
        </div>
      </div>

      {/* Veto sequence indicator */}
      <div className="flex items-center justify-center gap-1">
        {sequence.map((step, i) => {
          const isDone = i < currentStep;
          const isCurrent = i === currentStep && !isComplete;
          const action = actions[i];

          return (
            <div
              key={i}
              className={`flex flex-col items-center rounded px-3 py-2 text-center transition-all ${
                isCurrent
                  ? "bg-[var(--val-red)]/20 ring-1 ring-[var(--val-red)]"
                  : isDone
                    ? "bg-[var(--val-surface)] opacity-60"
                    : "bg-[var(--val-surface)] opacity-30"
              }`}
            >
              <span
                className={`text-[9px] font-bold uppercase tracking-wider ${
                  step.type === "ban"
                    ? "text-[var(--val-red)]"
                    : "text-[var(--val-green)]"
                }`}
              >
                {step.type}
              </span>
              <span className="text-[10px] text-[var(--val-white)]/50">
                {step.team === "team1" ? match.team1.tag : match.team2.tag}
              </span>
              {isDone && action && (
                <span className="mt-0.5 text-[9px] font-semibold text-[var(--val-white)]/70">
                  {action.map}
                </span>
              )}
            </div>
          );
        })}
        {/* Decider indicator */}
        <div
          className={`flex flex-col items-center rounded px-3 py-2 text-center transition-all ${
            isComplete
              ? "bg-[var(--val-gold)]/20 ring-1 ring-[var(--val-gold)]"
              : "bg-[var(--val-surface)] opacity-30"
          }`}
        >
          <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--val-gold)]">
            Decider
          </span>
          <span className="text-[10px] text-[var(--val-white)]/50">Auto</span>
          {isComplete && finalMaps.length > 0 && (
            <span className="mt-0.5 text-[9px] font-semibold text-[var(--val-white)]/70">
              {finalMaps[finalMaps.length - 1]}
            </span>
          )}
        </div>
      </div>

      {/* Current action label */}
      {!isComplete && (
        <div className="text-center">
          {aiThinking ? (
            <div className="inline-flex items-center gap-2 rounded-full bg-[var(--val-surface)] px-4 py-2">
              <div className="h-2 w-2 animate-pulse rounded-full bg-[var(--val-red)]" />
              <span className="text-sm font-semibold text-[var(--val-white)]/70">
                {!isTeam1 ? team1Name : team2Name} is{" "}
                {currentStepInfo?.type === "ban" ? "banning" : "picking"}...
              </span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 rounded-full bg-[var(--val-red)]/10 px-4 py-2">
              <span className="text-sm font-semibold text-[var(--val-white)]">
                Your turn to{" "}
                <span
                  className={
                    currentStepInfo?.type === "ban"
                      ? "text-[var(--val-red)]"
                      : "text-[var(--val-green)]"
                  }
                >
                  {currentStepInfo?.type === "ban" ? "BAN" : "PICK"}
                </span>{" "}
                a map
              </span>
            </div>
          )}
        </div>
      )}

      {/* Map cards grid */}
      <div className="grid grid-cols-7 gap-3">
        {mapPool.map((mapName) => {
          const isBanned = bannedMaps.includes(mapName);
          const isPicked = pickedMaps.includes(mapName);
          const isAvailable = availableMaps.includes(mapName);
          const canSelect = isPlayerTurn && isAvailable && !isComplete && !aiThinking;
          const whoActed = actions.find((a) => a.map === mapName);

          return (
            <button
              key={mapName}
              onClick={() => canSelect && handleMapSelect(mapName)}
              disabled={!canSelect}
              className={`group relative aspect-[16/10] overflow-hidden rounded-lg border transition-all ${
                isBanned
                  ? "border-[var(--val-red)]/30 opacity-40 grayscale"
                  : isPicked
                    ? "border-[var(--val-green)] ring-2 ring-[var(--val-green)]/50"
                    : canSelect
                      ? "cursor-pointer border-[var(--val-gray)] hover:border-[var(--val-white)]/50 hover:scale-105"
                      : "border-[var(--val-gray)] opacity-60"
              }`}
            >
              {/* Map image background */}
              <img
                src={getMapImage(mapName)}
                alt={mapName}
                className="absolute inset-0 h-full w-full object-cover"
              />

              {/* Dark overlay */}
              <div className="absolute inset-0 bg-black/40" />

              {/* Ban overlay */}
              {isBanned && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                  <svg
                    className="h-10 w-10 text-[var(--val-red)]"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </div>
              )}

              {/* Pick overlay */}
              {isPicked && (
                <div className="absolute inset-0 flex items-center justify-center bg-[var(--val-green)]/10">
                  <svg
                    className="h-10 w-10 text-[var(--val-green)]"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </div>
              )}

              {/* Map name */}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                <div className="text-xs font-bold uppercase tracking-wider text-white">
                  {mapName}
                </div>
                {whoActed && (
                  <div
                    className={`text-[9px] font-semibold uppercase tracking-wider ${
                      whoActed.type === "ban"
                        ? "text-[var(--val-red)]/80"
                        : "text-[var(--val-green)]/80"
                    }`}
                  >
                    {whoActed.type === "ban" ? "Banned" : "Picked"} by{" "}
                    {whoActed.team === "team1"
                      ? match.team1.tag
                      : match.team2.tag}
                  </div>
                )}
              </div>

              {/* Hover highlight for selectable maps */}
              {canSelect && (
                <div className="absolute inset-0 bg-white/0 transition-colors group-hover:bg-white/10" />
              )}
            </button>
          );
        })}
      </div>

      {/* Veto complete: final maps summary */}
      {isComplete && finalMaps.length > 0 && (
        <div className="space-y-6">
          <div className="rounded-lg border border-[var(--val-gray)] bg-[var(--val-surface)] p-6">
            <h3 className="mb-4 text-center text-xs font-semibold uppercase tracking-[0.2em] text-[var(--val-white)]/30">
              Maps Selected
            </h3>
            <div className="flex items-center justify-center gap-4">
              {finalMaps.map((mapName, i) => {
                const isDecider = i === finalMaps.length - 1;
                return (
                  <div key={mapName} className="flex flex-col items-center gap-2">
                    <div className="relative aspect-[16/10] w-36 overflow-hidden rounded-lg border border-[var(--val-gray)]">
                      <img
                        src={getMapImage(mapName)}
                        alt={mapName}
                        className="h-full w-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/30" />
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-2">
                        <div className="text-xs font-bold uppercase tracking-wider text-white">
                          {mapName}
                        </div>
                      </div>
                    </div>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider ${
                        isDecider
                          ? "text-[var(--val-gold)]"
                          : "text-[var(--val-white)]/40"
                      }`}
                    >
                      {isDecider ? "Decider" : `Map ${i + 1}`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex justify-center">
            <button
              onClick={handleSimulate}
              disabled={isSimulating}
              className="rounded bg-[var(--val-red)] px-8 py-3 text-sm font-black uppercase tracking-[0.15em] text-white transition-all hover:bg-[var(--val-red)]/80 hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
            >
              {isSimulating ? (
                <span className="flex items-center gap-2">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Simulating...
                </span>
              ) : (
                "Simulate Match"
              )}
            </button>
          </div>
        </div>
      )}

      {/* Veto log */}
      {actions.length > 0 && (
        <div className="rounded-lg border border-[var(--val-gray)] bg-[var(--val-surface)] p-4">
          <h4 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--val-white)]/20">
            Veto Log
          </h4>
          <div className="space-y-1">
            {actions.map((action, i) => (
              <div
                key={i}
                className="flex items-center gap-2 text-xs text-[var(--val-white)]/50"
              >
                <span className="w-4 text-right text-[var(--val-white)]/20">
                  {i + 1}.
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                    action.type === "ban"
                      ? "bg-[var(--val-red)]/10 text-[var(--val-red)]"
                      : "bg-[var(--val-green)]/10 text-[var(--val-green)]"
                  }`}
                >
                  {action.type}
                </span>
                <span className="font-semibold text-[var(--val-white)]/70">
                  {action.team === "team1" ? match.team1.tag : match.team2.tag}
                </span>
                <span className="text-[var(--val-white)]/30">removed</span>
                <span className="font-semibold text-[var(--val-white)]">
                  {action.map}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
