import { serverTrpc } from "@/lib/trpc-server";
import { prisma } from "@/lib/prisma";
import { VCT_STAGES } from "@/constants/vct-format";
import { TRPCError } from "@trpc/server";
import Link from "next/link";
import { D } from "@/constants/design";
import { DashboardTicker } from "@/components/DashboardTicker";
import { formatGameDate } from "@/lib/game-date";

// Cinematic dashboard. Two columns at 100vh:
//   - LEFT: full-height Messages (personal inbox: MATCH / PLAYER / COACH / SPONSOR / BOARD)
//   - RIGHT: hero next match → squad + standings → [recent matches | live ticker]
// All scoped to VALO.GG palette (D.* tokens) — dark surfaces, indigo primary,
// teal / coral for W/L and rating deltas, amber reserved for stars.

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
  maps: unknown;
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
  acs: number;
  kd: number;
  agentStats: unknown;
  mapFactors: unknown;
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

function bestMap(p: Player): { name: string; factor: number } | null {
  const factors = (p.mapFactors ?? {}) as Record<string, number>;
  const entries = Object.entries(factors).filter(([, v]) => typeof v === "number");
  if (entries.length === 0) return null;
  let best = entries[0];
  for (const e of entries) if (e[1] > best[1]) best = e;
  return { name: best[0], factor: best[1] };
}

// Approximate per-map stats by scaling the player's baseline by their map
// factor. Good enough for a glanceable dashboard line — exact per-map history
// would need an extra table.
function statsOnMap(p: Player, factor: number): { acs: number; kd: number } {
  return {
    acs: Math.round(p.acs * factor),
    kd: Math.round(p.kd * factor * 100) / 100,
  };
}

function winProbability(myAvg: number, oppAvg: number): number {
  // Logistic on overall delta. Divisor 3.0 gives a calibrated scale that
  // matches the actual sim's variance: a 2-point overall edge ~ 65%, 4 pts
  // ~ 79%, 5 pts ~ 84%. The old 1.5 divisor was too aggressive — it showed
  // 86% for a 2.7-point gap, which the sim couldn't actually deliver once
  // mapFactor, gameDay rolls and bracket variance kicked in.
  const p = 1 / (1 + Math.exp(-(myAvg - oppAvg) / 3.0));
  return Math.round(p * 100);
}

const ROLE_ORDER: Player["role"][] = [
  "Duelist", "Initiator", "Sentinel", "Controller", "IGL", "Flex",
];
function pairByRole(a: Player[], b: Player[]): Array<{ my: Player | null; them: Player | null }> {
  const aRemaining = [...a];
  const bRemaining = [...b];
  const pairs: Array<{ my: Player | null; them: Player | null }> = [];

  // First pass: pair players only where BOTH teams have someone in the same
  // role. Asymmetric roles (Duelist on one side, Controller on the other) are
  // deferred to the leftover pass — otherwise the strict role match would
  // emit `{ my: Controller, them: null }` even when an unmatched Duelist on
  // the opposing side could fill that slot.
  for (const role of ROLE_ORDER) {
    const myIdx = aRemaining.findIndex((p) => p.role === role);
    const themIdx = bRemaining.findIndex((p) => p.role === role);
    if (myIdx >= 0 && themIdx >= 0) {
      const my = aRemaining.splice(myIdx, 1)[0];
      const them = bRemaining.splice(themIdx, 1)[0];
      pairs.push({ my, them });
    }
  }

  // Second pass: pair what's left in order. Each side's leftovers get matched
  // up — no more rows with `null` unless one team genuinely has fewer than 5
  // active players.
  while (aRemaining.length || bRemaining.length) {
    pairs.push({ my: aRemaining.shift() ?? null, them: bRemaining.shift() ?? null });
  }
  return pairs.slice(0, 5);
}

const NEWS_CATEGORIES = new Set(["MARKET", "NEWS", "MEDIA"]);

