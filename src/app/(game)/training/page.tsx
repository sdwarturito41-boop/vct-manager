"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { StatsBar } from "@/components/StatsBar";

const MAX_POINTS = 10;

export default function TrainingPage() {
  const { data: team, isLoading } = trpc.team.get.useQuery(undefined, { retry: false });
  const { data: season } = trpc.season.getCurrent.useQuery(undefined, { retry: false });
  const utils = trpc.useUtils();

  const [aim, setAim] = useState(0);
  const [utility, setUtility] = useState(0);
  const [teamplay, setTeamplay] = useState(0);

  const alreadyTrained = !!(team && season && team.lastTrainedWeek >= season.currentWeek);

  const remaining = MAX_POINTS - aim - utility - teamplay;

  const trainingMutation = trpc.training.allocate.useMutation({
    onSuccess: () => {
      utils.team.get.invalidate();
      setAim(0);
      setUtility(0);
      setTeamplay(0);
    },
  });

  const adjust = (
    setter: (fn: (prev: number) => number) => void,
    delta: number
  ) => {
    setter((prev: number) => {
      const next = prev + delta;
      if (next < 0) return prev;
      if (delta > 0 && remaining <= 0) return prev;
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--val-gray)] border-t-[var(--val-red)]" />
      </div>
    );
  }

  if (!team) {
    return (
      <div className="flex items-center justify-center py-32">
        <p className="text-sm text-[var(--val-white)]/40">No team found.</p>
      </div>
    );
  }

  const skills = [
    {
      label: "Aim",
      value: team.skillAim,
      allocation: aim,
      setter: setAim,
      color: "var(--val-red)",
    },
    {
      label: "Utility",
      value: team.skillUtility,
      allocation: utility,
      setter: setUtility,
      color: "#7C5CFC",
    },
    {
      label: "Teamplay",
      value: team.skillTeamplay,
      allocation: teamplay,
      setter: setTeamplay,
      color: "var(--val-green)",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-black uppercase tracking-[0.15em] text-[var(--val-white)]">
          Training
        </h1>
        <p className="mt-1 text-sm uppercase tracking-[0.1em] text-[var(--val-white)]/30">
          Allocate training points to improve your team
        </p>
      </div>

      {/* Already trained notice */}
      {alreadyTrained && (
        <div className="rounded-lg border border-[var(--val-gold)]/30 bg-[var(--val-gold)]/10 px-5 py-3 text-center text-sm font-semibold text-[var(--val-gold)]">
          Already trained this week (Week {season?.currentWeek}). Training resets next Monday.
        </div>
      )}

      {/* Points remaining */}
      <div className="rounded-lg border border-[var(--val-gray)] bg-[var(--val-surface)] p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--val-white)]/30">
              Training Points Available
            </div>
            <div className="mt-1 text-3xl font-black text-[var(--val-white)]">
              {remaining}
              <span className="text-lg text-[var(--val-white)]/30">
                {" "}
                / {MAX_POINTS}
              </span>
            </div>
          </div>
          <div className="flex gap-1">
            {Array.from({ length: MAX_POINTS }).map((_, i) => (
              <div
                key={i}
                className={`h-3 w-3 rounded-sm transition-colors ${
                  i < MAX_POINTS - remaining
                    ? "bg-[var(--val-red)]"
                    : "bg-[var(--val-gray)]"
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Skill bars */}
      <div className="space-y-6">
        {skills.map((skill) => (
          <div
            key={skill.label}
            className="rounded-lg border border-[var(--val-gray)] bg-[var(--val-surface)] p-5"
          >
            <div className="mb-4">
              <StatsBar
                label={skill.label}
                value={skill.value}
                color={skill.color}
              />
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={() => adjust(skill.setter, -1)}
                disabled={skill.allocation <= 0}
                className="flex h-9 w-9 items-center justify-center rounded border border-[var(--val-gray)] bg-[var(--val-bg)] text-lg font-bold text-[var(--val-white)]/50 transition-all hover:border-[var(--val-red)]/40 hover:text-[var(--val-red)] disabled:opacity-30 disabled:hover:border-[var(--val-gray)] disabled:hover:text-[var(--val-white)]/50"
              >
                -
              </button>

              <div className="flex-1 text-center">
                <span className="text-2xl font-black" style={{ color: skill.color }}>
                  +{skill.allocation}
                </span>
                <span className="ml-2 text-xs text-[var(--val-white)]/30">
                  pts this week
                </span>
              </div>

              <button
                onClick={() => adjust(skill.setter, 1)}
                disabled={remaining <= 0}
                className="flex h-9 w-9 items-center justify-center rounded border border-[var(--val-gray)] bg-[var(--val-bg)] text-lg font-bold text-[var(--val-white)]/50 transition-all hover:border-[var(--val-green)]/40 hover:text-[var(--val-green)] disabled:opacity-30 disabled:hover:border-[var(--val-gray)] disabled:hover:text-[var(--val-white)]/50"
              >
                +
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Apply button */}
      <button
        onClick={() => trainingMutation.mutate({ aim, utility, teamplay })}
        disabled={
          trainingMutation.isPending || alreadyTrained || (aim === 0 && utility === 0 && teamplay === 0)
        }
        className="w-full rounded bg-[var(--val-red)] py-3.5 text-sm font-bold uppercase tracking-[0.15em] text-white transition-all hover:bg-[var(--val-red)]/90 hover:shadow-lg hover:shadow-[var(--val-red)]/25 disabled:opacity-30"
      >
        {trainingMutation.isPending ? "Applying..." : "Apply Training"}
      </button>

      {trainingMutation.isSuccess && (
        <div className="rounded border border-[var(--val-green)]/30 bg-[var(--val-green)]/10 px-4 py-2 text-center text-xs font-semibold text-[var(--val-green)]">
          Training applied successfully!
        </div>
      )}
    </div>
  );
}
