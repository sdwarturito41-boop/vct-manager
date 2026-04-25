"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc-client";
import type { PlayerInfo } from "@/lib/types";
import { D, roleColor } from "@/constants/design";
import { formatCurrency, formatStat } from "@/lib/format";
import { countryToFlag } from "@/lib/country-flag";

interface RosterPlayer extends PlayerInfo {
  leadershipRole?: string;
  contractEndSeason?: number;
  contractEndWeek?: number;
  happiness?: number;
  happinessTags?: unknown;
  isTransferListed?: boolean;
  overall?: number;
}

function happinessColor(score: number): string {
  if (score >= 70) return D.green;
  if (score >= 40) return D.gold;
  if (score >= 20) return "#ff8c50";
  return D.red;
}

export default function RosterPage() {
  const router = useRouter();

  const { data: team, isLoading: teamLoading } = trpc.team.get.useQuery(
    undefined,
    { retry: false }
  );
  const { data: allPlayers, isLoading: playersLoading } =
    trpc.player.rosterAll.useQuery(undefined, { retry: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rosterRelations = trpc.player.rosterRelationSummary.useQuery(undefined, {
    retry: false,
  }) as any;
  const relationSummary = (rosterRelations.data ?? {}) as Record<
    string,
    { maxDuoStrength: number; hasClash: boolean }
  >;

  const utils = trpc.useUtils();

  const toggleMutation = trpc.team.togglePlayerActive.useMutation({
    onSuccess: () => {
      utils.player.rosterAll.invalidate();
      utils.team.get.invalidate();
    },
  });

  const sellMutation = trpc.player.sell.useMutation({
    onSuccess: () => {
      utils.player.rosterAll.invalidate();
      utils.team.get.invalidate();
    },
  });

  const handleRelease = (player: RosterPlayer) => {
    const recover = player.salary * 2;
    if (
      window.confirm(
        `Release ${player.ign}? You'll recover $${recover.toLocaleString()}`
      )
    ) {
      sellMutation.mutate({ playerId: player.id });
    }
  };

  const isLoading = teamLoading || playersLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div
          className="h-8 w-8 animate-spin rounded-full border-2"
          style={{ borderColor: D.border, borderTopColor: D.red }}
        />
      </div>
    );
  }

  if (!team || !allPlayers) {
    return (
      <div className="flex items-center justify-center py-32">
        <p className="text-sm" style={{ color: D.textSubtle }}>
          No team found.
        </p>
      </div>
    );
  }

  const players = allPlayers as RosterPlayer[];
  const activePlayers = players.filter((p) => p.isActive);
  const benchPlayers = players.filter((p) => !p.isActive);
  const totalSalary = players.reduce((sum, p) => sum + p.salary, 0);

  // Compute "MVP" row: highest ACS among active players
  const topAcsId =
    activePlayers.length > 0
      ? activePlayers.reduce((best, p) => (p.acs > best.acs ? p : best), activePlayers[0]).id
      : null;

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
              className="text-[11px] font-medium "
              style={{ color: D.textSubtle }}
            >
              {team.region} · {team.name}
            </div>
            <h1
              className="mt-1 text-[34px] font-medium leading-none "
              style={{ color: D.textPrimary }}
            >
              Roster
            </h1>
          </div>
          <Link
            href="/market"
            className="rounded px-4 py-2 text-[10px] font-medium transition-colors"
            style={{
              background: "rgba(255,70,85,0.1)",
              color: D.red,
              border: `1px solid rgba(255,70,85,0.25)`,
            }}
          >
            Transfer Market →
          </Link>
        </div>
      </section>

      {/* Metrics */}
      <section
        className="grid grid-cols-4"
        style={{ borderBottom: `1px solid ${D.border}` }}
      >
        <MetricCell label="Total Players" value={String(players.length)} />
        <MetricCell label="Active" value={String(activePlayers.length)} accent={D.red} />
        <MetricCell label="Bench" value={String(benchPlayers.length)} />
        <MetricCell
          label="Weekly Salary"
          value={formatCurrency(totalSalary)}
          accent={D.gold}
          last
        />
      </section>

      {/* Team Attribute Overview (V4.1) */}
      <TeamAttributeOverview />

      {/* Active table */}
      {activePlayers.length > 0 && (
        <section style={{ borderBottom: `1px solid ${D.border}` }}>
          <SectionHeader label="Active Roster" count={activePlayers.length} />
          <RosterTableHeader />
          {activePlayers.map((p) => (
            <RosterRow
              key={p.id}
              player={p}
              isMvp={p.id === topAcsId}
              relationSummary={relationSummary[p.id]}
              onOpenDetail={() => router.push(`/player/${p.id}`)}
              onBench={() =>
                toggleMutation.mutate({ playerId: p.id, isActive: false })
              }
              onRelease={() => handleRelease(p)}
              togglePending={toggleMutation.isPending}
              sellPending={sellMutation.isPending}
              active
            />
          ))}
        </section>
      )}

      {/* Bench table */}
      {benchPlayers.length > 0 && (
        <section style={{ borderBottom: `1px solid ${D.border}` }}>
          <SectionHeader label="Bench" count={benchPlayers.length} />
          <RosterTableHeader />
          {benchPlayers.map((p) => (
            <RosterRow
              key={p.id}
              player={p}
              isMvp={false}
              relationSummary={relationSummary[p.id]}
              onOpenDetail={() => router.push(`/player/${p.id}`)}
              onBench={() =>
                toggleMutation.mutate({ playerId: p.id, isActive: true })
              }
              onRelease={() => handleRelease(p)}
              togglePending={toggleMutation.isPending}
              sellPending={sellMutation.isPending}
              active={false}
            />
          ))}
        </section>
      )}

      {allPlayers.length === 0 && (
        <div className="px-10 py-16 text-center">
          <p className="text-[13px]" style={{ color: D.textSubtle }}>
            No players on your roster. Head to the{" "}
            <Link href="/market" style={{ color: D.red }}>
              Market
            </Link>{" "}
            to sign free agents.
          </p>
        </div>
      )}

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
      style={{ borderRight: last ? undefined : `1px solid ${D.borderFaint}` }}
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

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div
      className="flex items-center justify-between px-10 py-4"
      style={{ borderBottom: `1px solid ${D.borderFaint}` }}
    >
      <span
        className="text-[10px] font-medium "
        style={{ color: D.textSubtle }}
      >
        {label}
      </span>
      <span
        className="text-[10px] font-medium tabular-nums"
        style={{ color: D.textMuted }}
      >
        {count} {count === 1 ? "player" : "players"}
      </span>
    </div>
  );
}

