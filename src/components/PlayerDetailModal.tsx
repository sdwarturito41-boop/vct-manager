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
              className="text-[10px] font-medium uppercase tracking-[0.3em]"
              style={{ color: D.textSubtle }}
            >
              {player.region} · Age {player.age} · {countryToFlag(player.nationality)} {player.nationality}
            </div>
            <h2
              className="mt-1 text-[26px] font-medium uppercase tracking-[0.05em]"
              style={{ color: D.textPrimary }}
            >
              {player.ign}
            </h2>
            <div className="mt-1 flex items-center gap-3">
              <span
                className="text-[11px] font-medium uppercase tracking-[0.2em]"
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
          className="text-[11px] uppercase tracking-[0.2em]"
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
              className="text-[10px] font-medium uppercase tracking-[0.3em]"
              style={{ color: D.textSubtle }}
            >
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
                  className="rounded px-2 py-1 text-[10px] font-medium uppercase tracking-[0.15em]"
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

      {/* Action bar */}
      {isOwnPlayer ? (
        <div className="flex flex-col gap-3 px-8 py-5">
          {showRaise ? (
            <div
              className="flex items-center gap-3 rounded px-4 py-3"
              style={{ background: D.card, border: `1px solid ${D.borderFaint}` }}
            >
              <span
                className="text-[10px] uppercase tracking-[0.2em]"
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
                className="ml-auto rounded px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.2em] transition-colors disabled:opacity-40"
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
              label={player.teamId ? "Make Buyout Offer" : "Sign Free Agent"}
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
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
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
        className="text-[10px] font-medium uppercase tracking-[0.2em]"
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
      className="rounded px-3 py-2 text-[10px] font-medium uppercase tracking-[0.2em] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
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