function categoryColor(cat: string): string {
  switch (cat) {
    case "MATCH": return D.coral;
    case "MARKET": return D.primary;
    case "NEWS": return D.teal;
    case "MEDIA": return D.teal;
    case "PLAYER": return D.primary;
    case "COACH": return D.primary;
    case "SPONSOR": return D.teal;
    case "BOARD": return D.coral;
    default: return D.textMuted;
  }
}
function categoryTint(cat: string): string {
  return `${categoryColor(cat)}1A`;
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
          <p style={{ color: D.textSubtle }}>Aucune équipe trouvée.</p>
        </div>
      );
    }
    throw e;
  }

  const [feed, season, standings, messages] = await Promise.all([
    api.match.dashboardFeed({ teamId: team.id }),
    api.season.getCurrent().catch(() => null),
    api.league.standings().catch(() => []),
    api.message.list().catch(() => []),
  ]);

  const recentMatches = feed.recent as Match[];
  const nextMatch = (feed.next as Match | null) ?? null;

  const opponentTeamId = nextMatch
    ? nextMatch.team1Id === team.id ? nextMatch.team2Id : nextMatch.team1Id
    : null;
  const opponentTeam = opponentTeamId
    ? await prisma.team.findUnique({
        where: { id: opponentTeamId },
        select: {
          id: true, name: true, tag: true, logoUrl: true, region: true,
          players: {
            where: { isActive: true },
            orderBy: { overall: "desc" },
            take: 5,
            select: {
              id: true, ign: true, role: true, overall: true, rating: true,
              agentStats: true, acs: true, kd: true, mapFactors: true,
              imageUrl: true, isActive: true,
            },
          },
        },
      })
    : null;

  const myStarters = ((team.players as Player[]) ?? [])
    .filter((p) => p.isActive)
    .sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0))
    .slice(0, 5);

  const matchupPairs = opponentTeam
    ? pairByRole(myStarters, (opponentTeam.players as Player[]) ?? [])
    : Array.from({ length: 5 }, () => ({ my: null, them: null }));

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

  // Build the top 5 of the standings table, ensuring the user is always visible
  // even if outside the top 5. (Football Manager pulls the same trick.)
  const standingsTop5 = standingsArr.slice(0, 5);
  const userInTop5 = standingsTop5.some((t) => t.id === team.id);
  const standingsRows = userInTop5
    ? standingsTop5
    : [...standingsTop5, standingsArr.find((t) => t.id === team.id)].filter(Boolean) as typeof standingsArr;

  const messagesArr = messages as Array<{
    id: string;
    subject: string;
    body: string;
    fromName: string;
    fromRole: string;
    category: string;
    isRead: boolean;
    createdAt: Date;
    season: number;
    week: number;
  }>;
  const personalMessages = messagesArr.filter((m) => !NEWS_CATEGORIES.has(m.category));

  const myAvg = myStarters.length > 0
    ? myStarters.reduce((s, p) => s + (p.overall ?? 10), 0) / myStarters.length
    : 10;
  const oppAvg = opponentTeam && opponentTeam.players.length > 0
    ? opponentTeam.players.reduce((s, p) => s + (p.overall ?? 10), 0) / opponentTeam.players.length
    : 10;
  const winProb = winProbability(myAvg, oppAvg);

  // Form: last 5 played results (W/L) for the user team.
  const userForm = recentMatches
    .slice()
    .reverse()
    .map((m) => (m.winnerId === team.id ? "W" : "L") as "W" | "L");

  return (
    <div
      className="grid h-full min-h-0 overflow-hidden"
      style={{ gridTemplateColumns: "280px 1fr", background: D.bg }}
    >
      {/* ─── LEFT: Messages (full-height) ─── */}
      <aside
        className="flex min-h-0 flex-col overflow-y-auto"
        style={{ borderRight: `1px solid ${D.border}` }}
      >
        <div
          className="flex items-center justify-between px-4 pt-4 pb-3"
          style={{ borderBottom: `1px solid ${D.borderFaint}` }}
        >
          <SectionLabel>Messages</SectionLabel>{/* déjà FR */}
          {personalMessages.filter((m) => !m.isRead).length > 0 && (
            <span
              className="rounded-full px-2 py-0.5 text-[10px] tabular-nums"
              style={{
                background: "rgba(83,74,183,0.18)",
                color: D.primary,
                fontWeight: 500,
              }}
            >
              {personalMessages.filter((m) => !m.isRead).length} nouveau(x)
            </span>
          )}
        </div>
        {personalMessages.length === 0 ? (
          <div className="px-4 py-12 text-center text-[12px]" style={{ color: D.textSubtle }}>
            Aucun message pour l'instant.
          </div>
        ) : (
          personalMessages.slice(0, 40).map((m) => (
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
                {m.fromName.slice(0, 2)}
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
                    {m.fromName}
                  </span>
                  <span className="shrink-0 text-[10px] tabular-nums" style={{ color: D.textSubtle }}>
                    W{m.week}
                  </span>
                </div>
                <div
                  className="truncate text-[12px]"
                  style={{
                    color: m.isRead ? D.textMuted : D.textPrimary,
                    fontWeight: m.isRead ? 400 : 500,
                  }}
                >
                  {m.subject}
                </div>
                <div
                  className="line-clamp-2 text-[11px]"
                  style={{ color: m.isRead ? D.textSubtle : D.textMuted }}
                >
                  {m.body}
                </div>
              </div>
            </Link>
          ))
        )}
      </aside>

      {/* ─── RIGHT: hero + grid + recent + news ─── */}
      <main className="flex min-h-0 flex-col gap-5 overflow-y-auto px-6 py-5">
        {/* HERO — next match */}
        {nextMatch ? (
          <NextMatchHero
            team={team}
            nextMatch={nextMatch}
            teamRank={teamRank}
            opponentTeam={opponentTeam}
            matchupPairs={matchupPairs}
            winProb={winProb}
            userForm={userForm}
            stage={currentStage?.name ?? null}
            year={season?.year ?? 2026}
          />
        ) : (
          <div
            className="rounded-lg p-8 text-center text-[12px]"
            style={{ background: D.card, border: `1px solid ${D.borderFaint}`, color: D.textSubtle }}
          >
            Aucun match prévu.
          </div>
        )}

        {/* SQUAD + STANDINGS row */}
        <div className="grid gap-5" style={{ gridTemplateColumns: "1.4fr 1fr" }}>
          <SquadCard starters={myStarters} />
          <StandingsCard rows={standingsRows} userTeamId={team.id} />
        </div>

        {/* RECENT MATCHES + LIVE TICKER (finance / scouting / recommended) */}
        <div className="grid gap-5" style={{ gridTemplateColumns: "1.4fr 1fr" }}>
          <RecentMatchesCard matches={recentMatches} userTeamId={team.id} />
          <DashboardTicker />
        </div>
      </main>
    </div>
  );
}

