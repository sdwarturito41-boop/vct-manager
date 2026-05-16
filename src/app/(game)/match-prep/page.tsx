"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { trpc } from "@/lib/trpc-client";

// ── Types (kept local to avoid deep tRPC inference) ──

interface IntelData {
  opponent: { id: string; name: string; tag: string; region: string };
  tier: 0 | 1 | 2 | 3;
  analystTier: "Junior" | "Senior" | "Elite" | null;
  seasonRecord: { wins: number; losses: number };
  recentForm: { wins: number; losses: number; sequence: ("W" | "L")[] };
  dominantMaps: { mapName: string; count: number }[];
  keyPlayer: { id: string; ign: string; role: string; acs: number; kd: number } | null;
  strategicProfile: { playstyle: string; ecoDiscipline: number; adaptationRating: number } | null;
}

interface RosterPlayer {
  id: string;
  ign: string;
  role: string;
  overall: number | null;
  isActive: boolean;
  isReserve: boolean;
}

interface NextMatchData {
  id: string;
  day: number;
  format: string;
  stageId: string;
  team1Id: string;
  team2Id: string;
  daysUntil: number;
}

// ── Page ──

export default function MatchPrepPage() {
  const nextMatchQ = trpc.match.getNextUserMatch.useQuery();

  if (nextMatchQ.isLoading) {
    return <Shell><Skeleton /></Shell>;
  }
  if (!nextMatchQ.data) {
    return (
      <Shell>
        <div className="rounded-lg border border-[var(--val-gray)] bg-[var(--val-surface)] p-10 text-center">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--val-white)]/40">
            Aucun match programmé
          </div>
          <div className="mt-2 text-lg font-bold text-[var(--val-white)]">
            Avance les jours jusqu'à ton prochain match pour voir l'intel.
          </div>
        </div>
      </Shell>
    );
  }

  const nextMatch = nextMatchQ.data as NextMatchData;
  return <PrepBoard nextMatch={nextMatch} />;
}

