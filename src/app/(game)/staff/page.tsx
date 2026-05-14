"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { formatCurrency } from "@/lib/format";
import { D } from "@/constants/design";
import {
  STAFF_SKILL_LABELS,
  STAFF_ROLE_LABELS,
  ALL_STAFF_ROLES,
} from "@/constants/staff";
import type { StaffRole } from "@/generated/prisma/client";

type SlotInfo = {
  current: number;
  min: number;
  max: number;
  canHire: boolean;
  canFireLast: boolean;
};

type StaffRow = {
  id: string;
  name: string;
  role: StaffRole;
  region: string;
  nationality: string;
  age: number;
  salary: number;
  skill1: number;
  skill2: number;
  skill3: number;
  contractEndSeason: number;
  contractEndWeek: number;
};

type MarketOffer = {
  id: string;
  name: string;
  role: StaffRole;
  region: string;
  age: number;
  salary: number;
  skill1: number;
  skill2: number;
  skill3: number;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function avgSkill(s: { skill1: number; skill2: number; skill3: number }): number {
  return Math.round((s.skill1 + s.skill2 + s.skill3) / 3);
}

function skillColor(value: number): string {
  if (value >= 80) return D.green;
  if (value >= 60) return D.primary;
  if (value >= 40) return D.textPrimary;
  return D.textSubtle;
}

export default function StaffPage() {
  const utils = trpc.useUtils();
  const mineQuery = trpc.staff.listMine.useQuery();
  const data = mineQuery.data;

  const fireMut = trpc.staff.fire.useMutation({
    onSuccess: () => utils.staff.listMine.invalidate(),
  });
  const hireMut = trpc.staff.hire.useMutation({
    onSuccess: () => {
      utils.staff.listMine.invalidate();
    },
  });

  const [expandedRole, setExpandedRole] = useState<StaffRole | null>(null);

  if (!data) {
    return (
      <div className="p-10 text-sm" style={{ color: D.textMuted }}>
        Chargement du staff…
      </div>
    );
  }

  const totalWeeklyWage = data.staff.reduce((s, st) => s + st.salary, 0);
  const totalCount = data.staff.length;

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
              Équipe d'encadrement
            </div>
            <h1
              className="mt-1 text-[34px] font-medium leading-none"
              style={{ color: D.textPrimary }}
            >
              Staff
            </h1>
            <div
              className="mt-2 flex items-center gap-3 text-[11px]"
              style={{ color: D.textMuted }}
            >
              <span>{totalCount} sous contrat</span>
              <span>·</span>
              <span style={{ color: D.gold }}>
                {formatCurrency(totalWeeklyWage)}/sem
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Slot summary */}
      <section
        className="grid grid-cols-4"
        style={{ borderBottom: `1px solid ${D.border}` }}
      >
        {ALL_STAFF_ROLES.map((role, idx) => {
          const slot = data.slots[role];
          const required = slot.min > 0;
          const full = slot.current >= slot.max;
          return (
            <div
              key={role}
              className="flex flex-col gap-1 px-6 py-5"
              style={
                idx === 3
                  ? undefined
                  : { borderRight: `1px solid ${D.borderFaint}` }
              }
            >
              <span
                className="text-[10px] font-medium"
                style={{ color: D.textSubtle }}
              >
                {STAFF_ROLE_LABELS[role]}
              </span>
              <span
                className="text-[22px] font-medium tabular-nums"
                style={{ color: full ? D.green : D.textPrimary }}
              >
                {slot.current}/{slot.max}
              </span>
              <span className="text-[10px]" style={{ color: D.textSubtle }}>
                {required ? `Min. ${slot.min} requis` : "Optionnel"}
                {full && " · poste plein"}
              </span>
            </div>
          );
        })}
      </section>

      {/* Per-role sections */}
      <section className="flex flex-col">
        {ALL_STAFF_ROLES.map((role) => {
          const roleStaff = data.staff.filter((s) => s.role === role);
          const slot = data.slots[role];
          const isExpanded = expandedRole === role;
          return (
            <div
              key={role}
              className="flex flex-col px-10 py-6"
              style={{ borderBottom: `1px solid ${D.border}` }}
            >
              <div className="flex items-center justify-between mb-4">
                <h2
                  className="text-[16px] font-medium"
                  style={{ color: D.textPrimary }}
                >
                  {STAFF_ROLE_LABELS[role]}
                  <span
                    className="ml-2 text-[12px] font-normal"
                    style={{ color: D.textSubtle }}
                  >
                    {roleStaff.length}/{slot.max}
                  </span>
                </h2>
                <button
                  disabled={!slot.canHire}
                  onClick={() => setExpandedRole(isExpanded ? null : role)}
                  className="rounded px-3 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-30"
                  style={{
                    background: slot.canHire ? D.primary : "transparent",
                    color: "white",
                    border: `1px solid ${slot.canHire ? D.primary : D.borderFaint}`,
                  }}
                >
                  {slot.canHire ? (isExpanded ? "Masquer le marché" : "Voir le marché") : "Poste plein"}
                </button>
              </div>

              {/* Current hires */}
              {roleStaff.length === 0 ? (
                <div
                  className="p-4 text-[11px]"
                  style={{
                    color: D.textSubtle,
                    background: D.card,
                    border: `1px solid ${D.borderFaint}`,
                    borderRadius: D.radiusStat,
                  }}
                >
                  {slot.min > 0
                    ? "Poste vide — minimum requis non atteint."
                    : "Poste optionnel — actuellement vacant."}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {roleStaff.map((s) => (
                    <StaffCard
                      key={s.id}
                      staff={s as StaffRow}
                      canFire={slot.canFireLast}
                      onFire={() => fireMut.mutate({ staffId: s.id })}
                      firePending={fireMut.isPending}
                    />
                  ))}
                </div>
              )}

              {/* Market when expanded */}
              {isExpanded && (
                <MarketSection
                  role={role}
                  onHire={(offer) =>
                    hireMut.mutate({
                      name: offer.name,
                      role: offer.role,
                      region: offer.region,
                      age: offer.age,
                      salary: offer.salary,
                      skill1: offer.skill1,
                      skill2: offer.skill2,
                      skill3: offer.skill3,
                    })
                  }
                  hirePending={hireMut.isPending}
                />
              )}

              {hireMut.error && expandedRole === role && (
                <p className="mt-2 text-[10px]" style={{ color: D.red }}>
                  {hireMut.error.message}
                </p>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}

function StaffCard({
  staff,
  canFire,
  onFire,
  firePending,
}: {
  staff: StaffRow;
  canFire: boolean;
  onFire: () => void;
  firePending: boolean;
}) {
  const labels = STAFF_SKILL_LABELS[staff.role];
  return (
    <div
      className="flex flex-col gap-3 p-4"
      style={{
        background: D.card,
        border: `1px solid ${D.borderFaint}`,
        borderRadius: D.radiusCard,
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-full"
          style={{
            background: "rgba(255,255,255,0.05)",
            border: `1px solid ${D.borderFaint}`,
          }}
        >
          <span
            className="text-[14px] font-medium"
            style={{ color: D.textPrimary }}
          >
            {initials(staff.name)}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="truncate text-[14px] font-medium"
            style={{ color: D.textPrimary }}
          >
            {staff.name}
          </div>
          <div className="text-[11px]" style={{ color: D.textSubtle }}>
            {staff.nationality} · {staff.age} ans
          </div>
          <div className="text-[11px] tabular-nums mt-0.5" style={{ color: D.gold }}>
            {formatCurrency(staff.salary)}/sem
          </div>
        </div>
        <button
          disabled={!canFire || firePending}
          onClick={onFire}
          title={!canFire ? "Impossible — minimum requis pour ce rôle" : "Licencier"}
          className="rounded px-2 py-1 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-30"
          style={{
            background: canFire ? "rgba(255,80,80,0.10)" : "transparent",
            color: D.red,
            border: `1px solid ${canFire ? "rgba(255,80,80,0.25)" : D.borderFaint}`,
          }}
        >
          Licencier
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <SkillCell label={labels[0]} value={staff.skill1} />
        <SkillCell label={labels[1]} value={staff.skill2} />
        <SkillCell label={labels[2]} value={staff.skill3} />
      </div>
    </div>
  );
}

function MarketSection({
  role,
  onHire,
  hirePending,
}: {
  role: StaffRole;
  onHire: (offer: MarketOffer) => void;
  hirePending: boolean;
}) {
  const marketQ = trpc.staff.listMarket.useQuery({ role });
  const offers = marketQ.data ?? [];
  return (
    <div className="mt-4 flex flex-col gap-2">
      <div
        className="text-[10px] font-medium uppercase tracking-wider"
        style={{ color: D.textSubtle }}
      >
        Candidats disponibles · {STAFF_ROLE_LABELS[role]}
      </div>
      {offers.length === 0 ? (
        <p className="text-[10px]" style={{ color: D.textSubtle }}>
          Chargement du marché…
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {offers.map((o) => (
            <MarketCard
              key={o.id}
              offer={o as MarketOffer}
              onHire={() => onHire(o as MarketOffer)}
              pending={hirePending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MarketCard({
  offer,
  onHire,
  pending,
}: {
  offer: MarketOffer;
  onHire: () => void;
  pending: boolean;
}) {
  const labels = STAFF_SKILL_LABELS[offer.role];
  const avg = avgSkill(offer);
  return (
    <div
      className="flex items-center gap-3 p-3"
      style={{
        background: D.card,
        border: `1px solid ${D.borderFaint}`,
        borderRadius: D.radiusStat,
      }}
    >
      <div className="flex-1 min-w-0">
        <div
          className="truncate text-[13px] font-medium"
          style={{ color: D.textPrimary }}
        >
          {offer.name}
        </div>
        <div className="text-[10px]" style={{ color: D.textSubtle }}>
          {offer.region} · {offer.age} ans
        </div>
        <div className="flex items-center gap-2 mt-1 text-[10px]" style={{ color: D.textSubtle }}>
          <span title={labels[0]} style={{ color: skillColor(offer.skill1) }}>
            {offer.skill1}
          </span>
          <span style={{ color: D.borderFaint }}>·</span>
          <span title={labels[1]} style={{ color: skillColor(offer.skill2) }}>
            {offer.skill2}
          </span>
          <span style={{ color: D.borderFaint }}>·</span>
          <span title={labels[2]} style={{ color: skillColor(offer.skill3) }}>
            {offer.skill3}
          </span>
          <span style={{ color: D.borderFaint }}>·</span>
          <span style={{ color: D.textMuted }}>moy. {avg}</span>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span
          className="text-[12px] tabular-nums font-medium"
          style={{ color: D.gold }}
        >
          {formatCurrency(offer.salary)}/sem
        </span>
        <button
          disabled={pending}
          onClick={onHire}
          className="rounded px-2.5 py-1 text-[10px] font-medium transition-colors disabled:opacity-40"
          style={{
            background: D.primary,
            color: "white",
          }}
        >
          {pending ? "…" : "Recruter"}
        </button>
      </div>
    </div>
  );
}

function SkillCell({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="flex flex-col gap-1 p-2"
      style={{
        background: "rgba(255,255,255,0.02)",
        borderRadius: D.radiusStat,
      }}
    >
      <div className="text-[9px]" style={{ color: D.textSubtle }}>
        {label}
      </div>
      <div className="flex items-baseline justify-between">
        <span
          className="text-[16px] font-medium tabular-nums"
          style={{ color: skillColor(value) }}
        >
          {value}
        </span>
      </div>
      <div
        className="h-0.5"
        style={{ background: "rgba(255,255,255,0.05)" }}
      >
        <div
          className="h-full"
          style={{
            width: `${value}%`,
            background: skillColor(value),
          }}
        />
      </div>
    </div>
  );
}
