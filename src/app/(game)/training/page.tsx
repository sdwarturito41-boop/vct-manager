"use client";

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { VALORANT_AGENTS } from "@/constants/agents";
import { getActiveMapPool } from "@/constants/maps";
import { D } from "@/constants/design";

const FOCUS_OPTIONS = [
  { value: "AGENT_MASTERY", label: "Agent Mastery", desc: "+0.1–0.2 stars on an agent/map combo" },
  { value: "MAP_FACTOR", label: "Map Factor", desc: "+0.01–0.03 to player's map factor" },
  { value: "AIM", label: "Aim Drills", desc: "+1–3 team aim skill" },
  { value: "UTILITY", label: "Utility Lab", desc: "+1–3 team utility skill" },
  { value: "TEAM_SYNERGY", label: "Team Synergy", desc: "+0.5 team teamplay skill" },
] as const;

type FocusValue = (typeof FOCUS_OPTIONS)[number]["value"];

export default function TrainingPage() {
  const { data: team, isLoading: loadingTeam } = trpc.team.get.useQuery(undefined, { retry: false });
  const { data: season } = trpc.season.getCurrent.useQuery(undefined, { retry: false });
  const { data: slots } = trpc.training.getTrainingSlots.useQuery(undefined, { retry: false });
  const { data: sessions = [] } = trpc.training.listMyTrainings.useQuery(undefined, { retry: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const myCoachQuery = trpc.coach.listMyCoach.useQuery(undefined, { retry: false }) as any;
  const myCoach = myCoachQuery.data as { name: string; trainingEff: number } | null | undefined;
  const utils = trpc.useUtils();

  const [playerId, setPlayerId] = useState<string>("");
  const [focus, setFocus] = useState<FocusValue>("AIM");
  const [agentName, setAgentName] = useState<string>("");
  const [mapName, setMapName] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  const activePool = useMemo(
    () => (season?.currentStage ? getActiveMapPool(season.currentStage) : []),
    [season?.currentStage],
  );

  const createTraining = trpc.training.createTraining.useMutation({
    onSuccess: () => {
      utils.training.getTrainingSlots.invalidate();
      utils.training.listMyTrainings.invalidate();
      utils.team.get.invalidate();
      utils.player.roster.invalidate();
      setAgentName("");
      setMapName("");
      setErr(null);
    },
    onError: (e) => setErr(e.message),
  });

  if (loadingTeam) {
    return (
      <div className="flex items-center justify-center py-32">
        <div
          className="h-8 w-8 animate-spin rounded-full"
          style={{
            border: `2px solid ${D.borderFaint}`,
            borderTopColor: D.red,
          }}
        />
      </div>
    );
  }

  if (!team) {
    return (
      <div className="flex items-center justify-center py-32">
        <p className="text-[12px]" style={{ color: D.textSubtle }}>
          No team found.
        </p>
      </div>
    );
  }

  const used = slots?.used ?? 0;
  const max = slots?.max ?? 3;
  const atLimit = used >= max;

  const agentRequired = focus === "AGENT_MASTERY";
  const mapRequired = focus === "AGENT_MASTERY" || focus === "MAP_FACTOR";

  const canSubmit =
    !atLimit &&
    !!playerId &&
    (!agentRequired || !!agentName) &&
    (!mapRequired || !!mapName) &&
    !createTraining.isPending;

  const hasHighTrainingCoach = !!myCoach && myCoach.trainingEff >= 70;

  return (
    <div className="flex min-h-full flex-col">
      {/* Hero */}
      <section
        className="relative px-10 pt-8 pb-6"
        style={{ borderBottom: `1px solid ${D.border}` }}
      >
        <div className="flex items-start justify-between gap-6">
          <div>
            <div
              className="text-[11px] font-medium "
              style={{ color: D.textSubtle }}
            >
              Weekly Drills · $5k per session
            </div>
            <h1
              className="mt-1 text-[34px] font-medium leading-none "
              style={{ color: D.textPrimary }}
            >
              Training
            </h1>
            {season && (
              <div
                className="mt-2 flex items-center gap-3 text-[11px] font-medium "
                style={{ color: D.textMuted }}
              >
                <span style={{ color: atLimit ? D.red : D.textPrimary }}>
                  <span className="tabular-nums">{used}</span>
                  <span style={{ color: D.textSubtle }}> / </span>
                  <span className="tabular-nums">{max}</span>
                  <span> sessions</span>
                </span>
                <span>·</span>
                <span>Week {season.currentWeek}</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Metrics */}
      <section
        className="grid grid-cols-4"
        style={{ borderBottom: `1px solid ${D.border}` }}
      >
        <MetricCell
          label="Sessions Used"
          value={`${used}`}
          sub={`of ${max} this week`}
          accent={atLimit ? D.red : undefined}
        />
        <MetricCell
          label="Remaining"
          value={`${Math.max(0, max - used)}`}
          sub="Slots available"
          accent={atLimit ? D.textSubtle : D.green}
        />
        <MetricCell
          label="Coach Bonus"
          value={myCoach ? `+${myCoach.trainingEff}` : "—"}
          sub={myCoach ? myCoach.name : "No coach hired"}
          accent={hasHighTrainingCoach ? D.gold : undefined}
        />
        <MetricCell
          label="Cost / Drill"
          value="$5k"
          sub="Deducted on start"
          accent={D.gold}
          last
        />
      </section>

      {/* Two-column layout */}
      <section
        className="grid flex-1 grid-cols-[1fr_1fr]"
        style={{ borderBottom: `1px solid ${D.border}` }}
      >
        {/* Left: create training form */}
        <div
          className="flex flex-col"
          style={{ borderRight: `1px solid ${D.border}` }}
        >
          <div
            className="flex items-center justify-between px-8 py-4"
            style={{ borderBottom: `1px solid ${D.borderFaint}` }}
          >
            <span
              className="text-[10px] font-medium "
              style={{ color: D.textSubtle }}
            >
              New Session
            </span>
            {hasHighTrainingCoach && (
              <span
                className="rounded px-2 py-1 text-[10px] font-medium "
                style={{
                  background: "rgba(198,155,58,0.1)",
                  color: D.gold,
                  border: `1px solid rgba(198,155,58,0.25)`,
                }}
              >
                Coach Bonus
              </span>
            )}
          </div>

          <div className="flex flex-col gap-6 px-8 py-6">
            {/* Player select */}
            <div className="flex flex-col gap-2">
              <label
                className="text-[10px] font-medium "
                style={{ color: D.textSubtle }}
              >
                Player
              </label>
              <select
                value={playerId}
                onChange={(e) => setPlayerId(e.target.value)}
                className="w-full rounded px-3 py-2 text-[13px] outline-none"
                style={{
                  background: D.card,
                  color: D.textPrimary,
                  border: `1px solid ${D.border}`,
                }}
              >
                <option value="">Select a player…</option>
                {team.players
                  .filter((p: { isActive: boolean }) => p.isActive)
                  .map((p: { id: string; ign: string; role: string }) => (
                    <option key={p.id} value={p.id}>
                      {p.ign} — {p.role}
                    </option>
                  ))}
              </select>
            </div>

            {/* Focus pills */}
            <div className="flex flex-col gap-2">
              <label
                className="text-[10px] font-medium "
                style={{ color: D.textSubtle }}
              >
                Focus
              </label>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
                {FOCUS_OPTIONS.map((f) => {
                  const active = focus === f.value;
                  return (
                    <button
                      key={f.value}
                      type="button"
                      onClick={() => setFocus(f.value)}
                      className="rounded px-3 py-2 text-left transition-colors"
                      style={{
                        background: active ? D.textPrimary : "transparent",
                        color: active ? D.bg : D.textPrimary,
                        border: `1px solid ${active ? D.textPrimary : D.border}`,
                      }}
                    >
                      <div
                        className="text-[11px] font-medium "
                        style={{ color: active ? D.bg : D.textPrimary }}
                      >
                        {f.label}
                      </div>
                      <div
                        className="mt-1 text-[10px]"
                        style={{
                          color: active
                            ? "rgba(15,15,20,0.6)"
                            : D.textSubtle,
                        }}
                      >
                        {f.desc}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Agent dropdown (conditional) */}
            {agentRequired && (
              <div className="flex flex-col gap-2">
                <label
                  className="text-[10px] font-medium "
                  style={{ color: D.textSubtle }}
                >
                  Agent
                </label>
                <select
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  className="w-full rounded px-3 py-2 text-[13px] outline-none"
                  style={{
                    background: D.card,
                    color: D.textPrimary,
                    border: `1px solid ${D.border}`,
                  }}
                >
                  <option value="">Select an agent…</option>
                  {VALORANT_AGENTS.map((a) => (
                    <option key={a.name} value={a.name}>
                      {a.name} — {a.role}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Map dropdown (conditional) */}
            {mapRequired && (
              <div className="flex flex-col gap-2">
                <label
                  className="text-[10px] font-medium "
                  style={{ color: D.textSubtle }}
                >
                  Map
                </label>
                <select
                  value={mapName}
                  onChange={(e) => setMapName(e.target.value)}
                  className="w-full rounded px-3 py-2 text-[13px] outline-none"
                  style={{
                    background: D.card,
                    color: D.textPrimary,
                    border: `1px solid ${D.border}`,
                  }}
                >
                  <option value="">Select a map…</option>
                  {activePool.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {err && (
              <div
                className="rounded px-4 py-3 text-[12px]"
                style={{
                  background: "rgba(255,70,85,0.06)",
                  color: D.red,
                  border: `1px solid rgba(255,70,85,0.25)`,
                }}
              >
                {err}
              </div>
            )}

            <button
              disabled={!canSubmit}
              onClick={() => {
                if (!playerId) return;
                createTraining.mutate({
                  playerId,
                  focus,
                  agentName: agentName || undefined,
                  mapName: mapName || undefined,
                });
              }}
              className="w-full rounded px-4 py-3 text-[11px] font-medium transition-colors disabled:opacity-40"
              style={{
                background: canSubmit
                  ? "rgba(255,70,85,0.12)"
                  : "rgba(255,255,255,0.03)",
                color: canSubmit ? D.red : D.textSubtle,
                border: `1px solid ${canSubmit ? "rgba(255,70,85,0.3)" : D.border}`,
              }}
            >
              {createTraining.isPending
                ? "Running drill…"
                : atLimit
                  ? "Slots full"
                  : "Train ($5k)"}
            </button>
          </div>
        </div>

        {/* Right: session list */}
        <div className="flex flex-col">
          <div
            className="flex items-center justify-between px-8 py-4"
            style={{ borderBottom: `1px solid ${D.borderFaint}` }}
          >
            <span
              className="text-[10px] font-medium "
              style={{ color: D.textSubtle }}
            >
              This Week's Sessions
            </span>
            <span
              className="text-[10px] font-medium tabular-nums"
              style={{ color: D.textMuted }}
            >
              {sessions.length} / {max}
            </span>
          </div>

          {sessions.length === 0 ? (
            <div
              className="px-8 py-10 text-[12px]"
              style={{ color: D.textSubtle }}
            >
              No training sessions yet this week.
            </div>
          ) : (
            <div className="flex flex-col">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between gap-3 px-8 py-4 transition-colors"
                  style={{ borderBottom: `1px solid ${D.borderFaint}` }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = D.hoverBg)
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <div className="flex min-w-0 flex-col">
                    <span
                      className="text-[13px] font-medium"
                      style={{ color: D.textPrimary }}
                    >
                      {s.player.ign}
                    </span>
                    <span
                      className="text-[10px] font-medium "
                      style={{ color: D.textSubtle }}
                    >
                      {s.focus.replace(/_/g, " ")}
                    </span>
                  </div>
                  <div className="flex flex-col items-end text-right">
                    {s.agentName && (
                      <span
                        className="text-[11px]"
                        style={{ color: D.textPrimary }}
                      >
                        {s.agentName}
                      </span>
                    )}
                    {s.mapName && (
                      <span
                        className="text-[10px] font-medium "
                        style={{ color: D.textSubtle }}
                      >
                        {s.mapName}
                      </span>
                    )}
                    {!s.agentName && !s.mapName && (
                      <span
                        className="text-[10px] font-medium "
                        style={{ color: D.textSubtle }}
                      >
                        Team drill
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {/* Empty slot placeholders */}
              {Array.from({ length: Math.max(0, max - sessions.length) }).map(
                (_, i) => (
                  <div
                    key={`empty-${i}`}
                    className="flex items-center gap-3 px-8 py-4"
                    style={{ borderBottom: `1px solid ${D.borderFaint}` }}
                  >
                    <span
                      className="text-[10px] font-medium "
                      style={{ color: D.textFaint }}
                    >
                      Slot {sessions.length + i + 1} · Empty
                    </span>
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function MetricCell({
  label,
  value,
  sub,
  accent,
  last,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
  last?: boolean;
}) {
  return (
    <div
      className="flex flex-col gap-1 px-6 py-5"
      style={last ? undefined : { borderRight: `1px solid ${D.borderFaint}` }}
    >
      <span
        className="text-[10px] font-medium "
        style={{ color: D.textSubtle }}
      >
        {label}
      </span>
      <span
        className="text-[22px] font-medium tabular-nums"
        style={{ color: accent ?? D.textPrimary }}
      >
        {value}
      </span>
      {sub && (
        <span className="text-[10px]" style={{ color: D.textSubtle }}>
          {sub}
        </span>
      )}
    </div>
  );
}
