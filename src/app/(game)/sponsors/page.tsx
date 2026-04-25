"use client";

import { trpc } from "@/lib/trpc-client";
import { formatCurrency } from "@/lib/format";
import { D } from "@/constants/design";

interface SponsorOffer {
  id: string;
  name: string;
  tier: "Tier1" | "Tier2" | "Tier3";
  weeklyPayment: number;
  winBonus: number;
  champPtsBonus: number;
  durationWeeks: number;
}

interface ActiveSponsor {
  id: string;
  name: string;
  tier: "Tier1" | "Tier2" | "Tier3";
  weeklyPayment: number;
  winBonus: number;
  champPtsBonus: number;
  contractEndSeason: number;
  contractEndWeek: number;
  isActive: boolean;
  createdAt: Date;
}

function tierMeta(tier: "Tier1" | "Tier2" | "Tier3"): {
  label: string;
  color: string;
  bg: string;
  border: string;
} {
  switch (tier) {
    case "Tier1":
      return {
        label: "Tier 1",
        color: D.red,
        bg: "rgba(255,70,85,0.1)",
        border: "rgba(255,70,85,0.25)",
      };
    case "Tier2":
      return {
        label: "Tier 2",
        color: D.gold,
        bg: "rgba(198,155,58,0.1)",
        border: "rgba(198,155,58,0.25)",
      };
    case "Tier3":
      return {
        label: "Tier 3",
        color: D.textMuted,
        bg: "rgba(255,255,255,0.04)",
        border: "rgba(255,255,255,0.08)",
      };
  }
}

