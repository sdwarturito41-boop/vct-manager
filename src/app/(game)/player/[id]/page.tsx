"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { D, roleColor } from "@/constants/design";
import { formatCurrency, formatStat } from "@/lib/format";
import { countryToFlag } from "@/lib/country-flag";
import { ROLE_WEIGHTS } from "@/constants/role-weights";

type AttrKey =
  | "aim" | "crosshair" | "entryTiming" | "peek" | "positioning"
  | "utilUsage" | "tradeDiscipline" | "clutch" | "counterStrat" | "mapAdaptability"
  | "aggression" | "decisionMaking" | "consistency" | "workRate" | "vision"
  | "composure" | "pressureRes" | "adaptability" | "leadership" | "ambition"
  | "reactionTime" | "mousePrecision" | "peakPerf" | "staminaBO5" | "movementSpeed"
  | "mentalEndurance";

type PlaystyleRoleValue =
  | "Entry" | "Fragger" | "Carry"
  | "AggressiveInit" | "IntelInit" | "FlexInit"
  | "IglSmoke" | "AggressiveSmoke" | "AnchorSmoke"
  | "Anchor" | "Lurker" | "SupportSent";

const PLAYSTYLE_ROLES: { value: PlaystyleRoleValue; label: string }[] = [
  { value: "Entry", label: "Entry" },
  { value: "Fragger", label: "Fragger" },
  { value: "Carry", label: "Carry" },
  { value: "AggressiveInit", label: "Aggr Init" },
  { value: "IntelInit", label: "Intel Init" },
  { value: "FlexInit", label: "Flex Init" },
  { value: "IglSmoke", label: "IGL Smoke" },
  { value: "AggressiveSmoke", label: "Aggr Smoke" },
  { value: "AnchorSmoke", label: "Anchor Smoke" },
  { value: "Anchor", label: "Anchor" },
  { value: "Lurker", label: "Lurker" },
  { value: "SupportSent", label: "Support Sent" },
];

const ATTR_LABELS: Record<AttrKey, string> = {
  aim: "Aim mechanics",
  crosshair: "Crosshair placement",
  entryTiming: "Entry timing",
  peek: "Peek mechanics",
  positioning: "Positioning",
  utilUsage: "Util usage",
  tradeDiscipline: "Trade discipline",
  clutch: "Clutch execution",
  counterStrat: "Counter-strat",
  mapAdaptability: "Map adaptability",
  aggression: "Aggression",
  decisionMaking: "Decision making",
  consistency: "Consistency",
  workRate: "Work rate",
  vision: "Vision",
  composure: "Composure",
  pressureRes: "Pressure res.",
  adaptability: "Adaptability",
  leadership: "Leadership",
  ambition: "Ambition",
  reactionTime: "Reaction time",
  mousePrecision: "Mouse precision",
  peakPerf: "Peak performance",
  staminaBO5: "Stamina BO5",
  movementSpeed: "Movement speed",
  mentalEndurance: "Mental endurance",
};

const GROUP_TECH: AttrKey[] = [
  "aim", "crosshair", "entryTiming", "peek", "positioning",
  "utilUsage", "tradeDiscipline", "clutch", "counterStrat", "mapAdaptability",
];
const GROUP_MENTAL: AttrKey[] = [
  "aggression", "decisionMaking", "consistency", "workRate", "vision",
  "composure", "pressureRes", "adaptability", "leadership", "ambition",
];
const GROUP_PHYSICAL: AttrKey[] = [
  "reactionTime", "mousePrecision", "peakPerf", "staminaBO5", "movementSpeed",
  "mentalEndurance",
];

const STATE_COLOR: Record<string, { bg: string; fg: string; label: string }> = {
  HAPPY: { bg: "rgba(76,175,125,0.15)", fg: D.green, label: "Happy" },
  CONCERNED: { bg: "rgba(198,155,58,0.15)", fg: D.gold, label: "Concerned" },
  UNHAPPY: { bg: "rgba(255,140,80,0.15)", fg: "#ff8c50", label: "Unhappy" },
  WANTS_TRANSFER: { bg: "rgba(255,70,85,0.15)", fg: D.red, label: "Wants Transfer" },
};

