"use client";

import { trpc } from "@/lib/trpc-client";
import { formatGameDate, formatGameDateLong } from "@/lib/game-date";
import { D } from "@/constants/design";

/**
 * Page Saison — récap chronologique de la saison VCT :
 *   1. Kickoff (top 3 par région)
 *   2. Masters 1 (finalistes)
 *   3. Stage 1 (top 3 par région)
 *   4. Qualifiés EWC (par région)
 *   5. Masters 2 (finalistes)
 *   6. Qualifiés Champions (par région)
 *   7. Champions (finalistes)
 *   8. EWC (finalistes)
 *
 * Les sections vides sont omises au fur et à mesure que la saison se déroule.
 */
type TeamMini = {
  id: string;
  name: string;
  tag: string;
  logoUrl: string | null;
  region: string;
};

type Section =
  | { kind: "REGIONAL_PODIUM"; title: string; regions: Record<string, TeamMini[]> }
  | { kind: "INTERNATIONAL_FINAL"; title: string; city: string | null; finalists: TeamMini[] }
  | { kind: "QUALIFIERS"; title: string; subtitle: string; regions: Record<string, TeamMini[]> };

const ALL_REGIONS = ["EMEA", "Americas", "Pacific", "China"] as const;

export default function SeasonPage() {
  const seasonQ = trpc.season.getCurrent.useQuery();
  const recapQ = trpc.season.recap.useQuery();

  const season = seasonQ.data;
  const recap = recapQ.data;

  if (!season) {
    return (
      <div className="p-10 text-sm" style={{ color: D.textMuted }}>
        Chargement de la saison…
      </div>
    );
  }

  const sections = (recap?.sections ?? []) as Section[];

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
              Calendrier VCT {season.year}
            </div>
            <h1
              className="mt-1 text-[34px] font-medium leading-none"
              style={{ color: D.textPrimary }}
            >
              Saison {season.number}
            </h1>
            <div
              className="mt-2 flex items-center gap-3 text-[11px]"
              style={{ color: D.textMuted }}
            >
              <span>{formatGameDateLong(season.currentDay, season.year)}</span>
              <span>·</span>
              <span>Stage {season.currentStage}</span>
            </div>
          </div>
          <div className="text-right">
            <div
              className="text-[28px] font-medium tabular-nums"
              style={{ color: D.textPrimary }}
            >
              {formatGameDate(season.currentDay, season.year)}
            </div>
            <div className="text-[10px]" style={{ color: D.textSubtle }}>
              Day {season.currentDay} · Week {season.currentWeek}
            </div>
          </div>
        </div>
      </section>

      {sections.length === 0 ? (
        <section className="px-10 py-12 text-center">
          <p className="text-[12px]" style={{ color: D.textSubtle }}>
            La saison vient de commencer — aucun stage n'est encore terminé.
            Reviens après le Kickoff pour voir les premiers podiums.
          </p>
        </section>
      ) : (
        sections.map((s, idx) => (
          <SectionRenderer key={idx} section={s} />
        ))
      )}
    </div>
  );
}