function PrepBoard({ nextMatch }: { nextMatch: NextMatchData }) {
  const matchQ = trpc.match.getById.useQuery({ matchId: nextMatch.id });
  const teamQ = trpc.team.get.useQuery();
  const intelQ = trpc.match.scoutNextOpponent.useQuery({ matchId: nextMatch.id });

  if (matchQ.isLoading || teamQ.isLoading || intelQ.isLoading) {
    return <Shell><Skeleton /></Shell>;
  }
  if (matchQ.error || !matchQ.data) {
    return <Shell><ErrorCard msg={matchQ.error?.message ?? "Match introuvable."} /></Shell>;
  }
  if (intelQ.error || !intelQ.data) {
    return <Shell><ErrorCard msg={intelQ.error?.message ?? "Intel indisponible."} /></Shell>;
  }

  const match = matchQ.data as {
    id: string;
    team1Id: string;
    team2Id: string;
    team1: { name: string; tag: string; region: string };
    team2: { name: string; tag: string; region: string };
    day: number;
    stageId: string;
    format: string;
  };
  const userTeam = teamQ.data as ({ id: string; players: RosterPlayer[] }) | undefined;
  const intel = intelQ.data as IntelData;
  const isUserTeam1 = userTeam?.id === match.team1Id;
  const ourTeam = isUserTeam1 ? match.team1 : match.team2;
  const theirTeam = isUserTeam1 ? match.team2 : match.team1;

  const daysLabel =
    nextMatch.daysUntil === 0
      ? "Aujourd'hui"
      : nextMatch.daysUntil === 1
      ? "Demain"
      : `Dans ${nextMatch.daysUntil} jours`;

  return (
    <Shell>
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-[var(--val-white)]/40">
            Plan de match
          </div>
          <div className="mt-1 text-3xl font-black uppercase tracking-[0.05em] text-[var(--val-white)]">
            Prochain match
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--val-white)]/40">
            {match.stageId.replace(/_/g, " ")} · {match.format}
          </div>
          <div className="mt-1 text-base font-bold text-[var(--val-gold)]">
            {daysLabel}
          </div>
        </div>
      </div>

      {/* VS banner */}
      <div className="mt-6 rounded-lg border border-[var(--val-gray)] bg-[var(--val-surface)] p-8">
        <div className="grid grid-cols-3 items-center gap-6">
          <TeamBlock team={ourTeam} side="left" label="Votre équipe" />
          <div className="text-center">
            <div
              className="text-5xl font-black tracking-[0.2em]"
              style={{ color: "var(--val-red)", textShadow: "0 0 30px rgba(255,70,85,0.3)" }}
            >
              VS
            </div>
            <div className="mt-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--val-white)]/40">
              Jour {match.day}
            </div>
          </div>
          <TeamBlock team={theirTeam} side="right" label="Adversaire" />
        </div>

        {/* Launch CTA */}
        <div className="mt-6 flex justify-center">
          {nextMatch.daysUntil === 0 ? (
            <Link
              href={`/match-day/${match.id}`}
              className="rounded-md px-10 py-3.5 text-sm font-black uppercase tracking-[0.2em] text-white transition-all hover:scale-105"
              style={{
                background: "var(--val-red)",
                boxShadow: "0 0 32px rgba(255,70,85,0.35)",
              }}
            >
              Lancer la rencontre →
            </Link>
          ) : (
            <div
              className="rounded-md px-10 py-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--val-white)]/40"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              Match jouable {daysLabel.toLowerCase()}
            </div>
          )}
        </div>
      </div>

      {/* Top row — intel + roster */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <IntelPanel intel={intel} opponentName={theirTeam.name} />
        <RosterPanel team={userTeam} />
      </div>

      {/* Plan de jeu — full configurable form */}
      <div className="mt-4">
        <MatchPlanEditor
          matchId={nextMatch.id}
          format={match.format}
          myPlayers={(userTeam?.players ?? []).filter((p) => p.isActive && !p.isReserve)}
          oppPlayers={
            (isUserTeam1
              ? (match as { team2: { players?: { id: string; ign: string; role: string }[] } }).team2.players
              : (match as { team1: { players?: { id: string; ign: string; role: string }[] } }).team1.players) ?? []
          }
        />
      </div>
    </Shell>
  );
}

// ── Shell ──

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>;
}

function Skeleton() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-48 animate-pulse rounded bg-[var(--val-gray)]/40" />
      <div className="h-40 animate-pulse rounded bg-[var(--val-surface)]" />
      <div className="grid grid-cols-3 gap-4">
        <div className="h-60 animate-pulse rounded bg-[var(--val-surface)]" />
        <div className="h-60 animate-pulse rounded bg-[var(--val-surface)]" />
        <div className="h-60 animate-pulse rounded bg-[var(--val-surface)]" />
      </div>
    </div>
  );
}

function ErrorCard({ msg }: { msg: string }) {
  return (
    <div className="rounded-lg border border-[var(--val-red)]/40 bg-[var(--val-surface)] p-6 text-sm text-[var(--val-white)]/80">
      {msg}
    </div>
  );
}

// ── VS banner team block ──

function TeamBlock({
  team,
  side,
  label,
}: {
  team: { name: string; tag: string; region: string };
  side: "left" | "right";
  label: string;
}) {
  return (
    <div className={side === "left" ? "text-right" : "text-left"}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--val-white)]/40">
        {label}
      </div>
      <div className="mt-1 text-3xl font-black uppercase tracking-[0.05em] text-[var(--val-white)]">
        {team.tag}
      </div>
      <div className="mt-0.5 truncate text-sm font-medium text-[var(--val-white)]/70">
        {team.name}
      </div>
      <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--val-gold)]">
        {team.region}
      </div>
    </div>
  );
}

// ── Intel panel ──

