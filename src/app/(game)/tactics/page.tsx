"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { formatCurrency } from "@/lib/format";
import { D } from "@/constants/design";

const PLAYSTYLE_INFO: Record<
  string,
  { label: string; tag: string; color: string; pros: string[]; cons: string[] }
> = {
  Aggressive: {
    label: "Aggressive",
    tag: "Push the tempo",
    color: D.red,
    pros: ["+3% first-blood rate", "High aim ceiling"],
    cons: ["-2% KAST (more deaths)"],
  },
  Tactical: {
    label: "Tactical",
    tag: "Play the map",
    color: D.purple,
    pros: ["+3% utility effectiveness", "+2% KAST"],
    cons: ["No burst potential"],
  },
  Defensive: {
    label: "Defensive",
    tag: "Hold the angles",
    color: D.green,
    pros: ["+2% defensive round WR", "Stronger eco rounds"],
    cons: ["Slower attack pace"],
  },
  Balanced: {
    label: "Balanced",
    tag: "All-round",
    color: D.gold,
    pros: ["No weak matchups"],
    cons: ["No bonuses"],
  },
  Flex: {
    label: "Flex",
    tag: "Adaptive everywhere",
    color: D.blue,
    pros: ["Small bonus across all axes"],
    cons: ["Never dominates a dimension"],
  },
};

