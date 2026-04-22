"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { getMapImage, getActiveMapPool } from "@/constants/maps";
import { getAgentByName } from "@/constants/agents";
import { D, TEXT_SHADOW_SUBTLE } from "@/constants/design";

interface ScrimResult {
  score1: number;
  score2: number;
  myComp: string[];
  myRealComp?: string[];
  oppComp: string[];
}

interface ScrimEntry {
  id: string;
  teamId: string;
  opponentId: string;
  mapName: string;
  season: number;
  week: number;
  fakeComp: boolean;
  accepted: boolean;
  refused: boolean;
  result: unknown;
  reliability: number;
  createdAt: Date;
  opponent: { id: string; name: string; tag: string; logoUrl: string | null };
}

interface RegionTeam {
  id: string;
  name: string;
  tag: string;
  logoUrl: string | null;
  prestige: number;
}

export default function ScrimsPage() {
  const [selectedOpponent, setSelectedOpponent] = useState("");
  const [selectedMap, setSelectedMap] = useState("");
  const [fakeComp, setFakeComp] = useState(false);

  const utils = trpc.useUtils();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slotsQuery = trpc.scrim.getScrimSlots.useQuery() as any;
  const slots = slotsQuery.data as { used: number; max: number; week: number } | undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scrimsQuery = trpc.scrim.listScrims.useQuery() as any;
  const scrims = scrimsQuery.data as ScrimEntry[] | undefined;
  const isLoading = scrimsQuery.isLoading as boolean;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const regionTeamsQuery = trpc.scrim.getRegionTeams.useQuery() as any;
  const regionTeams = regionTeamsQuery.data as RegionTeam[] | undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seasonQuery = trpc.season.getCurrent.useQuery(undefined, { retry: false }) as any;
  const seasonData = seasonQuery.data as { currentStage: string } | undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const requestScrim = trpc.scrim.requestScrim.useMutation({
    onSuccess: () => {
      utils.scrim.listScrims.invalidate();
      utils.scrim.getScrimSlots.invalidate();
      setSelectedOpponent("");
      setSelectedMap("");
      setFakeComp(false);
    },
  }) as any;

  const currentStage = seasonData?.currentStage ?? "KICKOFF";
  const mapPool = getActiveMapPool(currentStage);

  const slotsFull = !!slots && slots.used >= slots.max;

  const handleSubmit = () => {
    if (!selectedOpponent || !selectedMap) return;
    requestScrim.mutate({
      opponentTeamId: selectedOpponent,
      mapName: selectedMap,
      fakeComp,
    });
  };

  // Compute scouted opponents (group by opponent id from played scrims)
  const scoutedMap = new Map<
    string,
    { team: ScrimEntry["opponent"]; count: number; reliability: number; lastComp: string[] }
  >();
  if (scrims) {
    for (const s of scrims) {
      if (s.refused || !s.result) continue;
      const r = s.result as ScrimResult;
      const existing = scoutedMap.get(s.opponentId);
      if (!existing) {
        scoutedMap.set(s.opponentId, {
          team: s.opponent,
          count: 1,
          reliability: s.reliability,
          lastComp: r.oppComp,
        });
      } else {
        existing.count += 1;
        existing.reliability = Math.max(existing.reliability, s.reliability);
        existing.lastComp = r.oppComp;
      }
    }
  }
  const scouted = Array.from(scoutedMap.values()).sort(
    (a, b) => b.reliability - a.reliability
  );

  return (
    <div className="flex min-h-full flex-col">
      {/* Hero */}
      <section
        className="px-10 pt-8 pb-6"
        style={{ borderBottom: `1px solid ${D.border}` }}
      >
        <div className="flex items-start justify-between gap-6">
          <div>
            <div
              className="text-[11px] font-medium uppercase tracking-[0.3em]"
              style={{ color: D.textSubtle }}
            >
              Practice & Scouting
            </div>
            <h1
              className="mt-1 text-[34px] font-medium uppercase leading-none tracking-[0.05em]"
              style={{ color: D.textPrimary }}
            >
              Scrims
            </h1>
          </div>
        </div>
      </section>

      {/* Metrics */}
      <section
        className="grid grid-cols-3"
        style={{ borderBottom: `1px solid ${D.border}` }}
      >
        <MetricCell
          label="Slots Used"
          value={slots ? `${slots.used}/${slots.max}` : "—/—"}
          sub="this week"
          accent={slotsFull ? D.red : D.textPrimary}
        />
        <MetricCell
          label="Week"
          value={slots ? String(slots.week) : "—"}
          sub={currentStage.replace(/_/g, " ")}
        />
        <MetricCell
          label="Scouted"
          value={String(scouted.length)}
          sub="opponents"
          accent={D.gold}
          last
        />
      </section>

      {/* Main grid */}
      <section
        className="grid flex-1"
        style={{
          gridTemplateColumns: "minmax(360px,420px) 1fr",
          borderBottom: `1px solid ${D.border}`,
        }}
      >
        {/* ── Left: Request form ── */}
        <div
          className="flex flex-col"
          style={{ borderRight: `1px solid ${D.border}` }}
        >
          <div
            className="flex items-center justify-between px-6 py-4"
            style={{ borderBottom: `1px solid ${D.borderFaint}` }}
          >
            <span
              className="text-[10px] font-medium uppercase tracking-[0.3em]"
              style={{ color: D.textSubtle }}
            >
              Request New Scrim
            </span>
          </div>

          <div className="flex flex-col gap-5 px-6 py-5">
            {/* Opponent */}
            <div>
              <label
                className="mb-2 block text-[10px] font-medium uppercase tracking-[0.2em]"
                style={{ color: D.textSubtle }}
              >
                Opponent
              </label>
              <select
                value={selectedOpponent}
                onChange={(e) => setSelectedOpponent(e.target.value)}
                className="w-full rounded px-3 py-2.5 text-[13px] outline-none"
                style={{
                  background: D.card,
                  color: D.textPrimary,
                  border: `1px solid ${D.border}`,
                }}
              >
                <option value="">Select a team...</option>
                {regionTeams?.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name} [{team.tag}]
                  </option>
                ))}
              </select>
            </div>

            {/* Map pills */}
            <div>
              <label
                className="mb-2 block text-[10px] font-medium uppercase tracking-[0.2em]"
                style={{ color: D.textSubtle }}
              >
                Map
              </label>
              <div className="flex flex-wrap gap-2">
                {mapPool.map((mapName) => {
                  const active = selectedMap === mapName;
                  return (
                    <button
                      key={mapName}
                      onClick={() => setSelectedMap(mapName)}
                      className="rounded px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.2em] transition-colors"
                      style={{
                        background: active ? D.textPrimary : "transparent",
                        color: active ? D.bg : D.textMuted,
                        border: active
                          ? `1px solid ${D.textPrimary}`
                          : `1px solid ${D.border}`,
                      }}
                    >
                      {mapName}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Fake comp toggle pill */}
            <div>
              <label
                className="mb-2 block text-[10px] font-medium uppercase tracking-[0.2em]"
                style={{ color: D.textSubtle }}
              >
                Fake Comp
              </label>
              <button
                onClick={() => setFakeComp(!fakeComp)}
                className="w-full rounded px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-[0.2em] transition-colors"
                style={{
                  background: fakeComp ? "rgba(198,155,58,0.15)" : "transparent",
                  color: fakeComp ? D.gold : D.textMuted,
                  border: fakeComp
                    ? `1px solid rgba(198,155,58,0.3)`
                    : `1px solid ${D.border}`,
                }}
              >
                {fakeComp ? "Fake Comp Enabled" : "Fake Comp Disabled"}
              </button>
              <p
                className="mt-2 text-[10px] leading-relaxed"
                style={{ color: D.textSubtle }}
              >
                Opponent sees a decoy composition while you play with your real
                one.
              </p>
            </div>

            {/* Error */}
            {requestScrim.error && (
              <div
                className="rounded px-3 py-2 text-[11px]"
                style={{
                  background: "rgba(255,70,85,0.08)",
                  color: D.red,
                  border: `1px solid rgba(255,70,85,0.25)`,
                }}
              >
                {requestScrim.error.message}
              </div>
            )}

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={
                !selectedOpponent ||
                !selectedMap ||
                requestScrim.isPending ||
                slotsFull
              }
              className="rounded px-4 py-2.5 text-[11px] font-medium uppercase tracking-[0.25em] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                background: "rgba(255,70,85,0.1)",
                color: D.red,
                border: `1px solid rgba(255,70,85,0.3)`,
              }}
            >
              {requestScrim.isPending
                ? "Requesting..."
                : slotsFull
                  ? "No Slots Left"
                  : "Request Scrim"}
            </button>
          </div>
        </div>

        {/* ── Right: Results list ── */}
        <div className="flex flex-col">
          <div
            className="flex items-center justify-between px-6 py-4"
            style={{ borderBottom: `1px solid ${D.borderFaint}` }}
          >
            <span
              className="text-[10px] font-medium uppercase tracking-[0.3em]"
              style={{ color: D.textSubtle }}
            >
              Scrim Results
            </span>
            {scrims && scrims.length > 0 && (
              <span
                className="text-[10px] font-medium uppercase tracking-[0.2em] tabular-nums"
                style={{ color: D.textMuted }}
              >
                {scrims.length} total
              </span>
            )}
          </div>

          {isLoading ? (
            <div className="flex flex-1 items-center justify-center py-20">
              <span className="text-[11px]" style={{ color: D.textSubtle }}>
                Loading scrims...
              </span>
            </div>
          ) : !scrims || scrims.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-20">
              <span
                className="text-[11px] font-medium uppercase tracking-[0.3em]"
                style={{ color: D.textSubtle }}
              >
                No Scrims Yet
              </span>
              <span className="text-[12px]" style={{ color: D.textMuted }}>
                Request your first scrim to start scouting.
              </span>
            </div>
          ) : (
            <div className="flex flex-col">
              {scrims.map((scrim) => (
                <ScrimRow key={scrim.id} scrim={scrim} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Scouting data */}
      {scouted.length > 0 && (
        <section>
          <div
            className="flex items-center justify-between px-10 py-4"
            style={{ borderBottom: `1px solid ${D.borderFaint}` }}
          >
            <span
              className="text-[10px] font-medium uppercase tracking-[0.3em]"
              style={{ color: D.textSubtle }}
            >
              Scouted Opponents
            </span>
            <span
              className="text-[10px] font-medium uppercase tracking-[0.2em] tabular-nums"
              style={{ color: D.textMuted }}
            >
              {scouted.length}
            </span>
          </div>
          <div className="flex flex-col">
            {scouted.map((s) => (
              <div
                key={s.team.id}
                className="grid items-center gap-4 px-10 py-3"
                style={{
                  gridTemplateColumns: "32px 1fr auto auto",
                  borderBottom: `1px solid ${D.borderFaint}`,
                }}
              >
                {s.team.logoUrl ? (
                  <img
                    src={s.team.logoUrl}
                    alt={s.team.name}
                    className="h-6 w-6 object-contain"
                  />
                ) : (
                  <div
                    className="flex h-6 w-6 items-center justify-center rounded"
                    style={{ background: D.card }}
                  >
                    <span
                      className="text-[9px] font-medium"
                      style={{ color: D.textMuted }}
                    >
                      {s.team.tag.slice(0, 2)}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <span
                    className="text-[13px] font-medium"
                    style={{ color: D.textPrimary }}
                  >
                    {s.team.name}
                  </span>
                  <span
                    className="text-[10px] font-medium uppercase tracking-[0.2em]"
                    style={{ color: D.textSubtle }}
                  >
                    [{s.team.tag}]
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {s.lastComp.slice(0, 5).map((agentName, i) => {
                    const agent = getAgentByName(agentName);
                    return agent ? (
                      <img
                        key={i}
                        src={agent.portraitUrl}
                        alt={agent.name}
                        title={agent.name}
                        className="h-5 w-5 rounded-full"
                        style={{ border: `1px solid ${D.borderFaint}` }}
                      />
                    ) : (
                      <div
                        key={i}
                        className="h-5 w-5 rounded-full"
                        style={{ background: D.card }}
                      />
                    );
                  })}
                </div>
                <div className="flex items-center gap-4">
                  <span
                    className="text-[10px] font-medium uppercase tracking-[0.2em] tabular-nums"
                    style={{ color: D.textMuted }}
                  >
                    {s.count}x
                  </span>
                  <span
                    className="rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.2em] tabular-nums"
                    style={{
                      background:
                        s.reliability >= 0.75
                          ? "rgba(76,175,125,0.1)"
                          : s.reliability >= 0.5
                            ? "rgba(198,155,58,0.1)"
                            : "rgba(255,70,85,0.1)",
                      color:
                        s.reliability >= 0.75
                          ? D.green
                          : s.reliability >= 0.5
                            ? D.gold
                            : D.red,
                    }}
                  >
                    {Math.round(s.reliability * 100)}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
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
      style={{ borderRight: last ? undefined : `1px solid ${D.borderFaint}` }}
    >
      <span
        className="text-[10px] font-medium uppercase tracking-[0.3em]"
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
        <span
          className="text-[10px] uppercase tracking-[0.2em]"
          style={{ color: D.textSubtle }}
        >
          {sub}
        </span>
      )}
    </div>
  );
}

function ScrimRow({ scrim }: { scrim: ScrimEntry }) {
  const result = scrim.result as ScrimResult | null;
  const isRefused = scrim.refused;
  const reliabilityPct = Math.round(scrim.reliability * 100);
  const isOutdated = scrim.reliability < 0.75;

  return (
    <div
      className="grid items-center gap-4 px-6 py-3 transition-colors"
      style={{
        gridTemplateColumns: "180px 120px 1fr auto",
        borderBottom: `1px solid ${D.borderFaint}`,
        opacity: isRefused ? 0.5 : isOutdated ? 0.7 : 1,
      }}
    >
      {/* Opponent */}
      <div className="flex items-center gap-3">
        {scrim.opponent.logoUrl ? (
          <img
            src={scrim.opponent.logoUrl}
            alt={scrim.opponent.name}
            className="h-8 w-8 shrink-0 object-contain"
          />
        ) : (
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded"
            style={{ background: D.card }}
          >
            <span
              className="text-[9px] font-medium"
              style={{ color: D.textMuted }}
            >
              {scrim.opponent.tag.slice(0, 2)}
            </span>
          </div>
        )}
        <div className="flex min-w-0 flex-col">
          <span
            className="truncate text-[13px] font-medium"
            style={{ color: D.textPrimary }}
          >
            {scrim.opponent.name}
          </span>
          <span
            className="text-[10px] font-medium uppercase tracking-[0.2em]"
            style={{ color: D.textSubtle }}
          >
            [{scrim.opponent.tag}]
          </span>
        </div>
      </div>

      {/* Map */}
      <div
        className="relative h-10 w-full overflow-hidden rounded"
        style={{ border: `1px solid ${D.borderFaint}` }}
      >
        <img
          src={getMapImage(scrim.mapName)}
          alt={scrim.mapName}
          className="h-full w-full object-cover"
        />
        <div
          className="absolute inset-0"
          style={{ background: "rgba(0,0,0,0.55)" }}
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <span
            className="text-[10px] font-medium uppercase tracking-[0.25em]"
            style={{ color: D.textPrimary, textShadow: TEXT_SHADOW_SUBTLE }}
          >
            {scrim.mapName}
          </span>
        </div>
      </div>

      {/* Result or status */}
      {isRefused ? (
        <div className="flex items-center">
          <span
            className="rounded px-2 py-1 text-[10px] font-medium uppercase tracking-[0.2em]"
            style={{
              background: "rgba(255,70,85,0.1)",
              color: D.red,
            }}
          >
            Declined
          </span>
        </div>
      ) : result ? (
        <div className="flex items-center gap-6">
          {/* Score */}
          <div className="flex items-center gap-2 tabular-nums">
            <span
              className="text-[22px] font-medium"
              style={{
                color:
                  result.score1 > result.score2 ? D.green : D.red,
              }}
            >
              {result.score1}
            </span>
            <span className="text-[12px]" style={{ color: D.textSubtle }}>
              –
            </span>
            <span
              className="text-[22px] font-medium"
              style={{
                color:
                  result.score2 > result.score1 ? D.green : D.red,
              }}
            >
              {result.score2}
            </span>
          </div>

          {/* Comps */}
          <div className="flex items-center gap-5">
            <div className="flex flex-col gap-1">
              <span
                className="text-[9px] font-medium uppercase tracking-[0.25em]"
                style={{ color: D.textSubtle }}
              >
                You {scrim.fakeComp && "· (fake shown)"}
              </span>
              <div className="flex gap-1">
                {(result.myRealComp ?? result.myComp).map((agentName, i) => {
                  const agent = getAgentByName(agentName);
                  return agent ? (
                    <img
                      key={i}
                      src={agent.portraitUrl}
                      alt={agent.name}
                      title={agent.name}
                      className="h-5 w-5 rounded-full"
                      style={{ border: `1px solid ${D.borderFaint}` }}
                    />
                  ) : (
                    <div
                      key={i}
                      className="h-5 w-5 rounded-full"
                      style={{ background: D.card }}
                    />
                  );
                })}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span
                className="text-[9px] font-medium uppercase tracking-[0.25em]"
                style={{ color: D.textSubtle }}
              >
                Them
              </span>
              <div className="flex gap-1">
                {result.oppComp.map((agentName, i) => {
                  const agent = getAgentByName(agentName);
                  return agent ? (
                    <img
                      key={i}
                      src={agent.portraitUrl}
                      alt={agent.name}
                      title={agent.name}
                      className="h-5 w-5 rounded-full"
                      style={{ border: `1px solid ${D.borderFaint}` }}
                    />
                  ) : (
                    <div
                      key={i}
                      className="h-5 w-5 rounded-full"
                      style={{ background: D.card }}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div />
      )}

      {/* Badges */}
      <div className="flex flex-col items-end gap-1">
        {result && (
          <span
            className="rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.2em] tabular-nums"
            style={{
              background:
                reliabilityPct >= 75
                  ? "rgba(76,175,125,0.1)"
                  : reliabilityPct >= 50
                    ? "rgba(198,155,58,0.1)"
                    : "rgba(255,70,85,0.1)",
              color:
                reliabilityPct >= 75
                  ? D.green
                  : reliabilityPct >= 50
                    ? D.gold
                    : D.red,
            }}
          >
            {reliabilityPct}%
          </span>
        )}
        {scrim.fakeComp && !isRefused && (
          <span
            className="text-[9px] font-medium uppercase tracking-[0.25em]"
            style={{ color: D.gold }}
          >
            Fake
          </span>
        )}
        {isOutdated && !isRefused && (
          <span
            className="text-[9px] font-medium uppercase tracking-[0.25em]"
            style={{ color: D.red }}
          >
            Outdated
          </span>
        )}
      </div>
    </div>
  );
}