function RosterTableHeader() {
  return (
    <div
      className="grid items-center gap-3 px-10 py-3 text-[10px] font-medium "
      style={{
        gridTemplateColumns:
          "48px minmax(180px,1.3fr) 100px 110px 60px repeat(4,minmax(60px,1fr)) 110px 120px 170px",
        color: D.textSubtle,
        borderBottom: `1px solid ${D.borderFaint}`,
      }}
    >
      <span />
      <span>Player</span>
      <span>Role</span>
      <span>Leadership</span>
      <span className="text-right">Age</span>
      <span className="text-right">ACS</span>
      <span className="text-right">K/D</span>
      <span className="text-right">ADR</span>
      <span className="text-right">KAST</span>
      <span className="text-right">Salary</span>
      <span className="text-right">Contract</span>
      <span className="text-right">Actions</span>
    </div>
  );
}

function RosterRow({
  player,
  isMvp,
  active,
  relationSummary,
  onOpenDetail,
  onBench,
  onRelease,
  togglePending,
  sellPending,
}: {
  player: RosterPlayer;
  isMvp: boolean;
  active: boolean;
  relationSummary?: { maxDuoStrength: number; hasClash: boolean };
  onOpenDetail: () => void;
  onBench: () => void;
  onRelease: () => void;
  togglePending: boolean;
  sellPending: boolean;
}) {
  const rColor = roleColor(player.role);
  const mvpBg = isMvp ? "rgba(198,155,58,0.04)" : undefined;
  const happiness = typeof player.happiness === "number" ? player.happiness : 75;
  const hColor = happinessColor(happiness);

  return (
    <div
      className="grid items-center gap-3 px-10 py-3 transition-colors hover:bg-white/5"
      style={{
        gridTemplateColumns:
          "48px minmax(180px,1.3fr) 100px 110px 60px repeat(4,minmax(60px,1fr)) 110px 120px 170px",
        borderBottom: `1px solid ${D.borderFaint}`,
        background: mvpBg,
        opacity: active ? 1 : 0.75,
        cursor: "pointer",
      }}
      onClick={onOpenDetail}
    >
      {/* Photo / initials */}
      <div className="block">
        {player.imageUrl ? (
          <img
            src={player.imageUrl}
            alt={player.ign}
            className="h-10 w-10 rounded-full object-cover"
            style={{ border: `1px solid ${D.borderFaint}` }}
          />
        ) : (
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full"
            style={{ background: D.card, border: `1px solid ${D.borderFaint}` }}
          >
            <span
              className="text-[12px] font-medium"
              style={{ color: D.textMuted }}
            >
              {player.ign.charAt(0).toUpperCase()}
            </span>
          </div>
        )}
      </div>

      {/* IGN + Full name */}
      <div className="min-w-0 flex flex-col">
        <div className="flex items-center gap-2">
          <span
            className="truncate text-[14px] font-medium"
            style={{ color: D.textPrimary }}
          >
            {player.ign}
          </span>
          <span className="text-[12px]">
            {countryToFlag(player.nationality)}
          </span>
          {/* Happiness dot */}
          <span
            title={`Mood ${happiness}/100`}
            className="h-2 w-2 rounded-full"
            style={{ background: hColor }}
          />
          {/* Relation dots (V3) */}
          {relationSummary?.maxDuoStrength && relationSummary.maxDuoStrength >= 0.8 && (
            <span
              title={`Strong DUO (${Math.round(relationSummary.maxDuoStrength * 100)}%)`}
              className="h-2 w-2 rounded-full"
              style={{ background: "#4caf7d" }}
            />
          )}
          {relationSummary?.hasClash && (
            <span
              title="Active CLASH with a teammate"
              className="h-2 w-2 rounded-full"
              style={{ background: "#ff4655" }}
            />
          )}
          {typeof player.overall === "number" && player.overall >= 17 && (
            <span
              title={`Elite overall (${Math.round(player.overall)}/20)`}
              className="h-2 w-2 rounded-full"
              style={{ background: "#c69b3a" }}
            />
          )}
          {player.isTransferListed && (
            <span
              className="rounded px-1.5 py-0.5 text-[9px] font-medium "
              style={{
                background: "rgba(255,70,85,0.1)",
                color: D.red,
              }}
            >
              Listed
            </span>
          )}
          {isMvp && (
            <span
              className="rounded px-1.5 py-0.5 text-[9px] font-medium "
              style={{
                background: "rgba(198,155,58,0.15)",
                color: D.gold,
              }}
            >
              MVP
            </span>
          )}
        </div>
        <span
          className="truncate text-[11px]"
          style={{ color: D.textSubtle }}
        >
          {player.firstName} {player.lastName}
        </span>
      </div>

      {/* Role */}
      <span
        className="text-[11px] font-medium "
        style={{ color: rColor }}
      >
        {player.role}
      </span>

      {/* Leadership */}
      <span
        className="text-[11px] font-medium "
        style={{ color: D.textMuted }}
      >
        {player.leadershipRole ?? "—"}
      </span>

      {/* Age */}
      <span
        className="text-right text-[12px] tabular-nums"
        style={{ color: D.textPrimary }}
      >
        {player.age}
      </span>

      {/* Stats */}
      <span
        className="text-right text-[13px] font-medium tabular-nums"
        style={{ color: D.gold }}
      >
        {formatStat(player.acs, 0)}
      </span>
      <span
        className="text-right text-[12px] tabular-nums"
        style={{ color: D.textPrimary }}
      >
        {formatStat(player.kd, 2)}
      </span>
      <span
        className="text-right text-[12px] tabular-nums"
        style={{ color: D.textPrimary }}
      >
        {formatStat(player.adr, 0)}
      </span>
      <span
        className="text-right text-[12px] tabular-nums"
        style={{ color: D.textPrimary }}
      >
        {formatStat(player.kast, 0)}%
      </span>

      {/* Salary */}
      <span
        className="text-right text-[13px] font-medium tabular-nums"
        style={{ color: D.gold }}
      >
        {formatCurrency(player.salary)}
      </span>

      {/* Contract end */}
      <span
        className="text-right text-[11px] tabular-nums "
        style={{ color: D.textMuted }}
      >
        {player.contractEndSeason !== undefined &&
        player.contractEndWeek !== undefined
          ? `S${player.contractEndSeason} W${player.contractEndWeek}`
          : "—"}
      </span>

      {/* Actions */}
      <div
        className="flex items-center justify-end gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onBench}
          disabled={togglePending}
          className="rounded px-2.5 py-1 text-[10px] font-medium transition-colors disabled:opacity-40"
          style={{
            border: `1px solid ${D.border}`,
            color: D.textMuted,
          }}
        >
          {active ? "Bench" : "Activate"}
        </button>
        <button
          onClick={onRelease}
          disabled={sellPending}
          className="rounded px-2.5 py-1 text-[10px] font-medium transition-colors disabled:opacity-40"
          style={{
            background: "rgba(255,70,85,0.1)",
            color: D.red,
            border: `1px solid rgba(255,70,85,0.2)`,
          }}
        >
          Release
        </button>
      </div>
    </div>
  );
}