export default function TacticsPage() {
  const { data: playstyle, isLoading } = trpc.playstyle.getMyPlaystyle.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();
  const [err, setErr] = useState<string | null>(null);

  const setMutation = trpc.playstyle.setMyPlaystyle.useMutation({
    onSuccess: () => {
      utils.playstyle.getMyPlaystyle.invalidate();
      utils.team.get.invalidate();
      setErr(null);
    },
    onError: (e) => setErr(e.message),
  });

  if (isLoading || !playstyle) {
    return (
      <div className="flex items-center justify-center py-32">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2"
          style={{ borderColor: D.borderFaint, borderTopColor: D.red }}
        />
      </div>
    );
  }

  const currentColor = PLAYSTYLE_INFO[playstyle.playstyle]?.color ?? D.textPrimary;
  const affordable = playstyle.budget >= playstyle.cost;

  return (
    <div className="flex min-h-full flex-col">
      {/* ── Hero ── */}
      <section
        className="px-10 pt-8 pb-6"
        style={{ borderBottom: `1px solid ${D.border}` }}
      >
        <div className="flex items-start justify-between gap-6">
          <div>
            <div
              className="text-[11px] font-medium "
              style={{ color: D.textSubtle }}
            >
              Team Doctrine
            </div>
            <h1
              className="mt-1 text-[34px] font-medium leading-none "
              style={{ color: D.textPrimary }}
            >
              Tactics
            </h1>
            <div className="mt-3 flex items-center gap-3">
              <span
                className="rounded-full px-3 py-1 text-[10px] font-medium "
                style={{
                  background: `${currentColor}14`,
                  color: currentColor,
                  border: `1px solid ${currentColor}40`,
                }}
              >
                {playstyle.playstyle}
              </span>
              <span
                className="text-[11px] font-medium "
                style={{ color: D.textMuted }}
              >
                {PLAYSTYLE_INFO[playstyle.playstyle]?.tag}
              </span>
            </div>
          </div>

          <div className="flex flex-col items-end">
            <span
              className="text-[10px] font-medium "
              style={{ color: D.textSubtle }}
            >
              Change cost
            </span>
            <span
              className="mt-1 text-[22px] font-medium tabular-nums"
              style={{ color: D.gold }}
            >
              {formatCurrency(playstyle.cost)}
            </span>
            <span className="text-[10px]" style={{ color: D.textSubtle }}>
              once per stage
            </span>
          </div>
        </div>

        {playstyle.changedThisStage && (
          <div
            className="mt-5 flex items-center justify-between gap-4 rounded-lg px-5 py-3"
            style={{
              background: "rgba(198,155,58,0.06)",
              border: `1px solid rgba(198,155,58,0.25)`,
            }}
          >
            <div className="flex flex-col gap-0.5">
              <span
                className="text-[10px] font-medium "
                style={{ color: D.gold }}
              >
                Locked this stage
              </span>
              <span className="text-[12px]" style={{ color: D.textMuted }}>
                Already changed this stage. Wait until the next patch.
              </span>
            </div>
          </div>
        )}

        {err && (
          <div
            className="mt-5 rounded-lg px-5 py-3"
            style={{
              background: "rgba(255,70,85,0.08)",
              border: `1px solid rgba(255,70,85,0.3)`,
            }}
          >
            <span
              className="text-[10px] font-medium "
              style={{ color: D.red }}
            >
              Error
            </span>
            <div className="mt-0.5 text-[12px]" style={{ color: D.textMuted }}>
              {err}
            </div>
          </div>
        )}
      </section>

      {/* ── Key metrics ── */}
      <section
        className="grid grid-cols-3"
        style={{ borderBottom: `1px solid ${D.border}` }}
      >
        <MetricCell
          label="Current"
          value={playstyle.playstyle}
          sub={PLAYSTYLE_INFO[playstyle.playstyle]?.tag}
          accent={currentColor}
        />
        <MetricCell
          label="Budget"
          value={formatCurrency(playstyle.budget)}
          sub={affordable ? "Available to spend" : "Insufficient funds"}
          accent={affordable ? D.gold : D.red}
        />
        <MetricCell
          label="Stage lock"
          value={playstyle.changedThisStage ? "Locked" : "Open"}
          sub={playstyle.changedThisStage ? "Changed this stage" : "Can change once"}
          accent={playstyle.changedThisStage ? D.amber : D.green}
        />
      </section>

      {/* ── Playstyle options ── */}
      <section className="px-10 py-8">
        <div
          className="mb-5 text-[10px] font-medium "
          style={{ color: D.textSubtle }}
        >
          Available Playstyles
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {playstyle.options.map((ps) => {
            const info = PLAYSTYLE_INFO[ps];
            const isCurrent = ps === playstyle.playstyle;
            const disabled =
              isCurrent ||
              playstyle.changedThisStage ||
              playstyle.budget < playstyle.cost ||
              setMutation.isPending;

            const btnLabel = isCurrent
              ? "Active"
              : playstyle.changedThisStage
                ? "Locked"
                : playstyle.budget < playstyle.cost
                  ? "Unavailable"
                  : setMutation.isPending
                    ? "Changing…"
                    : "Change";

            return (
              <div
                key={ps}
                className="flex flex-col rounded-lg p-5"
                style={{
                  background: isCurrent ? `${info?.color ?? D.red}0D` : D.surface,
                  border: `1px solid ${
                    isCurrent ? `${info?.color ?? D.red}40` : D.borderFaint
                  }`,
                }}
              >
                <div className="flex items-center justify-between">
                  <span
                    className="text-[11px] font-medium "
                    style={{ color: info?.color ?? D.textPrimary }}
                  >
                    {info?.label ?? ps}
                  </span>
                  {isCurrent && (
                    <span
                      className="rounded px-2 py-0.5 text-[9px] font-medium "
                      style={{
                        background: `${info?.color ?? D.red}1A`,
                        color: info?.color ?? D.red,
                      }}
                    >
                      Active
                    </span>
                  )}
                </div>

                <span
                  className="mt-2 text-[22px] font-medium"
                  style={{ color: D.textPrimary }}
                >
                  {info?.tag}
                </span>

                <ul className="mt-4 flex flex-col gap-1.5">
                  {info?.pros.map((p) => (
                    <li key={p} className="flex items-center gap-2">
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: D.green }}
                      />
                      <span className="text-[12px]" style={{ color: D.textPrimary }}>
                        {p}
                      </span>
                    </li>
                  ))}
                  {info?.cons.map((c) => (
                    <li key={c} className="flex items-center gap-2">
                      <span
                        className="h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: D.red }}
                      />
                      <span className="text-[12px]" style={{ color: D.textMuted }}>
                        {c}
                      </span>
                    </li>
                  ))}
                </ul>

                <button
                  disabled={disabled}
                  onClick={() => setMutation.mutate({ playstyle: ps as typeof ps })}
                  className="mt-5 rounded px-4 py-2 text-[10px] font-medium transition-colors disabled:cursor-not-allowed"
                  style={{
                    background: isCurrent ? "transparent" : D.card,
                    color: isCurrent
                      ? info?.color ?? D.textPrimary
                      : disabled
                        ? D.textSubtle
                        : D.textPrimary,
                    border: `1px solid ${
                      isCurrent
                        ? `${info?.color ?? D.red}40`
                        : disabled
                          ? D.borderFaint
                          : D.border
                    }`,
                    opacity: disabled && !isCurrent ? 0.5 : 1,
                  }}
                >
                  {btnLabel}
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function MetricCell({
  label, value, sub, accent,
}: {
  label: string; value: string; sub?: string; accent?: string;
}) {
  return (
    <div
      className="flex flex-col gap-1 px-6 py-5"
      style={{ borderRight: `1px solid ${D.borderFaint}` }}
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
