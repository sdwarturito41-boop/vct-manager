import { serverTrpc } from "@/lib/trpc-server";
import { VCT_STAGES, STAGE_ORDER } from "@/constants/vct-format";
import type { StageId } from "@/constants/vct-format";
import { formatGameDate, dayNameFull, dayOfWeek } from "@/lib/game-date";
import { AdvanceDayButton } from "@/components/AdvanceDayButton";
import Link from "next/link";

export default async function SeasonPage() {
  const api = await serverTrpc();
  const season = await api.season.getCurrent().catch(() => null);
  const team = await api.team.get().catch(() => null);

  const currentStageIndex = season
    ? STAGE_ORDER.indexOf(season.currentStage as StageId)
    : 0;

  // Fetch schedule and compute stage stats
  let stageMatchesPlayed = 0;
  let stageMatchesTotal = 0;
  let teamWins = 0;
  let teamLosses = 0;
  let nextMatch: {
    day: number;
    opponent: string;
    opponentTag: string;
    format: string;
  } | null = null;

  if (season && team) {
    const schedule = await api.season.getSchedule().catch(() => []);
    stageMatchesTotal = schedule.length;
    stageMatchesPlayed = schedule.filter((m) => m.isPlayed).length;

    for (const m of schedule) {
      const isTeam1 = m.team1Id === team.id;
      const isTeam2 = m.team2Id === team.id;
      if (!isTeam1 && !isTeam2) continue;

      if (m.isPlayed && m.winnerId) {
        if (m.winnerId === team.id) teamWins++;
        else teamLosses++;
      }

      if (!m.isPlayed && !nextMatch && m.day > 0) {
        const opponent = isTeam1 ? m.team2 : m.team1;
        nextMatch = {
          day: m.day,
          opponent: opponent.name,
          opponentTag: opponent.tag,
          format: m.format,
        };
      }
    }
  }

  const currentStage = season
    ? VCT_STAGES[season.currentStage as StageId]
    : null;

  return (
    <div className="space-y-6">
      {/* Advance Day - prominent at top */}
      <AdvanceDayButton />

      {/* Header with day/week counter */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-[0.15em] text-[var(--val-white)]">
            Season
          </h1>
          <p className="mt-1 text-sm uppercase tracking-[0.1em] text-[var(--val-white)]/30">
            VCT 2026 Calendar
          </p>
        </div>
        {season && (
          <div className="text-right">
            <div className="text-2xl font-black text-[var(--val-white)]">
              {dayNameFull(season.currentDay)}
            </div>
            <div className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--val-white)]/40">
              {formatGameDate(season.currentDay)} &middot; Day {season.currentDay}
            </div>
          </div>
        )}
      </div>

      {/* Current stage detail card */}
      {season && currentStage && (
        <div className="rounded-lg border border-[var(--val-red)] bg-[var(--val-red)]/5 p-5 shadow-lg shadow-[var(--val-red)]/10">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--val-red)]/60">
                Current Stage
              </div>
              <h2 className="mt-1 text-xl font-black uppercase tracking-[0.1em] text-[var(--val-red)]">
                {currentStage.name}
              </h2>
              {currentStage.format !== "offseason" && (
                <div className="mt-2 flex items-center gap-3 text-xs text-[var(--val-white)]/40">
                  <span className="capitalize">{currentStage.format.replace(/_/g, " ")}</span>
                  <span>&middot;</span>
                  <span>{currentStage.bo} / {currentStage.finalBo}</span>
                  <span>&middot;</span>
                  <span>{currentStage.durationWeeks} weeks</span>
                  {"isInternational" in currentStage && currentStage.isInternational && (
                    <>
                      <span>&middot;</span>
                      <span className="text-[var(--val-gold)]">International</span>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Stage progress */}
            <div className="text-right">
              <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--val-white)]/30">
                Stage Progress
              </div>
              <div className="mt-1 text-2xl font-black text-[var(--val-white)]">
                {stageMatchesPlayed}
                <span className="text-sm text-[var(--val-white)]/30"> / {stageMatchesTotal}</span>
              </div>
              <div className="text-[10px] text-[var(--val-white)]/30">
                matches played
              </div>
            </div>
          </div>

          {/* Team record + Next match row */}
          {team && (
            <div className="mt-4 flex gap-4">
              <div className="flex-1 rounded border border-[var(--val-gray)] bg-[var(--val-bg)] p-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--val-white)]/30">
                  Your Record
                </div>
                <div className="mt-1 text-lg font-black">
                  <span className="text-[var(--val-green)]">{teamWins}W</span>
                  <span className="mx-1 text-[var(--val-white)]/20">-</span>
                  <span className="text-[var(--val-red)]">{teamLosses}L</span>
                </div>
              </div>

              <div className="flex-1 rounded border border-[var(--val-gray)] bg-[var(--val-bg)] p-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--val-white)]/30">
                  Next Match
                </div>
                {nextMatch ? (
                  <div className="mt-1">
                    <span className="text-sm font-bold text-[var(--val-white)]">
                      vs {nextMatch.opponentTag}
                    </span>
                    <span className="ml-2 text-xs text-[var(--val-white)]/30">
                      Day {nextMatch.day} &middot; {nextMatch.format}
                    </span>
                  </div>
                ) : (
                  <div className="mt-1 text-sm text-[var(--val-white)]/30">
                    No upcoming matches
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Quick link */}
          <div className="mt-4">
            <Link
              href="/league"
              className="inline-flex items-center gap-2 rounded border border-[var(--val-red)]/30 bg-[var(--val-red)]/10 px-4 py-2 text-xs font-bold uppercase tracking-[0.15em] text-[var(--val-red)] transition-colors hover:bg-[var(--val-red)]/20"
            >
              View League / Bracket
              <span>&rarr;</span>
            </Link>
          </div>
        </div>
      )}

      {/* Stage Timeline */}
      <div>
        <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--val-white)]/30">
          Season Timeline
        </div>
        <div className="space-y-2">
          {STAGE_ORDER.map((stageId, index) => {
            const stage = VCT_STAGES[stageId];
            const isCurrent = season?.currentStage === stageId;
            const isCompleted = index < currentStageIndex;
            const isUpcoming = index > currentStageIndex;

            return (
              <div
                key={stageId}
                className={`relative flex items-center justify-between rounded-lg border p-4 transition-all ${
                  isCurrent
                    ? "border-[var(--val-red)] bg-[var(--val-red)]/5 shadow-lg shadow-[var(--val-red)]/10"
                    : isCompleted
                    ? "border-[var(--val-gray)]/50 bg-[var(--val-surface)]/50"
                    : "border-[var(--val-gray)] bg-[var(--val-surface)]"
                }`}
              >
                <div className="flex items-center gap-3">
                  {/* Status indicator */}
                  <div
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
                      isCurrent
                        ? "border-[var(--val-red)] bg-[var(--val-red)]/20"
                        : isCompleted
                        ? "border-[var(--val-green)]/50 bg-[var(--val-green)]/10"
                        : "border-[var(--val-gray)] bg-[var(--val-bg)]"
                    }`}
                  >
                    {isCompleted ? (
                      <svg
                        className="h-3.5 w-3.5 text-[var(--val-green)]"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.5}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : isCurrent ? (
                      <div className="h-2 w-2 animate-pulse rounded-full bg-[var(--val-red)]" />
                    ) : (
                      <div className="h-1.5 w-1.5 rounded-full bg-[var(--val-gray)]" />
                    )}
                  </div>

                  <div>
                    <h3
                      className={`text-sm font-bold uppercase tracking-[0.1em] ${
                        isCurrent
                          ? "text-[var(--val-red)]"
                          : isCompleted
                          ? "text-[var(--val-white)]/40"
                          : "text-[var(--val-white)]"
                      }`}
                    >
                      {stage.name}
                    </h3>
                    <div className="flex items-center gap-2 text-[10px] text-[var(--val-white)]/30">
                      {stage.format !== "offseason" && (
                        <>
                          <span className="capitalize">{stage.format.replace(/_/g, " ")}</span>
                          <span>&middot;</span>
                        </>
                      )}
                      <span>{stage.durationWeeks}w</span>
                      {"isInternational" in stage && stage.isInternational && (
                        <>
                          <span>&middot;</span>
                          <span className="text-[var(--val-gold)]">Intl</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Status badge */}
                <div>
                  {isCurrent && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--val-red)]/30 bg-[var(--val-red)]/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[var(--val-red)]">
                      <span className="h-1 w-1 animate-pulse rounded-full bg-[var(--val-red)]" />
                      Active
                    </span>
                  )}
                  {isCompleted && (
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--val-green)]/50">
                      Done
                    </span>
                  )}
                  {isUpcoming && (
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--val-white)]/20">
                      Upcoming
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