// ───────────────────── Team Attribute Overview (V4.1) ─────────────────────

const ATTR_DISPLAY_LABELS: Record<string, string> = {
  aim: "Aim",
  crosshair: "Crosshair",
  entryTiming: "Entry timing",
  peek: "Peek",
  positioning: "Positioning",
  utilUsage: "Util usage",
  tradeDiscipline: "Trade disc.",
  clutch: "Clutch",
  counterStrat: "Counter-strat",
  mapAdaptability: "Map adapt.",
  aggression: "Aggression",
  decisionMaking: "Decision",
  consistency: "Consistency",
  workRate: "Work rate",
  vision: "Vision",
  composure: "Composure",
  pressureRes: "Pressure",
  adaptability: "Adaptability",
  leadership: "Leadership",
  ambition: "Ambition",
  reactionTime: "Reaction",
  mousePrecision: "Mouse",
  peakPerf: "Peak perf.",
  staminaBO5: "Stamina",
  movementSpeed: "Movement",
  mentalEndurance: "Endurance",
};

function attrColorFor(v: number): string {
  if (v >= 16) return "#4ac96a";
  if (v >= 13) return "#d8c44a";
  if (v >= 8) return "#d89a4a";
  if (v >= 5) return "#d84a4a";
  return "#555";
}

