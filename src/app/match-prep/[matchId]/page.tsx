"use client";

import { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc-client";

export default function MatchPrepPage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = use(params);
  const router = useRouter();

  const matchQ = trpc.match.getById.useQuery({ matchId });
  const teamQ = trpc.team.get.useQuery();
  const intelQ = trpc.match.scoutNextOpponent.useQuery({ matchId });

  if (matchQ.isLoading || teamQ.isLoading || intelQ.isLoading) {
    return <PrepShell><Skeleton /></PrepShell>;
  }
  if (matchQ.error || !matchQ.data) {
    return <PrepShell><ErrorCard msg={matchQ.error?.message ?? "Match introuvable."} /></PrepShell>;
  }
  if (intelQ.error || !intelQ.data) {
    return <PrepShell><ErrorCard msg={intelQ.error?.message ?? "Intel indisponible."} /></PrepShell>;
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
  const userTeam = teamQ.data as ({ id: string } & RosterTeam) | undefined;
  const intel = intelQ.data as IntelData;
  const isUserTeam1 = userTeam?.id === match.team1Id;
  const ourTeam = isUserTeam1 ? match.team1 : match.team2;
  const theirTeam = isUserTeam1 ? match.team2 : match.team1;

  return (
    <PrepShell>
      {/* Back link */}
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-[var(--val-white)]/40 transition-colors hover:text-[var(--val-red)]"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Retour au dashboard
      </Link>

      {/* Stage banner */}
      <div className="mt-6 text-center text-[10px] font-semibold uppercase tracking-[0.3em] text-[var(--val-white)]/40">
        {match.stageId.replace(/_/g, " ")} · {match.format} · Match prep
      </div>

      {/* VS banner */}
      <div className="mt-4 rounded-lg border border-[var(--val-gray)] bg-[var(--val-surface)] p-10">
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
      </div>

      {/* Three-column prep board */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <IntelPanel intel={intel} opponentName={theirTeam.name} />
        <RosterPanel team={userTeam} />
        <GamePlanPanel matchId={matchId} format={match.format} />
      </div>

      {/* Bottom CTA */}
      <div className="mt-8 flex items-center justify-between rounded-lg border border-[var(--val-gray)] bg-[var(--val-surface)] p-6">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--val-white)]/40">
            Prêt à entrer en serveur
          </div>
          <div className="mt-1 text-lg font-bold text-[var(--val-white)]">
            Lancement de la rencontre — veto, agents, timeout.
          </div>
        </div>
        <button
          type="button"
          onClick={() => router.push(`/match-day/${matchId}`)}
          className="rounded-md px-8 py-4 text-sm font-black uppercase tracking-[0.2em] text-white transition-all hover:scale-105"
          style={{
            background: "var(--val-red)",
            boxShadow: "0 0 40px rgba(255,70,85,0.35)",
          }}
        >
          Démarrer →
        </button>
      </div>
    </PrepShell>
  );
}

// ── Shell ──

function PrepShell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-6xl px-6 py-10">{children}</div>;
}

function Skeleton() {
  return (
    <div className="space-y-4">
      <div className="h-6 w-32 animate-pulse rounded bg-[var(--val-gray)]/40" />
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

// ── Intel panel (tier-gated) ──

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

      {/* Always visible: form */}
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

      {/* Tier 1+: map preference */}
      <TierGated tier={intel.tier} required={1}>
        <Row label="Maps favoris">
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
        </Row>
      </TierGated>

      {/* Tier 2+: key player */}
      <TierGated tier={intel.tier} required={2}>
        <Row label="Joueur clé">
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
        </Row>
      </TierGated>

      {/* Tier 3: full strategic profile */}
      <TierGated tier={intel.tier} required={3}>
        {intel.strategicProfile && (
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
      </TierGated>

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
  children,
}: {
  tier: 0 | 1 | 2 | 3;
  required: 1 | 2 | 3;
  children: React.ReactNode;
}) {
  if (tier >= required) return <>{children}</>;
  return (
    <Row label={required === 1 ? "Maps favoris" : required === 2 ? "Joueur clé" : "Profil stratégique"}>
      <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--val-white)]/30">
        Tier {required} requis
      </span>
    </Row>
  );
}

// ── Roster panel ──

interface RosterPlayer {
  id: string;
  ign: string;
  role: string;
  overall: number | null;
  isActive: boolean;
  isReserve: boolean;
}
interface RosterTeam {
  players: RosterPlayer[];
}

function RosterPanel({ team }: { team: RosterTeam | undefined }) {
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

// ── Game plan panel (placeholder for future levers) ──

function GamePlanPanel({ matchId, format }: { matchId: string; format: string }) {
  const steps: { label: string; status: "pending" | "available" }[] = [
    { label: "Veto des maps", status: "available" },
    { label: "Choix des agents", status: "available" },
    { label: "Side picks (atk/def)", status: "available" },
    { label: "Timeout tactique", status: "available" },
  ];
  return (
    <Panel title="Plan de jeu" accent="var(--val-green)">
      <div className="mb-2 text-[10px] uppercase tracking-[0.1em] text-[var(--val-white)]/50">
        Format · {format}
      </div>
      <div className="space-y-1.5">
        {steps.map((s, i) => (
          <div
            key={s.label}
            className="flex items-center gap-2 rounded-sm border border-[var(--val-gray)] bg-[var(--val-bg)] px-3 py-2"
          >
            <span className="text-[10px] font-mono text-[var(--val-white)]/40">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="flex-1 text-sm text-[var(--val-white)]">{s.label}</span>
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background:
                  s.status === "available" ? "var(--val-green)" : "var(--val-white)",
                opacity: s.status === "available" ? 1 : 0.3,
              }}
            />
          </div>
        ))}
      </div>
      <Link
        href={`/match-day/${matchId}`}
        className="mt-4 block rounded-sm border border-[var(--val-gray)] bg-[var(--val-bg)] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--val-white)]/70 transition-colors hover:border-[var(--val-green)] hover:text-[var(--val-green)]"
      >
        Configurer dans le match-day →
      </Link>
    </Panel>
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
