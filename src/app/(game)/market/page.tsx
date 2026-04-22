"use client";

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { formatCurrency, formatStat } from "@/lib/format";
import { countryToFlag } from "@/lib/country-flag";
import { D, roleColor } from "@/constants/design";

type RoleFilter = "IGL" | "Duelist" | "Initiator" | "Sentinel" | "Controller" | "Flex" | "";
type RegionFilter = "EMEA" | "Americas" | "Pacific" | "China" | "";
type TabKey = "FA" | "BUYOUT" | "OFFERS";

const ROLES: RoleFilter[] = ["", "IGL", "Duelist", "Initiator", "Sentinel", "Controller", "Flex"];
const REGIONS: RegionFilter[] = ["", "EMEA", "Americas", "Pacific", "China"];
const CONTRACT_LENGTHS: { label: string; weeks: number }[] = [
  { label: "26w", weeks: 26 },
  { label: "52w", weeks: 52 },
  { label: "104w", weeks: 104 },
];

interface MarketPlayer {
  id: string;
  ign: string;
  firstName: string;
  lastName: string;
  nationality: string;
  age: number;
  role: string;
  imageUrl: string | null;
  region: string;
  salary: number;
  acs: number;
  kd: number;
  adr: number;
  kast: number;
  hs: number;
  teamId: string | null;
  buyoutClause: number;
  contractEndSeason: number;
  contractEndWeek: number;
  team?: { id: string; name: string; tag: string; logoUrl: string | null; region: string } | null;
}

interface OfferRow {
  id: string;
  playerId: string;
  fromTeamId: string;
  toTeamId: string | null;
  offerType: "FREE_AGENT_SIGNING" | "BUYOUT" | "CONTRACT_EXTENSION";
  transferFee: number;
  proposedSalary: number;
  contractLengthWeeks: number;
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "COUNTERED";
  week: number;
  season: number;
  createdAt: string | Date;
  player: { id: string; ign: string; role: string; imageUrl: string | null; salary: number; region: string };
  toTeam?: { id: string; name: string; tag: string; logoUrl: string | null } | null;
  fromTeam?: { id: string; name: string; tag: string; logoUrl: string | null } | null;
}

const STATUS_COLOR: Record<string, { bg: string; color: string }> = {
  PENDING: { bg: "rgba(198,155,58,0.1)", color: D.gold },
  ACCEPTED: { bg: "rgba(76,175,125,0.1)", color: D.green },
  REJECTED: { bg: "rgba(255,70,85,0.1)", color: D.red },
  EXPIRED: { bg: "rgba(255,255,255,0.04)", color: D.textSubtle },
  COUNTERED: { bg: "rgba(96,165,250,0.1)", color: D.blue },
};

