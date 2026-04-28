import { serverTrpc } from "@/lib/trpc-server";
import { prisma } from "@/lib/prisma";
import { VCT_STAGES } from "@/constants/vct-format";
import { TRPCError } from "@trpc/server";
import Link from "next/link";
import { D } from "@/constants/design";

// FM-style portal dashboard. Three independent scroll columns at 100vh.
// Layout closely follows the brief while staying inside VALO.GG palette:
//   - dark surfaces (D.bg / D.surface / D.card),
//   - indigo primary as the only accent (no orange),
//   - teal / coral semantics for W/L and rating deltas,
//   - sentence case + Inter 13/16/22, no uppercase tracking.

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
  rating: number;
  overall: number;
  agentStats: unknown;
};

const AGENT_CLASS: Record<string, "duelist" | "initiator" | "controller" | "sentinel"> = {
  jett: "duelist", phoenix: "duelist", raze: "duelist", yoru: "duelist",
  neon: "duelist", reyna: "duelist", iso: "duelist", waylay: "duelist",
  sova: "initiator", skye: "initiator", fade: "initiator", breach: "initiator",
  kayo: "initiator", gekko: "initiator", tejo: "initiator",
  brimstone: "controller", omen: "controller", viper: "controller",
  astra: "controller", harbor: "controller", clove: "controller",
  killjoy: "sentinel", sage: "sentinel", cypher: "sentinel",
  chamber: "sentinel", deadlock: "sentinel", vyse: "sentinel",
};

// Sentinel uses a deep-indigo so all 4 classes stay visually distinct without
// borrowing amber (which the spec reserves for stars).
const SENTINEL_TINT = "#8B8DC9";

function agentColor(agent: string | null): string {
  if (!agent) return D.textSubtle;
  switch (AGENT_CLASS[agent.toLowerCase()]) {
    case "duelist": return D.coral;
    case "initiator": return D.primary;
    case "controller": return D.teal;
    case "sentinel": return SENTINEL_TINT;
    default: return D.textSubtle;
  }
}

function bestAgent(p: Player): string | null {
  const stats = (p.agentStats ?? {}) as Record<string, { mastery?: number }>;
  const entries = Object.entries(stats);
  if (entries.length === 0) return null;
  let best = entries[0];
  for (const e of entries) if ((e[1].mastery ?? 0) > (best[1].mastery ?? 0)) best = e;
  return best[0];
}

