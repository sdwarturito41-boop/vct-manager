import { serverTrpc } from "@/lib/trpc-server";
import { formatCurrency } from "@/lib/format";
import { formatGameDate, dayNameFull } from "@/lib/game-date";
import { VCT_STAGES } from "@/constants/vct-format";
import { AdvanceDayButton } from "@/components/AdvanceDayButton";
import { TRPCError } from "@trpc/server";
import Link from "next/link";

export default async function DashboardPage() {
  const api = await serverTrpc();

  let team;
  try {
    team = await api.team.get();
  } catch (e) {
    if (e instanceof TRPCError && e.code === "NOT_FOUND") {
      return (
        <div className="flex items-center justify-center py-32">
          <p className="text-[var(--val-white)]/40">No team found.</p>
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

  // Check for pending match (unplayed, on or before current day)
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

  // Find team's rank in standings
  const standingsArr = standings as Array<{ id: string; name: string; champPts: number; wins: number; losses: number }>;
  const teamRank = standingsArr.findIndex((t) => t.id === team.id) + 1;

  // Weekly salary total
  const totalWeeklySalary = team.players.reduce((sum: number, p: { salary: number }) => sum + p.salary, 0);

  return (
    <div className="space-y-6">
      {/* ── Header: Team identity + Advance Day ── */}
      <div className="flex items-start justify-between gap-6">
        <div className="flex items-center gap-4">
          {team.logoUrl && (
            <img src={team.logoUrl} alt={team.name} className="h-14 w-14 object-contain" />
          )}
          <div>
            <h1 className="text-2xl font-black uppercase tracking-[0.15em] text-[var(--val-white)]">
              {team.name}
            </h1>
            <div className="mt-0.5 flex items-center gap-3 text-xs text-[var(--val-white)]/40">
              <span className="font-bold text-[var(--val-white)]/60">[{team.tag}]</span>
              <span>{team.region}</span>
              {currentStage && (
                <>
                  <span>·</span>
                  <span className="font-semibold text-[var(--val-red)]">{currentStage.name}</span>
                </>
              )}
              {season && (
                <>
                  <span>·</span>
                  <span>{formatGameDate(season.currentDay)}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="w-48 shrink-0">
          <AdvanceDayButton pendingMatchId={pendingMatch?.id} pendingOpponent={pendingOpponent} />
        </div>
      </div>

      {/* ── Row 1: Key stats ── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Ranking" value={teamRank > 0 ? `#${teamRank}` : "—"} sub={`of ${standingsArr.length}`} accent />
        <StatCard label="Record" value={`${team.wins}W - ${team.losses}L`} sub={
          team.wins + team.losses > 0
            ? `${Math.round((team.wins / (team.wins + team.losses)) * 100)}% WR`
            : "No matches yet"
        } />
        <StatCard label="Championship Pts" value={String(team.champPts)} sub="VCT 2026" gold />
        <StatCard label="Budget" value={formatCurrency(team.budget)} sub={`-${formatCurrency(totalWeeklySalary)}/wk`} gold />
        <StatCard label="Roster" value={`${team.players.length} players`} sub={`${team.players.filter((p: { isActive: boolean }) => p.isActive).length} active`} />
      </div>

      {/* ── Row 2: Next match + Roster overview ── */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Next match — 2 cols */}
        <div className="lg:col-span-2 rounded-lg border border-[var(--val-gray)] bg-[var(--val-surface)] p-5">
          <div className="mb-4 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--val-white)]/30">
            Next Match
          </div>
          {nextMatch ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-6">
                {/* Team 1 */}
                <div className="flex items-center gap-3">
                  {nextMatch.team1.logoUrl && (
                    <img src={nextMatch.team1.logoUrl} alt="" className="h-10 w-10 object-contain" />
                  )}
                  <div>
                    <div className={`text-lg font-bold uppercase tracking-wider ${nextMatch.team1Id === team.id ? "text-[var(--val-red)]" : "text-[var(--val-white)]"}`}>
                      {nextMatch.team1.tag}
                    </div>
                    <div className="text-[10px] text-[var(--val-white)]/30">{nextMatch.team1.name}</div>
                  </div>
                </div>

                <div className="text-center">
                  <div className="text-xs font-bold uppercase tracking-widest text-[var(--val-white)]/20">VS</div>
                  <div className="mt-1 text-[10px] text-[var(--val-white)]/30">{nextMatch.format}</div>
                </div>

                {/* Team 2 */}
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className={`text-lg font-bold uppercase tracking-wider ${nextMatch.team2Id === team.id ? "text-[var(--val-red)]" : "text-[var(--val-white)]"}`}>
                      {nextMatch.team2.tag}
                    </div>
                    <div className="text-[10px] text-[var(--val-white)]/30">{nextMatch.team2.name}</div>
                  </div>
                  {nextMatch.team2.logoUrl && (
                    <img src={nextMatch.team2.logoUrl} alt="" className="h-10 w-10 object-contain" />
                  )}
                </div>
              </div>

              <div className="text-right">
                <div className="text-xs text-[var(--val-white)]/30">
                  {dayNameFull(nextMatch.day)} · Week {nextMatch.week}
                </div>
                <div className="mt-1 text-[10px] font-semibold uppercase text-[var(--val-white)]/20">
                  {nextMatch.stageId.replace("_", " ")}
                </div>
                {season && nextMatch.day <= season.currentDay && (
                  <div className="mt-2 text-[10px] font-bold uppercase tracking-widest text-[var(--val-red)] animate-pulse">
                    Match Day — Ready to play
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-[var(--val-white)]/30">No upcoming matches.</p>
          )}
        </div>

        {/* Roster quick view — 1 col */}
        <div className="rounded-lg border border-[var(--val-gray)] bg-[var(--val-surface)] p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--val-white)]/30">
              Active Roster
            </span>
            <Link href="/roster" className="text-[10px] font-semibold uppercase tracking-widest text-[var(--val-red)] hover:underline">
              Manage →
            </Link>
          </div>
          <div className="space-y-2">
            {team.players
              .filter((p: { isActive: boolean }) => p.isActive)
              .slice(0, 5)
              .map((p: { id: string; ign: string; role: string; acs: number; imageUrl: string | null }) => (
                <div key={p.id} className="flex items-center gap-3">
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt={p.ign} className="h-7 w-7 rounded-full object-cover bg-[var(--val-gray)]" />
                  ) : (
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--val-gray)] text-[9px] font-bold text-[var(--val-white)]/50">
                      {p.ign[0]}
                    </div>
                  )}
                  <div className="flex-1">
                    <span className="text-xs font-bold text-[var(--val-white)]">{p.ign}</span>
                  </div>
                  <span className="text-[10px] font-medium text-[var(--val-white)]/30">{p.role}</span>
                  <span className="text-[10px] font-bold text-[var(--val-white)]/50">{Math.round(p.acs)} ACS</span>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* ── Row 3: Recent results ── */}
      {recentMatches.length > 0 && (
        <div className="rounded-lg border border-[var(--val-gray)] bg-[var(--val-surface)] p-5">
          <div className="mb-4 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--val-white)]/30">
            Recent Results
          </div>
          <div className="space-y-2">
            {recentMatches.map((match) => {
              const score = match.score as { team1: number; team2: number } | null;
              const won = match.winnerId === team.id;
              return (
                <Link
                  key={match.id}
                  href={`/match/${match.id}`}
                  className="flex items-center justify-between rounded border border-[var(--val-gray)] bg-[var(--val-bg)] p-3 transition-colors hover:border-[var(--val-red)]/30"
                >
                  <div className="flex items-center gap-4">
                    <span className={`text-xs font-black uppercase ${won ? "text-[var(--val-green)]" : "text-[var(--val-red)]"}`}>
                      {won ? "W" : "L"}
                    </span>
                    <div className="flex items-center gap-2">
                      {match.team1.logoUrl && <img src={match.team1.logoUrl} alt="" className="h-5 w-5 object-contain" />}
                      <span className="text-xs font-bold text-[var(--val-white)]">{match.team1.tag}</span>
                      <span className="text-xs font-bold text-[var(--val-white)]/40">
                        {score ? `${score.team1} - ${score.team2}` : "—"}
                      </span>
                      <span className="text-xs font-bold text-[var(--val-white)]">{match.team2.tag}</span>
                      {match.team2.logoUrl && <img src={match.team2.logoUrl} alt="" className="h-5 w-5 object-contain" />}
                    </div>
                  </div>
                  <span className="text-[10px] text-[var(--val-white)]/20">
                    {formatGameDate(match.day)}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Row 4: Training + Season progress ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--val-gray)] bg-[var(--val-surface)] p-5">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--val-white)]/30">
              Team Skills
            </span>
            <Link href="/training" className="text-[10px] font-semibold uppercase tracking-widest text-[var(--val-red)] hover:underline">
              Train →
            </Link>
          </div>
          <div className="space-y-3">
            <SkillRow label="Aim" value={team.skillAim} />
            <SkillRow label="Utility" value={team.skillUtility} />
            <SkillRow label="Teamplay" value={team.skillTeamplay} />
          </div>
        </div>

        <div className="rounded-lg border border-[var(--val-gray)] bg-[var(--val-surface)] p-5">
          <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--val-white)]/30">
            Season Progress
          </div>
          {season && currentStage && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--val-white)]/50">Stage</span>
                <span className="rounded border border-[var(--val-red)]/30 bg-[var(--val-red)]/10 px-2 py-0.5 text-xs font-bold uppercase text-[var(--val-red)]">
                  {currentStage.name}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--val-white)]/50">Matches played</span>
                <span className="text-xs font-bold text-[var(--val-white)]">{playedMatches.length} / {matches.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--val-white)]/50">Day</span>
                <span className="text-xs font-bold text-[var(--val-white)]">{season.currentDay}</span>
              </div>
              <Link
                href="/league"
                className="mt-2 block text-center text-[10px] font-semibold uppercase tracking-widest text-[var(--val-red)] hover:underline"
              >
                View Standings →
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, gold, accent }: {
  label: string; value: string; sub?: string; gold?: boolean; accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[var(--val-gray)] bg-[var(--val-surface)] p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--val-white)]/30">
        {label}
      </div>
      <div className={`mt-1.5 text-xl font-bold ${accent ? "text-[var(--val-red)]" : gold ? "text-[var(--val-gold)]" : "text-[var(--val-white)]"}`}>
        {value}
      </div>
      {sub && (
        <div className="mt-0.5 text-[10px] font-medium text-[var(--val-white)]/30">{sub}</div>
      )}
    </div>
  );
}

function SkillRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 text-xs font-medium text-[var(--val-white)]/50">{label}</span>
      <div className="flex-1 rounded-full bg-[var(--val-bg)] h-2">
        <div
          className="h-full rounded-full bg-[var(--val-red)] transition-all"
          style={{ width: `${value}%` }}
        />
      </div>
      <span className="w-8 text-right text-xs font-bold text-[var(--val-white)]/60">{value}</span>
    </div>
  );
}
