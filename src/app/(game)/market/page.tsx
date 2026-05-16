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
  // V2 scouting fields
  revealedFields: string[];
  scoutingTier: 0 | 1 | 2 | 3;
  analystTier: "Junior" | "Senior" | "Elite" | null;
  daysUntilNext: number;
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
                Analyste {data.team.analystTier ?? "non assigné"} (skill {data.team.analystSkill || "—"}) ·
                {" "}
                {data.team.analystTier === "Elite"
                  ? "révélation complète 3j"
                  : data.team.analystTier === "Senior"
                    ? "ACS/KD/ADR/KAST/Ovr en 7j"
                    : data.team.analystTier === "Junior"
                      ? "ACS/KD/ADR en 14j"
                      : "rapport indisponible — embauche un Analyste skill ≥ 40"}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Requirements — manager's want list */}
      <RequirementsPanel />

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
                      {p.role} · OVR {typeof p.overall === "number" ? Math.round(p.overall) : "—"} · {formatCurrency(p.salary)}/sem
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

      {/* Stats — masquage per-field selon le tier V2 */}
      <div className="flex items-center gap-3 text-[11px] tabular-nums">
        {(() => {
          const reveal = new Set(c.revealedFields ?? []);
          const canSee = (f: string) => reveal.has(f) || reveal.has("*");
          const tier = c.scoutingTier ?? 0;
          if (tier === 0 && !isScouting) {
            return (
              <span className="text-[10px]" style={{ color: D.textSubtle }}>
                Stats inconnues — ajoute à la shortlist
              </span>
            );
          }
          if (tier === 0 && isScouting) {
            return (
              <div className="flex flex-col gap-1 w-full">
                <span className="text-[10px]" style={{ color: D.amber }}>
                  Analyste {c.analystTier ?? "—"} en cours
                  {c.daysUntilNext > 0 ? ` · ${c.daysUntilNext}j restants` : ""}
                </span>
              </div>
            );
          }
          return (
            <>
              {canSee("overall") && (
                <StatChip
                  label="OVR"
                  value={typeof c.overall === "number" ? Math.round(c.overall) : "—"}
                  color={D.gold}
                />
              )}
              {canSee("acs") && <StatChip label="ACS" value={Math.round(c.acs)} />}
              {canSee("kd") && <StatChip label="K/D" value={c.kd.toFixed(2)} />}
              {canSee("kast") && <StatChip label="KAST" value={`${Math.round(c.kast)}%`} />}
              {canSee("potential") && (
                <StatChip label="POT" value={c.potential} color={D.primary} />
              )}
            </>
          );
        })()}
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

// ── Requirements panel — FM-style "want list" ────────────────────────