function IntelPanel({
  intel,
  opponentName,
}: {
  intel: IntelData;
  opponentName: string;
}) {
  const tierBadge =
    intel.analystTier === "Elite"
      ? { label: "Analyste Elite · Tier 3", color: "var(--val-gold)" }
      : intel.analystTier === "Senior"
      ? { label: "Analyste Senior · Tier 2", color: "var(--val-green)" }
      : intel.analystTier === "Junior"
      ? { label: "Analyste Junior · Tier 1", color: "var(--val-white)" }
      : { label: "Pas d'analyste qualifié", color: "var(--val-red)" };

  return (
    <Panel title="Intel adversaire" accent="var(--val-red)">
      <div
        className="mb-3 inline-flex items-center gap-2 rounded-sm px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.15em]"
        style={{ background: "rgba(255,255,255,0.04)", color: tierBadge.color }}
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: tierBadge.color }} />
        {tierBadge.label}
      </div>

      <Row label="Bilan saison">
        <span className="text-[var(--val-white)]">
          {intel.seasonRecord.wins}–{intel.seasonRecord.losses}
        </span>
      </Row>
      <Row label="Forme récente">
        <span className="flex gap-1">
          {intel.recentForm.sequence.length === 0 ? (
            <span className="text-[var(--val-white)]/40">—</span>
          ) : (
            intel.recentForm.sequence.map((r, i) => (
              <span
                key={i}
                className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-[10px] font-black"
                style={{
                  background: r === "W" ? "rgba(74,230,138,0.12)" : "rgba(255,70,85,0.12)",
                  color: r === "W" ? "var(--val-green)" : "var(--val-red)",
                }}
              >
                {r}
              </span>
            ))
          )}
        </span>
      </Row>

      <TierGated tier={intel.tier} required={1} label="Maps favoris">
        {intel.dominantMaps.length === 0 ? (
          <span className="text-[var(--val-white)]/40">Pas assez de matchs</span>
        ) : (
          <span className="flex flex-wrap gap-1.5">
            {intel.dominantMaps.map((m) => (
              <span
                key={m.mapName}
                className="rounded-sm border border-[var(--val-gray)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--val-white)]"
              >
                {m.mapName} · {m.count}
              </span>
            ))}
          </span>
        )}
      </TierGated>

      <TierGated tier={intel.tier} required={2} label="Joueur clé">
        {intel.keyPlayer ? (
          <span>
            <span className="font-bold text-[var(--val-white)]">{intel.keyPlayer.ign}</span>
            <span className="ml-2 text-[10px] uppercase tracking-[0.1em] text-[var(--val-white)]/50">
              {intel.keyPlayer.role}
            </span>
            <span className="ml-2 text-[var(--val-gold)]">
              {intel.keyPlayer.acs.toFixed(0)} ACS · {intel.keyPlayer.kd.toFixed(2)} K/D
            </span>
          </span>
        ) : (
          <span className="text-[var(--val-white)]/40">—</span>
        )}
      </TierGated>

      {intel.tier >= 3 && intel.strategicProfile && (
        <>
          <Row label="Playstyle">
            <span className="text-[var(--val-white)]">{intel.strategicProfile.playstyle}</span>
          </Row>
          <Row label="Discipline éco">
            <Bar value={intel.strategicProfile.ecoDiscipline} />
          </Row>
          <Row label="Adaptation">
            <Bar value={intel.strategicProfile.adaptationRating} />
          </Row>
        </>
      )}
      {intel.tier < 3 && (
        <TierGated tier={intel.tier} required={3} label="Profil stratégique">
          <span className="text-[var(--val-white)]/40">—</span>
        </TierGated>
      )}

      {intel.tier < 3 && (
        <div className="mt-3 rounded-sm border border-dashed border-[var(--val-gray)] bg-[var(--val-bg)] p-2 text-[10px] uppercase tracking-[0.1em] text-[var(--val-white)]/40">
          {intel.tier === 0
            ? `Recrutez un analyste pour révéler les intel sur ${opponentName}.`
            : intel.tier === 1
            ? "Analyste Senior (60+) → joueur clé révélé."
            : "Analyste Elite (80+) → profil stratégique complet."}
        </div>
      )}
    </Panel>
  );
}

