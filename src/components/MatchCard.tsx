"use client";

import Link from "next/link";

interface MatchTeam {
  name: string;
  tag: string;
}

interface MatchCardProps {
  matchId: string;
  team1: MatchTeam;
  team2: MatchTeam;
  score: { team1: number; team2: number } | null;
  isPlayed: boolean;
  stageId: string;
  winnerId?: string | null;
  team1Id: string;
  team2Id: string;
}

export function MatchCard({
  matchId,
  team1,
  team2,
  score,
  isPlayed,
  stageId,
  winnerId,
  team1Id,
  team2Id,
}: MatchCardProps) {
  return (
    <Link
      href={`/match/${matchId}`}
      className="group block rounded-lg border border-[var(--val-gray)] bg-[var(--val-surface)] p-4 transition-all hover:border-[var(--val-red)]/40 hover:shadow-lg hover:shadow-[var(--val-red)]/5"
    >
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--val-white)]/30">
        {stageId.replace(/_/g, " ")}
      </div>

      <div className="flex items-center justify-between gap-4">
        {/* Team 1 */}
        <div className="min-w-0 flex-1 text-right">
          <span
            className={`text-sm font-bold uppercase tracking-wide ${
              winnerId === team1Id
                ? "text-[var(--val-green)]"
                : isPlayed
                ? "text-[var(--val-white)]/50"
                : "text-[var(--val-white)]"
            }`}
          >
            {team1.tag}
          </span>
        </div>

        {/* Score */}
        <div className="flex items-center gap-2">
          {isPlayed && score ? (
            <>
              <span
                className={`text-lg font-bold ${
                  winnerId === team1Id
                    ? "text-[var(--val-white)]"
                    : "text-[var(--val-white)]/40"
                }`}
              >
                {score.team1}
              </span>
              <span className="text-xs text-[var(--val-white)]/20">:</span>
              <span
                className={`text-lg font-bold ${
                  winnerId === team2Id
                    ? "text-[var(--val-white)]"
                    : "text-[var(--val-white)]/40"
                }`}
              >
                {score.team2}
              </span>
            </>
          ) : (
            <span className="text-xs font-semibold uppercase tracking-widest text-[var(--val-red)]">
              Upcoming
            </span>
          )}
        </div>

        {/* Team 2 */}
        <div className="min-w-0 flex-1 text-left">
          <span
            className={`text-sm font-bold uppercase tracking-wide ${
              winnerId === team2Id
                ? "text-[var(--val-green)]"
                : isPlayed
                ? "text-[var(--val-white)]/50"
                : "text-[var(--val-white)]"
            }`}
          >
            {team2.tag}
          </span>
        </div>
      </div>
    </Link>
  );
}
