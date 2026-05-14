"use client";

import { trpc } from "@/lib/trpc-client";
import { formatGameDate, formatGameDateLong } from "@/lib/game-date";
import { D } from "@/constants/design";

/**
 * Page Saison — résumé compétitif :
 *   - Bandeau date courante + saison
 *   - Top 3 podiums par split régional (Kickoff / Stage 1 / Stage 2)
 *   - Top 2 podiums par tournoi international (Masters 1/2 / Champions)
 *
 * Quand un split/tournoi n'est pas encore joué, on l'omet (la page se
 * remplit progressivement à mesure que la saison avance).
 */
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

  return (
    <div className="flex min-h-full flex-col">
      {/* Hero — date + saison */}
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

      {/* Splits régionaux */}
      <section
        className="px-10 py-6"
        style={{ borderBottom: `1px solid ${D.border}` }}
      >
        <div className="flex items-baseline gap-3 mb-4">
          <h2
            className="text-[16px] font-medium"
            style={{ color: D.textPrimary }}
          >
            Splits régionaux
          </h2>
          {recap?.userRegion && (
            <span className="text-[11px]" style={{ color: D.textSubtle }}>
              · {recap.userRegion}
            </span>
          )}
        </div>

        {!recap || recap.splits.length === 0 ? (
          <EmptyState text="Aucun split terminé pour l'instant." />
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {recap.splits.map((s) => (
              <SplitPodiumCard key={s.stageId} name={s.name} podium={s.podium} />
            ))}
          </div>
        )}
      </section>

      {/* Tournois internationaux */}
      <section
        className="px-10 py-6"
        style={{ borderBottom: `1px solid ${D.border}` }}
      >
        <div className="flex items-baseline gap-3 mb-4">
          <h2
            className="text-[16px] font-medium"
            style={{ color: D.textPrimary }}
          >
            Tournois internationaux
          </h2>
          <span className="text-[11px]" style={{ color: D.textSubtle }}>
            · Toutes régions
          </span>
        </div>

        {!recap || recap.masters.length === 0 ? (
          <EmptyState text="Aucun tournoi international terminé pour l'instant." />
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {recap.masters.map((m) => (
              <InternationalPodiumCard
                key={m.stageId}
                name={m.name}
                city={m.city}
                podium={m.podium}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ─────────────────────── Components ───────────────────────

type Team = {
  id: string;
  name: string;
  tag: string;
  logoUrl: string | null;
  region: string;
};

type Podium = Array<{ rank: number; team: Team }>;

function SplitPodiumCard({ name, podium }: { name: string; podium: Podium }) {
  return (
    <div
      className="flex flex-col p-5"
      style={{
        background: D.card,
        border: `1px solid ${D.borderFaint}`,
        borderRadius: D.radiusCard,
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-[14px] font-medium" style={{ color: D.textPrimary }}>
          {name}
        </h3>
        <span className="text-[10px]" style={{ color: D.textSubtle }}>
          Top 3 qualifiés Masters
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {podium.map((p) => (
          <PodiumRow key={p.team.id} rank={p.rank} team={p.team} />
        ))}
      </div>
    </div>
  );
}

function InternationalPodiumCard({
  name,
  city,
  podium,
}: {
  name: string;
  city: string;
  podium: Podium;
}) {
  return (
    <div
      className="flex flex-col p-5"
      style={{
        background: D.card,
        border: `1px solid ${D.borderFaint}`,
        borderRadius: D.radiusCard,
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3
            className="text-[14px] font-medium"
            style={{ color: D.textPrimary }}
          >
            {name}
          </h3>
          <div className="text-[10px]" style={{ color: D.textSubtle }}>
            {city}
          </div>
        </div>
        <span className="text-[10px]" style={{ color: D.textSubtle }}>
          Finalistes
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {podium.map((p) => (
          <PodiumRow key={p.team.id} rank={p.rank} team={p.team} />
        ))}
      </div>
    </div>
  );
}

function PodiumRow({ rank, team }: { rank: number; team: Team }) {
  const medalColor =
    rank === 1 ? D.gold : rank === 2 ? "#c0c0c0" : rank === 3 ? "#cd7f32" : D.textSubtle;
  const medalLabel = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : `#${rank}`;
  return (
    <div
      className="flex items-center gap-3 px-3 py-2"
      style={{
        background: "rgba(255,255,255,0.02)",
        borderRadius: D.radiusStat,
        border: `1px solid ${rank === 1 ? `${medalColor}30` : D.borderFaint}`,
      }}
    >
      <span
        className="text-[16px] font-medium tabular-nums w-7 text-center"
        style={{ color: medalColor }}
      >
        {medalLabel}
      </span>
      {team.logoUrl ? (
        <img
          src={team.logoUrl}
          alt={team.name}
          className="h-7 w-7 object-contain"
        />
      ) : (
        <div
          className="flex h-7 w-7 items-center justify-center rounded-full"
          style={{
            background: D.card,
            border: `1px solid ${D.borderFaint}`,
            color: D.textMuted,
            fontSize: 10,
            fontWeight: 500,
          }}
        >
          {team.tag.slice(0, 2)}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div
          className="truncate text-[13px] font-medium"
          style={{ color: D.textPrimary }}
        >
          {team.name}
        </div>
        <div className="text-[10px]" style={{ color: D.textSubtle }}>
          {team.tag} · {team.region}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div
      className="px-4 py-8 text-center text-[11px]"
      style={{
        color: D.textSubtle,
        background: D.card,
        border: `1px dashed ${D.borderFaint}`,
        borderRadius: D.radiusCard,
      }}
    >
      {text}
    </div>
  );
}
