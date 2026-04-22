"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ── Types ──

type PlayerRole = "IGL" | "Duelist" | "Initiator" | "Sentinel" | "Controller";
type AgentRole = "Controller" | "Duelist" | "Initiator" | "Sentinel";
type MetaStatus = "hot" | "neutral" | "weak";
type RoleFilter = "ALL" | AgentRole;

interface AgentMastery {
  agentName: string;
  role: AgentRole;
  stars: number;
  metaStatus: MetaStatus;
  simulationBonus: number;
}

interface Player {
  ign: string;
  role: PlayerRole;
  photoUrl?: string;
  agentPool: AgentMastery[];
  lockedAgent?: string;
  isPicking: boolean;
}

interface AgentPickScreenProps {
  mapName: string;
  mapImageUrl: string;
  stageLabel?: string;
  formatLabel?: string;
  myTeam: Player[];
  opponentLockedCount: number;
  onLockIn: (agentName: string) => void;
  timeLimit: number;
}

// ── Constants ──

const ROLE_TINT: Record<AgentRole, string> = {
  Controller: "#8B5CF6",
  Duelist: "#FF4655",
  Initiator: "#22C55E",
  Sentinel: "#3B82F6",
};

const ROLE_BG: Record<AgentRole, string> = {
  Controller: "rgba(139,92,246,0.25)",
  Duelist: "rgba(255,70,85,0.25)",
  Initiator: "rgba(34,197,94,0.25)",
  Sentinel: "rgba(59,130,246,0.25)",
};

const ROLE_PILL_BG: Record<string, string> = {
  IGL: "rgba(198,155,58,0.2)",
  Duelist: "rgba(255,70,85,0.15)",
  Initiator: "rgba(34,197,94,0.15)",
  Sentinel: "rgba(59,130,246,0.15)",
  Controller: "rgba(139,92,246,0.15)",
};

const ROLE_PILL_COLOR: Record<string, string> = {
  IGL: "#C69B3A",
  Duelist: "#FF4655",
  Initiator: "#22C55E",
  Sentinel: "#3B82F6",
  Controller: "#8B5CF6",
};

const FILTERS: RoleFilter[] = ["ALL", "Controller", "Duelist", "Initiator", "Sentinel"];

// ── Helpers ──

function Stars({ count, max = 5 }: { count: number; max?: number }) {
  return (
    <span className="text-[11px] tracking-wider">
      {Array.from({ length: max }, (_, i) => (
        <span key={i} style={{ color: i < count ? "#C69B3A" : "rgba(255,255,255,0.15)" }}>
          ★
        </span>
      ))}
    </span>
  );
}

function PickingDots() {
  return (
    <span className="inline-flex items-center gap-[3px]">
      <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#FF4655" }}>
        Picking
      </span>
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="inline-block h-1 w-1 rounded-full"
          style={{ background: "#FF4655" }}
          animate={{ opacity: [0.2, 1, 0.2] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
        />
      ))}
    </span>
  );
}

// ── Component ──