function TeamAttributeOverview() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query = trpc.team.attributeOverview.useQuery(undefined, {
    retry: false,
  }) as any;
  const data = query.data as
    | {
        teamOverall: number;
        bestAttribute: { key: string; avg: number } | null;
        worstAttribute: { key: string; avg: number } | null;
        byAttribute: Array<{ key: string; avg: number }>;
        byPlayer: Array<{ id: string; ign: string; overall: number; playstyleRole: string | null }>;
      }
    | undefined;

  if (query.isLoading || !data || data.byPlayer.length === 0) return null;

  const overallRounded = Math.round(data.teamOverall);

  return (
    <section
      className="grid grid-cols-4"
      style={{ borderBottom: `1px solid ${D.border}` }}
    >
      <div
        className="flex flex-col gap-1 px-6 py-5"
        style={{ borderRight: `1px solid ${D.borderFaint}` }}
      >
        <span
          className="text-[10px] font-medium "
          style={{ color: D.textSubtle }}
        >
          Team Overall
        </span>
        <span
          className="text-[22px] font-medium tabular-nums"
          style={{ color: attrColorFor(overallRounded) }}
        >
          {overallRounded}
        </span>
        <span className="text-[10px]" style={{ color: D.textSubtle }}>
          out of 20
        </span>
      </div>
      <div
        className="flex flex-col gap-1 px-6 py-5"
        style={{ borderRight: `1px solid ${D.borderFaint}` }}
      >
        <span
          className="text-[10px] font-medium "
          style={{ color: D.textSubtle }}
        >
          Strongest
        </span>
        {data.bestAttribute && (
          <>
            <span
              className="text-[16px] font-medium"
              style={{ color: attrColorFor(data.bestAttribute.avg) }}
            >
              {ATTR_DISPLAY_LABELS[data.bestAttribute.key] ?? data.bestAttribute.key}
            </span>
            <span
              className="text-[10px] tabular-nums"
              style={{ color: D.textSubtle }}
            >
              {data.bestAttribute.avg.toFixed(1)} avg
            </span>
          </>
        )}
      </div>
      <div
        className="flex flex-col gap-1 px-6 py-5"
        style={{ borderRight: `1px solid ${D.borderFaint}` }}
      >
        <span
          className="text-[10px] font-medium "
          style={{ color: D.textSubtle }}
        >
          Weakest
        </span>
        {data.worstAttribute && (
          <>
            <span
              className="text-[16px] font-medium"
              style={{ color: attrColorFor(data.worstAttribute.avg) }}
            >
              {ATTR_DISPLAY_LABELS[data.worstAttribute.key] ?? data.worstAttribute.key}
            </span>
            <span
              className="text-[10px] tabular-nums"
              style={{ color: D.textSubtle }}
            >
              {data.worstAttribute.avg.toFixed(1)} avg
            </span>
          </>
        )}
      </div>
      <div className="flex flex-col gap-1 px-6 py-5">
        <span
          className="text-[10px] font-medium "
          style={{ color: D.textSubtle }}
        >
          Top performer
        </span>
        {(() => {
          const top = [...data.byPlayer].sort((a, b) => b.overall - a.overall)[0];
          if (!top) return null;
          return (
            <>
              <span
                className="text-[16px] font-medium"
                style={{ color: attrColorFor(top.overall) }}
              >
                {top.ign} · {Math.round(top.overall)}
              </span>
              <span
                className="text-[10px]"
                style={{ color: D.textSubtle }}
              >
                {top.playstyleRole ?? "—"}
              </span>
            </>
          );
        })()}
      </div>
    </section>
  );
}
