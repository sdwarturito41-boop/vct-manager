"use client";

import Link from "next/link";
import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { formatCurrency } from "@/lib/format";
import { countryToFlag } from "@/lib/country-flag";
import { D, roleColor } from "@/constants/design";
import { ShortlistButton } from "@/components/ShortlistButton";

/**
 * Recruitment Hub — FM26-inspired single page covering :
 *   - Objectifs du board (rôles à combler, urgences)
 *   - Manques de l'effectif
 *   - Contrats expirants
 *   - Shortlist (scouting actif)
 *   - Agents libres + Marché des transferts
 *
 * Visibilité des stats :
 *   - Joueur NON scouté → nom · rôle · région · âge · salaire (rien d'autre)
 *   - Joueur EN SCOUTING (sur shortlist, pas révélé) → "scouting Xw"
 *   - Joueur SCOUTÉ → stats complètes
 */

type Candidate = {
  id: string;
  ign: string;
  firstName?: string;
  lastName?: string;
  role: string;
  region: string;
  nationality: string;
  age: number;
  salary: number;
  imageUrl: string | null;
  overall: number | null;
  acs: number;
  kd: number;
  kast: number;
  potential: number;
  potentialRevealed: boolean;
  isScoutedByMe: boolean;
  scoutingProgressWeeks: number;
  scoutingTotalWeeks: number;
  buyoutClause?: number;
  team?: { id: string; name: string; tag: string; logoUrl: string | null } | null;
  currentTeam?: string | null;
};

