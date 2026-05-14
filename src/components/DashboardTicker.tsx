"use client";

import Link from "next/link";
import { trpc } from "@/lib/trpc-client";
import { formatCurrency } from "@/lib/format";
import { D } from "@/constants/design";

/**
 * Live ticker shown next to RecentMatches on the dashboard. Three stacked
 * panels — Finance / Scouting / Recommended — all sourced from one tRPC
 * call (`finance.ticker`) to keep the dashboard's TTFB low.
 */
export function DashboardTicker() {
  const tickerQ = trpc.finance.ticker.useQuery();
  const data = tickerQ.data;

  if (!data) {
    return (
      <aside
        className="flex flex-col gap-4 p-4"
        style={{
          background: D.card,
          border: `1px solid ${D.border}`,
          borderRadius: D.radiusCard,
        }}
      >
        <Skeleton lines={3} />
        <Divider />
        <Skeleton lines={3} />
        <Divider />
        <Skeleton lines={3} />
      </aside>
    );
  }

  const debtPct =
    data.debt.patience > 0 ? (data.debt.amount / data.debt.patience) * 100 : 0;

  return (
    <aside
      className="flex flex-col gap-4 p-4"
      style={{
        background: D.card,
        border: `1px solid ${D.border}`,
        borderRadius: D.radiusCard,
      }}
    >
      {/* Finance pulse */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle>Finances</SectionTitle>
          <Link
            href="/finance"
            className="text-[10px] underline-offset-2 hover:underline"
            style={{ color: D.textSubtle }}
          >
            détails
          </Link>
        </div>
        <div className="flex flex-col gap-1.5">
          <Row
            label="Bilan hebdo"
            value={`${data.weeklyNet >= 0 ? "+" : ""}${formatCurrency(data.weeklyNet)}`}
            color={data.weeklyNet >= 0 ? D.green : D.red}
          />
          <Row
            label="Transferts"
            value={formatCurrency(data.buckets.transfer)}
            color={D.gold}
          />
          {data.debt.amount > 0 && (
            <>
              <Row
                label="Dette investisseur"
                value={formatCurrency(data.debt.amount)}
                color={D.red}
              />
              <div
                className="relative mt-1 h-1 w-full"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  borderRadius: D.radiusBadge,
                }}
              >
                <div
                  className="absolute left-0 top-0 h-1"
                  style={{
                    width: `${Math.min(100, debtPct)}%`,
                    background:
                      data.debt.amount >= data.debt.patience
                        ? D.red
                        : data.debt.amount >= data.debt.patience * 0.5
                          ? D.amber
                          : D.green,
                    borderRadius: D.radiusBadge,
                  }}
                />
              </div>
            </>
          )}
        </div>
      </section>

      <Divider />

      {/* Scouting in progress */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle>Scouting</SectionTitle>
          <span className="text-[10px]" style={{ color: D.textSubtle }}>
            {data.shortlist.length} sous surveillance
          </span>
        </div>
        {data.shortlist.length === 0 ? (
          <Empty>
            Ajoute des joueurs à ta shortlist depuis le Marché — le potentiel
            se révèle après {data.revealWeeks} semaines de scouting.
          </Empty>
        ) : (
          <div className="flex flex-col gap-1.5">
            {data.shortlist.map((s) => {
              const weeksLeft = Math.max(
                0,
                data.revealWeeks - (data.absWeek - s.addedWeek),
              );
              const isRevealed = s.player.potentialRevealed;
              return (
                <div
                  key={s.id}
                  className="flex items-center justify-between text-[11px]"
                >
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
                      ? `pot. ${s.player.potential}`
                      : weeksLeft === 0
                        ? "révélation…"
                        : `${weeksLeft} sem`}
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
          <SectionTitle>Recommandés</SectionTitle>
          <Link
            href="/market"
            className="text-[10px] underline-offset-2 hover:underline"
            style={{ color: D.textSubtle }}
          >
            marché
          </Link>
        </div>
        {data.recommended.length === 0 ? (
          <Empty>Aucune recommandation actionnable pour l'instant.</Empty>
        ) : (
          <div className="flex flex-col gap-1.5">
            {data.recommended.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-2 text-[11px]"
              >
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
          className="h-3"
          style={{
            background: "rgba(255,255,255,0.05)",
            borderRadius: D.radiusBadge,
          }}
        />
      ))}
    </div>
  );
}
