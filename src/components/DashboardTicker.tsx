"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc-client";
import { formatCurrency } from "@/lib/format";
import { D } from "@/constants/design";

/**
 * Live ticker shown next to RecentMatches on the dashboard. Three rotating
 * sections (no animation library — just stacked panels so the user sees all
 * three pieces at once without scrolling):
 *   - Finances: weekly net + debt bar
 *   - Active scouting: shortlisted players + weeks until reveal
 *   - Recommended players: AI-surfaced targets based on team gaps
 */
export function DashboardTicker() {
  const financeQ = trpc.finance.overview.useQuery();
  const shortlistQ = trpc.scouting.list.useQuery();
  const recommendedQ = trpc.scouting.recommended.useQuery();
  const seasonQ = trpc.season.getCurrent.useQuery();

  const fin = financeQ.data;
  const shortlist = shortlistQ.data ?? [];
  const recommended = recommendedQ.data ?? [];
  const absWeek = seasonQ.data
    ? seasonQ.data.number * 52 + seasonQ.data.currentWeek
    : 0;

  return (
    <aside
      className="flex flex-col gap-4 rounded-lg p-4"
      style={{ background: D.card, border: `1px solid ${D.borderFaint}` }}
    >
      {/* Finance pulse */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle>Finance</SectionTitle>
          <Link
            href="/finance"
            className="text-[10px] underline-offset-2 hover:underline"
            style={{ color: D.textSubtle }}
          >
            details
          </Link>
        </div>
        {fin ? (
          <div className="flex flex-col gap-1.5">
            <Row
              label="Weekly net"
              value={`${fin.weekly.net >= 0 ? "+" : ""}${formatCurrency(fin.weekly.net)}`}
              color={fin.weekly.net >= 0 ? D.green : D.red}
            />
            <Row
              label="Transfer pool"
              value={formatCurrency(fin.buckets.transfer)}
              color={D.gold}
            />
            {fin.debt.amount > 0 && (
              <>
                <Row
                  label="Investor debt"
                  value={formatCurrency(fin.debt.amount)}
                  color={D.red}
                />
                <div
                  className="relative mt-1 h-1 w-full rounded"
                  style={{ background: "rgba(255,255,255,0.05)" }}
                >
                  <div
                    className="absolute left-0 top-0 h-1 rounded"
                    style={{
                      width: `${Math.min(100, (fin.debt.amount / fin.debt.patience) * 100)}%`,
                      background:
                        fin.debt.amount >= fin.debt.patience
                          ? D.red
                          : fin.debt.amount >= fin.debt.patience * 0.5
                            ? D.amber
                            : D.green,
                    }}
                  />
                </div>
              </>
            )}
          </div>
        ) : (
          <Skeleton lines={2} />
        )}
      </section>

      <Divider />

      {/* Scouting in progress */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle>Scouting</SectionTitle>
          <span className="text-[10px]" style={{ color: D.textSubtle }}>
            {shortlist.length} on watchlist
          </span>
        </div>
        {shortlist.length === 0 ? (
          <Empty>
            Add players to your shortlist from the Market — potential reveals
            after 4 weeks of scouting.
          </Empty>
        ) : (
          <div className="flex flex-col gap-1.5">
            {shortlist.slice(0, 4).map((s) => {
              const weeksLeft = Math.max(0, 4 - (absWeek - s.addedWeek));
              const isRevealed = s.player.potentialRevealed;
              return (
                <div key={s.id} className="flex items-center justify-between text-[11px]">
                  <Link
                    href={`/player/${s.player.id}`}
                    className="truncate hover:underline"
                    style={{ color: D.textPrimary }}
                  >
                    {s.player.ign}
                    <span style={{ color: D.textSubtle }}> · {s.player.role}</span>
                  </Link>
                  <span
                    className="text-[10px] tabular-nums"
                    style={{ color: isRevealed ? D.green : D.textSubtle }}
                  >
                    {isRevealed
                      ? `pot ${s.player.potential}`
                      : weeksLeft === 0
                        ? "revealing…"
                        : `${weeksLeft}w`}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <Divider />

      {/* Recommended targets */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle>Recommended</SectionTitle>
          <Link
            href="/market"
            className="text-[10px] underline-offset-2 hover:underline"
            style={{ color: D.textSubtle }}
          >
            market
          </Link>
        </div>
        {recommended.length === 0 ? (
          <Empty>No actionable recommendations right now.</Empty>
        ) : (
          <div className="flex flex-col gap-1.5">
            {recommended.slice(0, 4).map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 text-[11px]">
                <Link
                  href={`/player/${p.id}`}
                  className="min-w-0 truncate hover:underline"
                  style={{ color: D.textPrimary }}
                >
                  {p.ign}
                  <span style={{ color: D.textSubtle }}> · OVR {p.overall}</span>
                </Link>
                <span
                  className="shrink-0 text-[10px]"
                  style={{ color: D.textSubtle }}
                >
                  {p.reason}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="text-[10px] font-medium uppercase tracking-wider"
      style={{ color: D.textSubtle }}
    >
      {children}
    </span>
  );
}

function Row({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span style={{ color: D.textMuted }}>{label}</span>
      <span
        className="tabular-nums font-medium"
        style={{ color: color ?? D.textPrimary }}
      >
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: D.borderFaint }} />;
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] leading-snug" style={{ color: D.textSubtle }}>
      {children}
    </p>
  );
}

function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-3 rounded"
          style={{ background: "rgba(255,255,255,0.05)" }}
        />
      ))}
    </div>
  );
}
