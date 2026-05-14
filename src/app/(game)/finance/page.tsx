"use client";

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { formatCurrency } from "@/lib/format";
import { D } from "@/constants/design";

export default function FinancePage() {
  const utils = trpc.useUtils();
  const overviewQuery = trpc.finance.overview.useQuery();
  const data = overviewQuery.data;

  const rebalanceMut = trpc.finance.rebalanceBudget.useMutation({
    onSuccess: () => {
      utils.finance.overview.invalidate();
    },
  });
  const bootcampMut = trpc.finance.setBootcamp.useMutation({
    onSuccess: () => utils.finance.overview.invalidate(),
  });
  const facilityMut = trpc.finance.setFacilityTier.useMutation({
    onSuccess: () => utils.finance.overview.invalidate(),
  });

  const [transferPct, setTransferPct] = useState(30);
  const [wagePct, setWagePct] = useState(55);

  useEffect(() => {
    if (!data) return;
    const total = data.buckets.total;
    if (total === 0) return;
    setTransferPct(Math.round((data.buckets.transfer / total) * 100));
    setWagePct(Math.round((data.buckets.wage / total) * 100));
  }, [data]);

  if (!data) {
    return (
      <div className="p-10 text-sm" style={{ color: D.textMuted }}>
        Loading finance data…
      </div>
    );
  }

  const total = data.buckets.total;
  const opPct = Math.max(0, 100 - transferPct - wagePct);
  const targetTransfer = Math.round((total * transferPct) / 100);
  const targetWage = Math.round((total * wagePct) / 100);
  const targetOperational = total - targetTransfer - targetWage;
  const allocationChanged =
    targetTransfer !== data.buckets.transfer ||
    targetWage !== data.buckets.wage;
  const allocationValid = opPct >= 0 && transferPct + wagePct <= 100;

  const debtPct = data.debt.patience > 0 ? (data.debt.amount / data.debt.patience) * 100 : 0;
  const debtBarColor =
    debtPct >= 100 ? D.red : debtPct >= 50 ? D.amber : D.green;

  return (
    <div className="flex min-h-full flex-col">
      {/* Hero */}
      <section
        className="relative px-10 pt-8 pb-6"
        style={{ borderBottom: `1px solid ${D.border}` }}
      >
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="text-[11px] font-medium" style={{ color: D.textSubtle }}>
              Org Finances
            </div>
            <h1
              className="mt-1 text-[34px] font-medium leading-none"
              style={{ color: D.textPrimary }}
            >
              Finance
            </h1>
            <div
              className="mt-2 flex items-center gap-3 text-[11px] font-medium"
              style={{ color: D.textMuted }}
            >
              <span>Total capital {formatCurrency(total)}</span>
              <span>·</span>
              <span style={{ color: data.weekly.net >= 0 ? D.green : D.red }}>
                {data.weekly.net >= 0 ? "+" : ""}
                {formatCurrency(data.weekly.net)}/wk
              </span>
              {data.debt.amount > 0 && (
                <>
                  <span>·</span>
                  <span style={{ color: D.red }}>
                    Debt {formatCurrency(data.debt.amount)}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Bucket metrics */}
      <section
        className="grid grid-cols-4"
        style={{ borderBottom: `1px solid ${D.border}` }}
      >
        <MetricCell
          label="Transfer Budget"
          value={formatCurrency(data.buckets.transfer)}
          sub="Signings + buyouts"
          accent={D.gold}
        />
        <MetricCell
          label="Wage Budget"
          value={formatCurrency(data.buckets.wage)}
          sub="Season pool"
          accent={D.blue}
        />
        <MetricCell
          label="Operational"
          value={formatCurrency(data.buckets.operational)}
          sub="General pool + fallback"
          accent={D.green}
        />
        <MetricCell
          label="Weekly Net"
          value={`${data.weekly.net >= 0 ? "+" : ""}${formatCurrency(data.weekly.net)}`}
          sub={`In ${formatCurrency(data.weekly.totalIncome)} / Out ${formatCurrency(data.weekly.totalExpense)}`}
          accent={data.weekly.net >= 0 ? D.green : D.red}
          last
        />
      </section>

      {/* Investor patience bar */}
      <section className="px-10 py-6" style={{ borderBottom: `1px solid ${D.border}` }}>
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-[11px] font-medium" style={{ color: D.textSubtle }}>
            Investor Patience
          </span>
          <span className="text-[11px] tabular-nums" style={{ color: D.textMuted }}>
            {formatCurrency(data.debt.amount)} / {formatCurrency(data.debt.patience)}
            {data.debt.isBankrupt && (
              <span style={{ color: D.red, marginLeft: 8 }}>· BANKRUPT</span>
            )}
          </span>
        </div>
        <div
          className="relative h-2 w-full rounded"
          style={{ backgroundColor: "rgba(255,255,255,0.05)" }}
        >
          <div
            className="absolute left-0 top-0 h-2 rounded transition-all"
            style={{
              width: `${Math.min(100, debtPct)}%`,
              backgroundColor: debtBarColor,
            }}
          />
          <div
            className="absolute top-0 h-2 border-l border-dashed"
            style={{
              left: "50%",
              borderColor: D.textSubtle,
              opacity: 0.4,
            }}
            title="Warning threshold"
          />
        </div>
        <div className="mt-2 text-[10px]" style={{ color: D.textSubtle }}>
          Warning at {formatCurrency(data.debt.warningAt)} · Bankruptcy at {formatCurrency(data.debt.bankruptcyAt)}
        </div>
      </section>

      {/* Two-column: Allocation slider + Weekly P&L */}
      <section className="grid grid-cols-2 gap-px" style={{ backgroundColor: D.border }}>
        {/* Allocation */}
        <div className="px-10 py-6" style={{ backgroundColor: D.bg }}>
          <h2 className="text-[13px] font-medium mb-4" style={{ color: D.textPrimary }}>
            Board Allocation
          </h2>
          <p className="text-[11px] mb-5" style={{ color: D.textMuted }}>
            Reshape your three pools without changing total capital. The board
            allows mid-season rebalancing.
          </p>

          <SliderRow
            label="Transfer"
            pct={transferPct}
            amount={targetTransfer}
            color={D.gold}
            onChange={(v) => {
              const newT = Math.min(v, 100 - wagePct);
              setTransferPct(newT);
            }}
          />
          <SliderRow
            label="Wage"
            pct={wagePct}
            amount={targetWage}
            color={D.blue}
            onChange={(v) => {
              const newW = Math.min(v, 100 - transferPct);
              setWagePct(newW);
            }}
          />
          <div className="flex items-center justify-between text-[11px] mt-4 pt-3" style={{ borderTop: `1px solid ${D.borderFaint}`, color: D.textMuted }}>
            <span>Operational (auto)</span>
            <span className="tabular-nums" style={{ color: D.textPrimary }}>
              {opPct}% · {formatCurrency(targetOperational)}
            </span>
          </div>

          <button
            disabled={!allocationChanged || !allocationValid || rebalanceMut.isPending}
            onClick={() =>
              rebalanceMut.mutate({
                transferBudget: targetTransfer,
                wageBudgetSeason: targetWage,
                operationalBudget: targetOperational,
              })
            }
            className="mt-5 w-full py-2 rounded text-[12px] font-medium transition-opacity disabled:opacity-40"
            style={{
              backgroundColor: D.primary,
              color: "white",
            }}
          >
            {rebalanceMut.isPending ? "Reallocating…" : "Apply Allocation"}
          </button>
          {rebalanceMut.error && (
            <p className="mt-2 text-[10px]" style={{ color: D.red }}>
              {rebalanceMut.error.message}
            </p>
          )}
        </div>

        {/* Weekly P&L */}
        <div className="px-10 py-6" style={{ backgroundColor: D.bg }}>
          <h2 className="text-[13px] font-medium mb-4" style={{ color: D.textPrimary }}>
            Weekly P&L
          </h2>
          <div className="space-y-2 text-[11px]">
            <PLRow label="Riot stipend" amount={data.weekly.riotFee} kind="income" />
            <PLRow label="Sponsors" amount={data.weekly.sponsorIncome} kind="income" />
            <PLRow label="Merchandising" amount={data.weekly.merch} kind="income" />
            <div className="pt-2 mt-2" style={{ borderTop: `1px solid ${D.borderFaint}` }}>
              <PLRow label="Total income" amount={data.weekly.totalIncome} kind="income" bold />
            </div>
            <div className="pt-3" />
            <PLRow label="Player wages" amount={-data.weekly.playerWages} kind="expense" />
            <PLRow label="Coach wage" amount={-data.weekly.coachWage} kind="expense" />
            <PLRow label="Facility upkeep" amount={-data.weekly.facility} kind="expense" />
            {data.weekly.bootcamp > 0 && (
              <PLRow label="Bootcamp" amount={-data.weekly.bootcamp} kind="expense" />
            )}
            <div className="pt-2 mt-2" style={{ borderTop: `1px solid ${D.borderFaint}` }}>
              <PLRow label="Total expense" amount={-data.weekly.totalExpense} kind="expense" bold />
            </div>
            <div className="pt-3 mt-2 flex items-center justify-between" style={{ borderTop: `1px solid ${D.border}` }}>
              <span className="font-medium" style={{ color: D.textPrimary }}>Net</span>
              <span className="tabular-nums font-medium" style={{ color: data.weekly.net >= 0 ? D.green : D.red }}>
                {data.weekly.net >= 0 ? "+" : ""}{formatCurrency(data.weekly.net)}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Operations */}
      <section className="grid grid-cols-2 gap-px" style={{ backgroundColor: D.border, borderTop: `1px solid ${D.border}` }}>
        {/* Facility */}
        <div className="px-10 py-6" style={{ backgroundColor: D.bg }}>
          <h2 className="text-[13px] font-medium mb-4" style={{ color: D.textPrimary }}>
            Facility Tier
          </h2>
          <p className="text-[11px] mb-4" style={{ color: D.textMuted }}>
            Higher tiers cost more weekly upkeep but support team training and morale.
          </p>
          <div className="grid grid-cols-5 gap-2">
            {[1, 2, 3, 4, 5].map((tier) => {
              const isCurrent = tier === data.operations.facilityTier;
              const labels = ["Apt", "House", "Facility", "Complex", "HQ"];
              const costs = ["$2k", "$5k", "$12k", "$25k", "$45k"];
              return (
                <button
                  key={tier}
                  disabled={facilityMut.isPending || tier === data.operations.facilityTier}
                  onClick={() => facilityMut.mutate({ tier })}
                  className="py-3 rounded text-[10px] font-medium transition-colors disabled:cursor-not-allowed"
                  style={{
                    backgroundColor: isCurrent ? D.primary : "rgba(255,255,255,0.04)",
                    color: isCurrent ? "white" : D.textMuted,
                    border: `1px solid ${isCurrent ? D.primary : D.borderFaint}`,
                  }}
                >
                  <div>T{tier}</div>
                  <div className="opacity-70 mt-1">{labels[tier - 1]}</div>
                  <div className="opacity-50 mt-1 text-[9px]">{costs[tier - 1]}/wk</div>
                </button>
              );
            })}
          </div>
          {facilityMut.error && (
            <p className="mt-2 text-[10px]" style={{ color: D.red }}>
              {facilityMut.error.message}
            </p>
          )}
        </div>

        {/* Bootcamp */}
        <div className="px-10 py-6" style={{ backgroundColor: D.bg }}>
          <h2 className="text-[13px] font-medium mb-4" style={{ color: D.textPrimary }}>
            Bootcamp
          </h2>
          <p className="text-[11px] mb-4" style={{ color: D.textMuted }}>
            Intensive prep mode. Costs $5k/week extra. Boost team prep before majors.
          </p>
          {data.operations.bootcampWeeksLeft > 0 ? (
            <div className="flex items-center justify-between p-3 rounded" style={{ backgroundColor: "rgba(0,200,150,0.05)", border: `1px solid ${D.green}` }}>
              <span className="text-[12px]" style={{ color: D.textPrimary }}>
                Active · {data.operations.bootcampWeeksLeft} week(s) remaining
              </span>
              <button
                onClick={() => bootcampMut.mutate({ weeks: 0 })}
                disabled={bootcampMut.isPending}
                className="text-[11px] underline disabled:opacity-50"
                style={{ color: D.red }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {[2, 4, 6, 8].map((w) => (
                <button
                  key={w}
                  disabled={bootcampMut.isPending}
                  onClick={() => bootcampMut.mutate({ weeks: w })}
                  className="py-3 rounded text-[11px] font-medium transition-colors"
                  style={{
                    backgroundColor: "rgba(255,255,255,0.04)",
                    color: D.textPrimary,
                    border: `1px solid ${D.borderFaint}`,
                  }}
                >
                  {w}w
                  <div className="opacity-50 mt-1 text-[9px]">
                    {formatCurrency(w * 5000)}
                  </div>
                </button>
              ))}
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
      <span className="text-[10px] font-medium" style={{ color: D.textSubtle }}>
        {label}
      </span>
      <span className="text-[22px] font-medium tabular-nums" style={{ color: accent ?? D.textPrimary }}>
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

function SliderRow({
  label,
  pct,
  amount,
  color,
  onChange,
}: {
  label: string;
  pct: number;
  amount: number;
  color: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[11px] font-medium" style={{ color: D.textMuted }}>
          {label}
        </span>
        <span className="text-[11px] tabular-nums" style={{ color: D.textPrimary }}>
          {pct}% · {formatCurrency(amount)}
        </span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={pct}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        style={{ accentColor: color }}
      />
    </div>
  );
}

function PLRow({
  label,
  amount,
  kind,
  bold,
}: {
  label: string;
  amount: number;
  kind: "income" | "expense";
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <span style={{ color: bold ? D.textPrimary : D.textMuted, fontWeight: bold ? 500 : 400 }}>
        {label}
      </span>
      <span
        className="tabular-nums"
        style={{
          color: bold ? (kind === "income" ? D.green : D.red) : D.textMuted,
          fontWeight: bold ? 500 : 400,
        }}
      >
        {amount >= 0 ? "+" : ""}{formatCurrency(amount)}
      </span>
    </div>
  );
}