function RequirementsPanel() {
  const utils = trpc.useUtils();
  const listQuery = trpc.recruitment.listRequirements.useQuery();
  const createMut = trpc.recruitment.createRequirement.useMutation({
    onSuccess: () => utils.recruitment.listRequirements.invalidate(),
  });
  const deleteMut = trpc.recruitment.deleteRequirement.useMutation({
    onSuccess: () => utils.recruitment.listRequirements.invalidate(),
  });
  const [showForm, setShowForm] = useState(false);
  const [openMatches, setOpenMatches] = useState<string | null>(null);

  const reqs = listQuery.data ?? [];

  return (
    <section className="px-10 py-5" style={{ borderBottom: `1px solid ${D.border}` }}>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className="text-[14px] font-medium" style={{ color: D.textPrimary }}>
            Requirements
          </h2>
          <p className="text-[10px]" style={{ color: D.textSubtle }}>
            Pose un besoin → le système te sort les candidats qui le remplissent.
          </p>
        </div>
        <button
          onClick={() => setShowForm((s) => !s)}
          className="rounded px-3 py-1.5 text-[11px] font-medium transition-colors"
          style={{
            background: showForm ? D.surface : D.primary,
            color: showForm ? D.textPrimary : "#fff",
            border: `1px solid ${showForm ? D.border : D.primary}`,
          }}
        >
          {showForm ? "Annuler" : "+ Nouveau besoin"}
        </button>
      </div>

      {showForm && (
        <RequirementForm
          onSubmit={(payload) => {
            createMut.mutate(payload, {
              onSuccess: () => setShowForm(false),
            });
          }}
          pending={createMut.isPending}
        />
      )}

      {reqs.length === 0 && !showForm ? (
        <p className="py-3 text-center text-[11px]" style={{ color: D.textSubtle }}>
          Aucun besoin actif. Crée-en un pour que le système te suggère des candidats ciblés.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {reqs.map((r) => (
            <RequirementRow
              key={r.id}
              req={r}
              isOpen={openMatches === r.id}
              onToggle={() => setOpenMatches(openMatches === r.id ? null : r.id)}
              onDelete={() => deleteMut.mutate({ id: r.id })}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function RequirementForm({
  onSubmit,
  pending,
}: {
  onSubmit: (payload: {
    label: string;
    role?: "IGL" | "Duelist" | "Initiator" | "Sentinel" | "Controller" | "Flex";
    region?: "EMEA" | "Americas" | "Pacific" | "China";
    minOverall?: number;
    maxSalary?: number;
  }) => void;
  pending: boolean;
}) {
  const [label, setLabel] = useState("");
  const [role, setRole] = useState<string>("");
  const [region, setRegion] = useState<string>("");
  const [minOverall, setMinOverall] = useState("");
  const [maxSalary, setMaxSalary] = useState("");

  return (
    <div
      className="mb-3 flex flex-col gap-2 rounded p-3"
      style={{ background: D.card, border: `1px solid ${D.borderFaint}` }}
    >
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder='Description ("Remplacer marteen", "Depth Duelist EMEA"…)'
        className="rounded px-2 py-1.5 text-[12px]"
        style={{ background: D.surface, color: D.textPrimary, border: `1px solid ${D.borderFaint}` }}
      />
      <div className="grid grid-cols-4 gap-2">
        <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded px-2 py-1.5 text-[11px]" style={{ background: D.surface, color: D.textPrimary, border: `1px solid ${D.borderFaint}` }}>
          <option value="">Tous rôles</option>
          {["IGL", "Duelist", "Initiator", "Sentinel", "Controller", "Flex"].map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select value={region} onChange={(e) => setRegion(e.target.value)} className="rounded px-2 py-1.5 text-[11px]" style={{ background: D.surface, color: D.textPrimary, border: `1px solid ${D.borderFaint}` }}>
          <option value="">Toutes régions</option>
          {["EMEA", "Americas", "Pacific", "China"].map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <input
          type="number"
          value={minOverall}
          onChange={(e) => setMinOverall(e.target.value)}
          placeholder="Overall min"
          className="rounded px-2 py-1.5 text-[11px]"
          style={{ background: D.surface, color: D.textPrimary, border: `1px solid ${D.borderFaint}` }}
        />
        <input
          type="number"
          value={maxSalary}
          onChange={(e) => setMaxSalary(e.target.value)}
          placeholder="Salaire max ($/sem)"
          className="rounded px-2 py-1.5 text-[11px]"
          style={{ background: D.surface, color: D.textPrimary, border: `1px solid ${D.borderFaint}` }}
        />
      </div>
      <button
        onClick={() => {
          if (label.trim().length < 2) return;
          onSubmit({
            label: label.trim(),
            role: role ? (role as "Duelist") : undefined,
            region: region ? (region as "EMEA") : undefined,
            minOverall: minOverall ? parseInt(minOverall, 10) : undefined,
            maxSalary: maxSalary ? parseInt(maxSalary, 10) : undefined,
          });
        }}
        disabled={pending || label.trim().length < 2}
        className="self-end rounded px-3 py-1.5 text-[11px] font-medium"
        style={{ background: D.primary, color: "#fff", opacity: pending ? 0.5 : 1 }}
      >
        {pending ? "…" : "Créer"}
      </button>
    </div>
  );
}

function RequirementRow({
  req,
  isOpen,
  onToggle,
  onDelete,
}: {
  req: {
    id: string;
    label: string;
    role: string | null;
    region: string | null;
    minOverall: number | null;
    maxSalary: number | null;
  };
  isOpen: boolean;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const matchesQuery = trpc.recruitment.requirementMatches.useQuery(
    { id: req.id },
    { enabled: isOpen },
  );
  const filterChips: string[] = [];
  if (req.role) filterChips.push(req.role);
  if (req.region) filterChips.push(req.region);
  if (req.minOverall != null) filterChips.push(`OVR ≥ ${req.minOverall}`);
  if (req.maxSalary != null) filterChips.push(`≤ ${formatCurrency(req.maxSalary)}/sem`);

  return (
    <div className="rounded" style={{ background: D.card, border: `1px solid ${D.borderFaint}` }}>
      <div className="flex items-center gap-3 px-3 py-2">
        <button
          onClick={onToggle}
          className="flex-1 text-left text-[12px] font-medium"
          style={{ color: D.textPrimary }}
        >
          <div className="flex items-center gap-2">
            <span>{isOpen ? "▾" : "▸"}</span>
            <span>{req.label}</span>
          </div>
          {filterChips.length > 0 && (
            <div className="mt-0.5 flex flex-wrap gap-1.5 text-[9px]" style={{ color: D.textSubtle }}>
              {filterChips.map((c) => (
                <span key={c} className="rounded px-1.5 py-0.5" style={{ background: D.surface }}>
                  {c}
                </span>
              ))}
            </div>
          )}
        </button>
        <button
          onClick={onDelete}
          className="text-[10px]"
          style={{ color: D.textSubtle }}
        >
          ✕
        </button>
      </div>
      {isOpen && (
        <div className="border-t px-3 py-2" style={{ borderColor: D.borderFaint }}>
          {matchesQuery.isLoading ? (
            <p className="text-[10px]" style={{ color: D.textSubtle }}>Recherche…</p>
          ) : (matchesQuery.data ?? []).length === 0 ? (
            <p className="text-[10px]" style={{ color: D.textSubtle }}>
              Aucun candidat ne remplit ces critères pour le moment.
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {(matchesQuery.data ?? []).map((c) => (
                <Link
                  key={c.id}
                  href={`/player/${c.id}`}
                  className="flex items-center justify-between rounded px-2 py-1.5 text-[11px] hover:bg-white/5"
                >
                  <span className="flex items-center gap-2">
                    <span style={{ color: D.textPrimary, fontWeight: 500 }}>{c.ign}</span>
                    <span style={{ color: roleColor(c.role) }}>{c.role}</span>
                    <span style={{ color: D.textSubtle }}>· {c.region}</span>
                    {c.team?.tag && <span style={{ color: D.textSubtle }}>· {c.team.tag}</span>}
                  </span>
                  <span className="flex items-center gap-2 tabular-nums">
                    {c.isShortlisted && (
                      <span className="rounded px-1 text-[9px]" style={{ background: "rgba(74,144,217,0.15)", color: D.primary }}>scouté</span>
                    )}
                    <span style={{ color: D.gold }}>{formatCurrency(c.salary)}/sem</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
