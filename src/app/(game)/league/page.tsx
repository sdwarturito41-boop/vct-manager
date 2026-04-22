import { serverTrpc } from "@/lib/trpc-server";
import { BracketView } from "@/components/BracketView";
import { prisma } from "@/lib/prisma";
import { VCT_STAGES } from "@/constants/vct-format";
import type { StageId } from "@/constants/vct-format";
import { D } from "@/constants/design";

export default async function LeaguePage() {
  const api = await serverTrpc();

  let season;
  try {
    season = await api.season.getCurrent();
  } catch {
    return (
      <div className="flex items-center justify-center py-32">
        <p
          className="text-[11px] font-medium uppercase tracking-[0.3em]"
          style={{ color: D.textSubtle }}
        >
          No active season.
        </p>
      </div>
    );
  }

  const schedule = await api.season.getSchedule();
  const team = await api.team.get();
  const standings = (await api.league.standings().catch(() => [])) as Array<{
    id: string;
    name: string;
    tag: string;
    logoUrl: string | null;
    champPts: number;
    wins: number;
    losses: number;
  }>;

  const templates = await prisma.vctTeamTemplate.findMany({ select: { name: true, logoUrl: true } });
  const allTeams = await prisma.team.findMany({ select: { id: true, name: true, tag: true, logoUrl: true, region: true } });
  const teamNameToLogo: Record<string, string | null> = {};
  for (const t of templates) teamNameToLogo[t.name] = t.logoUrl;
  for (const t of allTeams) if (t.logoUrl) teamNameToLogo[t.name] = t.logoUrl;
  const teamIdToTeam = new Map(allTeams.map((t) => [t.id, t]));

  const currentStageName =
    season.currentStage in VCT_STAGES
      ? VCT_STAGES[season.currentStage as StageId].name
      : season.currentStage;

  const currentStage = season.currentStage as string;
  const isKickoff = currentStage === "KICKOFF";
  const isMasters = currentStage === "MASTERS_1" || currentStage === "MASTERS_2";
  const isStage = currentStage === "STAGE_1" || currentStage === "STAGE_2";
  const isEwc = currentStage === "EWC";
  const isChampions = currentStage === "CHAMPIONS";

  const regions = ["EMEA", "Americas", "Pacific", "China"] as const;
  const byRegion = new Map<string, typeof schedule>();
  for (const r of regions) byRegion.set(r, []);
  for (const m of schedule) byRegion.get(m.team1.region)?.push(m);
  const orderedRegions = [team.region, ...regions.filter((r) => r !== team.region)];

  // ─── Fetch all matches for the current international stages to compute Swiss standings ───
  // Full match data: we have `schedule` (user region + internationals) already
  // For Masters/EWC/Champions we need internal stage matches for ALL participating teams
  const stagePrefix = currentStage;
  const allStageMatches = await prisma.match.findMany({
    where: {
      season: season.number,
      OR: [
        { stageId: { startsWith: stagePrefix } },
        { stageId: stagePrefix },
      ],
    },
    include: { team1: true, team2: true },
    orderBy: { day: "asc" },
  });

  // ─── Stage-specific views ───

  // Swiss standings (for Masters/EWC/Champions) from stageId SWISS_R*
  let swissStandings: Array<{ team: typeof allTeams[0]; wins: number; losses: number; eliminated: boolean; advanced: boolean }> = [];
  if (isMasters || isEwc || isChampions) {
    const swissMatches = allStageMatches.filter((m) => m.stageId.includes("_SWISS_R"));
    const recordMap = new Map<string, { wins: number; losses: number }>();
    const participantIds = new Set<string>();
    for (const m of swissMatches) {
      participantIds.add(m.team1Id);
      participantIds.add(m.team2Id);
      if (m.isPlayed && m.winnerId) {
        const loserId = m.winnerId === m.team1Id ? m.team2Id : m.team1Id;
        const w = recordMap.get(m.winnerId) ?? { wins: 0, losses: 0 };
        w.wins++;
        recordMap.set(m.winnerId, w);
        const l = recordMap.get(loserId) ?? { wins: 0, losses: 0 };
        l.losses++;
        recordMap.set(loserId, l);
      }
    }
    swissStandings = [...participantIds]
      .map((id) => {
        const t = teamIdToTeam.get(id);
        if (!t) return null;
        const r = recordMap.get(id) ?? { wins: 0, losses: 0 };
        return {
          team: t,
          wins: r.wins,
          losses: r.losses,
          eliminated: r.losses >= 3,
          advanced: r.wins >= 3,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.wins - a.wins || a.losses - b.losses);
  }

  // ─── Compute team form (last 5) for Stage 1/2 group standings ───
  const teamForms = new Map<string, Array<"W" | "L">>();
  const playedMatches = schedule
    .filter((m) => m.isPlayed)
    .sort((a, b) => (a.day ?? 0) - (b.day ?? 0));
  for (const m of playedMatches) {
    for (const tid of [m.team1Id, m.team2Id]) {
      const arr = teamForms.get(tid) ?? [];
      arr.push(m.winnerId === tid ? "W" : "L");
      teamForms.set(tid, arr);
    }
  }

  // ─── Compute Alpha/Omega group standings for Stage 1/2 ───
  type GroupRow = { team: typeof allTeams[0]; wins: number; losses: number; form: Array<"W" | "L"> };
  const regionalGroups: Map<string, { alpha: GroupRow[]; omega: GroupRow[] }> = new Map();
  if (isStage) {
    const alphaMatches = allStageMatches.filter((m) => m.stageId === `${stagePrefix}_ALPHA`);
    const omegaMatches = allStageMatches.filter((m) => m.stageId === `${stagePrefix}_OMEGA`);

    function computeGroup(matches: typeof alphaMatches, regionFilter: string): GroupRow[] {
      const rec = new Map<string, { wins: number; losses: number }>();
      const participantIds = new Set<string>();
      for (const m of matches) {
        if (m.team1.region !== regionFilter) continue;
        participantIds.add(m.team1Id);
        participantIds.add(m.team2Id);
        if (m.isPlayed && m.winnerId) {
          const loserId = m.winnerId === m.team1Id ? m.team2Id : m.team1Id;
          const w = rec.get(m.winnerId) ?? { wins: 0, losses: 0 };
          w.wins++;
          rec.set(m.winnerId, w);
          const l = rec.get(loserId) ?? { wins: 0, losses: 0 };
          l.losses++;
          rec.set(loserId, l);
        }
      }
      return [...participantIds]
        .map((id) => {
          const t = teamIdToTeam.get(id);
          if (!t) return null;
          const r = rec.get(id) ?? { wins: 0, losses: 0 };
          return { team: t, wins: r.wins, losses: r.losses, form: (teamForms.get(id) ?? []).slice(-5) };
        })
        .filter((x): x is GroupRow => x !== null)
        .sort((a, b) => b.wins - a.wins || a.losses - b.losses);
    }

    for (const r of regions) {
      regionalGroups.set(r, {
        alpha: computeGroup(alphaMatches, r),
        omega: computeGroup(omegaMatches, r),
      });
    }
  }

  // ─── Playoffs bracket rounds for Stage 1/2 (per region) ───
  type PlayoffRound = { label: string; suffix: string; matches: typeof allStageMatches };
  const playoffRoundOrder = ["_PO_UB_QF", "_PO_UB_SF", "_PO_UB_FINAL", "_PO_LB_R1", "_PO_LB_R2", "_PO_LB_FINAL", "_PO_GF"];
  const regionalPlayoffs = new Map<string, PlayoffRound[]>();
  if (isStage) {
    for (const r of regions) {
      const rounds: PlayoffRound[] = [];
      for (const suffix of playoffRoundOrder) {
        const stageId = `${stagePrefix}${suffix}`;
        const ms = allStageMatches.filter((m) => m.stageId === stageId && m.team1.region === r);
        if (ms.length > 0) rounds.push({ label: suffix.replace(/^_PO_/, "").replace(/_/g, " "), suffix, matches: ms });
      }
      regionalPlayoffs.set(r, rounds);
    }
  }

  // ─── Bracket rounds for Masters/EWC/Champions ───
  const bracketRoundOrder = [
    "_UB_QF",
    "_UB_SF",
    "_UB_FINAL",
    "_LB_R1",
    "_LB_R2",
    "_LB_R3",
    "_LB_SF",
    "_LB_FINAL",
    "_GRAND_FINAL",
  ];
  const bracketRounds: Array<{ label: string; matches: typeof allStageMatches }> = [];
  if (isMasters || isEwc || isChampions) {
    for (const suffix of bracketRoundOrder) {
      const stageId = `${stagePrefix}${suffix}`;
      const ms = allStageMatches.filter((m) => m.stageId === stageId);
      if (ms.length > 0) {
        bracketRounds.push({ label: suffix.slice(1).replace(/_/g, " "), matches: ms });
      }
    }
  }

  // Kickoff
  const hasKickoffMatches = schedule.some((m) => m.stageId.startsWith("KICKOFF"));
  const kickoffComplete =
    hasKickoffMatches &&
    schedule.filter((m) => m.stageId.startsWith("KICKOFF")).every((m) => m.isPlayed);

  const heroSub =
    isKickoff ? "Triple Elimination · Top 3 → Masters"
    : isMasters ? "Swiss Stage · Double Elimination Bracket"
    : isStage ? "Regional Round Robin · Top 3 → Masters"
    : isEwc ? "Esports World Cup · Double Elimination"
    : isChampions ? "Champions · Group Stage → Playoffs"
    : "Season schedule";

  return (
    <div className="flex min-h-full flex-col">
      {/* ── Hero ── */}
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
              Season {season.number} · {team.region}
            </div>
            <h1
              className="mt-1 text-[34px] font-medium uppercase leading-none tracking-[0.05em]"
              style={{ color: D.textPrimary }}
            >
              League
            </h1>
            <div
              className="mt-3 flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.2em]"
              style={{ color: D.textMuted }}
            >
              <span style={{ color: D.red }}>{currentStageName}</span>
              <span>·</span>
              <span>{heroSub}</span>
            </div>
          </div>

          <div className="flex flex-col items-end">
            <span
              className="rounded-full px-3 py-1 text-[10px] font-medium uppercase tracking-[0.25em]"
              style={{
                background: "rgba(255,70,85,0.12)",
                color: D.red,
                border: `1px solid rgba(255,70,85,0.3)`,
              }}
            >
              Week {season.currentWeek}
            </span>
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════ */}
      {/* ─── KICKOFF: region brackets ── */}
      {/* ═══════════════════════════════════════ */}
      {isKickoff && hasKickoffMatches && (
        <section className="flex flex-col">
          <SectionHeader label="Kickoff Brackets" sub={`${regions.length} regions`} />
          {orderedRegions.map((region) => (
            <BracketView
              key={region}
              matches={byRegion.get(region) ?? []}
              userTeamId={team.id}
              region={region}
              isUserRegion={region === team.region}
              teamNameToLogo={teamNameToLogo}
            />
          ))}
        </section>
      )}

      {/* ═══════════════════════════════════════ */}
      {/* ─── MASTERS / EWC / CHAMPIONS: Swiss + bracket ── */}
      {/* ═══════════════════════════════════════ */}
      {(isMasters || isEwc || isChampions) && (
        <>
          {swissStandings.length > 0 && (
            <section className="flex flex-col" style={{ borderBottom: `1px solid ${D.border}` }}>
              <SectionHeader label="Swiss Stage" sub={`${swissStandings.length} teams · Top 8 advance`} />
              <SwissTable standings={swissStandings} userTeamId={team.id} />
            </section>
          )}

          {bracketRounds.length > 0 && (
            <section className="flex flex-col">
              <SectionHeader label="Bracket Stage" sub="Double Elimination" />
              <div className="flex flex-col gap-0">
                {bracketRounds.map((r) => (
                  <BracketRound
                    key={r.label}
                    label={r.label}
                    matches={r.matches}
                    userTeamId={team.id}
                    teamNameToLogo={teamNameToLogo}
                  />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* ═══════════════════════════════════════ */}
      {/* ─── STAGE 1 / 2: Alpha + Omega groups + playoffs per region ── */}
      {/* ═══════════════════════════════════════ */}
      {isStage && regionalGroups.size > 0 && (
        <section className="flex flex-col">
          <SectionHeader label="Regional Stages" sub="Alpha + Omega Groups · Top 3 → Masters" />
          {orderedRegions.map((r) => {
            const groups = regionalGroups.get(r);
            const playoffs = regionalPlayoffs.get(r) ?? [];
            if (!groups || (groups.alpha.length === 0 && groups.omega.length === 0)) return null;
            return (
              <div
                key={r}
                className="flex flex-col"
                style={{ borderBottom: `1px solid ${D.border}` }}
              >
                {/* Region header */}
                <div
                  className="flex items-center justify-between px-10 py-4"
                  style={{
                    background: r === team.region ? "rgba(255,70,85,0.04)" : "transparent",
                    borderBottom: `1px solid ${D.borderFaint}`,
                  }}
                >
                  <span
                    className="text-[14px] font-medium uppercase tracking-[0.3em]"
                    style={{ color: r === team.region ? D.red : D.textPrimary }}
                  >
                    {r}
                    {r === team.region && (
                      <span className="ml-3 text-[10px] tracking-[0.2em]" style={{ color: D.red }}>
                        · Your Region
                      </span>
                    )}
                  </span>
                  <span
                    className="text-[10px] font-medium uppercase tracking-[0.2em]"
                    style={{ color: D.textMuted }}
                  >
                    {groups.alpha.length + groups.omega.length} teams
                  </span>
                </div>

                {/* Alpha + Omega side by side */}
                <div className="grid grid-cols-2" style={{ borderBottom: `1px solid ${D.borderFaint}` }}>
                  <div style={{ borderRight: `1px solid ${D.border}` }}>
                    <GroupHeader name="Alpha Group" count={groups.alpha.length} />
                    <GroupTable list={groups.alpha} userTeamId={team.id} compact />
                  </div>
                  <div>
                    <GroupHeader name="Omega Group" count={groups.omega.length} />
                    <GroupTable list={groups.omega} userTeamId={team.id} compact />
                  </div>
                </div>

                {/* Playoffs below groups */}
                {playoffs.length > 0 && (
                  <div className="flex flex-col">
                    <div
                      className="flex items-center justify-between px-10 py-3"
                      style={{ borderBottom: `1px solid ${D.borderFaint}` }}
                    >
                      <span
                        className="text-[10px] font-medium uppercase tracking-[0.3em]"
                        style={{ color: D.gold }}
                      >
                        {r} Playoffs
                      </span>
                      <span className="text-[10px] uppercase tracking-[0.2em]" style={{ color: D.textSubtle }}>
                        Double Elimination
                      </span>
                    </div>
                    {playoffs.map((round) => (
                      <BracketRound
                        key={round.suffix}
                        label={round.label}
                        matches={round.matches}
                        userTeamId={team.id}
                        teamNameToLogo={teamNameToLogo}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      {/* ═══════════════════════════════════════ */}
      {/* ─── Champions points rankings (always) ── */}
      {/* ═══════════════════════════════════════ */}
      {standings.length > 0 && !isMasters && !isEwc && !isChampions && (
        <section className="flex flex-col" style={{ borderTop: `1px solid ${D.border}` }}>
          <SectionHeader label={`${team.region} Rankings`} sub={`${standings.length} teams · Season standings`} />
          <ChampPtsTable standings={standings} userTeamId={team.id} teamForms={teamForms} />
        </section>
      )}

      {/* Kickoff complete banner */}
      {kickoffComplete && !isKickoff && !isMasters && (
        <section className="px-10 py-6">
          <div
            className="flex items-center justify-between gap-4 rounded-lg px-5 py-3"
            style={{
              background: "rgba(198,155,58,0.06)",
              border: `1px solid rgba(198,155,58,0.25)`,
            }}
          >
            <span
              className="text-[10px] font-medium uppercase tracking-[0.25em]"
              style={{ color: D.gold }}
            >
              Kickoff Complete
            </span>
          </div>
        </section>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────

function SectionHeader({ label, sub }: { label: string; sub: string }) {
  return (
    <div
      className="flex items-center justify-between px-10 py-4"
      style={{ borderBottom: `1px solid ${D.borderFaint}` }}
    >
      <span
        className="text-[11px] font-medium uppercase tracking-[0.3em]"
        style={{ color: D.textSubtle }}
      >
        {label}
      </span>
      <span
        className="text-[10px] font-medium uppercase tracking-[0.2em]"
        style={{ color: D.textMuted }}
      >
        {sub}
      </span>
    </div>
  );
}

function SwissTable({
  standings,
  userTeamId,
}: {
  standings: Array<{ team: { id: string; name: string; tag: string; logoUrl: string | null }; wins: number; losses: number; eliminated: boolean; advanced: boolean }>;
  userTeamId: string;
}) {
  return (
    <>
      <div
        className="grid items-center gap-3 px-10 py-2"
        style={{
          gridTemplateColumns: "40px 1fr 60px 60px 120px",
          borderBottom: `1px solid ${D.borderFaint}`,
        }}
      >
        <span className="text-[9px] font-medium uppercase tracking-[0.3em]" style={{ color: D.textSubtle }}>#</span>
        <span className="text-[9px] font-medium uppercase tracking-[0.3em]" style={{ color: D.textSubtle }}>Team</span>
        <span className="text-right text-[9px] font-medium uppercase tracking-[0.3em]" style={{ color: D.textSubtle }}>W</span>
        <span className="text-right text-[9px] font-medium uppercase tracking-[0.3em]" style={{ color: D.textSubtle }}>L</span>
        <span className="text-right text-[9px] font-medium uppercase tracking-[0.3em]" style={{ color: D.textSubtle }}>Status</span>
      </div>
      {standings.map((s, idx) => {
        const isUser = s.team.id === userTeamId;
        return (
          <div
            key={s.team.id}
            className="grid items-center gap-3 px-10 py-3"
            style={{
              gridTemplateColumns: "40px 1fr 60px 60px 120px",
              borderBottom: `1px solid ${D.borderFaint}`,
              background: isUser ? "rgba(255,70,85,0.06)" : "transparent",
            }}
          >
            <span className="text-[12px] font-medium tabular-nums" style={{ color: idx < 8 ? D.gold : D.textMuted }}>
              {idx + 1}
            </span>
            <div className="flex min-w-0 items-center gap-3">
              {s.team.logoUrl ? (
                <img src={s.team.logoUrl} alt="" className="h-6 w-6 shrink-0 object-contain" />
              ) : (
                <div className="h-6 w-6 shrink-0 rounded" style={{ background: D.card }} />
              )}
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] font-medium" style={{ color: isUser ? D.red : D.textPrimary }}>
                  {s.team.name}
                </span>
                <span className="text-[10px] uppercase tracking-[0.2em]" style={{ color: D.textSubtle }}>
                  {s.team.tag}
                </span>
              </div>
            </div>
            <span className="text-right text-[13px] font-medium tabular-nums" style={{ color: D.textPrimary }}>
              {s.wins}
            </span>
            <span className="text-right text-[13px] font-medium tabular-nums" style={{ color: D.textMuted }}>
              {s.losses}
            </span>
            <div className="flex justify-end">
              {s.advanced ? (
                <span
                  className="rounded px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.2em]"
                  style={{ background: "rgba(76,175,125,0.15)", color: D.green }}
                >
                  Advanced
                </span>
              ) : s.eliminated ? (
                <span
                  className="rounded px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.2em]"
                  style={{ background: "rgba(255,70,85,0.12)", color: D.red }}
                >
                  Eliminated
                </span>
              ) : (
                <span
                  className="rounded px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.2em]"
                  style={{ background: "rgba(255,255,255,0.04)", color: D.textMuted }}
                >
                  Playing
                </span>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

function BracketRound({
  label,
  matches,
  userTeamId,
  teamNameToLogo,
}: {
  label: string;
  matches: Array<{ id: string; team1: { id: string; name: string; tag: string; logoUrl: string | null }; team2: { id: string; name: string; tag: string; logoUrl: string | null }; winnerId: string | null; score: unknown; isPlayed: boolean; day: number }>;
  userTeamId: string;
  teamNameToLogo: Record<string, string | null>;
}) {
  return (
    <div className="flex flex-col" style={{ borderBottom: `1px solid ${D.borderFaint}` }}>
      <div className="flex items-center justify-between px-10 py-3">
        <span
          className="text-[10px] font-medium uppercase tracking-[0.3em]"
          style={{ color: D.textPrimary }}
        >
          {label}
        </span>
        <span className="text-[10px] uppercase tracking-[0.2em]" style={{ color: D.textSubtle }}>
          {matches.length} {matches.length === 1 ? "match" : "matches"}
        </span>
      </div>
      <div className="grid gap-0 pb-2">
        {matches.map((m) => {
          const score = m.score as { team1: number; team2: number } | null;
          const isUserMatch = m.team1.id === userTeamId || m.team2.id === userTeamId;
          const t1Won = m.winnerId === m.team1.id;
          const t2Won = m.winnerId === m.team2.id;
          return (
            <div
              key={m.id}
              className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-10 py-2.5"
              style={{
                background: isUserMatch ? "rgba(255,70,85,0.04)" : "transparent",
                borderBottom: `1px solid ${D.borderFaint}`,
              }}
            >
              {/* Team 1 — right aligned */}
              <div className="flex items-center justify-end gap-2.5">
                <span
                  className="truncate text-[13px] font-medium"
                  style={{
                    color: m.isPlayed ? (t1Won ? D.textPrimary : D.textMuted) : D.textPrimary,
                    opacity: m.isPlayed && !t1Won ? 0.5 : 1,
                  }}
                >
                  {m.team1.name}
                </span>
                {m.team1.logoUrl ? (
                  <img src={m.team1.logoUrl} alt="" className="h-6 w-6 shrink-0 object-contain" />
                ) : (
                  <div className="h-6 w-6 shrink-0 rounded" style={{ background: D.card }} />
                )}
              </div>

              {/* Score */}
              <div className="flex min-w-[80px] items-center justify-center gap-2 text-[14px] tabular-nums">
                {m.isPlayed && score ? (
                  <>
                    <span style={{ color: t1Won ? D.green : D.textMuted, fontWeight: 500 }}>{score.team1}</span>
                    <span style={{ color: D.textFaint }}>:</span>
                    <span style={{ color: t2Won ? D.green : D.textMuted, fontWeight: 500 }}>{score.team2}</span>
                  </>
                ) : (
                  <span className="text-[10px] uppercase tracking-[0.2em]" style={{ color: D.textSubtle }}>
                    Upcoming
                  </span>
                )}
              </div>

              {/* Team 2 — left aligned */}
              <div className="flex items-center gap-2.5">
                {m.team2.logoUrl ? (
                  <img src={m.team2.logoUrl} alt="" className="h-6 w-6 shrink-0 object-contain" />
                ) : (
                  <div className="h-6 w-6 shrink-0 rounded" style={{ background: D.card }} />
                )}
                <span
                  className="truncate text-[13px] font-medium"
                  style={{
                    color: m.isPlayed ? (t2Won ? D.textPrimary : D.textMuted) : D.textPrimary,
                    opacity: m.isPlayed && !t2Won ? 0.5 : 1,
                  }}
                >
                  {m.team2.name}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GroupHeader({ name, count }: { name: string; count: number }) {
  return (
    <div
      className="flex items-center justify-between px-6 py-3"
      style={{ borderBottom: `1px solid ${D.borderFaint}` }}
    >
      <span
        className="text-[11px] font-medium uppercase tracking-[0.3em]"
        style={{ color: D.textPrimary }}
      >
        {name}
      </span>
      <span
        className="text-[10px] font-medium uppercase tracking-[0.2em]"
        style={{ color: D.textSubtle }}
      >
        {count} teams
      </span>
    </div>
  );
}

function GroupTable({
  list,
  userTeamId,
  compact = false,
}: {
  list: Array<{ team: { id: string; name: string; tag: string; logoUrl: string | null }; wins: number; losses: number; form: Array<"W" | "L"> }>;
  userTeamId: string;
  compact?: boolean;
}) {
  const pad = compact ? "px-6" : "px-10";
  const cols = compact ? "32px 1fr 40px 40px 80px" : "40px 1fr 60px 60px 120px";
  return (
    <>
      <div
        className={`grid items-center gap-3 py-2 ${pad}`}
        style={{
          gridTemplateColumns: cols,
          borderBottom: `1px solid ${D.borderFaint}`,
        }}
      >
        <span className="text-[9px] font-medium uppercase tracking-[0.3em]" style={{ color: D.textSubtle }}>#</span>
        <span className="text-[9px] font-medium uppercase tracking-[0.3em]" style={{ color: D.textSubtle }}>Team</span>
        <span className="text-right text-[9px] font-medium uppercase tracking-[0.3em]" style={{ color: D.textSubtle }}>W</span>
        <span className="text-right text-[9px] font-medium uppercase tracking-[0.3em]" style={{ color: D.textSubtle }}>L</span>
        <span className="text-right text-[9px] font-medium uppercase tracking-[0.3em]" style={{ color: D.textSubtle }}>Form</span>
      </div>
      {list.map((row, idx) => {
        const isUser = row.team.id === userTeamId;
        const qualifies = idx < 3;
        return (
          <div
            key={row.team.id}
            className={`grid items-center gap-3 py-3 ${pad}`}
            style={{
              gridTemplateColumns: cols,
              borderBottom: `1px solid ${D.borderFaint}`,
              background: isUser ? "rgba(255,70,85,0.06)" : "transparent",
            }}
          >
            <span
              className="text-[12px] font-medium tabular-nums"
              style={{ color: qualifies ? D.gold : D.textMuted }}
            >
              {idx + 1}
            </span>
            <div className="flex min-w-0 items-center gap-3">
              {row.team.logoUrl ? (
                <img src={row.team.logoUrl} alt="" className="h-6 w-6 shrink-0 object-contain" />
              ) : (
                <div className="h-6 w-6 shrink-0 rounded" style={{ background: D.card }} />
              )}
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] font-medium" style={{ color: isUser ? D.red : D.textPrimary }}>
                  {row.team.name}
                </span>
                <span className="text-[10px] uppercase tracking-[0.2em]" style={{ color: D.textSubtle }}>
                  {row.team.tag}
                </span>
              </div>
            </div>
            <span className="text-right text-[13px] font-medium tabular-nums" style={{ color: D.textPrimary }}>
              {row.wins}
            </span>
            <span className="text-right text-[13px] font-medium tabular-nums" style={{ color: D.textMuted }}>
              {row.losses}
            </span>
            <div className="flex items-center justify-end gap-1">
              {row.form.length === 0 ? (
                <span className="text-[10px]" style={{ color: D.textSubtle }}>—</span>
              ) : (
                row.form.map((r, i) => (
                  <span
                    key={i}
                    className="flex h-4 w-4 items-center justify-center rounded text-[9px] font-medium"
                    style={{
                      background: r === "W" ? "rgba(76,175,125,0.15)" : "rgba(255,70,85,0.12)",
                      color: r === "W" ? D.green : D.red,
                    }}
                  >
                    {r}
                  </span>
                ))
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

function ChampPtsTable({
  standings,
  userTeamId,
  teamForms,
}: {
  standings: Array<{ id: string; name: string; tag: string; logoUrl: string | null; champPts: number; wins: number; losses: number }>;
  userTeamId: string;
  teamForms: Map<string, Array<"W" | "L">>;
}) {
  return (
    <>
      <div
        className="grid items-center gap-3 px-10 py-2"
        style={{
          gridTemplateColumns: "40px 1fr 60px 60px 80px 140px",
          borderBottom: `1px solid ${D.borderFaint}`,
        }}
      >
        <span className="text-[9px] font-medium uppercase tracking-[0.3em]" style={{ color: D.textSubtle }}>#</span>
        <span className="text-[9px] font-medium uppercase tracking-[0.3em]" style={{ color: D.textSubtle }}>Team</span>
        <span className="text-right text-[9px] font-medium uppercase tracking-[0.3em]" style={{ color: D.textSubtle }}>W</span>
        <span className="text-right text-[9px] font-medium uppercase tracking-[0.3em]" style={{ color: D.textSubtle }}>L</span>
        <span className="text-right text-[9px] font-medium uppercase tracking-[0.3em]" style={{ color: D.textSubtle }}>Champ</span>
        <span className="text-right text-[9px] font-medium uppercase tracking-[0.3em]" style={{ color: D.textSubtle }}>Form</span>
      </div>
      {standings.map((t, idx) => {
        const isUser = t.id === userTeamId;
        const form = (teamForms.get(t.id) ?? []).slice(-5);
        return (
          <div
            key={t.id}
            className="grid items-center gap-3 px-10 py-3"
            style={{
              gridTemplateColumns: "40px 1fr 60px 60px 80px 140px",
              borderBottom: `1px solid ${D.borderFaint}`,
              background: isUser ? "rgba(255,70,85,0.06)" : "transparent",
            }}
          >
            <span
              className="text-[12px] font-medium tabular-nums"
              style={{ color: idx < 3 ? D.gold : D.textMuted }}
            >
              {idx + 1}
            </span>
            <div className="flex min-w-0 items-center gap-3">
              {t.logoUrl ? (
                <img src={t.logoUrl} alt="" className="h-6 w-6 shrink-0 object-contain" />
              ) : (
                <div className="h-6 w-6 shrink-0 rounded" style={{ background: D.card }} />
              )}
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] font-medium" style={{ color: isUser ? D.red : D.textPrimary }}>
                  {t.name}
                </span>
                <span className="text-[10px] uppercase tracking-[0.2em]" style={{ color: D.textSubtle }}>
                  {t.tag}
                </span>
              </div>
            </div>
            <span className="text-right text-[13px] font-medium tabular-nums" style={{ color: D.textPrimary }}>
              {t.wins}
            </span>
            <span className="text-right text-[13px] font-medium tabular-nums" style={{ color: D.textMuted }}>
              {t.losses}
            </span>
            <span className="text-right text-[13px] font-medium tabular-nums" style={{ color: D.gold }}>
              {t.champPts}
            </span>
            <div className="flex items-center justify-end gap-1">
              {form.length === 0 ? (
                <span className="text-[10px]" style={{ color: D.textSubtle }}>—</span>
              ) : (
                form.map((r, i) => (
                  <span
                    key={i}
                    className="flex h-4 w-4 items-center justify-center rounded text-[9px] font-medium"
                    style={{
                      background: r === "W" ? "rgba(76,175,125,0.15)" : "rgba(255,70,85,0.12)",
                      color: r === "W" ? D.green : D.red,
                    }}
                  >
                    {r}
                  </span>
                ))
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
