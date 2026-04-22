"use client";

import { trpc } from "@/lib/trpc-client";
import { formatCurrency } from "@/lib/format";
import { D } from "@/constants/design";

interface CoachOffer {
  id: string;
  name: string;
  nationality: string;
  age: number;
  salary: number;
  utilityBoost: number;
  trainingEff: number;
  scoutingSkill: number;
}

interface MyCoach {
  id: string;
  name: string;
  nationality: string;
  age: number;
  salary: number;
  utilityBoost: number;
  trainingEff: number;
  scoutingSkill: number;
  contractEndSeason: number;
  contractEndWeek: number;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function StatBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span
          className="text-[10px] font-medium uppercase tracking-[0.25em]"
          style={{ color: D.textSubtle }}
        >
          {label}
        </span>
        <span
          className="text-[12px] font-medium tabular-nums"
          style={{ color: D.textPrimary }}
        >
          {value}
        </span>
      </div>
      <div
        className="h-[3px] overflow-hidden"
        style={{ background: D.borderFaint }}
      >
        <div
          className="h-full"
          style={{
            width: `${Math.max(0, Math.min(100, value))}%`,
            background: D.red,
          }}
        />
      </div>
    </div>
  );
}

export default function StaffPage() {
  const utils = trpc.useUtils();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mineQuery = trpc.coach.listMyCoach.useQuery() as any;
  const myCoach = mineQuery.data as MyCoach | null | undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const offersQuery = trpc.coach.listAvailableCoaches.useQuery() as any;
  const offers = offersQuery.data as CoachOffer[] | undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hireMut = trpc.coach.hireCoach.useMutation({
    onSuccess: () => {
      utils.coach.listMyCoach.invalidate();
      utils.coach.listAvailableCoaches.invalidate();
      utils.team.get.invalidate();
    },
  }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fireMut = trpc.coach.fireCoach.useMutation({
    onSuccess: () => {
      utils.coach.listMyCoach.invalidate();
    },
  }) as any;

  const offerCount = offers?.length ?? 0;

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
              className="text-[11px] font-medium uppercase tracking-[0.3em]"
              style={{ color: D.textSubtle }}
            >
              Coaching Staff
            </div>
            <h1
              className="mt-1 text-[34px] font-medium uppercase leading-none tracking-[0.05em]"
              style={{ color: D.textPrimary }}
            >
              Staff
            </h1>
            <div
              className="mt-2 flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.2em]"
              style={{ color: D.textMuted }}
            >
              <span style={{ color: myCoach ? D.red : D.textMuted }}>
                {myCoach ? "1 coach hired" : "No coach"}
              </span>
              <span>·</span>
              <span>{offerCount} offers available</span>
            </div>
          </div>
        </div>
      </section>

      {/* Metrics row */}
      <section
        className="grid grid-cols-3"
        style={{ borderBottom: `1px solid ${D.border}` }}
      >
        <MetricCell
          label="Head Coach"
          value={myCoach ? myCoach.name : "—"}
          sub={myCoach ? `${myCoach.nationality} · Age ${myCoach.age}` : "No coach on staff"}
          accent={myCoach ? D.red : undefined}
        />
        <MetricCell
          label="Weekly Salary"
          value={myCoach ? formatCurrency(myCoach.salary) : "—"}
          sub={myCoach ? `Ends S${myCoach.contractEndSeason} · W${myCoach.contractEndWeek}` : "No active contract"}
          accent={myCoach ? D.gold : undefined}
        />
        <MetricCell
          label="Available"
          value={String(offerCount)}
          sub="New listings each stage"
          last
        />
      </section>

      {/* Current coach detail */}
      {myCoach && (
        <section
          className="px-10 py-8"
          style={{ borderBottom: `1px solid ${D.border}` }}
        >
          <div
            className="text-[10px] font-medium uppercase tracking-[0.35em]"
            style={{ color: D.textSubtle }}
          >
            Current Coach
          </div>
          <div className="mt-5 grid grid-cols-[80px_1fr_auto] items-center gap-6">
            <div
              className="flex h-20 w-20 items-center justify-center rounded-lg"
              style={{ background: D.surface, border: `1px solid ${D.borderFaint}` }}
            >
              <span
                className="text-[24px] font-medium"
                style={{ color: D.textPrimary }}
              >
                {initials(myCoach.name)}
              </span>
            </div>
            <div>
              <div
                className="text-[22px] font-medium uppercase tracking-[0.05em]"
                style={{ color: D.textPrimary }}
              >
                {myCoach.name}
              </div>
              <div
                className="mt-1 text-[11px] font-medium uppercase tracking-[0.2em]"
                style={{ color: D.textMuted }}
              >
                <span>{myCoach.nationality}</span>
                <span style={{ color: D.textFaint }}> · </span>
                <span>Age {myCoach.age}</span>
                <span style={{ color: D.textFaint }}> · </span>
                <span style={{ color: D.gold }}>
                  {formatCurrency(myCoach.salary)} / wk
                </span>
              </div>
            </div>
            <button
              onClick={() => fireMut.mutate()}
              disabled={fireMut.isPending}
              className="rounded px-4 py-2 text-[10px] font-medium uppercase tracking-[0.2em] transition-colors disabled:opacity-40"
              style={{
                background: "rgba(255,70,85,0.08)",
                color: D.red,
                border: `1px solid rgba(255,70,85,0.25)`,
              }}
            >
              Fire
            </button>
          </div>

          <div className="mt-6 grid grid-cols-3 gap-10">
            <StatBar label="Utility" value={myCoach.utilityBoost} />
            <StatBar label="Training" value={myCoach.trainingEff} />
            <StatBar label="Scouting" value={myCoach.scoutingSkill} />
          </div>
        </section>
      )}

      {/* Available coaches */}
      <section className="flex flex-col">
        <div
          className="flex items-center justify-between px-10 py-4"
          style={{ borderBottom: `1px solid ${D.borderFaint}` }}
        >
          <span
            className="text-[10px] font-medium uppercase tracking-[0.35em]"
            style={{ color: D.textSubtle }}
          >
            Available Coaches
          </span>
          <span
            className="text-[10px] font-medium uppercase tracking-[0.2em] tabular-nums"
            style={{ color: D.textMuted }}
          >
            {offerCount} offers
          </span>
        </div>

        {!offers || offers.length === 0 ? (
          <div
            className="px-10 py-10 text-[12px]"
            style={{ color: D.textSubtle }}
          >
            No coaches available. New listings arrive each stage.
          </div>
        ) : (
          <>
            {/* Column headers */}
            <div
              className="grid items-center gap-4 px-10 py-3"
              style={{
                borderBottom: `1px solid ${D.borderFaint}`,
                gridTemplateColumns: "48px 1fr 80px 80px 80px 100px 100px",
              }}
            >
              <span />
              <span
                className="text-[10px] font-medium uppercase tracking-[0.3em]"
                style={{ color: D.textSubtle }}
              >
                Name
              </span>
              <span
                className="text-right text-[10px] font-medium uppercase tracking-[0.3em]"
                style={{ color: D.textSubtle }}
              >
                Utility
              </span>
              <span
                className="text-right text-[10px] font-medium uppercase tracking-[0.3em]"
                style={{ color: D.textSubtle }}
              >
                Training
              </span>
              <span
                className="text-right text-[10px] font-medium uppercase tracking-[0.3em]"
                style={{ color: D.textSubtle }}
              >
                Scouting
              </span>
              <span
                className="text-right text-[10px] font-medium uppercase tracking-[0.3em]"
                style={{ color: D.textSubtle }}
              >
                Salary/wk
              </span>
              <span />
            </div>

            {offers.map((o) => {
              const diff = myCoach ? o.salary - myCoach.salary : 0;
              const isMoreExpensive = diff > 0;
              return (
                <div
                  key={o.id}
                  className="group grid items-center gap-4 px-10 py-4 transition-colors"
                  style={{
                    borderBottom: `1px solid ${D.borderFaint}`,
                    gridTemplateColumns: "48px 1fr 80px 80px 80px 100px 100px",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = D.hoverBg)
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-full"
                    style={{ background: D.hoverBg, border: `1px solid ${D.borderFaint}` }}
                  >
                    <span
                      className="text-[11px] font-medium"
                      style={{ color: D.textMuted }}
                    >
                      {initials(o.name)}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div
                      className="truncate text-[13px] font-medium"
                      style={{ color: D.textPrimary }}
                    >
                      {o.name}
                    </div>
                    <div
                      className="text-[10px] font-medium uppercase tracking-[0.2em]"
                      style={{ color: D.textSubtle }}
                    >
                      {o.nationality} · Age {o.age}
                    </div>
                  </div>
                  <span
                    className="text-right text-[13px] font-medium tabular-nums"
                    style={{ color: D.textPrimary }}
                  >
                    {o.utilityBoost}
                  </span>
                  <span
                    className="text-right text-[13px] font-medium tabular-nums"
                    style={{ color: D.textPrimary }}
                  >
                    {o.trainingEff}
                  </span>
                  <span
                    className="text-right text-[13px] font-medium tabular-nums"
                    style={{ color: D.textPrimary }}
                  >
                    {o.scoutingSkill}
                  </span>
                  <div className="flex flex-col items-end">
                    <span
                      className="text-[13px] font-medium tabular-nums"
                      style={{
                        color: isMoreExpensive ? D.red : D.gold,
                      }}
                    >
                      {formatCurrency(o.salary)}
                    </span>
                    {myCoach && diff !== 0 && (
                      <span
                        className="text-[10px] tabular-nums"
                        style={{ color: isMoreExpensive ? D.red : D.green }}
                      >
                        {diff > 0 ? "+" : ""}
                        {formatCurrency(diff)}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => hireMut.mutate({ coachOfferId: o.id })}
                    disabled={hireMut.isPending}
                    className="rounded px-4 py-2 text-[10px] font-medium uppercase tracking-[0.2em] transition-colors disabled:opacity-40"
                    style={{
                      background: "rgba(255,70,85,0.12)",
                      color: D.red,
                      border: `1px solid rgba(255,70,85,0.25)`,
                    }}
                  >
                    {myCoach ? "Replace" : "Hire"}
                  </button>
                </div>
              );
            })}
          </>
        )}

        {hireMut.error && (
          <div
            className="mx-10 my-4 rounded px-4 py-3 text-[12px]"
            style={{
              background: "rgba(255,70,85,0.06)",
              color: D.red,
              border: `1px solid rgba(255,70,85,0.25)`,
            }}
          >
            {hireMut.error.message}
          </div>
        )}
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
        className="text-[10px] font-medium uppercase tracking-[0.3em]"
        style={{ color: D.textSubtle }}
      >
        {label}
      </span>
      <span
        className="truncate text-[22px] font-medium tabular-nums"
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