function TierGated({
  tier,
  required,
  label,
  children,
}: {
  tier: 0 | 1 | 2 | 3;
  required: 1 | 2 | 3;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Row label={label}>
      {tier >= required ? (
        children
      ) : (
        <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--val-white)]/30">
          Tier {required} requis
        </span>
      )}
    </Row>
  );
}

// ── Roster panel ──

function RosterPanel({ team }: { team: { id: string; players: RosterPlayer[] } | undefined }) {
  if (!team) return <Panel title="Effectif" accent="var(--val-gold)">—</Panel>;
  const active = team.players.filter((p) => p.isActive && !p.isReserve);
  return (
    <Panel title="Effectif" accent="var(--val-gold)">
      <div className="space-y-2">
        {active.map((p) => (
          <div
            key={p.id}
            className="flex items-center justify-between rounded-sm border border-[var(--val-gray)] bg-[var(--val-bg)] px-3 py-2"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-[var(--val-white)]">{p.ign}</div>
              <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--val-white)]/50">
                {p.role}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-black text-[var(--val-gold)]">
                {(p.overall ?? 0).toFixed(0)}
              </div>
              <div className="text-[9px] uppercase tracking-[0.1em] text-[var(--val-white)]/40">
                OVR
              </div>
            </div>
          </div>
        ))}
        {active.length === 0 && (
          <div className="text-sm text-[var(--val-white)]/40">Aucun joueur actif.</div>
        )}
      </div>
    </Panel>
  );
}

// ── Match Plan editor (full configurable form) ──

type Playstyle = "Aggressive" | "Tactical" | "Defensive";
type SitePref = "A" | "B" | "C" | "VARIED";
type Tempo = "RUSH" | "DEFAULT" | "SLOW";
type DefenseStyle = "AGGRESSIVE" | "HOLD" | "REACTIVE";
type PlayerRole = "entry" | "lurk" | "support" | "awper" | "safe";

interface PlanState {
  playstyle: Playstyle | null;
  sitePref: SitePref | null;
  tempo: Tempo | null;
  defenseStyle: DefenseStyle | null;
  antiStarPlayerId: string | null;
  antiStarAssignedPlayerId: string | null;
  bootcampEnabled: boolean;
  playerRoles: Record<string, string> | null;
}

interface PlanOpponent {
  id: string;
  ign: string;
  role: string;
  acs?: number;
}

