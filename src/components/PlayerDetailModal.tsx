"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { D, roleColor } from "@/constants/design";
import { formatCurrency, formatStat } from "@/lib/format";
import { countryToFlag } from "@/lib/country-flag";

type Props = {
  playerId: string;
  isOwnPlayer: boolean;
  onClose: () => void;
  onOpenOfferModal?: () => void;
  onOpenExtendModal?: () => void;
};

const STATE_COLOR: Record<string, { bg: string; fg: string; label: string }> = {
  HAPPY: { bg: "rgba(76,175,125,0.15)", fg: D.green, label: "Happy" },
  CONCERNED: { bg: "rgba(198,155,58,0.15)", fg: D.gold, label: "Concerned" },
  UNHAPPY: { bg: "rgba(255,140,80,0.15)", fg: "#ff8c50", label: "Unhappy" },
  WANTS_TRANSFER: { bg: "rgba(255,70,85,0.15)", fg: D.red, label: "Wants transfer" },
};

const TAG_LABEL: Record<string, string> = {
  UNDERPAID: "Underpaid",
  OVERPAID: "Overpaid",
  CONTRACT_EXPIRING: "Contract expiring",
  TEAM_LOSING_STREAK: "Team losing streak",
  TEAM_WINNING_STREAK: "Team winning streak",
  RECENT_SIGNING: "Recent signing",
  TROPHY_WON: "Trophy won",
  MAJOR_OFFER_REJECTED: "Major offer rejected",
  PLAYING_HOME_REGION: "Home region",
  DUO_BROKEN: "Duo broken",
  MENTOR_LOST: "Mentor lost",
  CLASH_ACTIVE: "Clash active",
};

const RELATION_COLOR: Record<string, string> = {
  DUO: D.green,
  CLASH: D.red,
  MENTOR: D.gold,
};

function stateFromScore(score: number): keyof typeof STATE_COLOR {
  if (score >= 70) return "HAPPY";
  if (score >= 40) return "CONCERNED";
  if (score >= 20) return "UNHAPPY";
  return "WANTS_TRANSFER";
}