export default function MarketPage() {
  const [tab, setTab] = useState<TabKey>("FA");
  const [role, setRole] = useState<RoleFilter>("");
  const [region, setRegion] = useState<RegionFilter>("");
  const [minSalary, setMinSalary] = useState<string>("");
  const [maxSalary, setMaxSalary] = useState<string>("");
  const [offerTarget, setOfferTarget] = useState<MarketPlayer | null>(null);

  const utils = trpc.useUtils();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const teamQuery = trpc.team.get.useQuery(undefined, { retry: false }) as any;
  const team = teamQuery.data as { id: string; budget: number; name: string; tag: string } | undefined;

  const filters = useMemo(
    () => ({
      region: region || undefined,
      role: role || undefined,
      minSalary: minSalary ? parseInt(minSalary, 10) : undefined,
      maxSalary: maxSalary ? parseInt(maxSalary, 10) : undefined,
    }),
    [region, role, minSalary, maxSalary],
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const freeAgentsQuery = trpc.transfer.listFreeAgents.useQuery(filters, {
    enabled: tab === "FA",
  }) as any;
  const faData = freeAgentsQuery.data as
    | { all: MarketPlayer[]; byRegion: Record<string, MarketPlayer[]> }
    | undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const marketQuery = trpc.transfer.listMarketPlayers.useQuery(filters, {
    enabled: tab === "BUYOUT",
  }) as any;
  const marketPlayers = marketQuery.data as MarketPlayer[] | undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const offersQuery = trpc.transfer.myOffers.useQuery(undefined, {
    enabled: tab === "OFFERS",
  }) as any;
  const offers = offersQuery.data as { made: OfferRow[]; received: OfferRow[] } | undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const respondMutation = trpc.transfer.respondToOffer.useMutation({
    onSuccess: () => {
      utils.transfer.myOffers.invalidate();
      utils.team.get.invalidate();
    },
  }) as any;

  const invalidateAll = () => {
    utils.team.get.invalidate();
    utils.transfer.listFreeAgents.invalidate();
    utils.transfer.listMarketPlayers.invalidate();
    utils.transfer.myOffers.invalidate();
  };

  const tabs: { key: TabKey; label: string }[] = [
    { key: "FA", label: "Free Agents" },
    { key: "BUYOUT", label: "Buy-out Market" },
    { key: "OFFERS", label: "My Offers" },
  ];

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
              Sign free agents & negotiate buyouts
            </div>
            <h1
              className="mt-1 text-[34px] font-medium uppercase leading-none tracking-[0.05em]"
              style={{ color: D.textPrimary }}
            >
              Transfer Market
            </h1>
          </div>

          {team && (
            <div className="flex flex-col items-end gap-1">
              <span
                className="text-[10px] font-medium uppercase tracking-[0.3em]"
                style={{ color: D.textSubtle }}
              >
                Available Budget
              </span>
              <span
                className="text-[22px] font-medium tabular-nums"
                style={{ color: D.gold }}
              >
                {formatCurrency(team.budget)}
              </span>
            </div>
          )}
        </div>

        {/* Pill tabs */}
        <div className="mt-6 flex gap-2">
          {tabs.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className="rounded px-4 py-2 text-[11px] font-medium uppercase tracking-[0.2em] transition-colors"
                style={{
                  background: active ? D.textPrimary : "transparent",
                  color: active ? D.bg : D.textMuted,
                  border: active
                    ? `1px solid ${D.textPrimary}`
                    : `1px solid ${D.border}`,
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </section>

      {/* Filters */}
      {tab !== "OFFERS" && (
        <section
          className="flex flex-wrap items-end gap-4 px-10 py-4"
          style={{ borderBottom: `1px solid ${D.border}` }}
        >
          <FilterSelect
            label="Role"
            value={role}
            options={ROLES}
            onChange={(v) => setRole(v as RoleFilter)}
            emptyLabel="All Roles"
          />
          <FilterSelect
            label="Region"
            value={region}
            options={REGIONS}
            onChange={(v) => setRegion(v as RegionFilter)}
            emptyLabel="All Regions"
          />
          <FilterInput
            label="Min Salary"
            value={minSalary}
            onChange={setMinSalary}
            placeholder="0"
          />
          <FilterInput
            label="Max Salary"
            value={maxSalary}
            onChange={setMaxSalary}
            placeholder="—"
          />
        </section>
      )}

      {/* Tab content */}
      <div className="flex-1">
        {tab === "FA" && (
          <FreeAgentsTab
            data={faData}
            isLoading={freeAgentsQuery.isLoading}
            onOffer={(p) => setOfferTarget(p)}
          />
        )}
        {tab === "BUYOUT" && (
          <BuyoutMarketTab
            players={marketPlayers}
            isLoading={marketQuery.isLoading}
            onOffer={(p) => setOfferTarget(p)}
          />
        )}
        {tab === "OFFERS" && (
          <OffersTab
            data={offers}
            isLoading={offersQuery.isLoading}
            userTeamId={team?.id ?? ""}
            onRespond={(offerId, action) =>
              respondMutation.mutate({ offerId, action })
            }
            respondPending={respondMutation.isPending as boolean}
          />
        )}
      </div>

      {/* Offer modal */}
      {offerTarget && team && (
        <OfferModal
          player={offerTarget}
          userTeamId={team.id}
          userBudget={team.budget}
          onClose={() => setOfferTarget(null)}
          onDone={() => {
            setOfferTarget(null);
            invalidateAll();
          }}
        />
      )}
    </div>
  );
}

// ───────────────────────── Filters ─────────────────────────

function FilterSelect({
  label,
  value,
  options,
  onChange,
  emptyLabel,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  emptyLabel: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label
        className="text-[10px] font-medium uppercase tracking-[0.2em]"
        style={{ color: D.textSubtle }}
      >
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded px-3 py-2 text-[12px] outline-none"
        style={{
          background: D.card,
          color: D.textPrimary,
          border: `1px solid ${D.border}`,
        }}
      >
        {options.map((r) => (
          <option key={r} value={r}>
            {r || emptyLabel}
          </option>
        ))}
      </select>
    </div>
  );
}

function FilterInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label
        className="text-[10px] font-medium uppercase tracking-[0.2em]"
        style={{ color: D.textSubtle }}
      >
        {label}
      </label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-32 rounded px-3 py-2 text-[12px] outline-none tabular-nums"
        style={{
          background: D.card,
          color: D.textPrimary,
          border: `1px solid ${D.border}`,
        }}
      />
    </div>
  );
}

// ───────────────────────── Loading / Empty ─────────────────────────

function CenterMsg({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <span className="text-[11px]" style={{ color: D.textSubtle }}>
        {children}
      </span>
    </div>
  );
}

// ───────────────────────── Free Agents ─────────────────────────

function FreeAgentsTab({
  data,
  isLoading,
  onOffer,
}: {
  data?: { all: MarketPlayer[]; byRegion: Record<string, MarketPlayer[]> };
  isLoading: boolean;
  onOffer: (p: MarketPlayer) => void;
}) {
  if (isLoading) return <CenterMsg>Loading free agents...</CenterMsg>;
  if (!data || data.all.length === 0)
    return <CenterMsg>No free agents match your filters.</CenterMsg>;

  const regionOrder = ["EMEA", "Americas", "Pacific", "China"];
  return (
    <div>
      {regionOrder
        .filter((r) => data.byRegion[r]?.length)
        .map((r) => (
          <section
            key={r}
            style={{ borderBottom: `1px solid ${D.border}` }}
          >
            <div
              className="flex items-center justify-between px-10 py-4"
              style={{ borderBottom: `1px solid ${D.borderFaint}` }}
            >
              <span
                className="text-[10px] font-medium uppercase tracking-[0.3em]"
                style={{ color: D.textSubtle }}
              >
                {r}
              </span>
              <span
                className="text-[10px] font-medium uppercase tracking-[0.2em] tabular-nums"
                style={{ color: D.textMuted }}
              >
                {data.byRegion[r].length} players
              </span>
            </div>
            <MarketRowHeader kind="FA" />
            {data.byRegion[r].map((p) => (
              <MarketPlayerRow
                key={p.id}
                player={p}
                kind="FA"
                onOffer={() => onOffer(p)}
              />
            ))}
          </section>
        ))}
    </div>
  );
}

// ───────────────────────── Buyout Market ─────────────────────────

function BuyoutMarketTab({
  players,
  isLoading,
  onOffer,
}: {
  players?: MarketPlayer[];
  isLoading: boolean;
  onOffer: (p: MarketPlayer) => void;
}) {
  if (isLoading) return <CenterMsg>Loading market...</CenterMsg>;
  if (!players || players.length === 0)
    return <CenterMsg>No contracted players match your filters.</CenterMsg>;

  return (
    <section style={{ borderBottom: `1px solid ${D.border}` }}>
      <MarketRowHeader kind="BUYOUT" />
      {players.map((p) => (
        <MarketPlayerRow
          key={p.id}
          player={p}
          kind="BUYOUT"
          onOffer={() => onOffer(p)}
        />
      ))}
    </section>
  );
}

// ───────────────────────── Market row ─────────────────────────

function MarketRowHeader({ kind }: { kind: "FA" | "BUYOUT" }) {
  const cols =
    kind === "FA"
      ? "40px 1fr 80px 80px 80px 120px"
      : "40px 1fr 80px 80px 100px 120px 120px";
  return (
    <div
      className="grid items-center gap-3 px-10 py-3 text-[10px] font-medium uppercase tracking-[0.2em]"
      style={{
        gridTemplateColumns: cols,
        color: D.textSubtle,
        borderBottom: `1px solid ${D.borderFaint}`,
      }}
    >
      <span />
      <span>Player</span>
      <span>Role</span>
      <span>Region</span>
      {kind === "BUYOUT" && <span>Team</span>}
      <span className="text-right">
        {kind === "FA" ? "Salary/wk" : "Buyout"}
      </span>
      <span className="text-right">Action</span>
    </div>
  );
}

function MarketPlayerRow({
  player,
  kind,
  onOffer,
}: {
  player: MarketPlayer;
  kind: "FA" | "BUYOUT";
  onOffer: () => void;
}) {
  const cols =
    kind === "FA"
      ? "40px 1fr 80px 80px 80px 120px"
      : "40px 1fr 80px 80px 100px 120px 120px";

  return (
    <div
      className="grid items-center gap-3 px-10 py-3 transition-colors"
      style={{
        gridTemplateColumns: cols,
        borderBottom: `1px solid ${D.borderFaint}`,
      }}
    >
      {/* Avatar */}
      {player.imageUrl ? (
        <img
          src={player.imageUrl}
          alt={player.ign}
          className="h-8 w-8 rounded-full object-cover"
          style={{ border: `1px solid ${D.borderFaint}` }}
        />
      ) : (
        <div
          className="flex h-8 w-8 items-center justify-center rounded-full"
          style={{ background: D.card, border: `1px solid ${D.borderFaint}` }}
        >
          <span
            className="text-[11px] font-medium"
            style={{ color: D.textMuted }}
          >
            {player.ign.charAt(0).toUpperCase()}
          </span>
        </div>
      )}

      {/* Identity + stats */}
      <div className="flex min-w-0 flex-col">
        <div className="flex items-center gap-2">
          <span
            className="truncate text-[13px] font-medium"
            style={{ color: D.textPrimary }}
          >
            {player.ign}
          </span>
          <span className="text-[12px]">
            {countryToFlag(player.nationality)}
          </span>
          <span
            className="text-[10px] font-medium uppercase tracking-[0.2em]"
            style={{ color: D.textSubtle }}
          >
            Age {player.age}
          </span>
        </div>
        <div
          className="flex items-center gap-3 text-[10px] uppercase tracking-[0.15em] tabular-nums"
          style={{ color: D.textSubtle }}
        >
          <span>
            ACS{" "}
            <span style={{ color: D.gold }}>{formatStat(player.acs, 0)}</span>
          </span>
          <span>
            K/D{" "}
            <span style={{ color: D.textPrimary }}>
              {formatStat(player.kd, 2)}
            </span>
          </span>
          <span>
            ADR{" "}
            <span style={{ color: D.textPrimary }}>
              {formatStat(player.adr, 0)}
            </span>
          </span>
        </div>
      </div>

      {/* Role */}
      <span
        className="text-[11px] font-medium uppercase tracking-[0.15em]"
        style={{ color: roleColor(player.role) }}
      >
        {player.role}
      </span>

      {/* Region */}
      <span
        className="text-[11px] font-medium uppercase tracking-[0.15em]"
        style={{ color: D.textMuted }}
      >
        {player.region}
      </span>

      {/* Team (buyout only) */}
      {kind === "BUYOUT" && (
        <div className="flex items-center gap-2">
          {player.team?.logoUrl ? (
            <img
              src={player.team.logoUrl}
              alt={player.team.name}
              className="h-5 w-5 object-contain"
            />
          ) : (
            <div
              className="h-5 w-5 rounded"
              style={{ background: D.card }}
            />
          )}
          <span
            className="text-[11px] font-medium uppercase tracking-[0.15em]"
            style={{ color: D.textPrimary }}
          >
            {player.team?.tag ?? "—"}
          </span>
        </div>
      )}

      {/* Money */}
      <div className="flex flex-col items-end">
        <span
          className="text-[13px] font-medium tabular-nums"
          style={{ color: D.gold }}
        >
          {kind === "FA"
            ? formatCurrency(player.salary)
            : formatCurrency(player.buyoutClause)}
        </span>
        {kind === "BUYOUT" && (
          <span
            className="text-[10px] tabular-nums"
            style={{ color: D.textSubtle }}
          >
            {formatCurrency(player.salary)}/wk
          </span>
        )}
      </div>

      {/* Action */}
      <div className="flex items-center justify-end">
        <button
          onClick={onOffer}
          className="rounded px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.2em] transition-colors"
          style={{
            background: "rgba(255,70,85,0.1)",
            color: D.red,
            border: `1px solid rgba(255,70,85,0.25)`,
          }}
        >
          {kind === "FA" ? "Sign" : "Make Offer"}
        </button>
      </div>
    </div>
  );
}

// ───────────────────────── Offers ─────────────────────────

function OffersTab({
  data,
  isLoading,
  userTeamId,
  onRespond,
  respondPending,
}: {
  data?: { made: OfferRow[]; received: OfferRow[] };
  isLoading: boolean;
  userTeamId: string;
  onRespond: (offerId: string, action: "ACCEPT" | "REJECT") => void;
  respondPending: boolean;
}) {
  if (isLoading) return <CenterMsg>Loading offers...</CenterMsg>;
  if (!data || (data.made.length === 0 && data.received.length === 0))
    return <CenterMsg>No transfer activity yet.</CenterMsg>;

  return (
    <div>
      {data.received.length > 0 && (
        <section style={{ borderBottom: `1px solid ${D.border}` }}>
          <div
            className="flex items-center justify-between px-10 py-4"
            style={{ borderBottom: `1px solid ${D.borderFaint}` }}
          >
            <span
              className="text-[10px] font-medium uppercase tracking-[0.3em]"
              style={{ color: D.textSubtle }}
            >
              Offers Received
            </span>
            <span
              className="text-[10px] font-medium uppercase tracking-[0.2em] tabular-nums"
              style={{ color: D.textMuted }}
            >
              {data.received.length}
            </span>
          </div>
          {data.received.map((o) => (
            <OfferRow
              key={o.id}
              offer={o}
              direction="IN"
              userTeamId={userTeamId}
              onRespond={onRespond}
              respondPending={respondPending}
            />
          ))}
        </section>
      )}

      {data.made.length > 0 && (
        <section style={{ borderBottom: `1px solid ${D.border}` }}>
          <div
            className="flex items-center justify-between px-10 py-4"
            style={{ borderBottom: `1px solid ${D.borderFaint}` }}
          >
            <span
              className="text-[10px] font-medium uppercase tracking-[0.3em]"
              style={{ color: D.textSubtle }}
            >
              Offers Made
            </span>
            <span
              className="text-[10px] font-medium uppercase tracking-[0.2em] tabular-nums"
              style={{ color: D.textMuted }}
            >
              {data.made.length}
            </span>
          </div>
          {data.made.map((o) => (
            <OfferRow
              key={o.id}
              offer={o}
              direction="OUT"
              userTeamId={userTeamId}
              onRespond={onRespond}
              respondPending={respondPending}
            />
          ))}
        </section>
      )}
    </div>
  );
}

function OfferRow({
  offer,
  direction,
  onRespond,
  respondPending,
}: {
  offer: OfferRow;
  direction: "IN" | "OUT";
  userTeamId: string;
  onRespond: (offerId: string, action: "ACCEPT" | "REJECT") => void;
  respondPending: boolean;
}) {
  const status = STATUS_COLOR[offer.status] ?? {
    bg: "rgba(255,255,255,0.04)",
    color: D.textSubtle,
  };
  const otherTeam = direction === "IN" ? offer.fromTeam : offer.toTeam;

  return (
    <div
      className="grid items-center gap-3 px-10 py-3"
      style={{
        gridTemplateColumns: "40px 1fr 180px 1fr 180px",
        borderBottom: `1px solid ${D.borderFaint}`,
      }}
    >
      {/* Player photo */}
      {offer.player.imageUrl ? (
        <img
          src={offer.player.imageUrl}
          alt={offer.player.ign}
          className="h-8 w-8 rounded-full object-cover"
          style={{ border: `1px solid ${D.borderFaint}` }}
        />
      ) : (
        <div
          className="flex h-8 w-8 items-center justify-center rounded-full"
          style={{ background: D.card, border: `1px solid ${D.borderFaint}` }}
        >
          <span
            className="text-[11px] font-medium"
            style={{ color: D.textMuted }}
          >
            {offer.player.ign.charAt(0).toUpperCase()}
          </span>
        </div>
      )}

      <div className="flex min-w-0 flex-col">
        <span
          className="truncate text-[13px] font-medium"
          style={{ color: D.textPrimary }}
        >
          {offer.player.ign}
        </span>
        <span
          className="text-[10px] font-medium uppercase tracking-[0.2em]"
          style={{ color: D.textSubtle }}
        >
          {offer.player.role} · {offer.player.region}
        </span>
      </div>

      <div className="flex flex-col">
        <span
          className="text-[10px] font-medium uppercase tracking-[0.2em]"
          style={{ color: D.textSubtle }}
        >
          {offer.offerType.replace(/_/g, " ")}
        </span>
        {otherTeam ? (
          <div className="mt-1 flex items-center gap-2">
            {otherTeam.logoUrl ? (
              <img
                src={otherTeam.logoUrl}
                alt={otherTeam.name}
                className="h-4 w-4 object-contain"
              />
            ) : (
              <div className="h-4 w-4 rounded" style={{ background: D.card }} />
            )}
            <span className="text-[12px]" style={{ color: D.textPrimary }}>
              {otherTeam.name}
            </span>
          </div>
        ) : (
          <span
            className="mt-1 text-[11px]"
            style={{ color: D.textSubtle, fontStyle: "italic" }}
          >
            Free Agent
          </span>
        )}
      </div>

      <div className="flex items-center gap-6 tabular-nums">
        {offer.transferFee > 0 && (
          <div className="flex flex-col">
            <span
              className="text-[10px] font-medium uppercase tracking-[0.2em]"
              style={{ color: D.textSubtle }}
            >
              Fee
            </span>
            <span
              className="text-[12px] font-medium"
              style={{ color: D.textPrimary }}
            >
              {formatCurrency(offer.transferFee)}
            </span>
          </div>
        )}
        <div className="flex flex-col">
          <span
            className="text-[10px] font-medium uppercase tracking-[0.2em]"
            style={{ color: D.textSubtle }}
          >
            Salary
          </span>
          <span className="text-[12px] font-medium" style={{ color: D.gold }}>
            {formatCurrency(offer.proposedSalary)}/wk
          </span>
        </div>
        <div className="flex flex-col">
          <span
            className="text-[10px] font-medium uppercase tracking-[0.2em]"
            style={{ color: D.textSubtle }}
          >
            Length
          </span>
          <span
            className="text-[12px] font-medium"
            style={{ color: D.textPrimary }}
          >
            {offer.contractLengthWeeks}w
          </span>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <span
          className="rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.2em]"
          style={{ background: status.bg, color: status.color }}
        >
          {offer.status}
        </span>
        {direction === "IN" && offer.status === "PENDING" && (
          <>
            <button
              disabled={respondPending}
              onClick={() => onRespond(offer.id, "REJECT")}
              className="rounded px-2 py-1 text-[10px] font-medium uppercase tracking-[0.2em] transition-colors disabled:opacity-40"
              style={{
                border: `1px solid ${D.border}`,
                color: D.textMuted,
              }}
            >
              Reject
            </button>
            <button
              disabled={respondPending}
              onClick={() => onRespond(offer.id, "ACCEPT")}
              className="rounded px-2 py-1 text-[10px] font-medium uppercase tracking-[0.2em] transition-colors disabled:opacity-40"
              style={{
                background: "rgba(76,175,125,0.12)",
                color: D.green,
                border: `1px solid rgba(76,175,125,0.3)`,
              }}
            >
              Accept
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ───────────────────────── Offer Modal ─────────────────────────

function OfferModal({
  player,
  userBudget,
  onClose,
  onDone,
}: {
  player: MarketPlayer;
  userTeamId: string;
  userBudget: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const isBuyout = player.teamId !== null;
  const defaultSalary = isBuyout
    ? Math.ceil(player.salary * 1.2)
    : player.salary;
  const defaultFee = isBuyout ? player.buyoutClause : 0;

  const [proposedSalary, setProposedSalary] = useState<number>(defaultSalary);
  const [contractLengthWeeks, setContractLengthWeeks] = useState<number>(52);
  const [transferFee, setTransferFee] = useState<number>(defaultFee);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const makeOffer = trpc.transfer.makeOffer.useMutation({
    onSuccess: () => onDone(),
  }) as any;

  const upfront = isBuyout ? transferFee : proposedSalary * 4;
  const insufficient = upfront > userBudget;

  const handleSubmit = () => {
    makeOffer.mutate({
      playerId: player.id,
      offerType: isBuyout ? "BUYOUT" : "FREE_AGENT_SIGNING",
      transferFee: isBuyout ? transferFee : undefined,
      proposedSalary,
      contractLengthWeeks,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{
        background: "rgba(0,0,0,0.6)",
        backdropFilter: "blur(6px)",
      }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg"
        style={{
          background: D.surface,
          border: `1px solid ${D.border}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: `1px solid ${D.borderFaint}` }}
        >
          <div>
            <div
              className="text-[10px] font-medium uppercase tracking-[0.3em]"
              style={{ color: D.textSubtle }}
            >
              {isBuyout ? "Buyout Offer" : "Sign Free Agent"}
            </div>
            <h2
              className="mt-1 text-[22px] font-medium uppercase tracking-[0.05em]"
              style={{ color: D.textPrimary }}
            >
              {player.ign}
            </h2>
            <div
              className="mt-1 text-[11px] font-medium uppercase tracking-[0.2em]"
              style={{ color: D.textMuted }}
            >
              {player.role} · {player.region}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-[12px] uppercase tracking-[0.2em] transition-colors"
            style={{ color: D.textMuted }}
          >
            Close
          </button>
        </div>

        {/* Context row */}
        <div
          className="grid grid-cols-3"
          style={{ borderBottom: `1px solid ${D.borderFaint}` }}
        >
          <ModalMetric
            label="Current Salary"
            value={formatCurrency(player.salary)}
          />
          {isBuyout ? (
            <ModalMetric
              label="Buyout Clause"
              value={formatCurrency(player.buyoutClause)}
              accent={D.gold}
            />
          ) : (
            <ModalMetric label="K/D" value={formatStat(player.kd, 2)} />
          )}
          <ModalMetric
            label="ACS"
            value={formatStat(player.acs, 0)}
            accent={D.gold}
            last
          />
        </div>

        <div className="flex flex-col gap-5 px-6 py-5">
          {isBuyout && (
            <div>
              <label
                className="mb-2 block text-[10px] font-medium uppercase tracking-[0.2em]"
                style={{ color: D.textSubtle }}
              >
                Transfer Fee
              </label>
              <input
                type="number"
                value={transferFee}
                onChange={(e) =>
                  setTransferFee(parseInt(e.target.value || "0", 10))
                }
                className="w-full rounded px-3 py-2.5 text-[13px] outline-none tabular-nums"
                style={{
                  background: D.card,
                  color: D.textPrimary,
                  border: `1px solid ${D.border}`,
                }}
              />
              <p
                className="mt-2 text-[10px] leading-relaxed"
                style={{ color: D.textSubtle }}
              >
                {transferFee >= player.buyoutClause
                  ? "Meets buyout clause — auto-accepted."
                  : transferFee >= Math.floor(player.buyoutClause * 0.7)
                    ? "Below clause — selling team will consider (50/50)."
                    : "Too low — likely rejected."}
              </p>
            </div>
          )}

          <div>
            <label
              className="mb-2 block text-[10px] font-medium uppercase tracking-[0.2em]"
              style={{ color: D.textSubtle }}
            >
              Proposed Salary (per week)
            </label>
            <input
              type="number"
              value={proposedSalary}
              onChange={(e) =>
                setProposedSalary(parseInt(e.target.value || "0", 10))
              }
              className="w-full rounded px-3 py-2.5 text-[13px] outline-none tabular-nums"
              style={{
                background: D.card,
                color: D.textPrimary,
                border: `1px solid ${D.border}`,
              }}
            />
            <p
              className="mt-2 text-[10px] leading-relaxed"
              style={{ color: D.textSubtle }}
            >
              {isBuyout
                ? `Player demands at least ${formatCurrency(Math.ceil(player.salary * 1.2))}/wk to move.`
                : proposedSalary >= player.salary
                  ? "Meets asking salary — signing should go through."
                  : "Below asking — player may decline."}
            </p>
          </div>

          <div>
            <label
              className="mb-2 block text-[10px] font-medium uppercase tracking-[0.2em]"
              style={{ color: D.textSubtle }}
            >
              Contract Length
            </label>
            <div className="flex gap-2">
              {CONTRACT_LENGTHS.map((c) => {
                const active = contractLengthWeeks === c.weeks;
                return (
                  <button
                    key={c.weeks}
                    onClick={() => setContractLengthWeeks(c.weeks)}
                    className="flex-1 rounded px-3 py-2 text-[11px] font-medium uppercase tracking-[0.2em] transition-colors"
                    style={{
                      background: active
                        ? "rgba(255,70,85,0.1)"
                        : "transparent",
                      color: active ? D.red : D.textMuted,
                      border: active
                        ? `1px solid rgba(255,70,85,0.3)`
                        : `1px solid ${D.border}`,
                    }}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Upfront */}
          <div
            className="flex items-center justify-between rounded px-3 py-2.5"
            style={{
              background: D.card,
              border: `1px solid ${D.borderFaint}`,
            }}
          >
            <span
              className="text-[10px] font-medium uppercase tracking-[0.2em]"
              style={{ color: D.textSubtle }}
            >
              Upfront Cost {isBuyout ? "(transfer fee)" : "(4w signing)"}
            </span>
            <span
              className="text-[14px] font-medium tabular-nums"
              style={{ color: insufficient ? D.red : D.gold }}
            >
              {formatCurrency(upfront)}
            </span>
          </div>

          {makeOffer.error && (
            <div
              className="rounded px-3 py-2 text-[11px]"
              style={{
                background: "rgba(255,70,85,0.08)",
                color: D.red,
                border: `1px solid rgba(255,70,85,0.25)`,
              }}
            >
              {makeOffer.error.message}
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              className="rounded px-4 py-2 text-[11px] font-medium uppercase tracking-[0.2em] transition-colors"
              style={{
                border: `1px solid ${D.border}`,
                color: D.textMuted,
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={
                insufficient || makeOffer.isPending || proposedSalary <= 0
              }
              className="rounded px-4 py-2 text-[11px] font-medium uppercase tracking-[0.25em] transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              style={{
                background: "rgba(255,70,85,0.1)",
                color: D.red,
                border: `1px solid rgba(255,70,85,0.3)`,
              }}
            >
              {makeOffer.isPending ? "Sending..." : "Submit Offer"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ModalMetric({
  label,
  value,
  accent,
  last,
}: {
  label: string;
  value: string;
  accent?: string;
  last?: boolean;
}) {
  return (
    <div
      className="flex flex-col gap-1 px-5 py-4"
      style={{ borderRight: last ? undefined : `1px solid ${D.borderFaint}` }}
    >
      <span
        className="text-[10px] font-medium uppercase tracking-[0.25em]"
        style={{ color: D.textSubtle }}
      >
        {label}
      </span>
      <span
        className="text-[16px] font-medium tabular-nums"
        style={{ color: accent ?? D.textPrimary }}
      >
        {value}
      </span>
    </div>
  );
}