const TAG_LABEL: Record<string, string> = {
  UNDERPAID: "Underpaid",
  OVERPAID: "Overpaid",
  CONTRACT_EXPIRING: "Contract Expiring",
  TEAM_LOSING_STREAK: "Team Losing Streak",
  TEAM_WINNING_STREAK: "Team Winning Streak",
  RECENT_SIGNING: "Recent Signing",
  TROPHY_WON: "Trophy Won",
  MAJOR_OFFER_REJECTED: "Major Offer Rejected",
  PLAYING_HOME_REGION: "Home Region",
  DUO_BROKEN: "Duo Broken",
  MENTOR_LOST: "Mentor Lost",
  CLASH_ACTIVE: "Clash Active",
};

function stateFromScore(score: number): keyof typeof STATE_COLOR {
  if (score >= 70) return "HAPPY";
  if (score >= 40) return "CONCERNED";
  if (score >= 20) return "UNHAPPY";
  return "WANTS_TRANSFER";
}

function attrColor(v: number): string {
  if (v >= 16) return "#4ac96a";
  if (v >= 13) return "#d8c44a";
  if (v >= 8) return "#d89a4a";
  if (v >= 5) return "#d84a4a";
  return "#555";
}

export default function PlayerPage() {
  const params = useParams();
  const router = useRouter();
  const playerId = Array.isArray(params.id) ? params.id[0] : (params.id ?? "");

  const utils = trpc.useUtils();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const detailQuery = trpc.player.detail.useQuery({ playerId }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const attrsQuery = trpc.player.attributes.useQuery({ playerId }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const relationsQuery = trpc.player.relationships.useQuery({ playerId }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const teamQuery = trpc.team.get.useQuery(undefined, { retry: false }) as any;

  const invalidate = () => {
    utils.player.detail.invalidate({ playerId });
    utils.player.attributes.invalidate({ playerId });
    utils.player.relationships.invalidate({ playerId });
    utils.player.rosterAll.invalidate();
    utils.team.get.invalidate();
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raiseMutation = trpc.player.raiseSalary.useMutation({ onSuccess: invalidate }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pepTalkMutation = trpc.player.pepTalk.useMutation({ onSuccess: invalidate }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listMutation = trpc.player.setTransferListed.useMutation({ onSuccess: invalidate }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setRoleMutation = trpc.player.setPlaystyleRole.useMutation({ onSuccess: invalidate }) as any;

  const [showRaise, setShowRaise] = useState(false);
  const [raiseAmount, setRaiseAmount] = useState<number>(0);

  const player = detailQuery.data;
  const attrs = attrsQuery.data;
  const relations = relationsQuery.data;
  const userTeam = teamQuery.data;

  if (detailQuery.isLoading || !player) {
    return (
      <div className="flex items-center justify-center py-32">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2"
          style={{ borderColor: D.border, borderTopColor: D.red }}
        />
      </div>
    );
  }

  const isOwnPlayer = userTeam && player.teamId === userTeam.id;
  const state = stateFromScore(player.happiness);
  const stateStyle = STATE_COLOR[state];
  const happinessTags: string[] = Array.isArray(player.happinessTags)
    ? (player.happinessTags as string[])
    : [];

  const handleRaise = () => {
    if (!raiseAmount || raiseAmount <= player.salary) return;
    raiseMutation.mutate({ playerId, newSalary: raiseAmount });
    setShowRaise(false);
    setRaiseAmount(0);
  };

  return (
    <div className="flex min-h-full flex-col">
      {/* ═══ Header bar ═══ */}
      <section
        className="flex items-center justify-between px-10 py-5"
        style={{ borderBottom: `1px solid ${D.border}` }}
      >
        <button
          onClick={() => router.back()}
          className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em]"
          style={{ color: D.textMuted }}
        >
          ← Back
        </button>
        <div className="flex items-center gap-3">
          {attrs && (
            <div className="flex flex-col items-end">
              <span className="text-[9px] uppercase tracking-[0.2em]" style={{ color: D.textSubtle }}>
                Current Ability
              </span>
              <span
                className="text-[28px] font-medium tabular-nums leading-none"
                style={{ color: attrColor(Math.round(attrs.overall)) }}
              >
                {Math.round(attrs.overall)}
              </span>
            </div>
          )}
        </div>
      </section>

      {/* ═══ Identity header (photo + name + core facts) ═══ */}
      <section
        className="grid gap-6 px-10 py-6"
        style={{
          gridTemplateColumns: "120px 1fr 280px",
          borderBottom: `1px solid ${D.border}`,
        }}
      >
        {/* Photo */}
        <div>
          {player.imageUrl ? (
            <img
              src={player.imageUrl}
              alt={player.ign}
              className="h-[120px] w-[120px] rounded-lg object-cover"
              style={{ border: `1px solid ${D.borderFaint}` }}
            />
          ) : (
            <div
              className="flex h-[120px] w-[120px] items-center justify-center rounded-lg"
              style={{ background: D.card, border: `1px solid ${D.borderFaint}` }}
            >
              <span className="text-[40px] font-medium" style={{ color: D.textMuted }}>
                {player.ign.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
        </div>

        {/* Identity + contract */}
        <div className="flex flex-col gap-3">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.3em]" style={{ color: D.textSubtle }}>
              {countryToFlag(player.nationality)} {player.nationality} · {player.region} · Age {player.age}
            </div>
            <h1
              className="mt-1 text-[40px] font-medium uppercase leading-none tracking-[0.05em]"
              style={{ color: D.textPrimary }}
            >
              {player.ign}
            </h1>
            <div className="mt-2 flex items-center gap-4 text-[12px]" style={{ color: D.textMuted }}>
              <span
                className="font-medium uppercase tracking-[0.2em]"
                style={{ color: roleColor(player.role) }}
              >
                {player.role}
              </span>
              <span>{player.firstName} {player.lastName}</span>
              {attrs?.playstyleRole && (
                <span className="uppercase tracking-[0.15em]" style={{ color: D.textSubtle }}>
                  {PLAYSTYLE_ROLES.find((r) => r.value === attrs.playstyleRole)?.label ?? attrs.playstyleRole}
                </span>
              )}
              {player.isIgl && (
                <span
                  className="rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.2em]"
                  style={{ background: "rgba(198,155,58,0.15)", color: D.gold }}
                >
                  IGL
                </span>
              )}
            </div>
          </div>

          {/* 4-col identity metrics */}
          <div
            className="mt-2 grid gap-4"
            style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr" }}
          >
            <HeaderMetric label="Salary" value={`${formatCurrency(player.salary)}/wk`} accent={D.gold} />
            <HeaderMetric label="Market rate" value={formatCurrency(player.marketRate)} />
            <HeaderMetric label="Buyout clause" value={formatCurrency(player.buyoutClause)} />
            <HeaderMetric label="Contract ends" value={`S${player.contractEndSeason} W${player.contractEndWeek}`} />
          </div>
        </div>

        {/* Team badge / current club */}
        <div
          className="flex flex-col gap-2 rounded-lg p-4"
          style={{ background: D.card, border: `1px solid ${D.borderFaint}` }}
        >
          <span className="text-[10px] uppercase tracking-[0.3em]" style={{ color: D.textSubtle }}>
            Current Club
          </span>
          {player.team ? (
            <div className="flex items-center gap-3">
              {player.team.logoUrl ? (
                <img src={player.team.logoUrl} alt={player.team.name} className="h-10 w-10 object-contain" />
              ) : (
                <div className="h-10 w-10 rounded" style={{ background: D.surface }} />
              )}
              <div className="flex flex-col">
                <span className="text-[15px] font-medium" style={{ color: D.textPrimary }}>
                  {player.team.name}
                </span>
                <span className="text-[10px] uppercase tracking-[0.2em]" style={{ color: D.textMuted }}>
                  {player.team.tag} · {player.team.region}
                </span>
              </div>
            </div>
          ) : (
            <span className="text-[13px]" style={{ color: D.textSubtle, fontStyle: "italic" }}>
              Free Agent
            </span>
          )}
        </div>
      </section>

      {/* ═══ Attributes + sidebar ═══ */}
      <section
        className="grid gap-6 px-10 py-6"
        style={{
          gridTemplateColumns: "1fr 1fr 1fr 320px",
          borderBottom: `1px solid ${D.border}`,
        }}
      >
        <AttrGroup title="Technique" keys={GROUP_TECH} values={attrs?.attrs} role={attrs?.playstyleRole as PlaystyleRoleValue | undefined} />
        <AttrGroup title="Mental" keys={GROUP_MENTAL} values={attrs?.attrs} role={attrs?.playstyleRole as PlaystyleRoleValue | undefined} />
        <AttrGroup title="Physique" keys={GROUP_PHYSICAL} values={attrs?.attrs} role={attrs?.playstyleRole as PlaystyleRoleValue | undefined} />

        {/* Right sidebar: role + overall + happiness */}
        <div className="flex flex-col gap-4">
          {/* Role selector */}
          <div
            className="rounded p-4"
            style={{ background: D.card, border: `1px solid ${D.borderFaint}` }}
          >
            <div className="text-[9px] uppercase tracking-[0.25em] mb-2" style={{ color: D.textSubtle }}>
              Playstyle Role
            </div>
            {isOwnPlayer ? (
              <select
                value={attrs?.playstyleRole ?? ""}
                onChange={(e) =>
                  setRoleMutation.mutate({
                    playerId,
                    role: e.target.value as PlaystyleRoleValue,
                  })
                }
                disabled={setRoleMutation.isPending || !attrs}
                className="w-full rounded px-2 py-1.5 text-[12px] outline-none"
                style={{
                  background: D.surface,
                  color: D.textPrimary,
                  border: `1px solid ${D.border}`,
                }}
              >
                {PLAYSTYLE_ROLES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-[13px]" style={{ color: D.textPrimary }}>
                {attrs?.playstyleRole
                  ? PLAYSTYLE_ROLES.find((r) => r.value === attrs.playstyleRole)?.label
                  : "—"}
              </span>
            )}
            {attrs?.wasAutoAssigned && (
              <div className="mt-1 text-[9px] uppercase tracking-[0.15em]" style={{ color: D.textSubtle, fontStyle: "italic" }}>
                Auto-assigned from stats
              </div>
            )}
          </div>

          {/* Mood / happiness */}
          {isOwnPlayer && (
            <div
              className="rounded p-4"
              style={{ background: D.card, border: `1px solid ${D.borderFaint}` }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[9px] uppercase tracking-[0.25em]" style={{ color: D.textSubtle }}>
                  Player Mood
                </span>
                <span
                  className="rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.2em]"
                  style={{ background: stateStyle.bg, color: stateStyle.fg }}
                >
                  {stateStyle.label}
                </span>
              </div>
              <div
                className="h-2 w-full overflow-hidden rounded-full"
                style={{ background: D.surface, border: `1px solid ${D.borderFaint}` }}
              >
                <div
                  className="h-full transition-all"
                  style={{ width: `${player.happiness}%`, background: stateStyle.fg }}
                />
              </div>
              <div className="mt-2 text-[10px] tabular-nums" style={{ color: D.textSubtle }}>
                {player.happiness}/100
              </div>
              {happinessTags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {happinessTags.map((t) => (
                    <span
                      key={t}
                      className="rounded px-1.5 py-1 text-[9px] font-medium uppercase tracking-[0.15em]"
                      style={{
                        background: D.surface,
                        color: D.textPrimary,
                        border: `1px solid ${D.borderFaint}`,
                      }}
                    >
                      {TAG_LABEL[t] ?? t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Recent form stats */}
          <div
            className="rounded p-4"
            style={{ background: D.card, border: `1px solid ${D.borderFaint}` }}
          >
            <div className="text-[9px] uppercase tracking-[0.25em] mb-3" style={{ color: D.textSubtle }}>
              Recent Form
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]" style={{ color: D.textPrimary }}>
              <MiniStat label="ACS" value={formatStat(player.acs, 0)} accent={D.gold} />
              <MiniStat label="K/D" value={formatStat(player.kd, 2)} />
              <MiniStat label="ADR" value={formatStat(player.adr, 0)} />
              <MiniStat label="KAST" value={`${formatStat(player.kast, 0)}%`} />
              <MiniStat label="HS" value={`${formatStat(player.hs, 0)}%`} />
              <MiniStat label="Rating" value={formatStat(player.rating, 2)} />
            </div>
          </div>
        </div>
      </section>

      {/* ═══ Agents Mastered ═══ */}
      <AgentsSection agentStats={attrs?.agentStats} />

      {/* ═══ Relationships ═══ */}
      <section
        className="px-10 py-6"
        style={{ borderBottom: `1px solid ${D.border}` }}
      >
        <div className="text-[10px] font-medium uppercase tracking-[0.3em] mb-4" style={{ color: D.textSubtle }}>
          Relationships
        </div>
        {relationsQuery.isLoading || !relations ? (
          <div className="text-[11px]" style={{ color: D.textSubtle }}>Loading...</div>
        ) : relations.current.length === 0 && relations.historical.length === 0 ? (
          <div className="text-[11px]" style={{ color: D.textSubtle, fontStyle: "italic" }}>
            No meaningful relationships yet. Keep playing.
          </div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <RelationList title="Active" items={relations.current} active />
            <RelationList title="Historical (decaying)" items={relations.historical.slice(0, 10)} active={false} />
          </div>
        )}
      </section>

      {/* ═══ Action bar ═══ */}
      {isOwnPlayer && (
        <section className="px-10 py-6">
          <div className="text-[10px] font-medium uppercase tracking-[0.3em] mb-3" style={{ color: D.textSubtle }}>
            Manager actions
          </div>

          {showRaise ? (
            <div
              className="flex items-center gap-3 rounded px-4 py-3"
              style={{ background: D.card, border: `1px solid ${D.borderFaint}` }}
            >
              <span className="text-[10px] uppercase tracking-[0.2em]" style={{ color: D.textSubtle }}>
                New salary
              </span>
              <input
                type="number"
                value={raiseAmount || ""}
                onChange={(e) => setRaiseAmount(parseInt(e.target.value || "0", 10))}
                placeholder={String(Math.ceil(player.salary * 1.2))}
                className="w-40 rounded px-2 py-1.5 text-[12px] outline-none tabular-nums"
                style={{
                  background: D.surface,
                  color: D.textPrimary,
                  border: `1px solid ${D.border}`,
                }}
              />
              <span className="text-[10px]" style={{ color: D.textSubtle }}>
                upfront: {formatCurrency((raiseAmount || 0) * 2)}
              </span>
              <button
                onClick={handleRaise}
                disabled={
                  raiseMutation.isPending ||
                  !raiseAmount ||
                  raiseAmount <= player.salary
                }
                className="ml-auto rounded px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.2em] disabled:opacity-40"
                style={{
                  background: "rgba(76,175,125,0.12)",
                  color: D.green,
                  border: `1px solid rgba(76,175,125,0.3)`,
                }}
              >
                Confirm
              </button>
              <button
                onClick={() => setShowRaise(false)}
                className="rounded px-3 py-1.5 text-[10px] uppercase tracking-[0.2em]"
                style={{ color: D.textMuted, border: `1px solid ${D.border}` }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <ActionButton
                label={`Raise Salary${player.raisesUsedSeason >= 1 ? " (used)" : ""}`}
                disabled={player.raisesUsedSeason >= 1 || raiseMutation.isPending}
                onClick={() => {
                  setRaiseAmount(Math.ceil(player.salary * 1.15));
                  setShowRaise(true);
                }}
              />
              <ActionButton
                label={`Pep Talk (${2 - player.pepTalksUsedSeason}/2)`}
                disabled={player.pepTalksUsedSeason >= 2 || pepTalkMutation.isPending}
                onClick={() => pepTalkMutation.mutate({ playerId })}
              />
              <ActionButton
                label={player.isTransferListed ? "Remove from List" : "Transfer List"}
                warning={player.isTransferListed}
                disabled={listMutation.isPending}
                onClick={() =>
                  listMutation.mutate({
                    playerId,
                    listed: !player.isTransferListed,
                  })
                }
              />
            </div>
          )}

          {(raiseMutation.error || pepTalkMutation.error) && (
            <div
              className="mt-3 rounded px-3 py-2 text-[11px]"
              style={{
                background: "rgba(255,70,85,0.08)",
                color: D.red,
                border: `1px solid rgba(255,70,85,0.25)`,
              }}
            >
              {raiseMutation.error?.message ?? pepTalkMutation.error?.message}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ═════════════════ Sub-components ═════════════════

function HeaderMetric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[9px] uppercase tracking-[0.25em]" style={{ color: D.textSubtle }}>
        {label}
      </span>
      <span className="text-[15px] font-medium tabular-nums" style={{ color: accent ?? D.textPrimary }}>
        {value}
      </span>
    </div>
  );
}

function MiniStat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10px] uppercase tracking-[0.15em]" style={{ color: D.textSubtle }}>
        {label}
      </span>
      <span className="font-medium tabular-nums" style={{ color: accent ?? D.textPrimary }}>
        {value}
      </span>
    </div>
  );
}

function AttrGroup({
  title,
  keys,
  values,
  role,
}: {
  title: string;
  keys: AttrKey[];
  values?: Record<AttrKey, number>;
  role?: PlaystyleRoleValue;
}) {
  const weights = role ? ROLE_WEIGHTS[role] : undefined;
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-[0.3em] mb-3" style={{ color: D.textSubtle }}>
        {title}
      </div>
      <div className="flex flex-col gap-1.5">
        {keys.map((k) => (
          <AttrRow
            key={k}
            label={ATTR_LABELS[k]}
            value={values?.[k] ?? 0}
            weight={weights?.[k as keyof typeof weights] ?? 1}
          />
        ))}
      </div>
    </div>
  );
}

// weight >= 1.5 → KEY (green tint, full intensity). weight ~1 → NORMAL.
// weight < 1 → SECONDARY (muted, lower opacity). Used to guide the eye toward
// the attributes that actually matter for the selected role.
function emphasisFor(weight: number): "key" | "normal" | "muted" {
  if (weight >= 1.5) return "key";
  if (weight < 1) return "muted";
  return "normal";
}

function AttrRow({ label, value, weight }: { label: string; value: number; weight: number }) {
  const v = Math.round(value);
  const pct = (v / 20) * 100;
  const baseColor = attrColor(v);
  const emph = emphasisFor(weight);
  const isKey = emph === "key";
  const isMuted = emph === "muted";
  return (
    <div
      className="grid items-center gap-2 py-1"
      style={{
        gridTemplateColumns: "10px 1fr 28px 90px",
        borderBottom: `1px solid ${D.borderFaint}`,
        opacity: isMuted ? 0.55 : 1,
      }}
    >
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 rounded-full"
        style={{ background: isKey ? D.green : "transparent" }}
      />
      <span
        className="text-[11px] truncate"
        style={{
          color: isKey ? D.textPrimary : D.textMuted,
          fontWeight: isKey ? 600 : 400,
        }}
      >
        {label}
      </span>
      <span
        className="text-[13px] font-medium tabular-nums text-right"
        style={{ color: baseColor }}
      >
        {v}
      </span>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: D.card }}>
        <div
          className="h-full"
          style={{
            width: `${pct}%`,
            background: isKey ? D.green : baseColor,
          }}
        />
      </div>
    </div>
  );
}

// ═══ Agents Mastered ═══

type AgentStat = {
  rounds: number; rating: number; acs: number; kd: number; adr: number;
  kast: number; kpr: number; apr: number; fkpr: number; fdpr: number;
  hs: number; mastery: number;
};

// Role grouping for coloring — matches in-game classes.
const AGENT_ROLE: Record<string, "duelist" | "initiator" | "controller" | "sentinel"> = {
  jett: "duelist", phoenix: "duelist", raze: "duelist", yoru: "duelist",
  neon: "duelist", reyna: "duelist", iso: "duelist", waylay: "duelist",
  sova: "initiator", skye: "initiator", fade: "initiator", breach: "initiator",
  kayo: "initiator", gekko: "initiator", tejo: "initiator",
  brimstone: "controller", omen: "controller", viper: "controller",
  astra: "controller", harbor: "controller", clove: "controller",
  killjoy: "sentinel", sage: "sentinel", cypher: "sentinel",
  chamber: "sentinel", deadlock: "sentinel", vyse: "sentinel",
};

const ROLE_TINT: Record<string, string> = {
  duelist: "#ff4655",
  initiator: "#e7c56a",
  controller: "#7aa5e0",
  sentinel: "#4cb07d",
};

function AgentsSection({ agentStats }: { agentStats?: Record<string, AgentStat> }) {
  const entries = Object.entries(agentStats ?? {})
    .filter(([, s]) => s && typeof s.mastery === "number")
    .sort((a, b) => b[1].mastery - a[1].mastery);

  if (entries.length === 0) return null;

  return (
    <section
      className="px-10 py-6"
      style={{ borderBottom: `1px solid ${D.border}` }}
    >
      <div className="text-[10px] font-medium uppercase tracking-[0.3em] mb-4" style={{ color: D.textSubtle }}>
        Agents Mastered · {entries.length}
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
        {entries.map(([agent, s]) => (
          <AgentCard key={agent} agent={agent} stats={s} />
        ))}
      </div>
    </section>
  );
}

function AgentCard({ agent, stats }: { agent: string; stats: AgentStat }) {
  const role = AGENT_ROLE[agent] ?? "duelist";
  const tint = ROLE_TINT[role];
  const masteryPct = Math.max(0, Math.min(1, stats.mastery)) * 100;
  return (
    <div
      className="rounded p-3"
      style={{ background: D.card, border: `1px solid ${D.borderFaint}`, borderLeft: `3px solid ${tint}` }}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[13px] font-semibold capitalize" style={{ color: D.textPrimary }}>
          {agent}
        </span>
        <span
          className="text-[9px] uppercase tracking-[0.2em] rounded px-1.5 py-0.5"
          style={{ background: `${tint}22`, color: tint }}
        >
          {role}
        </span>
      </div>
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: D.surface }}>
          <div className="h-full" style={{ width: `${masteryPct}%`, background: tint }} />
        </div>
        <span className="text-[11px] tabular-nums font-medium" style={{ color: tint }}>
          {Math.round(masteryPct)}%
        </span>
      </div>
      <div
        className="grid gap-y-0.5 text-[10px]"
        style={{ gridTemplateColumns: "auto 1fr", color: D.textSubtle }}
      >
        <span>Rounds</span>
        <span className="text-right tabular-nums" style={{ color: D.textMuted }}>
          {stats.rounds}
        </span>
        <span>Rating</span>
        <span className="text-right tabular-nums" style={{ color: D.textMuted }}>
          {stats.rating.toFixed(2)}
        </span>
        <span>ACS</span>
        <span className="text-right tabular-nums" style={{ color: D.textMuted }}>
          {Math.round(stats.acs)}
        </span>
        <span>K:D</span>
        <span className="text-right tabular-nums" style={{ color: D.textMuted }}>
          {stats.kd.toFixed(2)}
        </span>
      </div>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  disabled,
  warning,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  warning?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="rounded px-3 py-2 text-[10px] font-medium uppercase tracking-[0.2em] disabled:cursor-not-allowed disabled:opacity-40"
      style={
        warning
          ? {
              background: "rgba(255,70,85,0.1)",
              color: D.red,
              border: `1px solid rgba(255,70,85,0.3)`,
            }
          : {
              background: D.card,
              color: D.textPrimary,
              border: `1px solid ${D.borderFaint}`,
            }
      }
    >
      {label}
    </button>
  );
}

type RelationItem = {
  id: string;
  type: "DUO" | "MENTOR" | "CLASH";
  otherPlayer: { id: string; ign: string; role: string; imageUrl: string | null; teamId: string | null };
  weeksTogether: number;
  strength: number;
  isCurrentlyTogether: boolean;
  firstTogetherSeason: number;
  firstTogetherWeek: number;
  mentorRole: "MENTOR_TO_THEM" | "PROTEGE_OF_THEM" | null;
};

function RelationList({
  title,
  items,
  active,
}: {
  title: string;
  items: RelationItem[];
  active: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.2em] mb-2" style={{ color: D.textMuted }}>
        {title}
      </div>
      <div className="flex flex-col gap-1.5">
        {items.map((r) => {
          const color =
            r.type === "DUO"
              ? D.green
              : r.type === "CLASH"
                ? D.red
                : D.gold;
          const label =
            r.type === "MENTOR"
              ? r.mentorRole === "MENTOR_TO_THEM"
                ? "Mentors"
                : "Protégé of"
              : r.type;
          return (
            <div
              key={r.id}
              className="flex items-center gap-3 rounded px-3 py-2"
              style={{
                background: active ? "transparent" : "rgba(255,255,255,0.02)",
                border: `1px solid ${D.borderFaint}`,
                opacity: active ? 1 : 0.7,
              }}
            >
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ background: active ? color : D.textSubtle }}
              />
              <span className="text-[12px] flex-1 truncate" style={{ color: D.textPrimary }}>
                {r.otherPlayer.ign}
              </span>
              <span
                className="rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.15em]"
                style={{ color, border: `1px solid ${color}40` }}
              >
                {label}
              </span>
              <span className="text-[10px] tabular-nums" style={{ color: D.textSubtle }}>
                {Math.round(r.weeksTogether)}w
              </span>
              {r.type !== "MENTOR" && (
                <div className="h-1.5 w-16 overflow-hidden rounded-full" style={{ background: D.card }}>
                  <div className="h-full" style={{ width: `${Math.round(r.strength * 100)}%`, background: color }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
