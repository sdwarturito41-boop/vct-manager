import { serverTrpc } from "@/lib/trpc-server";
import { formatCurrency } from "@/lib/format";
import { formatGameDate, dayNameFull } from "@/lib/game-date";
import { VCT_STAGES } from "@/constants/vct-format";
import { AdvanceDayButton } from "@/components/AdvanceDayButton";
import { TRPCError } from "@trpc/server";
import Link from "next/link";
import { D, TEXT_SHADOW_SUBTLE } from "@/constants/design";

export default async function DashboardPage() {
  const api = await serverTrpc();

  let team;
  try {
    team = await api.team.get();
  } catch (e) {
    if (e instanceof TRPCError && e.code === "NOT_FOUND") {
      return (
        <div className="flex items-center justify-center py-32">
          <p style={{ color: D.textSubtle }}>No team found.</p>
        </div>
      );
    }
    throw e;
  }

  const [allMatches, season, standings] = await Promise.all([
    api.match.listByTeam({ teamId: team.id }),
    api.season.getCurrent().catch(() => null),
    api.league.standings().catch(() => []),
  ]);

  const matches = allMatches as Array<{
    id: string; stageId: string; day: number; week: number; format: string;
    team1Id: string; team2Id: string;
    team1: { id: string; name: string; tag: string; logoUrl: string | null };
    team2: { id: string; name: string; tag: string; logoUrl: string | null };
    winnerId: string | null; score: unknown; isPlayed: boolean; playedAt: Date | null;
  }>;

  const playedMatches = matches.filter((m) => m.isPlayed);
  const recentMatches = playedMatches
    .sort((a, b) => (b.playedAt?.getTime() ?? 0) - (a.playedAt?.getTime() ?? 0))
    .slice(0, 5);
  const nextMatch = matches
    .filter((m) => !m.isPlayed && m.day > 0)
    .sort((a, b) => a.day - b.day)[0] ?? null;

  const pendingMatch = season ? matches.find(
    (m) => !m.isPlayed && m.day > 0 && m.day <= season.currentDay
  ) : null;
  const pendingOpponent = pendingMatch
    ? (pendingMatch.team1Id === team.id ? pendingMatch.team2.tag : pendingMatch.team1.tag)
    : null;

  const currentStage =
    season?.currentStage && season.currentStage in VCT_STAGES
      ? VCT_STAGES[season.currentStage as keyof typeof VCT_STAGES]
      : null;

  const standingsArr = standings as Array<{ id: string; name: string; champPts: number; wins: number; losses: number }>;
  const teamRank = standingsArr.findIndex((t) => t.id === team.id) + 1;
  const totalWeeklySalary = team.players.reduce((sum: number, p: { salary: number }) => sum + p.salary, 0);

  const isOffseason = season?.currentStage === "OFFSEASON";
  const offSeasonWeeksLeft = isOffseason && season
    ? Math.max(0, 8 - ((season.currentWeek - 1) % 52))
    : 0;

  return (
    <div className="flex min-h-full flex-col">
      {/* ── Hero section — team identity + next action ── */}
      <section
        className="relative px-10 pt-8 pb-6"
        style={{ borderBottom: `1px solid ${D.border}` }}
      >
        <div className="flex items-start justify-between gap-6">
          {/* Left: team identity */}
          <div className="flex items-center gap-5">
            {team.logoUrl ? (
              <img src={team.logoUrl} alt={team.name} className="h-16 w-16 shrink-0 object-contain" />
            ) : (
              <div
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded"
                style={{ background: D.surface, border: `1px solid ${D.borderFaint}` }}
              >
                <span className="text-[22px] font-medium" style={{ color: D.textPrimary }}>
                  {team.name.slice(0, 2).toUpperCase()}
                </span>
              </div>
            )}
            <div>
              <div
                className="text-[11px] font-medium "
                style={{ color: D.textSubtle }}
              >
                {team.region} · Season {season?.number ?? 1}
              </div>
              <h1
                className="mt-1 text-[34px] font-medium leading-none "
                style={{ color: D.textPrimary }}
              >
                {team.name}
              </h1>
              {currentStage && season && (
                <div
                  className="mt-2 flex items-center gap-3 text-[11px] font-medium "
                  style={{ color: D.textMuted }}
                >
                  <span style={{ color: D.red }}>{currentStage.name}</span>
                  <span>·</span>
                  <span>{formatGameDate(season.currentDay)}</span>
                  <span>·</span>
                  <span>Week {season.currentWeek}</span>
                </div>
              )}
            </div>
          </div>

          {/* Right: advance day */}
          <div className="w-52 shrink-0">
            <AdvanceDayButton pendingMatchId={pendingMatch?.id} pendingOpponent={pendingOpponent} />
          </div>
        </div>

        {/* Off-season banner */}
        {isOffseason && (
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
                Off-season active
              </span>
              <span className="text-[12px]" style={{ color: D.textMuted }}>
                Transfer window is open.
                {offSeasonWeeksLeft > 0 && ` New season in ${offSeasonWeeksLeft} week${offSeasonWeeksLeft === 1 ? "" : "s"}.`}
              </span>
            </div>
            <Link
              href="/market"
              className="rounded px-4 py-2 text-[10px] font-medium transition-colors"
              style={{
                background: "rgba(198,155,58,0.15)",
                color: D.gold,
                border: `1px solid rgba(198,155,58,0.3)`,
              }}
            >
              Transfers →
            </Link>
          </div>
        )}
      </section>

      {/* ── Key metrics row ── */}
      <section
        className="grid grid-cols-5"
        style={{ borderBottom: `1px solid ${D.border}` }}
      >
        <MetricCell label="Rank" value={teamRank > 0 ? `#${teamRank}` : "—"} sub={`of ${standingsArr.length}`} accent={teamRank > 0 && teamRank <= 3 ? D.red : undefined} />
        <MetricCell label="Record" value={`${team.wins}W – ${team.losses}L`} sub={team.wins + team.losses > 0 ? `${Math.round((team.wins / (team.wins + team.losses)) * 100)}% WR` : "—"} />
        <MetricCell label="Champ pts" value={String(team.champPts)} sub="VCT 2026" accent={D.gold} />
        <MetricCell label="Budget" value={formatCurrency(team.budget)} sub={`-${formatCurrency(totalWeeklySalary)} / wk`} accent={D.gold} />
        <MetricCell label="Roster" value={`${team.players.filter((p: { isActive: boolean }) => p.isActive).length}`} sub={`of ${team.players.length} total`} />
      </section>

      {/* ── Next match — mirrored hero style ── */}
      {nextMatch && (
        <section
          className="px-10 py-8"
          style={{ borderBottom: `1px solid ${D.border}` }}
        >
          <div
            className="text-[10px] font-medium "
            style={{ color: D.textSubtle }}
          >
            Next Match · {nextMatch.stageId.replace(/_/g, " ")}
          </div>
          <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-8">
            {/* Team 1 */}
            <div className="flex items-center justify-end gap-4">
              <div className="flex flex-col items-end">
                <span
                  className="text-[11px] font-medium "
                  style={{ color: D.textSubtle }}
                >
                  {nextMatch.team1.tag}
                </span>
                <span
                  className="text-[22px] font-medium "
                  style={{ color: nextMatch.team1Id === team.id ? D.red : D.textPrimary }}
                >
                  {nextMatch.team1.name}
                </span>
              </div>
              {nextMatch.team1.logoUrl && (
                <img src={nextMatch.team1.logoUrl} alt="" className="h-14 w-14 object-contain" />
              )}
            </div>

            {/* Center: VS + metadata */}
            <div className="flex flex-col items-center gap-2">
              <span
                className="text-[20px] font-medium "
                style={{ color: D.textMuted }}
              >
                VS
              </span>
              <div className="flex items-center gap-2">
                <span
                  className="text-[10px] font-medium "
                  style={{ color: D.textSubtle }}
                >
                  {nextMatch.format}
                </span>
                <span style={{ color: D.textFaint }}>·</span>
                <span
                  className="text-[10px] font-medium "
                  style={{ color: D.textMuted }}
                >
                  {dayNameFull(nextMatch.day)}
                </span>
              </div>
              {season && nextMatch.day <= season.currentDay && (
                <span
                  className="rounded-full px-3 py-1 text-[10px] font-medium "
                  style={{
                    background: "rgba(255,70,85,0.12)",
                    color: D.red,
                    border: `1px solid rgba(255,70,85,0.25)`,
                  }}
                >
                  Ready to play
                </span>
              )}
            </div>

            {/* Team 2 */}
            <div className="flex items-center justify-start gap-4">
              {nextMatch.team2.logoUrl && (
                <img src={nextMatch.team2.logoUrl} alt="" className="h-14 w-14 object-contain" />
              )}
              <div className="flex flex-col items-start">
                <span
                  className="text-[11px] font-medium "
                  style={{ color: D.textSubtle }}
                >
                  {nextMatch.team2.tag}
                </span>
                <span
                  className="text-[22px] font-medium "
                  style={{ color: nextMatch.team2Id === team.id ? D.red : D.textPrimary }}
                >
                  {nextMatch.team2.name}
                </span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── Grid: Roster + Recent results + Skills ── */}
      <section className="grid flex-1 grid-cols-3" style={{ borderBottom: `1px solid ${D.border}` }}>
        {/* Roster */}
        <div className="flex flex-col" style={{ borderRight: `1px solid ${D.border}` }}>
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${D.borderFaint}` }}>
            <span
              className="text-[10px] font-medium "
              style={{ color: D.textSubtle }}
            >
              Active Roster
            </span>
            <Link
              href="/roster"
              className="text-[10px] font-medium transition-colors"
              style={{ color: D.textMuted }}
            >
              Manage →
            </Link>
          </div>
          <div className="flex flex-col">
            {team.players
              .filter((p: { isActive: boolean }) => p.isActive)
              .slice(0, 5)
              .map((p: { id: string; ign: string; role: string; acs: number; imageUrl: string | null }) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 px-5 py-3"
                  style={{ borderBottom: `1px solid ${D.borderFaint}` }}
                >
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt={p.ign} className="h-8 w-8 shrink-0 rounded-full object-cover" />
                  ) : (
                    <div
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                      style={{ background: D.hoverBg }}
                    >
                      <span className="text-[10px] font-medium" style={{ color: D.textMuted }}>
                        {p.ign[0]}
                      </span>
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-[13px] font-medium" style={{ color: D.textPrimary }}>
                      {p.ign}
                    </div>
                    <div className="text-[10px]" style={{ color: D.textSubtle }}>
                      {p.role}
                    </div>
                  </div>
                  <span className="text-[12px] font-medium tabular-nums" style={{ color: D.gold }}>
                    {Math.round(p.acs)}
                  </span>
                </div>
              ))}
          </div>
        </div>

        {/* Recent results */}
        <div className="flex flex-col" style={{ borderRight: `1px solid ${D.border}` }}>
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${D.borderFaint}` }}>
            <span
              className="text-[10px] font-medium "
              style={{ color: D.textSubtle }}
            >
              Recent Results
            </span>
          </div>
          <div className="flex flex-col">
            {recentMatches.length === 0 ? (
              <div className="px-5 py-5 text-[12px]" style={{ color: D.textSubtle }}>
                No matches yet.
              </div>
            ) : (
              recentMatches.map((match) => {
                const score = match.score as { team1: number; team2: number } | null;
                const won = match.winnerId === team.id;
                const isT1 = match.team1Id === team.id;
                const myScore = score ? (isT1 ? score.team1 : score.team2) : 0;
                const oppScore = score ? (isT1 ? score.team2 : score.team1) : 0;
                const opp = isT1 ? match.team2 : match.team1;
                return (
                  <Link
                    key={match.id}
                    href={`/match/${match.id}`}
                    className="group flex items-center gap-3 px-5 py-3 transition-colors"
                    style={{ borderBottom: `1px solid ${D.borderFaint}` }}
                  >
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-medium"
                      style={{
                        background: won ? "rgba(76,175,125,0.15)" : "rgba(255,70,85,0.12)",
                        color: won ? D.green : D.red,
                      }}
                    >
                      {won ? "W" : "L"}
                    </span>
                    {opp.logoUrl ? (
                      <img src={opp.logoUrl} alt="" className="h-5 w-5 shrink-0 object-contain" />
                    ) : null}
                    <span className="flex-1 truncate text-[12px]" style={{ color: D.textPrimary }}>
                      vs {opp.name}
                    </span>
                    <span className="text-[12px] font-medium tabular-nums" style={{ color: D.textMuted }}>
                      {myScore}-{oppScore}
                    </span>
                  </Link>
                );
              })
            )}
          </div>
        </div>

        {/* Team skills */}
        <div className="flex flex-col">
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${D.borderFaint}` }}>
            <span
              className="text-[10px] font-medium "
              style={{ color: D.textSubtle }}
            >
              Team Skills
            </span>
            <Link
              href="/training"
              className="text-[10px] font-medium "
              style={{ color: D.textMuted }}
            >
              Train →
            </Link>
          </div>
          <div className="flex flex-1 flex-col justify-center gap-4 px-5 py-5">
            <SkillRow label="Aim" value={team.skillAim} />
            <SkillRow label="Utility" value={team.skillUtility} />
            <SkillRow label="Teamplay" value={team.skillTeamplay} />
          </div>
        </div>
      </section>

      {/* ── Footer: season progress ── */}
      {season && currentStage && (
        <section className="flex items-center justify-between px-10 py-4">
          <span
            className="text-[10px] font-medium "
            style={{ color: D.textSubtle, textShadow: TEXT_SHADOW_SUBTLE }}
          >
            Season progress
          </span>
          <div className="flex items-center gap-6 text-[11px]" style={{ color: D.textMuted }}>
            <span>
              <span style={{ color: D.textSubtle }}>Matches</span>{" "}
              <span className="font-medium tabular-nums" style={{ color: D.textPrimary }}>
                {playedMatches.length} / {matches.length}
              </span>
            </span>
            <Link
              href="/league"
              className="font-medium "
              style={{ color: D.red }}
            >
              Standings →
            </Link>
          </div>
        </section>
      )}
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

function SkillRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="w-16 text-[10px] font-medium "
        style={{ color: D.textSubtle }}
      >
        {label}
      </span>
      <div
        className="h-[3px] flex-1 overflow-hidden"
        style={{ background: D.borderFaint }}
      >
        <div
          className="h-full transition-all"
          style={{ width: `${value}%`, background: D.red }}
        />
      </div>
      <span
        className="w-8 text-right text-[12px] font-medium tabular-nums"
        style={{ color: D.textPrimary }}
      >
        {value}
      </span>
    </div>
  );
}