function winProbability(myAvg: number, oppAvg: number): number {
  // Logistic on overall delta. ~50% at parity, ~75% at +2, ~90% at +4.
  const p = 1 / (1 + Math.exp(-(myAvg - oppAvg) / 1.5));
  return Math.round(p * 100);
}

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
  // The advance-day Continue button now lives in the global TopNav, so the
  // dashboard no longer needs to track the pending user match here.

  // Fetch full opponent roster for the matchup card.
  const opponentTeamId = nextMatch
    ? nextMatch.team1Id === team.id
      ? nextMatch.team2Id
      : nextMatch.team1Id
    : null;
  const opponentTeam = opponentTeamId
    ? await prisma.team.findUnique({
        where: { id: opponentTeamId },
        include: {
          players: {
            where: { isActive: true },
            orderBy: { overall: "desc" },
            take: 5,
          },
        },
      })
    : null;

  const myStarters = ((team.players as Player[]) ?? [])
    .filter((p) => p.isActive)
    .sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0))
    .slice(0, 5);

  // Upcoming + recent fixtures combined view (FM "Fixture schedule" mixes both
  // — recent results above the fold, upcoming below).
  const upcomingMatches = matches
    .filter((m) => !m.isPlayed && m.day > 0)
    .sort((a, b) => a.day - b.day)
    .slice(0, 4);

  const fixturesList: Array<{
    match: Match;
    isUpcoming: boolean;
  }> = [
    ...upcomingMatches.map((m) => ({ match: m, isUpcoming: true })),
    ...recentMatches.slice(0, 3).map((m) => ({ match: m, isUpcoming: false })),
  ];

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

  // Compute team-overall averages for the win-prob badge.
  const myAvg = myStarters.length > 0
    ? myStarters.reduce((s, p) => s + (p.overall ?? 10), 0) / myStarters.length
    : 10;
  const oppAvg = opponentTeam && opponentTeam.players.length > 0
    ? opponentTeam.players.reduce((s, p) => s + (p.overall ?? 10), 0) / opponentTeam.players.length
    : 10;
  const winProb = winProbability(myAvg, oppAvg);

  return (
    <div className="flex h-full flex-col overflow-hidden" style={{ background: D.bg }}>
      {/* ─── 3-column body ─── */}
      <div
        className="grid min-h-0 flex-1"
        style={{ gridTemplateColumns: "240px 1fr 280px" }}
      >
        {/* LEFT — Inbox */}
        <aside
          className="flex min-h-0 flex-col overflow-y-auto"
          style={{ borderRight: `1px solid ${D.border}` }}
        >
          <div className="px-4 pt-4 pb-2" style={{ borderBottom: `1px solid ${D.borderFaint}` }}>
            <SectionLabel>Messages</SectionLabel>
            <div className="mt-3 flex items-center gap-2">
              {(["All", "New", "Tasks"] as const).map((chip, i) => (
                <span
                  key={chip}
                  className="rounded-full px-2.5 py-0.5 text-[11px]"
                  style={{
                    background: i === 0 ? "rgba(83,74,183,0.18)" : "transparent",
                    color: i === 0 ? D.primary : D.textMuted,
                    border: i === 0 ? "none" : `1px solid ${D.borderFaint}`,
                    fontWeight: i === 0 ? 500 : 400,
                  }}
                >
                  {chip}
                  {i === 1 && messagesArr.filter((m) => !m.isRead).length > 0 && (
                    <span className="ml-1 tabular-nums">
                      ({messagesArr.filter((m) => !m.isRead).length})
                    </span>
                  )}
                </span>
              ))}
            </div>
          </div>
          {messagesArr.length === 0 ? (
            <div className="px-4 py-12 text-center text-[12px]" style={{ color: D.textSubtle }}>
              No messages yet.
            </div>
          ) : (
            messagesArr.slice(0, 30).map((m) => (
              <Link
                key={m.id}
                href="/inbox"
                className="flex items-start gap-3 px-4 py-3 transition-colors"
                style={{ borderBottom: `1px solid ${D.borderFaint}` }}
              >
                <div
                  className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-medium"
                  style={{
                    background: categoryTint(m.category),
                    color: categoryColor(m.category),
                    border: `1px solid ${categoryColor(m.category)}33`,
                  }}
                >
                  {(m.senderName ?? "??").slice(0, 2)}
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
        </aside>

        {/* CENTER — Next match + this week */}
        <main className="flex min-h-0 flex-col overflow-y-auto px-5 py-4">
          {/* Next match header strip */}
          <div className="mb-3 flex items-center justify-between">
            <SectionLabel withAccent>Next match</SectionLabel>
            {nextMatch && (
              <span className="text-[11px]" style={{ color: D.textMuted }}>
                {nextMatch.format} · D{nextMatch.day}
                {currentStage ? ` · ${currentStage.name}` : ""}
              </span>
            )}
          </div>

          {/* Match card */}
          {nextMatch ? (
            (() => {
              const isHome = nextMatch.team1Id === team.id;
              const opp = isHome ? nextMatch.team2 : nextMatch.team1;
              return (
                <div
                  className="flex flex-col gap-2 rounded-lg p-4"
                  style={{ background: D.card, border: `1px solid ${D.borderFaint}` }}
                >
                  {/* Header row */}
                  <div className="flex items-center justify-between gap-3 pb-2" style={{ borderBottom: `1px solid ${D.borderFaint}` }}>
                    <TeamHeader
                      logo={team.logoUrl}
                      tag={team.tag}
                      name={team.name}
                      rank={teamRank}
                      record={`${team.wins}-${team.losses}`}
                      align="left"
                      ours
                    />
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="text-[11px]" style={{ color: D.textSubtle }}>
                        Win probability
                      </span>
                      <span className="text-[18px] font-medium tabular-nums" style={{ color: D.primary }}>
                        {winProb}%
                      </span>
                    </div>
                    <TeamHeader
                      logo={opp.logoUrl}
                      tag={opp.tag}
                      name={opp.name}
                      rank={standingsArr.findIndex((t) => t.id === opp.id) + 1 || null}
                      record={(() => {
                        const oppStanding = standingsArr.find((t) => t.id === opp.id);
                        return oppStanding ? `${oppStanding.wins}-${oppStanding.losses}` : "—";
                      })()}
                      align="right"
                    />
                  </div>

                  {/* 5 matchup rows */}
                  <div className="flex flex-col">
                    {Array.from({ length: 5 }).map((_, i) => {
                      const my = myStarters[i] ?? null;
                      const them = opponentTeam?.players[i] ?? null;
                      const myAgent = my ? bestAgent(my) : null;
                      const oppAgent = them ? bestAgent(them as Player) : null;
                      const myRating = my?.rating ?? 0;
                      const oppRating = them?.rating ?? 0;
                      const diff = myRating - oppRating;

                      return (
                        <div
                          key={i}
                          className="grid items-center gap-2 px-2 py-2"
                          style={{
                            gridTemplateColumns: "1fr 200px 1fr",
                            borderBottom:
                              i < 4 ? `1px solid ${D.borderFaint}` : "none",
                          }}
                        >
                          {/* My player */}
                          <PlayerLine
                            ign={my?.ign ?? "—"}
                            agent={myAgent}
                            color={agentColor(myAgent)}
                            align="left"
                          />

                          {/* Center: ratings + diff */}
                          <div className="flex items-center justify-center gap-2 text-[12px] tabular-nums">
                            <span style={{ color: D.primary, fontWeight: 500 }}>
                              {myRating > 0 ? myRating.toFixed(2) : "—"}
                            </span>
                            <span style={{ color: D.textSubtle }}>vs</span>
                            <span
                              className="rounded px-1.5 text-[11px]"
                              style={{
                                background:
                                  diff >= 0
                                    ? "rgba(29,158,117,0.15)"
                                    : "rgba(216,90,48,0.15)",
                                color: diff >= 0 ? D.teal : D.coral,
                                fontWeight: 500,
                              }}
                            >
                              {diff >= 0 ? "+" : ""}
                              {diff.toFixed(2)}
                            </span>
                            <span style={{ color: D.textPrimary, fontWeight: 500 }}>
                              {oppRating > 0 ? oppRating.toFixed(2) : "—"}
                            </span>
                          </div>

                          {/* Opp player */}
                          <PlayerLine
                            ign={them?.ign ?? "—"}
                            agent={oppAgent}
                            color={agentColor(oppAgent)}
                            align="right"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()
          ) : (
            <div
              className="rounded-lg p-6 text-center text-[12px]"
              style={{ background: D.card, border: `1px solid ${D.borderFaint}`, color: D.textSubtle }}
            >
              No upcoming match scheduled.
            </div>
          )}

          {/* This week calendar */}
          {season && <ThisWeekCalendar season={season} matches={matches} teamId={team.id} />}
        </main>

        {/* RIGHT — Fixture schedule + standings */}
        <aside
          className="flex min-h-0 flex-col overflow-y-auto"
          style={{ borderLeft: `1px solid ${D.border}` }}
        >
          <div className="px-4 py-4" style={{ borderBottom: `1px solid ${D.borderFaint}` }}>
            <SectionLabel>Fixture schedule</SectionLabel>
            <div className="mt-3 flex flex-col">
              {fixturesList.length === 0 ? (
                <span className="text-[11px]" style={{ color: D.textSubtle }}>
                  No fixtures.
                </span>
              ) : (
                fixturesList.map(({ match: m, isUpcoming }) => {
                  const isHome = m.team1Id === team.id;
                  const opp = isHome ? m.team2 : m.team1;
                  const won = m.winnerId === team.id;
                  const draw = m.winnerId === null && m.isPlayed;
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
                      className="grid items-center gap-2 py-1.5 text-[11px]"
                      style={{
                        gridTemplateColumns: "30px 1fr 50px",
                        borderBottom: `1px solid ${D.borderFaint}`,
                      }}
                    >
                      <span className="tabular-nums" style={{ color: D.textSubtle }}>
                        D{m.day}
                      </span>
                      <span className="truncate" style={{ color: D.textPrimary }}>
                        {team.tag} <span style={{ color: D.textSubtle }}>{isHome ? "vs" : "@"}</span>{" "}
                        <span style={{ color: D.textMuted }}>{opp.tag}</span>
                      </span>
                      {isUpcoming ? (
                        <span
                          className="text-right text-[10px]"
                          style={{ color: D.textSubtle }}
                        >
                          TBD
                        </span>
                      ) : (
                        <span
                          className="rounded px-1.5 py-0.5 text-center text-[10px] font-medium tabular-nums"
                          style={{
                            background: won
                              ? "rgba(29,158,117,0.15)"
                              : draw
                                ? D.borderFaint
                                : "rgba(216,90,48,0.15)",
                            color: won ? D.teal : draw ? D.textMuted : D.coral,
                          }}
                        >
                          {won ? "W" : draw ? "D" : "L"} {ourMaps}-{oppMaps}
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="px-4 py-4">
            <div className="flex items-baseline justify-between">
              <SectionLabel>Standings</SectionLabel>
              {teamRank > 0 && (
                <span className="text-[10px]" style={{ color: D.textMuted }}>
                  #{teamRank} of {standingsArr.length}
                </span>
              )}
            </div>
            <div className="mt-2 flex flex-col">
              <div
                className="grid items-center gap-2 pb-1.5 text-[10px]"
                style={{
                  gridTemplateColumns: "16px 1fr 36px 28px",
                  color: D.textSubtle,
                  borderBottom: `1px solid ${D.borderFaint}`,
                }}
              >
                <span>#</span>
                <span>Team</span>
                <span className="text-right">W-L</span>
                <span className="text-right">Pts</span>
              </div>
              {standingsArr.slice(0, 8).map((t, i) => {
                const isOurs = t.id === team.id;
                const top4 = i < 4;
                return (
                  <div
                    key={t.id}
                    className="grid items-center gap-2 py-1.5 text-[12px]"
                    style={{
                      gridTemplateColumns: "16px 1fr 36px 28px",
                      borderBottom: `1px solid ${D.borderFaint}`,
                      background: isOurs ? "rgba(83,74,183,0.10)" : "transparent",
                    }}
                  >
                    <span
                      className="tabular-nums"
                      style={{ color: top4 ? D.teal : D.textSubtle }}
                    >
                      {i + 1}
                    </span>
                    <span
                      className="flex items-center gap-1.5 truncate"
                      style={{
                        color: isOurs ? D.primary : D.textPrimary,
                        fontWeight: isOurs ? 500 : 400,
                      }}
                    >
                      {isOurs && (
                        <span style={{ color: D.primary, fontSize: 10 }}>◀</span>
                      )}
                      {t.tag ?? t.name}
                    </span>
                    <span className="text-right tabular-nums" style={{ color: D.textMuted }}>
                      {t.wins}-{t.losses}
                    </span>
                    <span
                      className="text-right tabular-nums"
                      style={{ color: D.textPrimary, fontWeight: 500 }}
                    >
                      {t.champPts}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────

function SectionLabel({
  children,
  withAccent,
}: {
  children: React.ReactNode;
  withAccent?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      {withAccent && (
        <span style={{ width: 3, height: 12, background: D.primary, borderRadius: 1 }} />
      )}
      <span className="text-[11px] font-medium" style={{ color: D.textMuted }}>
        {children}
      </span>
    </div>
  );
}

function TeamHeader({
  logo,
  tag,
  name,
  rank,
  record,
  align,
  ours,
}: {
  logo: string | null;
  tag: string;
  name: string;
  rank: number | null;
  record: string;
  align: "left" | "right";
  ours?: boolean;
}) {
  const right = align === "right";
  return (
    <div
      className="flex items-center gap-2.5"
      style={{ flexDirection: right ? "row-reverse" : "row" }}
    >
      {logo ? (
        <img src={logo} alt={name} className="h-9 w-9 object-contain" />
      ) : (
        <div
          className="flex h-9 w-9 items-center justify-center rounded"
          style={{ background: D.surface, border: `1px solid ${D.borderFaint}` }}
        >
          <span className="text-[10px]" style={{ color: D.textMuted }}>
            {tag}
          </span>
        </div>
      )}
      <div
        className="flex flex-col"
        style={{ alignItems: right ? "flex-end" : "flex-start" }}
      >
        <span
          className="text-[13px] font-medium"
          style={{ color: ours ? D.primary : D.textPrimary }}
        >
          {name}
        </span>
        <span className="text-[10px] tabular-nums" style={{ color: D.textSubtle }}>
          {rank ? `#${rank}` : "—"} · {record}
        </span>
      </div>
    </div>
  );
}

function PlayerLine({
  ign,
  agent,
  color,
  align,
}: {
  ign: string;
  agent: string | null;
  color: string;
  align: "left" | "right";
}) {
  const right = align === "right";
  return (
    <div
      className="flex items-center gap-2"
      style={{
        flexDirection: right ? "row-reverse" : "row",
        borderLeft: right ? "none" : `2px solid ${color}`,
        borderRight: right ? `2px solid ${color}` : "none",
        paddingLeft: right ? 0 : 8,
        paddingRight: right ? 8 : 0,
      }}
    >
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-medium"
        style={{
          background: `${color}1A`,
          color,
          border: `1px solid ${color}40`,
        }}
      >
        {ign.slice(0, 2)}
      </div>
      <div
        className="flex min-w-0 flex-col"
        style={{ alignItems: right ? "flex-end" : "flex-start" }}
      >
        <span
          className="truncate text-[12px] font-medium"
          style={{ color: D.textPrimary, maxWidth: 120 }}
        >
          {ign}
        </span>
        <span
          className="truncate text-[10px] capitalize"
          style={{ color, maxWidth: 120 }}
        >
          {agent ?? "—"}
        </span>
      </div>
    </div>
  );
}

function ThisWeekCalendar({
  season,
  matches,
  teamId,
}: {
  season: { currentDay: number; currentWeek: number };
  matches: Match[];
  teamId: string;
}) {
  const weekStart = Math.max(1, season.currentDay - ((season.currentDay - 1) % 7));
  const days = Array.from({ length: 7 }, (_, i) => weekStart + i);
  const matchByDay = new Map<number, Match>();
  for (const m of matches) if (!matchByDay.has(m.day)) matchByDay.set(m.day, m);
  const dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <div className="mt-5">
      <SectionLabel>This week</SectionLabel>
      <div
        className="mt-2 grid grid-cols-7 overflow-hidden rounded-lg"
        style={{ background: D.card, border: `1px solid ${D.borderFaint}` }}
      >
        {days.map((d, i) => {
          const m = matchByDay.get(d);
          const isToday = d === season.currentDay;
          const ours = m && (m.team1Id === teamId || m.team2Id === teamId);
          return (
            <div
              key={d}
              className="flex min-h-[68px] flex-col items-center justify-start gap-1 p-2"
              style={{
                background: isToday ? "rgba(83,74,183,0.10)" : "transparent",
                borderRight:
                  i < 6 ? `1px solid ${D.borderFaint}` : "none",
              }}
            >
              <span className="text-[10px]" style={{ color: D.textSubtle }}>
                {dayLabels[i]}
              </span>
              <span
                className="text-[14px] tabular-nums"
                style={{
                  color: isToday ? D.primary : D.textPrimary,
                  fontWeight: isToday ? 500 : 400,
                }}
              >
                D{d}
              </span>
              {ours && (
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: D.primary,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

function categoryColor(cat: string): string {
  switch (cat) {
    case "INJURY": return D.coral;
    case "MATCH": return D.coral;
    case "TRANSFER": return D.primary;
    case "SCOUT": return D.teal;
    case "TRAINING": return D.primary;
    default: return D.textMuted;
  }
}

function categoryTint(cat: string): string {
  const c = categoryColor(cat);
  return `${c}1A`;
}