export default function RecruitmentHubPage() {
  const hubQuery = trpc.recruitment.hub.useQuery();
  const data = hubQuery.data;
  const [activeFilter, setActiveFilter] = useState<"ALL" | "FA" | "BUYOUT" | "SHORTLIST">("ALL");

  if (!data) {
    return (
      <div className="p-10 text-sm" style={{ color: D.textMuted }}>
        Chargement du recrutement…
      </div>
    );
  }

  const shortlistCount = data.shortlist.length;
  const scoutedCount = data.shortlist.filter((s) => s.player.isScoutedByMe).length;

  return (
    <div className="flex min-h-full flex-col">
      {/* Hero */}
      <section
        className="relative px-10 pt-8 pb-6"
        style={{ borderBottom: `1px solid ${D.border}` }}
      >
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="text-[11px] font-medium" style={{ color: D.textSubtle }}>
              Centre de recrutement
            </div>
            <h1
              className="mt-1 text-[34px] font-medium leading-none"
              style={{ color: D.textPrimary }}
            >
              Recrutement
            </h1>
            <div
              className="mt-2 flex items-center gap-3 text-[11px]"
              style={{ color: D.textMuted }}
            >
              <span>Enveloppe transferts {formatCurrency(data.team.transferEnvelope)}</span>
              <span>·</span>
              <span>
                Analyste skill {data.team.analystSkill || "—"} · révélation {data.team.revealWeeks} sem
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Métriques rapides */}
      <section
        className="grid grid-cols-4"
        style={{ borderBottom: `1px solid ${D.border}` }}
      >
        <MetricCell
          label="Shortlist"
          value={String(shortlistCount)}
          sub={`${scoutedCount} scouté(s)`}
          accent={D.amber}
        />
        <MetricCell
          label="Agents libres"
          value={String(data.freeAgents.length)}
          sub="Disponibles dans la région"
          accent={D.green}
        />
        <MetricCell
          label="Marché transferts"
          value={String(data.buyoutMarket.length)}
          sub="Joueurs listés"
          accent={D.primary}
        />
        <MetricCell
          label="Contrats expirants"
          value={String(data.expiring.length)}
          sub="Moins de 8 semaines"
          accent={data.expiring.length > 0 ? D.red : D.textSubtle}
          last
        />
      </section>

      {/* Objectifs du board */}
      {data.objectives.length > 0 && (
        <section
          className="px-10 py-6"
          style={{ borderBottom: `1px solid ${D.border}` }}
        >
          <h2
            className="text-[13px] font-medium mb-3"
            style={{ color: D.textPrimary }}
          >
            Objectifs du board
          </h2>
          <div className="grid grid-cols-3 gap-3">
            {data.objectives.map((o, i) => (
              <div
                key={i}
                className="px-4 py-3"
                style={{
                  background: D.card,
                  border: `1px solid ${objectiveBorderColor(o.kind)}`,
                  borderRadius: D.radiusCard,
                }}
              >
                <div
                  className="text-[10px] font-medium uppercase tracking-wider"
                  style={{ color: objectiveColor(o.kind) }}
                >
                  {objectiveKindLabel(o.kind)}
                </div>
                <div
                  className="mt-1 text-[12px]"
                  style={{ color: D.textPrimary }}
                >
                  {o.label}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Manques effectif + contrats expirants côte à côte */}
      <section
        className="grid grid-cols-2 gap-px"
        style={{ backgroundColor: D.border, borderBottom: `1px solid ${D.border}` }}
      >
        <div className="px-10 py-6" style={{ backgroundColor: D.bg }}>
          <h2
            className="text-[13px] font-medium mb-3"
            style={{ color: D.textPrimary }}
          >
            Manques de l'effectif
          </h2>
          <div className="flex flex-col gap-2">
            {data.rosterGaps.map((g) => (
              <div
                key={g.role}
                className="flex items-center justify-between px-3 py-2"
                style={{
                  background: D.card,
                  border: `1px solid ${D.borderFaint}`,
                  borderRadius: D.radiusStat,
                }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                    style={{
                      background: `${roleColor(g.role)}20`,
                      color: roleColor(g.role),
                      borderRadius: D.radiusBadge,
                    }}
                  >
                    {g.role}
                  </span>
                  <span className="text-[11px]" style={{ color: D.textMuted }}>
                    {g.count > 0
                      ? `${g.count} joueur(s) · OVR ${g.avgOverall}`
                      : "Aucun joueur"}
                  </span>
                </div>
                <span
                  className="text-[10px] font-medium uppercase"
                  style={{
                    color:
                      g.status === "MISSING"
                        ? D.red
                        : g.status === "WEAK"
                          ? D.amber
                          : D.green,
                  }}
                >
                  {g.status === "MISSING"
                    ? "Manquant"
                    : g.status === "WEAK"
                      ? "Faible"
                      : "OK"}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="px-10 py-6" style={{ backgroundColor: D.bg }}>
          <h2
            className="text-[13px] font-medium mb-3"
            style={{ color: D.textPrimary }}
          >
            Contrats expirants
          </h2>
          {data.expiring.length === 0 ? (
            <p className="text-[11px]" style={{ color: D.textSubtle }}>
              Aucun contrat n'expire dans les 8 prochaines semaines.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {data.expiring.map((p) => (
                <Link
                  key={p.id}
                  href={`/player/${p.id}`}
                  className="flex items-center justify-between px-3 py-2 transition-colors hover:bg-white/2"
                  style={{
                    background: D.card,
                    border: `1px solid ${D.borderFaint}`,
                    borderRadius: D.radiusStat,
                  }}
                >
                  <div>
                    <div className="text-[12px] font-medium" style={{ color: D.textPrimary }}>
                      {p.ign}
                    </div>
                    <div className="text-[10px]" style={{ color: D.textSubtle }}>
                      {p.role} · OVR {p.overall ?? "—"} · {formatCurrency(p.salary)}/sem
                    </div>
                  </div>
                  <span
                    className="text-[10px] font-medium"
                    style={{ color: p.weeksLeft <= 2 ? D.red : D.amber }}
                  >
                    {p.weeksLeft} sem
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Filtres + listing */}
      <section className="flex flex-col">
        <div
          className="flex items-center gap-2 px-10 py-4"
          style={{ borderBottom: `1px solid ${D.border}` }}
        >
          {(["ALL", "SHORTLIST", "FA", "BUYOUT"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setActiveFilter(k)}
              className="rounded px-3 py-1.5 text-[11px] font-medium transition-colors"
              style={{
                background:
                  activeFilter === k ? "rgba(124,92,252,0.15)" : "transparent",
                color: activeFilter === k ? D.primary : D.textMuted,
                border: `1px solid ${activeFilter === k ? D.primary : D.borderFaint}`,
                borderRadius: D.radiusBadge,
              }}
            >
              {k === "ALL"
                ? "Tous"
                : k === "SHORTLIST"
                  ? `Shortlist · ${shortlistCount}`
                  : k === "FA"
                    ? "Agents libres"
                    : "Marché transferts"}
            </button>
          ))}
        </div>

        {/* SHORTLIST */}
        {(activeFilter === "ALL" || activeFilter === "SHORTLIST") && shortlistCount > 0 && (
          <CandidateSection
            title="Joueurs sous surveillance"
            subtitle="Ta shortlist — les stats se révèlent à mesure que ton analyste les scoute."
            candidates={data.shortlist.map((s) => s.player as Candidate)}
          />
        )}

        {/* AGENTS LIBRES */}
        {(activeFilter === "ALL" || activeFilter === "FA") && (
          <CandidateSection
            title="Agents libres"
            subtitle="Sans Analyste, tu vois juste leur identité — ajoute à la shortlist pour révéler les stats."
            candidates={data.freeAgents as Candidate[]}
          />
        )}

        {/* MARCHÉ TRANSFERTS */}
        {(activeFilter === "ALL" || activeFilter === "BUYOUT") && data.buyoutMarket.length > 0 && (
          <CandidateSection
            title="Marché des transferts"
            subtitle="Joueurs sous contrat mis sur la liste des transferts."
            candidates={data.buyoutMarket as Candidate[]}
          />
        )}
      </section>
    </div>
  );
}

// ─────────────────────────── Subcomponents ───────────────────────────

function CandidateSection({
  title,
  subtitle,
  candidates,
}: {
  title: string;
  subtitle: string;
  candidates: Candidate[];
}) {
  if (candidates.length === 0) {
    return (
      <div
        className="px-10 py-6"
        style={{ borderBottom: `1px solid ${D.border}` }}
      >
        <h2 className="text-[13px] font-medium" style={{ color: D.textPrimary }}>
          {title}
        </h2>
        <p className="mt-1 text-[11px]" style={{ color: D.textSubtle }}>
          Rien à afficher dans cette section.
        </p>
      </div>
    );
  }
  return (
    <div style={{ borderBottom: `1px solid ${D.border}` }}>
      <div className="px-10 pt-6 pb-3">
        <h2 className="text-[13px] font-medium" style={{ color: D.textPrimary }}>
          {title}
        </h2>
        <p className="mt-0.5 text-[10px]" style={{ color: D.textSubtle }}>
          {subtitle}
        </p>
      </div>
      <div>
        {candidates.map((c) => (
          <CandidateRow key={c.id} candidate={c} />
        ))}
      </div>
    </div>
  );
}

function CandidateRow({ candidate }: { candidate: Candidate }) {
  const c = candidate;
  const isScouted = c.isScoutedByMe;
  const isScouting =
    !isScouted && c.scoutingProgressWeeks > 0 && c.scoutingTotalWeeks > 0;
  const weeksLeft = Math.max(0, c.scoutingTotalWeeks - c.scoutingProgressWeeks);

  return (
    <Link
      href={`/player/${c.id}`}
      className="grid items-center gap-3 px-10 py-3 transition-colors hover:bg-white/2"
      style={{
        gridTemplateColumns: "44px 1fr 100px 1fr 120px 120px",
        borderTop: `1px solid ${D.borderFaint}`,
      }}
    >
      {/* Avatar */}
      {c.imageUrl ? (
        <img
          src={c.imageUrl}
          alt={c.ign}
          className="h-9 w-9 rounded-full object-cover"
          style={{ border: `1px solid ${D.borderFaint}` }}
        />
      ) : (
        <div
          className="flex h-9 w-9 items-center justify-center rounded-full"
          style={{
            background: D.card,
            border: `1px solid ${D.borderFaint}`,
          }}
        >
          <span
            className="text-[12px] font-medium"
            style={{ color: D.textMuted }}
          >
            {c.ign.charAt(0).toUpperCase()}
          </span>
        </div>
      )}

      {/* Identité (toujours visible) */}
      <div className="min-w-0 flex flex-col">
        <div className="flex items-center gap-2">
          <span
            className="truncate text-[13px] font-medium"
            style={{ color: D.textPrimary }}
          >
            {c.ign}
          </span>
          <span className="text-[12px]">{countryToFlag(c.nationality)}</span>
          <span className="text-[10px]" style={{ color: D.textSubtle }}>
            {c.age} ans
          </span>
        </div>
        <div className="text-[10px]" style={{ color: D.textSubtle }}>
          {c.region}
          {c.team?.tag && ` · ${c.team.tag}`}
          {!c.team && c.currentTeam && ` · ${c.currentTeam} (libre)`}
        </div>
      </div>

      {/* Rôle */}
      <span
        className="text-[11px] font-medium"
        style={{ color: roleColor(c.role) }}
      >
        {c.role}
      </span>

      {/* Stats — masquées si pas scouté */}
      <div className="flex items-center gap-3 text-[11px] tabular-nums">
        {isScouted ? (
          <>
            <StatChip label="OVR" value={c.overall ?? "—"} color={D.gold} />
            <StatChip label="ACS" value={Math.round(c.acs)} />
            <StatChip label="K/D" value={c.kd.toFixed(2)} />
            <StatChip label="POT" value={c.potential} color={D.primary} />
          </>
        ) : isScouting ? (
          <div className="flex flex-col gap-1 w-full">
            <span className="text-[10px]" style={{ color: D.amber }}>
              Scouting · {weeksLeft} sem restantes
            </span>
            <div
              className="h-1 w-32"
              style={{
                background: "rgba(255,255,255,0.05)",
                borderRadius: D.radiusBadge,
              }}
            >
              <div
                className="h-1"
                style={{
                  width: `${Math.min(100, (c.scoutingProgressWeeks / c.scoutingTotalWeeks) * 100)}%`,
                  background: D.amber,
                  borderRadius: D.radiusBadge,
                }}
              />
            </div>
          </div>
        ) : (
          <span className="text-[10px]" style={{ color: D.textSubtle }}>
            Stats inconnues — ajoute à la shortlist
          </span>
        )}
      </div>

      {/* Salaire / Clause (toujours visibles) */}
      <div className="flex flex-col items-end text-right">
        <span
          className="text-[12px] font-medium tabular-nums"
          style={{ color: D.gold }}
        >
          {formatCurrency(c.salary)}/sem
        </span>
        {c.buyoutClause != null && c.buyoutClause > 0 && (
          <span className="text-[10px] tabular-nums" style={{ color: D.textSubtle }}>
            Clause {formatCurrency(c.buyoutClause)}
          </span>
        )}
      </div>

      {/* Actions */}
      <div
        className="flex items-center justify-end gap-1.5"
        onClick={(e) => e.stopPropagation()}
      >
        <ShortlistButton playerId={c.id} size="sm" />
      </div>
    </Link>
  );
}

function StatChip({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color?: string;
}) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-[9px]" style={{ color: D.textSubtle }}>
        {label}
      </span>
      <span
        className="text-[12px] font-medium tabular-nums"
        style={{ color: color ?? D.textPrimary }}
      >
        {value}
      </span>
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
      style={last ? undefined : { borderRight: `1px solid ${D.borderFaint}` }}
    >
      <span
        className="text-[10px] font-medium uppercase tracking-wider"
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

function objectiveKindLabel(kind: "ROLE_GAP" | "UPGRADE" | "DEPTH"): string {
  switch (kind) {
    case "ROLE_GAP": return "Poste vacant";
    case "UPGRADE": return "Renfort";
    case "DEPTH": return "Profondeur";
  }
}
function objectiveColor(kind: "ROLE_GAP" | "UPGRADE" | "DEPTH"): string {
  switch (kind) {
    case "ROLE_GAP": return D.red;
    case "UPGRADE": return D.amber;
    case "DEPTH": return D.primary;
  }
}
function objectiveBorderColor(kind: "ROLE_GAP" | "UPGRADE" | "DEPTH"): string {
  const c = objectiveColor(kind);
  return `${c}30`;
}