// ─── Hero ────────────────────────────────────────────────────────────

function NextMatchHero({
  team,
  nextMatch,
  teamRank,
  opponentTeam,
  matchupPairs,
  winProb,
  userForm,
  stage,
  year,
}: {
  team: { id: string; name: string; tag: string; logoUrl: string | null; wins: number; losses: number };
  nextMatch: Match;
  teamRank: number;
  opponentTeam: { id: string; name: string; tag: string; logoUrl: string | null; players: Player[] } | null;
  matchupPairs: Array<{ my: Player | null; them: Player | null }>;
  winProb: number;
  userForm: Array<"W" | "L">;
  stage: string | null;
  year: number;
}) {
  const isHome = nextMatch.team1Id === team.id;
  const opp = isHome ? nextMatch.team2 : nextMatch.team1;
  return (
    <section
      className="flex flex-col gap-4 rounded-lg p-5"
      style={{ background: D.card, border: `1px solid ${D.borderFaint}` }}
    >
      {/* Top strip: section + format/day/stage */}
      <div className="flex items-center justify-between">
        <SectionLabel withAccent>Prochain match</SectionLabel>
        <span className="text-[11px]" style={{ color: D.textMuted }}>
          {nextMatch.format} · {formatGameDate(nextMatch.day, year)}
          {stage ? ` · ${stage}` : ""}
        </span>
      </div>

      {/* Team header row */}
      <div className="flex items-center justify-between gap-4">
        <TeamHeader
          logo={team.logoUrl}
          tag={team.tag}
          name={team.name}
          rank={teamRank}
          record={`${team.wins}-${team.losses}`}
          align="left"
          ours
        />
        <div className="flex flex-col items-center gap-1">
          <div
            className="rounded-full px-3 py-1 text-[12px] tabular-nums"
            style={{
              background: "rgba(83,74,183,0.18)",
              color: D.primary,
              fontWeight: 500,
            }}
          >
            {winProb}% de victoire
          </div>
          <FormPills form={userForm} />
        </div>
        <TeamHeader
          logo={opp.logoUrl}
          tag={opp.tag}
          name={opp.name}
          rank={null}
          record={"—"}
          align="right"
        />
      </div>

      {/* H2H matchup rows (5, paired by role) */}
      <div
        className="flex flex-col rounded"
        style={{ background: D.surface, border: `1px solid ${D.borderFaint}` }}
      >
        {matchupPairs.map(({ my, them }, i) => {
          const myAgent = my ? bestAgent(my) : null;
          const oppAgent = them ? bestAgent(them) : null;
          const myRating = my?.rating ?? 0;
          const oppRating = them?.rating ?? 0;
          const diff = myRating - oppRating;
          return (
            <div
              key={i}
              className="grid items-center gap-2 px-3 py-2.5"
              style={{
                gridTemplateColumns: "1fr 200px 1fr",
                borderBottom: i < matchupPairs.length - 1 ? `1px solid ${D.borderFaint}` : "none",
              }}
            >
              <PlayerLine
                ign={my?.ign ?? "—"}
                agent={myAgent}
                color={agentColor(myAgent)}
                align="left"
              />
              <div className="flex items-center justify-center gap-2 text-[12px] tabular-nums">
                <span style={{ color: D.primary, fontWeight: 500 }}>
                  {myRating > 0 ? myRating.toFixed(2) : "—"}
                </span>
                <span style={{ color: D.textSubtle }}>vs</span>
                <span
                  className="rounded px-1.5 text-[11px]"
                  style={{
                    background: diff >= 0 ? "rgba(29,158,117,0.15)" : "rgba(216,90,48,0.15)",
                    color: diff >= 0 ? D.teal : D.coral,
                    fontWeight: 500,
                  }}
                >
                  {diff >= 0 ? "+" : ""}{diff.toFixed(2)}
                </span>
                <span style={{ color: D.textPrimary, fontWeight: 500 }}>
                  {oppRating > 0 ? oppRating.toFixed(2) : "—"}
                </span>
              </div>
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
    </section>
  );
}

// ─── Squad card ──────────────────────────────────────────────────────

function SquadCard({ starters }: { starters: Player[] }) {
  return (
    <section
      className="flex flex-col rounded-lg overflow-hidden"
      style={{ background: D.card, border: `1px solid ${D.borderFaint}` }}
    >
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: `1px solid ${D.borderFaint}` }}
      >
        <SectionLabel withAccent>Effectif</SectionLabel>
        <Link href="/roster" className="text-[11px]" style={{ color: D.textMuted }}>
          Full roster →
        </Link>
      </div>
      <div>
        {starters.length === 0 ? (
          <div className="px-4 py-10 text-center text-[12px]" style={{ color: D.textSubtle }}>
            No active players.
          </div>
        ) : (
          starters.map((p, i) => {
            const main = bestAgent(p);
            const map = bestMap(p);
            const stats = map ? statsOnMap(p, map.factor) : null;
            const color = agentColor(main);
            return (
              <Link
                key={p.id}
                href={`/player/${p.id}`}
                className="grid items-center gap-3 px-4 py-3 transition-colors"
                style={{
                  gridTemplateColumns: "1fr auto",
                  borderBottom:
                    i < starters.length - 1 ? `1px solid ${D.borderFaint}` : "none",
                }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-medium"
                    style={{
                      background: `${color}1A`,
                      color,
                      border: `1px solid ${color}40`,
                    }}
                  >
                    {p.ign.slice(0, 2)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span
                        className="truncate text-[13px] font-medium"
                        style={{ color: D.textPrimary }}
                      >
                        {p.ign}
                      </span>
                      <span className="text-[10px]" style={{ color: D.textSubtle }}>
                        {p.role}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px]" style={{ color: D.textMuted }}>
                      <span style={{ color }} className="capitalize font-medium">
                        ★ {main ?? "—"}
                      </span>
                      <span style={{ color: D.textSubtle }}>·</span>
                      <span>{map?.name ?? "—"}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-[11px] tabular-nums" style={{ color: D.textMuted }}>
                  <span>
                    <span style={{ color: D.textPrimary, fontWeight: 500 }}>{stats?.acs ?? "—"}</span>
                    <span style={{ color: D.textSubtle }}> ACS</span>
                  </span>
                  <span>
                    <span style={{ color: D.textPrimary, fontWeight: 500 }}>{stats ? stats.kd.toFixed(2) : "—"}</span>
                    <span style={{ color: D.textSubtle }}> K/D</span>
                  </span>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </section>
  );
}

// ─── Standings card ──────────────────────────────────────────────────

function StandingsCard({
  rows,
  userTeamId,
}: {
  rows: Array<{
    id: string;
    name: string;
    tag?: string;
    logoUrl?: string | null;
    champPts: number;
    wins: number;
    losses: number;
  }>;
  userTeamId: string;
}) {
  return (
    <section
      className="flex flex-col rounded-lg overflow-hidden"
      style={{ background: D.card, border: `1px solid ${D.borderFaint}` }}
    >
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: `1px solid ${D.borderFaint}` }}
      >
        <SectionLabel withAccent>Classement</SectionLabel>
        <Link href="/league" className="text-[11px]" style={{ color: D.textMuted }}>
          Full table →
        </Link>
      </div>
      <div className="px-4 py-2">
        {rows.length === 0 ? (
          <div className="py-10 text-center text-[12px]" style={{ color: D.textSubtle }}>
            No standings yet.
          </div>
        ) : (
          rows.map((t, idx) => {
            const isUser = t.id === userTeamId;
            // If the user is appended past row 5, show their actual rank.
            const rank =
              idx >= 5
                ? rows.findIndex((r) => r.id === t.id) + 1
                : idx + 1;
            return (
              <div
                key={t.id}
                className="grid items-center gap-3 py-2 text-[12px]"
                style={{
                  gridTemplateColumns: "20px 1fr 60px 60px",
                  borderTop: idx === 0 ? "none" : `1px solid ${D.borderFaint}`,
                }}
              >
                <span
                  className="tabular-nums"
                  style={{
                    color: isUser ? D.primary : D.textSubtle,
                    fontWeight: isUser ? 500 : 400,
                  }}
                >
                  {rank}
                </span>
                <div className="flex items-center gap-2 min-w-0">
                  {t.logoUrl ? (
                    <img src={t.logoUrl} alt={t.name} className="h-5 w-5 object-contain" />
                  ) : (
                    <div
                      className="flex h-5 w-5 items-center justify-center rounded text-[8px]"
                      style={{ background: D.surface, color: D.textMuted }}
                    >
                      {t.tag?.slice(0, 2) ?? "??"}
                    </div>
                  )}
                  <span
                    className="truncate"
                    style={{
                      color: isUser ? D.primary : D.textPrimary,
                      fontWeight: isUser ? 500 : 400,
                    }}
                  >
                    {t.name}
                  </span>
                </div>
                <span
                  className="text-right tabular-nums"
                  style={{ color: D.textMuted }}
                >
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
          })
        )}
      </div>
    </section>
  );
}

// ─── Recent matches card ─────────────────────────────────────────────

function RecentMatchesCard({
  matches,
  userTeamId,
}: {
  matches: Match[];
  userTeamId: string;
}) {
  return (
    <section
      className="flex flex-col rounded-lg overflow-hidden"
      style={{ background: D.card, border: `1px solid ${D.borderFaint}` }}
    >
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: `1px solid ${D.borderFaint}` }}
      >
        <SectionLabel withAccent>Derniers matchs</SectionLabel>
      </div>
      <div>
        {matches.length === 0 ? (
          <div className="py-10 text-center text-[12px]" style={{ color: D.textSubtle }}>
            Aucun match joué pour l'instant.
          </div>
        ) : (
          matches.map((m, i) => {
            const isHome = m.team1Id === userTeamId;
            const opp = isHome ? m.team2 : m.team1;
            const won = m.winnerId === userTeamId;
            const score = m.score as { team1?: number; team2?: number } | null;
            const ourMaps = score ? (isHome ? score.team1 ?? 0 : score.team2 ?? 0) : 0;
            const theirMaps = score ? (isHome ? score.team2 ?? 0 : score.team1 ?? 0) : 0;
            const mapsArr = Array.isArray(m.maps)
              ? (m.maps as Array<{ map: string; score1: number; score2: number }>)
              : [];
            return (
              <div
                key={m.id}
                className="grid items-center gap-3 px-4 py-3 text-[12px]"
                style={{
                  gridTemplateColumns: "auto auto 1fr",
                  borderTop: i === 0 ? "none" : `1px solid ${D.borderFaint}`,
                }}
              >
                {/* Opponent + result */}
                <div className="flex items-center gap-2 min-w-0">
                  <span style={{ color: D.textSubtle }}>vs</span>
                  {opp.logoUrl ? (
                    <img src={opp.logoUrl} alt={opp.name} className="h-5 w-5 object-contain" />
                  ) : null}
                  <span style={{ color: D.textPrimary, fontWeight: 500 }} className="truncate">
                    {opp.name}
                  </span>
                </div>
                {/* W/L pill + map score */}
                <div className="flex items-center gap-2">
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
                    style={{
                      background: won ? "rgba(29,158,117,0.18)" : "rgba(216,90,48,0.18)",
                      color: won ? D.teal : D.coral,
                    }}
                  >
                    {won ? "W" : "L"} {ourMaps}-{theirMaps}
                  </span>
                </div>
                {/* Per-map line scores */}
                <div className="flex flex-wrap justify-end gap-2 text-[10px] tabular-nums" style={{ color: D.textMuted }}>
                  {mapsArr.length === 0 ? (
                    <span style={{ color: D.textSubtle }}>—</span>
                  ) : (
                    mapsArr.map((mp, j) => {
                      const our = isHome ? mp.score1 : mp.score2;
                      const their = isHome ? mp.score2 : mp.score1;
                      const wonMap = our > their;
                      return (
                        <span
                          key={j}
                          className="rounded px-1.5 py-0.5"
                          style={{
                            background: D.surface,
                            color: D.textMuted,
                          }}
                        >
                          <span style={{ color: D.textSubtle }}>{mp.map}</span>
                          <span style={{ color: wonMap ? D.teal : D.coral, fontWeight: 500 }}>
                            {" "}{our}
                          </span>
                          <span style={{ color: D.textSubtle }}>-</span>
                          <span style={{ color: wonMap ? D.textPrimary : D.textMuted }}>
                            {their}
                          </span>
                        </span>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

// ─── Shared subcomponents ────────────────────────────────────────────

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
        <img src={logo} alt={name} className="h-10 w-10 object-contain" />
      ) : (
        <div
          className="flex h-10 w-10 items-center justify-center rounded"
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
          className="text-[14px] font-medium"
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

function FormPills({ form }: { form: Array<"W" | "L"> }) {
  if (form.length === 0) return null;
  return (
    <div className="flex items-center gap-1">
      {form.map((f, i) => (
        <span
          key={i}
          className="flex h-3.5 w-3.5 items-center justify-center rounded-sm text-[8px] font-medium"
          style={{
            background: f === "W" ? "rgba(29,158,117,0.25)" : "rgba(216,90,48,0.25)",
            color: f === "W" ? D.teal : D.coral,
          }}
        >
          {f}
        </span>
      ))}
    </div>
  );
}