function SectionRenderer({ section }: { section: Section }) {
  if (section.kind === "REGIONAL_PODIUM") {
    return (
      <section
        className="px-10 py-6"
        style={{ borderBottom: `1px solid ${D.border}` }}
      >
        <h2 className="text-[16px] font-medium mb-4" style={{ color: D.textPrimary }}>
          {section.title}
        </h2>
        <div className="grid grid-cols-4 gap-3">
          {ALL_REGIONS.map((reg) => (
            <RegionPodiumCard
              key={reg}
              region={reg}
              podium={section.regions[reg] ?? []}
              max={3}
            />
          ))}
        </div>
      </section>
    );
  }

  if (section.kind === "INTERNATIONAL_FINAL") {
    return (
      <section
        className="px-10 py-6"
        style={{ borderBottom: `1px solid ${D.border}` }}
      >
        <div className="flex items-baseline gap-3 mb-4">
          <h2 className="text-[16px] font-medium" style={{ color: D.textPrimary }}>
            {section.title}
          </h2>
          {section.city && (
            <span className="text-[11px]" style={{ color: D.textSubtle }}>
              · Finale internationale
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 max-w-2xl">
          {section.finalists.map((t, i) => (
            <FinalistCard key={t.id} rank={i + 1} team={t} />
          ))}
        </div>
      </section>
    );
  }

  if (section.kind === "QUALIFIERS") {
    return (
      <section
        className="px-10 py-6"
        style={{ borderBottom: `1px solid ${D.border}` }}
      >
        <div className="flex items-baseline gap-3 mb-4">
          <h2 className="text-[16px] font-medium" style={{ color: D.textPrimary }}>
            {section.title}
          </h2>
          <span className="text-[11px]" style={{ color: D.textSubtle }}>
            · {section.subtitle}
          </span>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {ALL_REGIONS.map((reg) => (
            <RegionPodiumCard
              key={reg}
              region={reg}
              podium={section.regions[reg] ?? []}
              max={5}
              showRank={false}
            />
          ))}
        </div>
      </section>
    );
  }

  return null;
}

function RegionPodiumCard({
  region,
  podium,
  max,
  showRank = true,
}: {
  region: string;
  podium: TeamMini[];
  max: number;
  showRank?: boolean;
}) {
  return (
    <div
      className="flex flex-col p-4"
      style={{
        background: D.card,
        border: `1px solid ${D.borderFaint}`,
        borderRadius: D.radiusCard,
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <span
          className="text-[10px] font-medium uppercase tracking-wider"
          style={{ color: D.textSubtle }}
        >
          {region}
        </span>
        <span className="text-[10px] tabular-nums" style={{ color: D.textSubtle }}>
          {podium.length}/{max}
        </span>
      </div>
      {podium.length === 0 ? (
        <p className="text-[10px]" style={{ color: D.textSubtle }}>
          —
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {podium.slice(0, max).map((t, i) => (
            <TeamRow key={t.id} team={t} rank={showRank ? i + 1 : null} compact />
          ))}
        </div>
      )}
    </div>
  );
}

function FinalistCard({ rank, team }: { rank: number; team: TeamMini }) {
  const medalColor = rank === 1 ? D.gold : "#c0c0c0";
  const medalLabel = rank === 1 ? "🥇" : "🥈";
  return (
    <div
      className="flex items-center gap-3 p-4"
      style={{
        background: D.card,
        border: `1px solid ${rank === 1 ? `${medalColor}40` : D.borderFaint}`,
        borderRadius: D.radiusCard,
      }}
    >
      <span
        className="text-[24px] tabular-nums w-9 text-center"
        style={{ color: medalColor }}
      >
        {medalLabel}
      </span>
      {team.logoUrl ? (
        <img
          src={team.logoUrl}
          alt={team.name}
          className="h-10 w-10 object-contain"
        />
      ) : (
        <div
          className="flex h-10 w-10 items-center justify-center rounded-full"
          style={{
            background: D.surface,
            border: `1px solid ${D.borderFaint}`,
            color: D.textMuted,
            fontSize: 11,
            fontWeight: 500,
          }}
        >
          {team.tag.slice(0, 3)}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div
          className="truncate text-[15px] font-medium"
          style={{ color: D.textPrimary }}
        >
          {team.name}
        </div>
        <div className="text-[11px]" style={{ color: D.textSubtle }}>
          {team.region}
        </div>
      </div>
    </div>
  );
}

function TeamRow({
  team,
  rank,
  compact,
}: {
  team: TeamMini;
  rank: number | null;
  compact?: boolean;
}) {
  return (
    <div
      className="flex items-center gap-2"
      style={{
        padding: compact ? 4 : 8,
        background: "rgba(255,255,255,0.02)",
        borderRadius: D.radiusBadge,
      }}
    >
      {rank !== null && (
        <span
          className="text-[10px] font-medium tabular-nums w-4 text-center"
          style={{
            color: rank === 1 ? D.gold : rank === 2 ? "#c0c0c0" : "#cd7f32",
          }}
        >
          {rank}
        </span>
      )}
      {team.logoUrl ? (
        <img
          src={team.logoUrl}
          alt={team.name}
          className="h-5 w-5 object-contain"
        />
      ) : (
        <div
          className="flex h-5 w-5 items-center justify-center rounded-full"
          style={{
            background: D.surface,
            color: D.textMuted,
            fontSize: 8,
          }}
        >
          {team.tag.slice(0, 2)}
        </div>
      )}
      <span
        className="truncate text-[11px]"
        style={{ color: D.textPrimary }}
      >
        {team.tag}
      </span>
    </div>
  );
}