export default function AgentPickScreen({
  mapName,
  mapImageUrl,
  stageLabel = "GROUP STAGE",
  formatLabel = "BO3",
  myTeam: initialTeam,
  opponentLockedCount,
  onLockIn,
  timeLimit,
}: AgentPickScreenProps) {
  const [team, setTeam] = useState<Player[]>(initialTeam);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("ALL");
  const [timer, setTimer] = useState(timeLimit);
  const [favoritesOnly, setFavoritesOnly] = useState(false);

  // Current picking player
  const pickingPlayer = team.find((p) => p.isPicking);
  const pickingIndex = team.findIndex((p) => p.isPicking);

  // All locked agents across team
  const lockedAgentNames = team
    .filter((p) => p.lockedAgent)
    .map((p) => p.lockedAgent!);

  // Agents locked by specific teammates (for overlay labels)
  const agentLockedBy = new Map<string, string>();
  for (const p of team) {
    if (p.lockedAgent) agentLockedBy.set(p.lockedAgent, p.ign);
  }

  // Collect all unique agents across all players' pools
  const allAgents = (() => {
    const map = new Map<string, AgentMastery>();
    for (const p of team) {
      for (const a of p.agentPool) {
        if (!map.has(a.agentName)) map.set(a.agentName, a);
      }
    }
    return Array.from(map.values());
  })();

  // Filter agents
  const filteredAgents = allAgents.filter((a) => {
    if (roleFilter !== "ALL" && a.role !== roleFilter) return false;
    if (favoritesOnly && pickingPlayer) {
      const inPool = pickingPlayer.agentPool.find((pa) => pa.agentName === a.agentName);
      if (!inPool || inPool.stars < 3) return false;
    }
    return true;
  });

  // Missing roles check
  const coveredRoles = new Set<string>();
  for (const p of team) {
    if (p.lockedAgent) {
      const agentEntry = allAgents.find((a) => a.agentName === p.lockedAgent);
      if (agentEntry) coveredRoles.add(agentEntry.role);
    }
  }
  if (selectedAgent) {
    const selEntry = allAgents.find((a) => a.agentName === selectedAgent);
    if (selEntry) coveredRoles.add(selEntry.role);
  }
  const essentialRoles: AgentRole[] = ["Controller", "Duelist", "Initiator", "Sentinel"];
  const missingRoles = essentialRoles.filter((r) => !coveredRoles.has(r));

  // Timer countdown
  useEffect(() => {
    if (timer <= 0) return;
    const interval = setInterval(() => setTimer((t) => Math.max(0, t - 1)), 1000);
    return () => clearInterval(interval);
  }, [timer]);

  // Selected agent info
  const selectedInfo = selectedAgent
    ? allAgents.find((a) => a.agentName === selectedAgent) ?? null
    : null;
  const playerMasteryForSelected =
    selectedAgent && pickingPlayer
      ? pickingPlayer.agentPool.find((a) => a.agentName === selectedAgent)
      : null;

  // Lock in handler
  const handleLockIn = useCallback(() => {
    if (!selectedAgent || !pickingPlayer) return;

    onLockIn(selectedAgent);

    setTeam((prev) => {
      const updated = prev.map((p) => {
        if (p.isPicking) return { ...p, lockedAgent: selectedAgent, isPicking: false };
        return p;
      });
      // Advance to next unlocked player
      const nextIdx = updated.findIndex((p) => !p.lockedAgent);
      if (nextIdx !== -1) {
        updated[nextIdx] = { ...updated[nextIdx], isPicking: true };
      }
      return updated;
    });
    setSelectedAgent(null);
  }, [selectedAgent, pickingPlayer, onLockIn]);

  return (
    <div className="relative h-screen w-screen overflow-hidden" style={{ fontFamily: "'Rajdhani', 'Inter', sans-serif" }}>
      {/* ── Blurred map background ── */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `url(${mapImageUrl})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
          filter: "blur(24px)",
          transform: "scale(1.1)",
        }}
      />
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.72)" }} />

      {/* ── All UI ── */}
      <div className="relative z-10 flex h-full flex-col">
        {/* ── Top bar: map name + info ── */}
        <div className="flex items-end gap-3 px-6 pt-5 pb-2">
          <h1 className="text-2xl font-black uppercase tracking-wider text-white">{mapName}</h1>
          <span className="mb-0.5 text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: "rgba(255,255,255,0.3)" }}>
            {stageLabel} · {formatLabel}
          </span>
        </div>

        {/* ── Main 2-col layout ── */}
        <div className="flex flex-1 overflow-hidden">
          {/* ═══ LEFT PANEL — Player roster ═══ */}
          <div
            className="flex w-[280px] shrink-0 flex-col justify-between py-2 pl-3 pr-2"
            style={{ borderRight: "1px solid rgba(255,255,255,0.06)" }}
          >
            <div className="flex flex-1 flex-col justify-center gap-1">
              {team.map((player, idx) => {
                const isActive = player.isPicking;
                const isLocked = !!player.lockedAgent;
                const agentData = player.lockedAgent
                  ? allAgents.find((a) => a.agentName === player.lockedAgent)
                  : null;

                return (
                  <motion.div
                    key={player.ign}
                    layout
                    className="relative flex items-center gap-3 rounded-lg px-3 py-3"
                    style={{
                      background: isActive
                        ? "rgba(255,70,85,0.12)"
                        : isLocked
                          ? "rgba(255,255,255,0.04)"
                          : "transparent",
                      borderLeft: isActive ? "3px solid #FF4655" : "3px solid transparent",
                    }}
                  >
                    {/* Player photo */}
                    <div
                      className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg"
                      style={{
                        background: "rgba(255,255,255,0.06)",
                        border: isActive ? "2px solid #FF4655" : isLocked ? "2px solid rgba(198,155,58,0.3)" : "2px solid rgba(255,255,255,0.06)",
                      }}
                    >
                      {player.photoUrl ? (
                        <img src={player.photoUrl} alt={player.ign} className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-lg font-bold" style={{ color: "rgba(255,255,255,0.15)" }}>
                          {player.ign.charAt(0)}
                        </span>
                      )}
                    </div>

                    {/* Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[15px] font-bold text-white">{player.ign}</span>
                        <span
                          className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                          style={{
                            background: ROLE_PILL_BG[player.role] ?? "rgba(255,255,255,0.08)",
                            color: ROLE_PILL_COLOR[player.role] ?? "rgba(255,255,255,0.5)",
                          }}
                        >
                          {player.role}
                        </span>
                      </div>

                      {isLocked && agentData ? (
                        <motion.div
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="mt-0.5 flex items-center gap-1.5"
                        >
                          <div
                            className="h-5 w-5 rounded"
                            style={{ background: ROLE_BG[agentData.role] }}
                          />
                          <span className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.6)" }}>
                            {player.lockedAgent}
                          </span>
                        </motion.div>
                      ) : isActive ? (
                        <div className="mt-0.5">
                          <PickingDots />
                        </div>
                      ) : (
                        <div className="mt-0.5 text-xs" style={{ color: "rgba(255,255,255,0.15)" }}>
                          —
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {/* Missing role warning */}
            <AnimatePresence>
              {missingRoles.length > 0 && team.filter((p) => !p.lockedAgent).length <= 2 && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="mt-2 rounded-lg px-3 py-2 text-xs font-bold text-white"
                  style={{ background: "rgba(255,70,85,0.8)" }}
                >
                  ⚠ NO {missingRoles[0]?.toUpperCase()} SELECTED
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ═══ CENTER PANEL — Agent grid ═══ */}
          <div className="flex flex-1 flex-col overflow-hidden px-6 py-3">
            {/* Role filter tabs */}
            <div className="mb-4 flex items-center gap-2">
              {FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => setRoleFilter(f)}
                  className="rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wider transition-all duration-200"
                  style={{
                    background: roleFilter === f ? "rgba(255,255,255,0.95)" : "transparent",
                    color: roleFilter === f ? "#0a0a14" : "rgba(255,255,255,0.35)",
                    border: roleFilter === f ? "none" : "1px solid rgba(255,255,255,0.08)",
                  }}
                >
                  {f === "ALL" ? "All" : `${f}s`}
                </button>
              ))}

              <div className="flex-1" />

              {/* Favorites toggle */}
              <button
                onClick={() => setFavoritesOnly(!favoritesOnly)}
                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all duration-200"
                style={{
                  background: favoritesOnly ? "rgba(198,155,58,0.15)" : "transparent",
                  color: favoritesOnly ? "#C69B3A" : "rgba(255,255,255,0.25)",
                  border: favoritesOnly ? "1px solid rgba(198,155,58,0.3)" : "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <span>★</span>
                <span>Favorites</span>
              </button>
            </div>

            {/* Agent grid */}
            <div className="flex-1 overflow-y-auto pr-1" style={{ scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.1) transparent" }}>
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(7, 1fr)" }}>
                {filteredAgents.map((agent) => {
                  const isSelected = selectedAgent === agent.agentName;
                  const isLockedByTeammate = lockedAgentNames.includes(agent.agentName);
                  const lockedByIgn = agentLockedBy.get(agent.agentName);
                  const playerMastery = pickingPlayer?.agentPool.find((a) => a.agentName === agent.agentName);
                  const stars = playerMastery?.stars ?? 0;

                  return (
                    <motion.button
                      key={agent.agentName}
                      onClick={() => {
                        if (!isLockedByTeammate && pickingPlayer) setSelectedAgent(agent.agentName);
                      }}
                      disabled={isLockedByTeammate || !pickingPlayer}
                      whileHover={!isLockedByTeammate ? { scale: 1.04 } : undefined}
                      whileTap={!isLockedByTeammate ? { scale: 0.97 } : undefined}
                      className="group relative flex flex-col overflow-hidden rounded-lg transition-all duration-200"
                      style={{
                        border: isSelected
                          ? "2px solid #C69B3A"
                          : "2px solid rgba(255,255,255,0.06)",
                        opacity: isLockedByTeammate ? 0.3 : 1,
                        cursor: isLockedByTeammate ? "not-allowed" : "pointer",
                        boxShadow: isSelected ? "0 0 20px rgba(198,155,58,0.2)" : "none",
                      }}
                    >
                      {/* Agent portrait placeholder */}
                      <div
                        className="relative flex items-center justify-center"
                        style={{
                          aspectRatio: "1 / 1.1",
                          background: `linear-gradient(135deg, ${ROLE_BG[agent.role]} 0%, rgba(0,0,0,0.3) 100%)`,
                        }}
                      >
                        <span className="text-2xl font-black uppercase" style={{ color: ROLE_TINT[agent.role], opacity: 0.4 }}>
                          {agent.agentName.charAt(0)}
                        </span>

                        {/* Meta badge */}
                        {agent.metaStatus !== "neutral" && (
                          <div
                            className="absolute right-1 top-1 rounded px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider"
                            style={{
                              background: agent.metaStatus === "hot" ? "rgba(255,70,85,0.9)" : "rgba(120,120,120,0.7)",
                              color: "white",
                            }}
                          >
                            {agent.metaStatus === "hot" ? "META" : "WEAK"}
                          </div>
                        )}

                        {/* Selected gold tint */}
                        {isSelected && (
                          <div className="absolute inset-0" style={{ background: "rgba(198,155,58,0.12)" }} />
                        )}

                        {/* Locked by teammate overlay */}
                        {isLockedByTeammate && lockedByIgn && (
                          <div className="absolute inset-x-0 bottom-0 flex items-center justify-center py-1" style={{ background: "rgba(0,0,0,0.7)" }}>
                            <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.5)" }}>
                              {lockedByIgn}
                            </span>
                          </div>
                        )}

                        {/* Hover border highlight */}
                        {!isLockedByTeammate && !isSelected && (
                          <div className="absolute inset-0 rounded-lg border border-white/0 transition-all duration-200 group-hover:border-white/30" />
                        )}
                      </div>

                      {/* Agent name + stars */}
                      <div className="flex flex-col items-center gap-0.5 px-1 py-1.5" style={{ background: "rgba(0,0,0,0.4)" }}>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-white">{agent.agentName}</span>
                        <Stars count={stars} />
                      </div>
                    </motion.button>
                  );
                })}
              </div>
            </div>

            {/* ── Agent info strip (below grid when selected) ── */}
            <AnimatePresence>
              {selectedInfo && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 20 }}
                  transition={{ duration: 0.25 }}
                  className="mt-3 flex items-center gap-6 rounded-xl px-6 py-4"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
                >
                  {/* Agent name + role */}
                  <div>
                    <div className="text-[32px] font-black uppercase leading-none tracking-wider text-white">
                      {selectedInfo.agentName}
                    </div>
                    <span
                      className="mt-1 inline-block rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                      style={{ background: ROLE_BG[selectedInfo.role], color: ROLE_TINT[selectedInfo.role] }}
                    >
                      {selectedInfo.role}
                    </span>
                  </div>

                  {/* Ability placeholders */}
                  <div className="flex gap-2">
                    {(["C", "Q", "E", "X"] as const).map((key) => (
                      <div key={key} className="flex flex-col items-center gap-1">
                        <div
                          className="flex h-10 w-10 items-center justify-center rounded-full"
                          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                        >
                          <span className="text-xs font-bold text-white/30">{key}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mx-2 h-10 w-px" style={{ background: "rgba(255,255,255,0.08)" }} />

                  {/* Mastery */}
                  <div className="flex flex-col gap-0.5">
                    <Stars count={playerMasteryForSelected?.stars ?? 0} />
                    <span className="text-[11px] font-semibold" style={{ color: "rgba(255,255,255,0.4)" }}>
                      {playerMasteryForSelected?.stars ?? 0} stars · {(playerMasteryForSelected?.stars ?? 0) >= 4 ? "Strong" : (playerMasteryForSelected?.stars ?? 0) >= 2 ? "Decent" : "Weak"} on {mapName}
                    </span>
                  </div>

                  <div className="mx-2 h-10 w-px" style={{ background: "rgba(255,255,255,0.08)" }} />

                  {/* Meta status */}
                  <div>
                    {selectedInfo.metaStatus === "hot" ? (
                      <span className="text-xs font-bold" style={{ color: "#22C55E" }}>
                        META PICK · +{Math.round(selectedInfo.simulationBonus * 100)}% simulation bonus
                      </span>
                    ) : selectedInfo.metaStatus === "weak" ? (
                      <span className="text-xs font-bold" style={{ color: "#FF4655" }}>
                        WEAK PATCH · {Math.round(selectedInfo.simulationBonus * 100)}% simulation penalty
                      </span>
                    ) : (
                      <span className="text-xs font-semibold" style={{ color: "rgba(255,255,255,0.3)" }}>
                        Neutral meta
                      </span>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* ═══ BOTTOM BAR ═══ */}
        <div
          className="flex items-center justify-between px-6 py-3"
          style={{ background: "rgba(0,0,0,0.4)", borderTop: "1px solid rgba(255,255,255,0.06)" }}
        >
          {/* Opponent status */}
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              {[0, 1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="text-sm"
                  style={{
                    color: i < opponentLockedCount ? "#FF4655" : "rgba(255,255,255,0.12)",
                  }}
                >
                  ◆
                </div>
              ))}
            </div>
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: "rgba(255,255,255,0.35)" }}>
              Opponent locked: {opponentLockedCount}/5
            </span>
          </div>

          {/* Timer */}
          <motion.div
            animate={timer <= 10 ? { color: ["#FF4655", "#ffffff", "#FF4655"] } : {}}
            transition={timer <= 10 ? { duration: 1, repeat: Infinity } : {}}
            className="text-center"
          >
            <span
              className="text-5xl font-black tabular-nums"
              style={{
                color: timer <= 10 ? "#FF4655" : "white",
              }}
            >
              {timer}
            </span>
          </motion.div>

          {/* Lock In button */}
          <motion.button
            onClick={handleLockIn}
            disabled={!selectedAgent || !pickingPlayer}
            whileHover={selectedAgent ? { scale: 1.03 } : undefined}
            whileTap={selectedAgent ? { scale: 0.97 } : undefined}
            className="relative overflow-hidden rounded font-black uppercase tracking-[0.3em]"
            style={{
              width: 200,
              height: 52,
              background: selectedAgent ? "#FF4655" : "rgba(255,255,255,0.06)",
              color: selectedAgent ? "white" : "rgba(255,255,255,0.15)",
              cursor: selectedAgent ? "pointer" : "not-allowed",
              fontSize: 16,
              boxShadow: selectedAgent ? "0 0 30px rgba(255,70,85,0.3)" : "none",
            }}
          >
            {selectedAgent && (
              <motion.div
                className="absolute inset-0"
                style={{
                  background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.12) 50%, transparent 100%)",
                }}
                animate={{ x: ["-100%", "100%"] }}
                transition={{ duration: 2.5, repeat: Infinity, ease: "linear" }}
              />
            )}
            <span className="relative">LOCK IN</span>
          </motion.button>
        </div>
      </div>
    </div>
  );
}