function MatchPlanEditor({
  matchId,
  format,
  myPlayers,
  oppPlayers,
}: {
  matchId: string;
  format: string;
  myPlayers: Array<{ id: string; ign: string; role: string }>;
  oppPlayers: PlanOpponent[];
}) {
  const planQ = trpc.match.getPlan.useQuery({ matchId });
  const saveMut = trpc.match.savePlan.useMutation();

  const [plan, setPlan] = useState<PlanState | null>(null);
  const initializedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Seed local state from server once.
  useEffect(() => {
    if (initializedRef.current || !planQ.data) return;
    initializedRef.current = true;
    const d = planQ.data as unknown as Partial<PlanState>;
    setPlan({
      playstyle: (d.playstyle as Playstyle | null) ?? null,
      sitePref: (d.sitePref as SitePref | null) ?? null,
      tempo: (d.tempo as Tempo | null) ?? null,
      defenseStyle: (d.defenseStyle as DefenseStyle | null) ?? null,
      antiStarPlayerId: d.antiStarPlayerId ?? null,
      antiStarAssignedPlayerId: d.antiStarAssignedPlayerId ?? null,
      bootcampEnabled: d.bootcampEnabled ?? false,
      playerRoles: (d.playerRoles as Record<string, string> | null) ?? null,
    });
  }, [planQ.data]);

  // Debounced auto-save.
  function updatePlan(patch: Partial<PlanState>) {
    setPlan((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveMut.mutate({ matchId, ...next });
      }, 400);
      return next;
    });
  }

  if (!plan) {
    return (
      <Panel title="Plan de jeu" accent="var(--val-green)">
        <div className="h-40 animate-pulse rounded bg-[var(--val-bg)]" />
      </Panel>
    );
  }

  return (
    <Panel title="Plan de jeu" accent="var(--val-green)">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[0.15em] text-[var(--val-white)]/50">
          Format · {format}
        </span>
        <span
          className="text-[10px] font-bold uppercase tracking-[0.15em]"
          style={{
            color: saveMut.isPending
              ? "var(--val-gold)"
              : saveMut.isSuccess
              ? "var(--val-green)"
              : "rgba(236,232,225,0.3)",
          }}
        >
          {saveMut.isPending ? "Saving…" : saveMut.isSuccess ? "Saved" : "Auto-save"}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Stratégie offensive */}
        <Section title="Stratégie offensive">
          <FieldRow label="Site prioritaire">
            <SegmentGroup
              value={plan.sitePref}
              options={[
                { id: "A", label: "A" },
                { id: "B", label: "B" },
                { id: "C", label: "C" },
                { id: "VARIED", label: "Varié" },
              ]}
              onChange={(v) => updatePlan({ sitePref: v as SitePref | null })}
            />
          </FieldRow>
          {plan.sitePref && plan.sitePref !== "VARIED" && (
            <div className="-mt-1 mb-2 ml-32 text-[10px] italic text-[var(--val-red)]/70">
              ⚠️ Plus tu insistes sur ce site, plus la défense te lit (+0.02 → +0.07 par round consécutif).
            </div>
          )}
          <FieldRow label="Tempo">
            <SegmentGroup
              value={plan.tempo}
              options={[
                { id: "RUSH", label: "Rush" },
                { id: "DEFAULT", label: "Default" },
                { id: "SLOW", label: "Lent" },
              ]}
              onChange={(v) => updatePlan({ tempo: v as Tempo | null })}
            />
          </FieldRow>
          <div className="-mt-1 ml-32 text-[10px] italic text-[var(--val-white)]/45">
            Rush : +entry, -coordination utility · Lent : +utility, -entry
          </div>
        </Section>

        {/* Stratégie défensive */}
        <Section title="Stratégie défensive">
          <FieldRow label="Style">
            <SegmentGroup
              value={plan.defenseStyle}
              options={[
                { id: "AGGRESSIVE", label: "Agressif" },
                { id: "HOLD", label: "Hold angles" },
                { id: "REACTIVE", label: "Réactif" },
              ]}
              onChange={(v) => updatePlan({ defenseStyle: v as DefenseStyle | null })}
            />
          </FieldRow>
          <FieldRow label="Playstyle global">
            <SegmentGroup
              value={plan.playstyle}
              options={[
                { id: "Aggressive", label: "Aggressive" },
                { id: "Tactical", label: "Tactical" },
                { id: "Defensive", label: "Defensive" },
              ]}
              onChange={(v) => updatePlan({ playstyle: v as Playstyle | null })}
            />
          </FieldRow>
        </Section>
      </div>

      {/* Consignes joueurs */}
      <Section title="Consignes joueurs">
        <div className="space-y-1.5">
          {myPlayers.map((p) => {
            const currentRole = plan.playerRoles?.[p.id] ?? null;
            return (
              <div
                key={p.id}
                className="flex items-center gap-2 rounded-sm border border-[var(--val-gray)] bg-[var(--val-bg)] px-3 py-1.5"
              >
                <span className="w-28 truncate text-sm font-bold text-[var(--val-white)]">
                  {p.ign}
                </span>
                <span className="w-20 text-[10px] uppercase tracking-[0.1em] text-[var(--val-white)]/40">
                  {p.role}
                </span>
                <div className="flex-1">
                  <RoleSegmentGroup
                    value={currentRole as PlayerRole | null}
                    onChange={(role) => {
                      const next = { ...(plan.playerRoles ?? {}) };
                      if (!role) delete next[p.id];
                      else next[p.id] = role;
                      updatePlan({
                        playerRoles: Object.keys(next).length === 0 ? null : next,
                      });
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* Anti-star */}
      <Section title="Anti-star">
        <div className="text-[11px] text-[var(--val-white)]/55 mb-2">
          Double-team un joueur adverse — <span style={{ color: "var(--val-green)" }}>-0.06 sur ses duels</span>, mais{" "}
          <span style={{ color: "var(--val-red)" }}>-0.06 sur le joueur que tu sacrifies</span> (attention divisée).
        </div>

        {/* Target picker (opponent) */}
        <div className="mb-1 text-[10px] uppercase tracking-[0.15em] text-[var(--val-white)]/40">
          Cible adverse
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {oppPlayers.slice(0, 5).map((p) => {
            const isSel = plan.antiStarPlayerId === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  // Toggling target off also clears the assigned sacrifice.
                  if (isSel) {
                    updatePlan({ antiStarPlayerId: null, antiStarAssignedPlayerId: null });
                  } else {
                    updatePlan({ antiStarPlayerId: p.id });
                  }
                }}
                className="rounded-sm border px-2 py-2 text-center transition-all hover:scale-[1.03]"
                style={{
                  background: isSel ? "rgba(255,70,85,0.1)" : "var(--val-bg)",
                  borderColor: isSel ? "rgba(255,70,85,0.4)" : "var(--val-gray)",
                }}
              >
                <div
                  className="truncate text-xs font-black uppercase"
                  style={{ color: isSel ? "var(--val-red)" : "var(--val-white)" }}
                >
                  {p.ign}
                </div>
                <div className="text-[9px] uppercase tracking-[0.1em] text-[var(--val-white)]/40">
                  {p.role}
                </div>
                {p.acs !== undefined && (
                  <div className="mt-0.5 text-[10px] font-bold text-[var(--val-gold)]">
                    {p.acs.toFixed(0)} ACS
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Sacrifice picker (my team) — only visible once a target is set */}
        {plan.antiStarPlayerId && (
          <>
            <div className="mt-3 mb-1 text-[10px] uppercase tracking-[0.15em] text-[var(--val-white)]/40">
              Qui sacrifies-tu pour ce double-team ?
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {myPlayers.map((p) => {
                const isSel = plan.antiStarAssignedPlayerId === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() =>
                      updatePlan({ antiStarAssignedPlayerId: isSel ? null : p.id })
                    }
                    className="rounded-sm border px-2 py-2 text-center transition-all hover:scale-[1.03]"
                    style={{
                      background: isSel ? "rgba(198,155,58,0.1)" : "var(--val-bg)",
                      borderColor: isSel ? "rgba(198,155,58,0.4)" : "var(--val-gray)",
                    }}
                  >
                    <div
                      className="truncate text-xs font-black uppercase"
                      style={{ color: isSel ? "var(--val-gold)" : "var(--val-white)" }}
                    >
                      {p.ign}
                    </div>
                    <div className="text-[9px] uppercase tracking-[0.1em] text-[var(--val-white)]/40">
                      {p.role}
                    </div>
                  </button>
                );
              })}
            </div>
            {!plan.antiStarAssignedPlayerId && (
              <div className="mt-2 text-[10px] italic text-[var(--val-red)]/70">
                ⚠️ Le double-team n'est pas actif tant qu'aucun joueur n'est assigné.
              </div>
            )}
          </>
        )}
      </Section>

      {/* Bootcamp */}
      <Section title="Préparation">
        <button
          type="button"
          onClick={() => updatePlan({ bootcampEnabled: !plan.bootcampEnabled })}
          className="flex w-full items-center gap-3 rounded-sm border px-3 py-2.5 text-left transition-all"
          style={{
            background: plan.bootcampEnabled ? "rgba(74,230,138,0.08)" : "var(--val-bg)",
            borderColor: plan.bootcampEnabled ? "rgba(74,230,138,0.3)" : "var(--val-gray)",
          }}
        >
          <span
            className="flex h-5 w-5 items-center justify-center rounded-sm border-2"
            style={{
              borderColor: plan.bootcampEnabled ? "var(--val-green)" : "rgba(236,232,225,0.3)",
              background: plan.bootcampEnabled ? "var(--val-green)" : "transparent",
            }}
          >
            {plan.bootcampEnabled && (
              <span className="text-[10px] font-black" style={{ color: "var(--val-bg)" }}>
                ✓
              </span>
            )}
          </span>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-[var(--val-white)]">Bootcamp activé</span>
              <span className="rounded-sm px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em]" style={{ background: "rgba(255,70,85,0.12)", color: "var(--val-red)" }}>
                -$80K
              </span>
            </div>
            <div className="text-[10px] text-[var(--val-white)]/50">
              +10 mapPrep / coordination utility — débité du budget au match.
            </div>
          </div>
        </button>
      </Section>
    </Panel>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 first:mt-0">
      <div className="mb-2 text-[10px] font-black uppercase tracking-[0.2em] text-[var(--val-white)]/40">
        {title}
      </div>
      {children}
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-3">
      <span className="w-32 text-[10px] uppercase tracking-[0.15em] text-[var(--val-white)]/50">
        {label}
      </span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function SegmentGroup({
  value,
  options,
  onChange,
}: {
  value: string | null;
  options: Array<{ id: string; label: string }>;
  onChange: (v: string | null) => void;
}) {
  return (
    <div className="flex gap-1">
      {options.map((opt) => {
        const isSel = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(isSel ? null : opt.id)}
            className="flex-1 rounded-sm border px-2 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] transition-all"
            style={{
              background: isSel ? "rgba(198,155,58,0.1)" : "var(--val-bg)",
              borderColor: isSel ? "rgba(198,155,58,0.4)" : "var(--val-gray)",
              color: isSel ? "var(--val-gold)" : "rgba(236,232,225,0.6)",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function RoleSegmentGroup({
  value,
  onChange,
}: {
  value: PlayerRole | null;
  onChange: (v: PlayerRole | null) => void;
}) {
  const roles: { id: PlayerRole; label: string }[] = [
    { id: "entry", label: "Entry" },
    { id: "lurk", label: "Lurk" },
    { id: "support", label: "Support" },
    { id: "awper", label: "AWP" },
    { id: "safe", label: "Safe" },
  ];
  return (
    <div className="flex gap-1">
      {roles.map((r) => {
        const isSel = value === r.id;
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => onChange(isSel ? null : r.id)}
            className="flex-1 rounded-sm border px-1 py-1 text-[9px] font-bold uppercase tracking-[0.08em] transition-all"
            style={{
              background: isSel ? "rgba(198,155,58,0.1)" : "transparent",
              borderColor: isSel ? "rgba(198,155,58,0.4)" : "var(--val-gray)",
              color: isSel ? "var(--val-gold)" : "rgba(236,232,225,0.55)",
            }}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Primitives ──

function Panel({
  title,
  accent,
  children,
}: {
  title: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-[var(--val-gray)] bg-[var(--val-surface)] p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="h-3 w-1 rounded-sm" style={{ background: accent }} />
        <h3 className="text-xs font-black uppercase tracking-[0.2em] text-[var(--val-white)]">
          {title}
        </h3>
      </div>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--val-gray)]/40 py-2 text-sm last:border-b-0">
      <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--val-white)]/50">
        {label}
      </span>
      <span>{children}</span>
    </div>
  );
}

function Bar({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-20 overflow-hidden rounded-sm bg-[var(--val-bg)]">
        <span
          className="block h-full"
          style={{
            width: `${v}%`,
            background: v >= 70 ? "var(--val-green)" : v >= 40 ? "var(--val-gold)" : "var(--val-red)",
          }}
        />
      </span>
      <span className="w-7 text-right text-xs font-bold text-[var(--val-white)]">
        {v.toFixed(0)}
      </span>
    </span>
  );
}