export function PlayerDetailModal({
  playerId,
  isOwnPlayer,
  onClose,
  onOpenOfferModal,
  onOpenExtendModal,
}: Props) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query = trpc.player.detail.useQuery({ playerId }) as any;
  const player = query.data;

  const utils = trpc.useUtils();
  const invalidate = () => {
    utils.player.detail.invalidate({ playerId });
    utils.player.rosterAll.invalidate();
    utils.player.roster.invalidate();
    utils.team.get.invalidate();
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raiseMutation = trpc.player.raiseSalary.useMutation({
    onSuccess: invalidate,
  }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pepTalkMutation = trpc.player.pepTalk.useMutation({
    onSuccess: invalidate,
  }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listMutation = trpc.player.setTransferListed.useMutation({
    onSuccess: invalidate,
  }) as any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const relationsQuery = trpc.player.relationships.useQuery({ playerId }) as any;
  const relations = relationsQuery.data as
    | {
        current: Array<{
          id: string;
          type: "DUO" | "MENTOR" | "CLASH";
          otherPlayer: { id: string; ign: string; role: string; imageUrl: string | null; teamId: string | null };
          weeksTogether: number;
          strength: number;
          isCurrentlyTogether: boolean;
          firstTogetherSeason: number;
          firstTogetherWeek: number;
          mentorRole: "MENTOR_TO_THEM" | "PROTEGE_OF_THEM" | null;
        }>;
        historical: Array<{
          id: string;
          type: "DUO" | "MENTOR" | "CLASH";
          otherPlayer: { id: string; ign: string; role: string; imageUrl: string | null; teamId: string | null };
          weeksTogether: number;
          strength: number;
          isCurrentlyTogether: boolean;
          firstTogetherSeason: number;
          firstTogetherWeek: number;
          mentorRole: "MENTOR_TO_THEM" | "PROTEGE_OF_THEM" | null;
        }>;
      }
    | undefined;

  const [showRaise, setShowRaise] = useState(false);
  const [raiseAmount, setRaiseAmount] = useState<number>(0);

  if (query.isLoading || !player) {
    return (
      <Shell onClose={onClose}>
        <div className="px-8 py-20 text-center text-[12px]" style={{ color: D.textSubtle }}>
          Loading player...
        </div>
      </Shell>
    );
  }

  const state = stateFromScore(player.happiness);
  const stateStyle = STATE_COLOR[state];
  const tags: string[] = Array.isArray(player.happinessTags) ? player.happinessTags : [];
  const weeksLeft =
    (player.contractEndSeason - (player.team?.currentSeason ?? player.contractEndSeason)) * 52;

  const handleRaise = () => {
    if (!raiseAmount || raiseAmount <= player.salary) return;
    raiseMutation.mutate({ playerId, newSalary: raiseAmount });
    setShowRaise(false);
    setRaiseAmount(0);
  };

  return (
    <Shell onClose={onClose}>
      {/* Header */}
      <div
        className="flex items-start justify-between px-8 py-6"
        style={{ borderBottom: `1px solid ${D.borderFaint}` }}
      >
        <div className="flex items-start gap-4">
          {player.imageUrl ? (
            <img
              src={player.imageUrl}
              alt={player.ign}
              className="h-16 w-16 rounded-full object-cover"
              style={{ border: `1px solid ${D.borderFaint}` }}
            />
          ) : (
            <div
              className="flex h-16 w-16 items-center justify-center rounded-full"
              style={{ background: D.card, border: `1px solid ${D.borderFaint}` }}
            >
              <span className="text-[20px] font-medium" style={{ color: D.textMuted }}>
                {player.ign.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <div>
            <div
              className="text-[10px] font-medium "
              style={{ color: D.textSubtle }}
            >
              {player.region} · Age {player.age} · {countryToFlag(player.nationality)} {player.nationality}
            </div>
            <h2
              className="mt-1 text-[26px] font-medium "
              style={{ color: D.textPrimary }}
            >
              {player.ign}
            </h2>
            <div className="mt-1 flex items-center gap-3">
              <span
                className="text-[11px] font-medium "
                style={{ color: roleColor(player.role) }}
              >
                {player.role}
              </span>
              <span
                className="text-[10px]"
                style={{ color: D.textSubtle }}
              >
                {player.firstName} {player.lastName}
              </span>
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-[11px] "
          style={{ color: D.textMuted }}
        >
          Close
        </button>
      </div>

      {/* Happiness section — only for own players */}
      {isOwnPlayer && (
        <div
          className="px-8 py-5"
          style={{ borderBottom: `1px solid ${D.borderFaint}` }}
        >
          <div className="flex items-center justify-between">
            <span
              className="text-[10px] font-medium "
              style={{ color: D.textSubtle }}
            >
              Player mood
            </span>
            <span
              className="rounded px-2 py-0.5 text-[10px] font-medium "
              style={{ background: stateStyle.bg, color: stateStyle.fg }}
            >
              {stateStyle.label}
            </span>
          </div>
          <div
            className="mt-3 h-2 w-full overflow-hidden rounded-full"
            style={{ background: D.card, border: `1px solid ${D.borderFaint}` }}
          >
            <div
              className="h-full transition-all"
              style={{
                width: `${player.happiness}%`,
                background: stateStyle.fg,
              }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span
              className="text-[10px] tabular-nums"
              style={{ color: D.textSubtle }}
            >
              {player.happiness}/100
            </span>
          </div>
          {tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <span
                  key={t}
                  className="rounded px-2 py-1 text-[10px] font-medium "
                  style={{
                    background: D.card,
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

      {/* Stats */}
      <div
        className="grid grid-cols-5"
        style={{ borderBottom: `1px solid ${D.borderFaint}` }}
      >
        <StatCell label="ACS" value={formatStat(player.acs, 0)} accent={D.gold} />
        <StatCell label="K/D" value={formatStat(player.kd, 2)} />
        <StatCell label="ADR" value={formatStat(player.adr, 0)} />
        <StatCell label="KAST" value={`${formatStat(player.kast, 0)}%`} />
        <StatCell label="HS" value={`${formatStat(player.hs, 0)}%`} last />
      </div>

      {/* Contract & Market */}
      <div
        className="grid grid-cols-3"
        style={{ borderBottom: `1px solid ${D.borderFaint}` }}
      >
        <StatCell
          label="Salary / wk"
          value={formatCurrency(player.salary)}
          sub={
            isOwnPlayer && player.marketRate
              ? `Market ${formatCurrency(player.marketRate)}`
              : undefined
          }
          accent={D.gold}
        />
        <StatCell
          label="Buyout Clause"
          value={formatCurrency(player.buyoutClause)}
          sub={`End S${player.contractEndSeason} W${player.contractEndWeek}`}
        />
        <StatCell
          label="Happiness Score"
          value={isOwnPlayer ? String(player.happiness) : "—"}
          last
        />
      </div>

      {/* Relationships */}
      <RelationshipsSection
        relations={relations}
        isLoading={relationsQuery.isLoading}
      />

      {/* Attributes (V4) */}
      <AttributesSection playerId={playerId} isOwnPlayer={isOwnPlayer} />

      {/* Action bar */}
      {isOwnPlayer ? (
        <div className="flex flex-col gap-3 px-8 py-5">
          {showRaise ? (
            <div
              className="flex items-center gap-3 rounded px-4 py-3"
              style={{ background: D.card, border: `1px solid ${D.borderFaint}` }}
            >
              <span
                className="text-[10px] "
                style={{ color: D.textSubtle }}
              >
                New salary
              </span>
              <input
                type="number"
                value={raiseAmount || ""}
                onChange={(e) => setRaiseAmount(parseInt(e.target.value || "0", 10))}
                placeholder={String(Math.ceil(player.salary * 1.2))}
                className="w-40 rounded px-2 py-1.5 text-[12px] outline-none tabular-nums"
                style={{
                  background: D.bg,
                  color: D.textPrimary,
                  border: `1px solid ${D.border}`,
                }}
              />
              <span className="text-[10px]" style={{ color: D.textSubtle }}>
                upfront cost: {formatCurrency((raiseAmount || 0) * 2)}
              </span>
              <button
                onClick={handleRaise}
                disabled={
                  raiseMutation.isPending ||
                  !raiseAmount ||
                  raiseAmount <= player.salary
                }
                className="ml-auto rounded px-3 py-1.5 text-[10px] font-medium transition-colors disabled:opacity-40"
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
                className="rounded px-3 py-1.5 text-[10px] "
                style={{ color: D.textMuted, border: `1px solid ${D.border}` }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <ActionButton
                label={`Raise salary${player.raisesUsedSeason >= 1 ? " (used)" : ""}`}
                disabled={player.raisesUsedSeason >= 1 || raiseMutation.isPending}
                onClick={() => {
                  setRaiseAmount(Math.ceil(player.salary * 1.15));
                  setShowRaise(true);
                }}
              />
              <ActionButton
                label={`Pep talk (${2 - player.pepTalksUsedSeason}/2)`}
                disabled={
                  player.pepTalksUsedSeason >= 2 || pepTalkMutation.isPending
                }
                onClick={() => pepTalkMutation.mutate({ playerId })}
              />
              {onOpenExtendModal && (
                <ActionButton
                  label="Extend Contract"
                  onClick={onOpenExtendModal}
                />
              )}
              <ActionButton
                label={
                  player.isTransferListed
                    ? "Remove from List"
                    : "Transfer List"
                }
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
          {raiseMutation.error && (
            <div
              className="rounded px-3 py-2 text-[11px]"
              style={{
                background: "rgba(255,70,85,0.08)",
                color: D.red,
                border: `1px solid rgba(255,70,85,0.25)`,
              }}
            >
              {raiseMutation.error.message}
            </div>
          )}
          {pepTalkMutation.error && (
            <div
              className="rounded px-3 py-2 text-[11px]"
              style={{
                background: "rgba(255,70,85,0.08)",
                color: D.red,
                border: `1px solid rgba(255,70,85,0.25)`,
              }}
            >
              {pepTalkMutation.error.message}
            </div>
          )}
        </div>
      ) : (
        <div className="px-8 py-5">
          {onOpenOfferModal && (
            <ActionButton
              label={player.teamId ? "Make Buyout Offer" : "Sign Free agent"}
              warning
              onClick={onOpenOfferModal}
            />
          )}
        </div>
      )}
    </Shell>
  );
}

function Shell({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 py-10"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl rounded-lg"
        style={{ background: D.surface, border: `1px solid ${D.border}` }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function StatCell({
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
      className="flex flex-col gap-1 px-5 py-4"
      style={{ borderRight: last ? undefined : `1px solid ${D.borderFaint}` }}
    >
      <span
        className="text-[10px] font-medium "
        style={{ color: D.textSubtle }}
      >
        {label}
      </span>
      <span
        className="text-[15px] font-medium tabular-nums"
        style={{ color: accent ?? D.textPrimary }}
      >
        {value}
      </span>
      {sub && (
        <span className="text-[9px]" style={{ color: D.textSubtle }}>
          {sub}
        </span>
      )}
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
      className="rounded px-3 py-2 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40"
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

// ───────────────────────── Relationships section ─────────────────────────

type RelationRow = {
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

function RelationshipsSection({
  relations,
  isLoading,
}: {
  relations?: { current: RelationRow[]; historical: RelationRow[] };
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="px-8 py-5" style={{ borderBottom: `1px solid ${D.borderFaint}` }}>
        <span className="text-[10px]" style={{ color: D.textSubtle }}>
          Loading relationships...
        </span>
      </div>
    );
  }
  if (!relations || (relations.current.length === 0 && relations.historical.length === 0)) {
    return (
      <div className="px-8 py-5" style={{ borderBottom: `1px solid ${D.borderFaint}` }}>
        <div
          className="text-[10px] font-medium "
          style={{ color: D.textSubtle }}
        >
          Relationships
        </div>
        <div className="mt-2 text-[11px]" style={{ color: D.textSubtle, fontStyle: "italic" }}>
          No meaningful relationships yet. Keep playing.
        </div>
      </div>
    );
  }

  return (
    <div className="px-8 py-5" style={{ borderBottom: `1px solid ${D.borderFaint}` }}>
      <div
        className="text-[10px] font-medium "
        style={{ color: D.textSubtle }}
      >
        Relationships
      </div>

      {relations.current.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          <span className="text-[9px] " style={{ color: D.textMuted }}>
            Active
          </span>
          {relations.current.map((r) => (
            <RelationRowView key={r.id} r={r} active />
          ))}
        </div>
      )}

      {relations.historical.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          <span className="text-[9px] " style={{ color: D.textMuted }}>
            Historical (decaying)
          </span>
          {relations.historical.slice(0, 5).map((r) => (
            <RelationRowView key={r.id} r={r} active={false} />
          ))}
        </div>
      )}
    </div>
  );
}

function RelationRowView({ r, active }: { r: RelationRow; active: boolean }) {
  const color = RELATION_COLOR[r.type] ?? D.textMuted;
  const pct = Math.round(r.strength * 100);
  const weeks = Math.round(r.weeksTogether);
  const label =
    r.type === "MENTOR"
      ? r.mentorRole === "MENTOR_TO_THEM"
        ? "Mentors"
        : "Protégé of"
      : r.type;

  return (
    <div
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
      {r.otherPlayer.imageUrl ? (
        <img
          src={r.otherPlayer.imageUrl}
          alt={r.otherPlayer.ign}
          className="h-6 w-6 rounded-full object-cover"
          style={{ border: `1px solid ${D.borderFaint}` }}
        />
      ) : (
        <div
          className="flex h-6 w-6 items-center justify-center rounded-full shrink-0"
          style={{ background: D.card, border: `1px solid ${D.borderFaint}` }}
        >
          <span className="text-[9px]" style={{ color: D.textMuted }}>
            {r.otherPlayer.ign.charAt(0).toUpperCase()}
          </span>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="truncate text-[12px]" style={{ color: D.textPrimary }}>
            {r.otherPlayer.ign}
          </span>
          <span
            className="rounded px-1.5 py-0.5 text-[9px] font-medium "
            style={{ background: "transparent", color, border: `1px solid ${color}40` }}
          >
            {label}
          </span>
          <span className="text-[10px] tabular-nums" style={{ color: D.textSubtle }}>
            {weeks}w
          </span>
        </div>
      </div>
      {r.type !== "MENTOR" && (
        <div className="flex items-center gap-2 shrink-0">
          <div
            className="h-1.5 w-20 overflow-hidden rounded-full"
            style={{ background: D.card }}
          >
            <div
              className="h-full"
              style={{ width: `${pct}%`, background: color }}
            />
          </div>
          <span
            className="text-[10px] tabular-nums w-8 text-right"
            style={{ color: D.textSubtle }}
          >
            {pct}%
          </span>
        </div>
      )}
    </div>
  );
}

// ───────────────────────── Attributes section (V4) ─────────────────────────

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

function attrColor(v: number): string {
  if (v >= 16) return "#4ac96a"; // green
  if (v >= 13) return "#d8c44a"; // yellow
  if (v >= 8) return "#d89a4a"; // orange
  if (v >= 5) return "#d84a4a"; // red
  return "#555";                 // dark grey — terrible
}

function AttributesSection({
  playerId,
  isOwnPlayer,
}: {
  playerId: string;
  isOwnPlayer: boolean;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query = trpc.player.attributes.useQuery({ playerId }) as any;
  const utils = trpc.useUtils();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setRoleMutation = trpc.player.setPlaystyleRole.useMutation({
    onSuccess: () => {
      utils.player.attributes.invalidate({ playerId });
      utils.player.detail.invalidate({ playerId });
      utils.player.rosterAll.invalidate();
    },
  }) as any;

  const data = query.data as
    | {
        attrs: Record<AttrKey, number>;
        overall: number;
        playstyleRole: PlaystyleRoleValue;
        wasAutoAssigned: boolean;
      }
    | undefined;

  if (query.isLoading) {
    return (
      <div
        className="px-8 py-5"
        style={{ borderBottom: `1px solid ${D.borderFaint}` }}
      >
        <span className="text-[10px]" style={{ color: D.textSubtle }}>
          Loading attributes...
        </span>
      </div>
    );
  }
  if (!data) return null;

  const overallRounded = Math.round(data.overall);
  const overallClr = attrColor(overallRounded);

  return (
    <div
      className="px-8 py-5"
      style={{ borderBottom: `1px solid ${D.borderFaint}` }}
    >
      <div className="flex items-center justify-between mb-4">
        <span
          className="text-[10px] font-medium "
          style={{ color: D.textSubtle }}
        >
          Attributes
        </span>
        <div className="flex items-center gap-3">
          {isOwnPlayer ? (
            <select
              value={data.playstyleRole}
              onChange={(e) =>
                setRoleMutation.mutate({
                  playerId,
                  role: e.target.value as PlaystyleRoleValue,
                })
              }
              disabled={setRoleMutation.isPending}
              className="rounded px-2 py-1 text-[11px] outline-none"
              style={{
                background: D.card,
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
            <span
              className="text-[11px] "
              style={{ color: D.textMuted }}
            >
              {PLAYSTYLE_ROLES.find((r) => r.value === data.playstyleRole)?.label ?? data.playstyleRole}
            </span>
          )}
          {data.wasAutoAssigned && (
            <span
              className="text-[9px] "
              style={{ color: D.textSubtle, fontStyle: "italic" }}
            >
              auto
            </span>
          )}
          <div className="flex flex-col items-end">
            <span
              className="text-[24px] font-medium tabular-nums leading-none"
              style={{ color: overallClr }}
            >
              {overallRounded}
            </span>
            <span
              className="text-[9px] "
              style={{ color: D.textSubtle }}
            >
              Overall
            </span>
          </div>
        </div>
      </div>

      <AttrGroup title="Technique" keys={GROUP_TECH} values={data.attrs} />
      <AttrGroup title="Mental" keys={GROUP_MENTAL} values={data.attrs} />
      <AttrGroup title="Physique" keys={GROUP_PHYSICAL} values={data.attrs} />
    </div>
  );
}

function AttrGroup({
  title,
  keys,
  values,
}: {
  title: string;
  keys: AttrKey[];
  values: Record<AttrKey, number>;
}) {
  return (
    <div className="mb-3">
      <div
        className="text-[9px] mb-1.5"
        style={{ color: D.textMuted }}
      >
        {title}
      </div>
      <div className="grid gap-1" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {keys.map((k) => (
          <AttrRow key={k} label={ATTR_LABELS[k]} value={values[k] ?? 0} />
        ))}
      </div>
    </div>
  );
}

function AttrRow({ label, value }: { label: string; value: number }) {
  const v = Math.round(value);
  const pct = (v / 20) * 100;
  const color = attrColor(v);
  return (
    <div
      className="grid items-center gap-2"
      style={{ gridTemplateColumns: "1fr 22px 60px" }}
    >
      <span className="text-[11px] truncate" style={{ color: D.textMuted }}>
        {label}
      </span>
      <span
        className="text-[11px] font-medium tabular-nums text-right"
        style={{ color }}
      >
        {v}
      </span>
      <div
        className="h-1 rounded-full overflow-hidden"
        style={{ background: D.card }}
      >
        <div
          className="h-full transition-all"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}
