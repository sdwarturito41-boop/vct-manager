import { serverTrpc } from "@/lib/trpc-server";
import { formatCurrency } from "@/lib/format";
import { formatGameDate, dayNameFull } from "@/lib/game-date";
import { VCT_STAGES } from "@/constants/vct-format";
import { AdvanceDayButton } from "@/components/AdvanceDayButton";
import { TRPCError } from "@trpc/server";
import Link from "next/link";
import { D, overallToStars } from "@/constants/design";

// FM-style portal dashboard for VALO.GG. Layout mirrors Football Manager's
// portal/overview screen (3-col: messages · news+calendar · fixtures+stages)
// with an extra section for the player's own roster (FM doesn't show it on
// the home page; the user wants it visible here for quick scanning).

type Match = {
  id: string;
  stageId: string;
  day: number;
  week: number;
  format: string;
  team1Id: string;
  team2Id: string;
  team1: { id: string; name: string; tag: string; logoUrl: string | null };
  team2: { id: string; name: string; tag: string; logoUrl: string | null };
  winnerId: string | null;
  score: unknown;
  isPlayed: boolean;
  playedAt: Date | null;
};

type Player = {
  id: string;
  ign: string;
  imageUrl: string | null;
  role: string;
  isActive: boolean;
  overall: number;
  playstyleRole: string | null;
  nationality: string;
};

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

  const [allMatches, season, standings, messages] = await Promise.all([
    api.match.listByTeam({ teamId: team.id }),
    api.season.getCurrent().catch(() => null),
    api.league.standings().catch(() => []),
    api.message.list().catch(() => []),
  ]);

  const matches = allMatches as Match[];
  const playedMatches = matches.filter((m) => m.isPlayed);
  const recentMatches = playedMatches
    .sort((a, b) => (b.playedAt?.getTime() ?? 0) - (a.playedAt?.getTime() ?? 0))
    .slice(0, 5);
  const nextMatch =
    matches
      .filter((m) => !m.isPlayed && m.day > 0)
      .sort((a, b) => a.day - b.day)[0] ?? null;
  const pendingMatch = season
    ? matches.find((m) => !m.isPlayed && m.day > 0 && m.day <= season.currentDay)
    : null;
  const pendingOpponent = pendingMatch
    ? pendingMatch.team1Id === team.id
      ? pendingMatch.team2.tag
      : pendingMatch.team1.tag
    : null;

  const upcomingMatches = matches
    .filter((m) => !m.isPlayed && m.day > 0)
    .sort((a, b) => a.day - b.day)
    .slice(0, 7);

  const currentStage =
    season?.currentStage && season.currentStage in VCT_STAGES
      ? VCT_STAGES[season.currentStage as keyof typeof VCT_STAGES]
      : null;

  const standingsArr = standings as Array<{
    id: string;
    name: string;
    tag?: string;
    logoUrl?: string | null;
    champPts: number;
    wins: number;
    losses: number;
  }>;
  const teamRank = standingsArr.findIndex((t) => t.id === team.id) + 1;

  const players = (team.players as Player[]).filter((p) => p.isActive);
  // Top story: most recent unread message, fall back to latest.
  const messagesArr = messages as Array<{
    id: string;
    title: string;
    body: string;
    senderName: string | null;
    category: string;
    isRead: boolean;
    createdAt: Date;
    seasonNumber: number;
    week: number;
    day: number;
  }>;
  const topStory = messagesArr[0] ?? null;

  return (
    <div className="flex min-h-full flex-col" style={{ background: D.bg }}>
      {/* ─── Top header strip ─────────────────────────────────────── */}
      <section
        className="flex items-center justify-between px-8 py-4"
        style={{ background: D.surface, borderBottom: `1px solid ${D.border}` }}
      >
        <div className="flex items-center gap-4">
          {team.logoUrl ? (
            <img src={team.logoUrl} alt={team.name} className="h-10 w-10 object-contain" />
          ) : (
            <div
              className="flex h-10 w-10 items-center justify-center rounded"
              style={{ background: D.card, border: `1px solid ${D.borderFaint}` }}
            >
              <span className="text-[14px] font-medium" style={{ color: D.textPrimary }}>
                {team.name.slice(0, 2)}
              </span>
            </div>
          )}
          <div className="flex flex-col gap-0.5">
            <span className="text-[16px] font-medium" style={{ color: D.textPrimary }}>
              {team.name}
            </span>
            <span className="text-[11px]" style={{ color: D.textMuted }}>
              {team.region} · Season {season?.number ?? 1}
              {currentStage ? ` · ${currentStage.name}` : ""}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-5">
          {season && (
            <div className="flex flex-col items-end gap-0.5">
              <span className="text-[16px] font-medium tabular-nums" style={{ color: D.textPrimary }}>
                {formatGameDate(season.currentDay)}
              </span>
              <span className="text-[11px]" style={{ color: D.textMuted }}>
                Week {season.currentWeek}
              </span>
            </div>
          )}
          <div className="w-44">
            <AdvanceDayButton pendingMatchId={pendingMatch?.id} pendingOpponent={pendingOpponent} />
          </div>
        </div>
      </section>

      {/* ─── Sub-tabs (FM portal pattern) ─────────────────────────── */}
      <nav
        className="flex items-center gap-6 px-8"
        style={{ background: D.surface, borderBottom: `1px solid ${D.border}` }}
      >
        {(["Overview", "Inbox", "Calendar", "News", "Fixtures", "Standings", "Roster"] as const).map(
          (label, i) => (
            <span
              key={label}
              className="relative py-3 text-[12px]"
              style={{
                color: i === 0 ? D.primary : D.textMuted,
                fontWeight: i === 0 ? 500 : 400,
              }}
            >
              {label}
              {i === 0 && (
                <span
                  className="absolute bottom-0 left-0 right-0 h-[2px]"
                  style={{ background: D.primary }}
                />
              )}
            </span>
          ),
        )}
      </nav>

      {/* ─── Main 3-column grid ────────────────────────────────────── */}
      <section
        className="grid gap-6 px-8 py-6"
        style={{ gridTemplateColumns: "320px 1fr 320px" }}
      >
        {/* ── LEFT: messages ── */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="text-[16px] font-medium" style={{ color: D.textPrimary }}>
              Messages
            </h2>
            <Link
              href="/inbox"
              className="text-[11px] transition-colors"
              style={{ color: D.primary }}
            >
              See all →
            </Link>
          </div>
          <div className="flex items-center gap-2">
            {(["All", "New", "Tasks", "Unread"] as const).map((chip, i) => (
              <span
                key={chip}
                className="rounded-full px-3 py-1 text-[11px]"
                style={{
                  background: i === 0 ? D.primaryLight : "transparent",
                  color: i === 0 ? D.primaryDark : D.textMuted,
                  border: i === 0 ? "none" : `1px solid ${D.border}`,
                  fontWeight: i === 0 ? 500 : 400,
                }}
              >
                {chip}
              </span>
            ))}
          </div>
          <div
            className="flex flex-col"
            style={{
              background: D.card,
              border: `1px solid ${D.borderFaint}`,
              borderRadius: 12,
              maxHeight: 640,
              overflowY: "auto",
            }}
          >
            {messagesArr.length === 0 ? (
              <div className="px-4 py-12 text-center text-[12px]" style={{ color: D.textSubtle }}>
                No messages yet.
              </div>
            ) : (
              messagesArr.slice(0, 12).map((m) => (
                <Link
                  key={m.id}
                  href="/inbox"
                  className="flex items-start gap-3 px-4 py-3 transition-colors"
                  style={{ borderBottom: `1px solid ${D.borderFaint}` }}
                >
                  <div
                    className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                    style={{
                      background: D.surface,
                      border: `1px solid ${D.borderFaint}`,
                      color: m.isRead ? D.textMuted : D.primary,
                      fontSize: 13,
                    }}
                  >
                    {iconForCategory(m.category)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className="truncate text-[12px]"
                        style={{
                          color: m.isRead ? D.textMuted : D.textPrimary,
                          fontWeight: m.isRead ? 400 : 500,
                        }}
                      >
                        {m.senderName ?? "System"}
                      </span>
                      <span className="shrink-0 text-[10px] tabular-nums" style={{ color: D.textSubtle }}>
                        D{m.day}
                      </span>
                    </div>
                    <div
                      className="truncate text-[11px]"
                      style={{ color: m.isRead ? D.textSubtle : D.textMuted }}
                    >
                      {m.title}
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>

        {/* ── CENTER: news hero + next match + recent fixtures + calendar ── */}
        <div className="flex flex-col gap-5">
          {/* News hero */}
          <div
            className="rounded-xl p-6"
            style={{ background: D.card, border: `1px solid ${D.borderFaint}` }}
          >
            <Link
              href="/inbox"
              className="text-[11px] transition-colors"
              style={{ color: D.primary }}
            >
              See all news →
            </Link>
            <h3
              className="mt-4 text-[22px] font-medium leading-tight"
              style={{ color: D.textPrimary }}
            >
              {topStory?.title ?? `Welcome to season ${season?.number ?? 1}`}
            </h3>
            <p className="mt-3 text-[13px] leading-relaxed" style={{ color: D.textMuted }}>
              {topStory?.body
                ? truncate(topStory.body, 220)
                : `Manage ${team.name} through the ${currentStage?.name ?? "current stage"}. Track inbox briefings, upcoming fixtures, and roster development from this overview.`}
            </p>
            {topStory?.senderName && (
              <div
                className="mt-4 flex items-center gap-2 text-[11px]"
                style={{ color: D.textSubtle }}
              >
                <span>{topStory.senderName}</span>
                <span style={{ color: D.textFaint }}>·</span>
                <span>D{topStory.day}</span>
              </div>
            )}
          </div>

          {/* Next match + Recent fixtures (split) */}
          <div className="grid gap-5" style={{ gridTemplateColumns: "1fr 1fr" }}>
            {/* Next match */}
            <div
              className="rounded-xl p-5"
              style={{ background: D.card, border: `1px solid ${D.borderFaint}` }}
            >
              <div className="text-[11px] mb-3" style={{ color: D.textSubtle }}>
                Next match
              </div>
              {nextMatch ? (
                (() => {
                  const isHome = nextMatch.team1Id === team.id;
                  const opp = isHome ? nextMatch.team2 : nextMatch.team1;
                  return (
                    <div className="flex items-center gap-3">
                      {opp.logoUrl ? (
                        <img src={opp.logoUrl} alt={opp.name} className="h-12 w-12 object-contain" />
                      ) : (
                        <div
                          className="flex h-12 w-12 items-center justify-center rounded"
                          style={{ background: D.surface, border: `1px solid ${D.borderFaint}` }}
                        >
                          <span className="text-[12px]" style={{ color: D.textMuted }}>
                            {opp.tag}
                          </span>
                        </div>
                      )}
                      <div className="flex flex-col gap-0.5">
                        <span className="text-[14px] font-medium" style={{ color: D.textPrimary }}>
                          {opp.name}{" "}
                          <span style={{ color: D.textSubtle }}>({isHome ? "H" : "A"})</span>
                        </span>
                        <span className="text-[11px]" style={{ color: D.textMuted }}>
                          {dayNameFull(nextMatch.day)} · {nextMatch.format}
                        </span>
                        {pendingMatch?.id === nextMatch.id && (
                          <span
                            className="mt-1 inline-flex w-fit rounded-full px-2 py-0.5 text-[10px]"
                            style={{
                              background: "rgba(216,90,48,0.12)",
                              color: D.coral,
                              border: `1px solid rgba(216,90,48,0.25)`,
                            }}
                          >
                            Ready to play
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()
              ) : (
                <span className="text-[12px]" style={{ color: D.textSubtle }}>
                  No upcoming match.
                </span>
              )}
            </div>

            {/* Recent fixtures */}
            <div
              className="rounded-xl p-5"
              style={{ background: D.card, border: `1px solid ${D.borderFaint}` }}
            >
              <div className="text-[11px] mb-3" style={{ color: D.textSubtle }}>
                Recent fixtures
              </div>
              {recentMatches.length === 0 ? (
                <span className="text-[12px]" style={{ color: D.textSubtle }}>
                  No matches played yet.
                </span>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {recentMatches.slice(0, 4).map((m) => {
                    const isHome = m.team1Id === team.id;
                    const opp = isHome ? m.team2 : m.team1;
                    const won = m.winnerId === team.id;
                    const draw = m.winnerId === null;
                    const score = m.score as { team1Maps?: number; team2Maps?: number } | null;
                    const ourMaps = score
                      ? isHome
                        ? score.team1Maps ?? 0
                        : score.team2Maps ?? 0
                      : 0;
                    const oppMaps = score
                      ? isHome
                        ? score.team2Maps ?? 0
                        : score.team1Maps ?? 0
                      : 0;
                    return (
                      <div
                        key={m.id}
                        className="grid items-center gap-2 py-1 text-[12px]"
                        style={{ gridTemplateColumns: "1fr auto auto" }}
                      >
                        <span className="truncate" style={{ color: D.textMuted }}>
                          {opp.tag}{" "}
                          <span style={{ color: D.textSubtle }}>({isHome ? "H" : "A"})</span>
                        </span>
                        <span className="tabular-nums" style={{ color: D.textPrimary }}>
                          {ourMaps}–{oppMaps}
                        </span>
                        <span
                          className="rounded px-1.5 text-[10px] font-medium"
                          style={{
                            background: won
                              ? "rgba(29,158,117,0.15)"
                              : draw
                                ? D.borderFaint
                                : "rgba(216,90,48,0.15)",
                            color: won ? D.teal : draw ? D.textMuted : D.coral,
                          }}
                        >
                          {won ? "W" : draw ? "D" : "L"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Calendar week strip */}
          {season && <CalendarStrip season={season} matches={matches} teamId={team.id} />}
        </div>

        {/* ── RIGHT: fixture schedule + standings ── */}
        <div className="flex flex-col gap-5">
          <div
            className="rounded-xl p-5"
            style={{ background: D.card, border: `1px solid ${D.borderFaint}` }}
          >
            <h3 className="mb-3 text-[14px] font-medium" style={{ color: D.textPrimary }}>
              Fixture schedule
            </h3>
            {upcomingMatches.length === 0 ? (
              <span className="text-[12px]" style={{ color: D.textSubtle }}>
                No upcoming fixtures.
              </span>
            ) : (
              <div className="flex flex-col">
                {upcomingMatches.map((m) => {
                  const isHome = m.team1Id === team.id;
                  const opp = isHome ? m.team2 : m.team1;
                  return (
                    <div
                      key={m.id}
                      className="grid items-center gap-2 py-2 text-[11px]"
                      style={{
                        gridTemplateColumns: "auto 1fr auto auto",
                        borderBottom: `1px solid ${D.borderFaint}`,
                      }}
                    >
                      <span className="tabular-nums" style={{ color: D.textSubtle }}>
                        D{m.day}
                      </span>
                      <span className="truncate" style={{ color: D.textPrimary }}>
                        {opp.tag}
                      </span>
                      <span style={{ color: D.textMuted }}>{isHome ? "H" : "A"}</span>
                      <span style={{ color: D.textSubtle }}>{m.format}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div
            className="rounded-xl p-5"
            style={{ background: D.card, border: `1px solid ${D.borderFaint}` }}
          >
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="text-[14px] font-medium" style={{ color: D.textPrimary }}>
                Standings
              </h3>
              {teamRank > 0 && (
                <span className="text-[11px]" style={{ color: D.textMuted }}>
                  #{teamRank} of {standingsArr.length}
                </span>
              )}
            </div>
            <div className="flex flex-col">
              <div
                className="grid items-center gap-2 pb-2 text-[10px]"
                style={{
                  gridTemplateColumns: "20px 1fr 32px 32px",
                  color: D.textSubtle,
                  borderBottom: `1px solid ${D.borderFaint}`,
                }}
              >
                <span>Pos</span>
                <span>Team</span>
                <span className="text-right">W–L</span>
                <span className="text-right">Pts</span>
              </div>
              {standingsArr.slice(0, 8).map((t, i) => {
                const isOurs = t.id === team.id;
                return (
                  <div
                    key={t.id}
                    className="grid items-center gap-2 py-1.5 text-[12px]"
                    style={{
                      gridTemplateColumns: "20px 1fr 32px 32px",
                      borderBottom: `1px solid ${D.borderFaint}`,
                      color: isOurs ? D.primary : D.textPrimary,
                      fontWeight: isOurs ? 500 : 400,
                    }}
                  >
                    <span className="tabular-nums" style={{ color: D.textSubtle }}>
                      {i + 1}
                    </span>
                    <span className="truncate">{t.tag ?? t.name}</span>
                    <span className="text-right tabular-nums" style={{ color: D.textMuted }}>
                      {t.wins}–{t.losses}
                    </span>
                    <span className="text-right tabular-nums">{t.champPts}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ─── Roster strip (extra vs FM) ─────────────────────────────── */}
      <section className="px-8 pb-8">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-[16px] font-medium" style={{ color: D.textPrimary }}>
            Roster · {players.length} active
          </h2>
          <Link
            href="/roster"
            className="text-[11px] transition-colors"
            style={{ color: D.primary }}
          >
            Open roster →
          </Link>
        </div>
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}
        >
          {players.map((p) => {
            const { stars, label } = overallToStars(p.overall ?? 10);
            return (
              <Link
                key={p.id}
                href={`/player/${p.id}`}
                className="flex flex-col gap-2 rounded-xl p-3 transition-colors"
                style={{ background: D.card, border: `1px solid ${D.borderFaint}` }}
              >
                <div className="flex items-center gap-3">
                  {p.imageUrl ? (
                    <img
                      src={p.imageUrl}
                      alt={p.ign}
                      className="h-10 w-10 rounded-full object-cover"
                      style={{ border: `1px solid ${D.borderFaint}` }}
                    />
                  ) : (
                    <div
                      className="flex h-10 w-10 items-center justify-center rounded-full"
                      style={{ background: D.surface, border: `1px solid ${D.borderFaint}` }}
                    >
                      <span className="text-[12px]" style={{ color: D.textMuted }}>
                        {p.ign.slice(0, 2)}
                      </span>
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium" style={{ color: D.textPrimary }}>
                      {p.ign}
                    </div>
                    <div className="truncate text-[11px]" style={{ color: D.textMuted }}>
                      {p.role}
                      {p.playstyleRole ? ` · ${p.playstyleRole}` : ""}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px]" style={{ color: D.textSubtle }}>
                    {label}
                  </span>
                  <StaticStarRow count={stars} />
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* ─── Hidden quick-stats footer ───────────────────────────── */}
      <section
        className="grid grid-cols-4"
        style={{ background: D.surface, borderTop: `1px solid ${D.border}` }}
      >
        <FooterMetric label="Record" value={`${team.wins}–${team.losses}`} />
        <FooterMetric label="Champ pts" value={String(team.champPts)} accent={D.amber} />
        <FooterMetric label="Budget" value={formatCurrency(team.budget)} />
        <FooterMetric
          label="Roster"
          value={`${players.length}`}
          sub={`of ${(team.players as Player[]).length} total`}
        />
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────

function CalendarStrip({
  season,
  matches,
  teamId,
}: {
  season: { currentDay: number; currentWeek: number };
  matches: Match[];
  teamId: string;
}) {
  // Render the week containing currentDay across 7 columns.
  const weekStart = Math.max(1, season.currentDay - ((season.currentDay - 1) % 7));
  const days = Array.from({ length: 7 }, (_, i) => weekStart + i);
  const matchByDay = new Map<number, Match>();
  for (const m of matches) if (!matchByDay.has(m.day)) matchByDay.set(m.day, m);

  return (
    <div
      className="rounded-xl p-5"
      style={{ background: D.card, border: `1px solid ${D.borderFaint}` }}
    >
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-[14px] font-medium" style={{ color: D.textPrimary }}>
          Calendar · week {season.currentWeek}
        </h3>
        <span className="text-[11px]" style={{ color: D.textSubtle }}>
          D{season.currentDay}
        </span>
      </div>
      <div className="grid grid-cols-7 gap-2">
        {days.map((d) => {
          const m = matchByDay.get(d);
          const isToday = d === season.currentDay;
          const ours = m && (m.team1Id === teamId || m.team2Id === teamId);
          return (
            <div
              key={d}
              className="flex min-h-[64px] flex-col gap-1 rounded p-2"
              style={{
                background: isToday ? "rgba(83,74,183,0.12)" : D.surface,
                border: `1px solid ${isToday ? "rgba(83,74,183,0.4)" : D.borderFaint}`,
              }}
            >
              <span
                className="text-[10px] tabular-nums"
                style={{ color: isToday ? D.primary : D.textSubtle }}
              >
                D{d}
              </span>
              {m && (
                <div
                  className="truncate text-[10px]"
                  style={{ color: ours ? D.textPrimary : D.textMuted }}
                >
                  {m.team1Id === teamId ? m.team2.tag : m.team1.tag}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StaticStarRow({ count }: { count: number }) {
  const PATH =
    "M5 0.5 L6.18 3.72 L9.55 3.91 L6.91 6.06 L7.81 9.35 L5 7.5 L2.19 9.35 L3.09 6.06 L0.45 3.91 L3.82 3.72 Z";
  return (
    <span className="inline-flex items-center" aria-label={`${count.toFixed(1)} stars`}>
      {[0, 1, 2, 3, 4].map((i) => {
        const fill = count - i;
        return (
          <svg key={i} width={11} height={11} viewBox="0 0 10 10">
            <path d={PATH} fill="none" stroke={D.amber} strokeWidth={0.8} opacity={0.45} />
            {fill > 0 && (
              <>
                <defs>
                  <clipPath id={`s-${i}-${count}`}>
                    <rect x={0} y={0} width={Math.min(1, fill) * 10} height={10} />
                  </clipPath>
                </defs>
                <path d={PATH} fill={D.amber} clipPath={`url(#s-${i}-${count})`} />
              </>
            )}
          </svg>
        );
      })}
    </span>
  );
}

function FooterMetric({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div
      className="flex flex-col gap-0.5 px-6 py-4"
      style={{ borderRight: `1px solid ${D.borderFaint}` }}
    >
      <span className="text-[11px]" style={{ color: D.textSubtle }}>
        {label}
      </span>
      <span
        className="text-[16px] font-medium tabular-nums"
        style={{ color: accent ?? D.textPrimary }}
      >
        {value}
      </span>
      {sub && (
        <span className="text-[11px]" style={{ color: D.textSubtle }}>
          {sub}
        </span>
      )}
    </div>
  );
}

function iconForCategory(cat: string): string {
  switch (cat) {
    case "INJURY":
      return "⚕";
    case "TRANSFER":
      return "↔";
    case "SCOUT":
      return "⌕";
    case "TRAINING":
      return "▤";
    case "MATCH":
      return "▶";
    default:
      return "✉";
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/\s+\S*$/, "") + "…";
}