export default function SponsorsPage() {
  const utils = trpc.useUtils();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mineQuery = trpc.sponsor.listMySponsors.useQuery() as any;
  const mySponsors = mineQuery.data as ActiveSponsor[] | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const offersQuery = trpc.sponsor.listOffers.useQuery() as any;
  const offers = offersQuery.data as SponsorOffer[] | undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const acceptMut = trpc.sponsor.acceptSponsor.useMutation({
    onSuccess: () => {
      utils.sponsor.listMySponsors.invalidate();
      utils.sponsor.listOffers.invalidate();
    },
  }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dropMut = trpc.sponsor.dropSponsor.useMutation({
    onSuccess: () => {
      utils.sponsor.listMySponsors.invalidate();
    },
  }) as any;

  const totalWeekly =
    mySponsors?.reduce((sum, s) => sum + s.weeklyPayment, 0) ?? 0;
  const totalWinBonus =
    mySponsors?.reduce((sum, s) => sum + s.winBonus, 0) ?? 0;
  const activeCount = mySponsors?.length ?? 0;
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
              className="text-[11px] font-medium "
              style={{ color: D.textSubtle }}
            >
              Brand Partnerships
            </div>
            <h1
              className="mt-1 text-[34px] font-medium leading-none "
              style={{ color: D.textPrimary }}
            >
              Sponsors
            </h1>
            <div
              className="mt-2 flex items-center gap-3 text-[11px] font-medium "
              style={{ color: D.textMuted }}
            >
              <span style={{ color: activeCount > 0 ? D.red : D.textMuted }}>
                {activeCount} active
              </span>
              <span>·</span>
              <span>{offerCount} offers</span>
            </div>
          </div>
        </div>
      </section>

      {/* Metrics */}
      <section
        className="grid grid-cols-4"
        style={{ borderBottom: `1px solid ${D.border}` }}
      >
        <MetricCell
          label="Active"
          value={String(activeCount)}
          sub="Sponsors on roster"
        />
        <MetricCell
          label="Weekly Income"
          value={formatCurrency(totalWeekly)}
          sub="Combined base pay"
          accent={D.gold}
        />
        <MetricCell
          label="Win Bonus"
          value={formatCurrency(totalWinBonus)}
          sub="Per match victory"
          accent={D.green}
        />
        <MetricCell
          label="Offers"
          value={String(offerCount)}
          sub="Available to sign"
          last
        />
      </section>

      {/* Active sponsors */}
      <section className="flex flex-col">
        <div
          className="flex items-center justify-between px-10 py-4"
          style={{ borderBottom: `1px solid ${D.borderFaint}` }}
        >
          <span
            className="text-[10px] font-medium "
            style={{ color: D.textSubtle }}
          >
            Active Sponsors
          </span>
          <span
            className="text-[10px] font-medium tabular-nums"
            style={{ color: D.textMuted }}
          >
            {activeCount}
          </span>
        </div>

        {!mySponsors || mySponsors.length === 0 ? (
          <div
            className="px-10 py-10 text-[12px]"
            style={{ color: D.textSubtle }}
          >
            No active sponsors. Accept an offer below.
          </div>
        ) : (
          mySponsors.map((s) => {
            const t = tierMeta(s.tier);
            return (
              <div
                key={s.id}
                className="grid items-center gap-6 px-10 py-4 transition-colors"
                style={{
                  borderBottom: `1px solid ${D.borderFaint}`,
                  gridTemplateColumns: "80px 1fr 120px 120px 140px 100px",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = D.hoverBg)
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                <span
                  className="inline-flex w-fit items-center rounded px-2 py-1 text-[10px] font-medium "
                  style={{
                    background: t.bg,
                    color: t.color,
                    border: `1px solid ${t.border}`,
                  }}
                >
                  {t.label}
                </span>
                <div className="min-w-0">
                  <div
                    className="truncate text-[14px] font-medium"
                    style={{ color: D.textPrimary }}
                  >
                    {s.name}
                  </div>
                  <div
                    className="text-[10px] font-medium "
                    style={{ color: D.textSubtle }}
                  >
                    Ends S{s.contractEndSeason} · W{s.contractEndWeek}
                  </div>
                </div>
                <div className="flex flex-col">
                  <span
                    className="text-[10px] font-medium "
                    style={{ color: D.textSubtle }}
                  >
                    Weekly
                  </span>
                  <span
                    className="text-[14px] font-medium tabular-nums"
                    style={{ color: D.gold }}
                  >
                    {formatCurrency(s.weeklyPayment)}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span
                    className="text-[10px] font-medium "
                    style={{ color: D.textSubtle }}
                  >
                    Win Bonus
                  </span>
                  <span
                    className="text-[14px] font-medium tabular-nums"
                    style={{ color: D.textPrimary }}
                  >
                    {formatCurrency(s.winBonus)}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span
                    className="text-[10px] font-medium "
                    style={{ color: D.textSubtle }}
                  >
                    Champ Pts
                  </span>
                  <span
                    className="text-[14px] font-medium tabular-nums"
                    style={{ color: D.textPrimary }}
                  >
                    {formatCurrency(s.champPtsBonus)}
                  </span>
                </div>
                <button
                  onClick={() => dropMut.mutate({ sponsorId: s.id })}
                  disabled={dropMut.isPending}
                  className="rounded px-4 py-2 text-[10px] font-medium transition-colors disabled:opacity-40"
                  style={{
                    background: "rgba(255,70,85,0.08)",
                    color: D.red,
                    border: `1px solid rgba(255,70,85,0.25)`,
                  }}
                >
                  Drop
                </button>
              </div>
            );
          })
        )}
      </section>

      {/* Available offers */}
      <section className="flex flex-col">
        <div
          className="flex items-center justify-between px-10 py-4"
          style={{
            borderTop: `1px solid ${D.border}`,
            borderBottom: `1px solid ${D.borderFaint}`,
          }}
        >
          <span
            className="text-[10px] font-medium "
            style={{ color: D.textSubtle }}
          >
            Available Offers
          </span>
          <span
            className="text-[10px] font-medium tabular-nums"
            style={{ color: D.textMuted }}
          >
            {offerCount}
          </span>
        </div>

        {!offers || offers.length === 0 ? (
          <div
            className="px-10 py-10 text-[12px]"
            style={{ color: D.textSubtle }}
          >
            No offers right now. New offers arrive each stage.
          </div>
        ) : (
          offers.map((o) => {
            const t = tierMeta(o.tier);
            return (
              <div
                key={o.id}
                className="grid items-center gap-6 px-10 py-4 transition-colors"
                style={{
                  borderBottom: `1px solid ${D.borderFaint}`,
                  gridTemplateColumns:
                    "80px 1fr 120px 120px 120px 120px 100px",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = D.hoverBg)
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "transparent")
                }
              >
                <span
                  className="inline-flex w-fit items-center rounded px-2 py-1 text-[10px] font-medium "
                  style={{
                    background: t.bg,
                    color: t.color,
                    border: `1px solid ${t.border}`,
                  }}
                >
                  {t.label}
                </span>
                <div className="min-w-0">
                  <div
                    className="truncate text-[14px] font-medium"
                    style={{ color: D.textPrimary }}
                  >
                    {o.name}
                  </div>
                </div>
                <div className="flex flex-col">
                  <span
                    className="text-[10px] font-medium "
                    style={{ color: D.textSubtle }}
                  >
                    Weekly
                  </span>
                  <span
                    className="text-[14px] font-medium tabular-nums"
                    style={{ color: D.gold }}
                  >
                    {formatCurrency(o.weeklyPayment)}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span
                    className="text-[10px] font-medium "
                    style={{ color: D.textSubtle }}
                  >
                    Win Bonus
                  </span>
                  <span
                    className="text-[14px] font-medium tabular-nums"
                    style={{ color: D.textPrimary }}
                  >
                    {formatCurrency(o.winBonus)}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span
                    className="text-[10px] font-medium "
                    style={{ color: D.textSubtle }}
                  >
                    Champ Pts
                  </span>
                  <span
                    className="text-[14px] font-medium tabular-nums"
                    style={{ color: D.textPrimary }}
                  >
                    {formatCurrency(o.champPtsBonus)}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span
                    className="text-[10px] font-medium "
                    style={{ color: D.textSubtle }}
                  >
                    Duration
                  </span>
                  <span
                    className="text-[14px] font-medium tabular-nums"
                    style={{ color: D.textPrimary }}
                  >
                    {o.durationWeeks} wks
                  </span>
                </div>
                <button
                  onClick={() => acceptMut.mutate({ offerId: o.id })}
                  disabled={acceptMut.isPending}
                  className="rounded px-4 py-2 text-[10px] font-medium transition-colors disabled:opacity-40"
                  style={{
                    background: "rgba(255,70,85,0.12)",
                    color: D.red,
                    border: `1px solid rgba(255,70,85,0.25)`,
                  }}
                >
                  Accept
                </button>
              </div>
            );
          })
        )}

        {acceptMut.error && (
          <div
            className="mx-10 my-4 rounded px-4 py-3 text-[12px]"
            style={{
              background: "rgba(255,70,85,0.06)",
              color: D.red,
              border: `1px solid rgba(255,70,85,0.25)`,
            }}
          >
            {acceptMut.error.message}
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
