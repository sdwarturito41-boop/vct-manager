"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatGameDate } from "@/lib/game-date";

interface Props {
  pendingMatchId?: string | null;
  pendingOpponent?: string | null;
}

interface MatchResult {
  matchId: string;
  team1Name: string;
  team2Name: string;
  winnerId: string;
  score: { team1: number; team2: number };
  isUserMatch: boolean;
  needsVeto: boolean;
}

export function AdvanceDayButton({ pendingMatchId, pendingOpponent }: Props) {
  const router = useRouter();
  const [results, setResults] = useState<MatchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingFromAdvance, setPendingFromAdvance] = useState<{ matchId: string; opponent: string } | null>(null);

  const mutation = trpc.season.advanceDay.useMutation({
    onSuccess: (data) => {
      setError(null);
      const vetoMatch = data.results.find((r) => r.needsVeto);
      if (vetoMatch) {
        setPendingFromAdvance({
          matchId: vetoMatch.matchId,
          opponent: vetoMatch.team1Name + " vs " + vetoMatch.team2Name,
        });
      }
      if (data.results.length > 0) {
        setResults(data.results.filter((r) => !r.needsVeto));
      } else {
        setResults(null);
      }
      router.refresh();
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  // Determine if we should show "Play Match" instead of "Next Day"
  const matchToPlay = pendingMatchId ?? pendingFromAdvance?.matchId;

  if (matchToPlay) {
    return (
      <div className="space-y-3">
        <Link
          href={`/match-day/${matchToPlay}`}
          className="flex w-full items-center justify-center gap-2 rounded bg-[var(--val-red)] py-3.5 text-sm font-bold uppercase tracking-[0.15em] text-white transition-all hover:bg-[var(--val-red)]/90 hover:shadow-lg hover:shadow-[var(--val-red)]/25"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
          </svg>
          Play Match
        </Link>
        {pendingOpponent && (
          <div className="text-center text-[10px] font-semibold uppercase tracking-widest text-[var(--val-white)]/30">
            vs {pendingOpponent}
          </div>
        )}

        {results && results.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-[var(--val-gray)]/20">
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--val-white)]/30">
              Other Results
            </div>
            {results.map((r) => (
              <Link
                key={r.matchId}
                href={`/match/${r.matchId}`}
                className="flex items-center justify-between rounded border border-[var(--val-gray)] bg-[var(--val-bg)] p-2 transition-colors hover:border-[var(--val-red)]/40"
              >
                <span className="text-[10px] font-bold text-[var(--val-white)]">
                  {r.team1Name} {r.score.team1}-{r.score.team2} {r.team2Name}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <button
        onClick={() => { setResults(null); setError(null); setPendingFromAdvance(null); mutation.mutate(); }}
        disabled={mutation.isPending}
        className="w-full cursor-pointer rounded bg-[var(--val-red)] py-3.5 text-sm font-bold uppercase tracking-[0.15em] text-white transition-all hover:bg-[var(--val-red)]/90 hover:shadow-lg hover:shadow-[var(--val-red)]/25 disabled:opacity-50"
      >
        {mutation.isPending ? "Simulating..." : "Next Day →"}
      </button>

      {error && (
        <div className="rounded border border-[var(--val-red)]/30 bg-[var(--val-red)]/10 px-3 py-2 text-[10px] font-semibold text-[var(--val-red)]">
          {error}
        </div>
      )}

      {mutation.data && !mutation.isPending && (
        <div className="text-xs text-[var(--val-white)]/40">
          {formatGameDate(mutation.data.day)} · {mutation.data.matchesSimulated} matches
        </div>
      )}

      {results && results.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--val-white)]/30">
            Today&apos;s Results
          </div>
          {results.map((r) => (
            <Link
              key={r.matchId}
              href={`/match/${r.matchId}`}
              className="flex items-center justify-between rounded border border-[var(--val-gray)] bg-[var(--val-bg)] p-3 transition-colors hover:border-[var(--val-red)]/40"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-[var(--val-white)]">
                  {r.team1Name}
                </span>
                <span className="text-xs font-bold text-[var(--val-white)]/60">
                  {r.score.team1} - {r.score.team2}
                </span>
                <span className="text-xs font-bold text-[var(--val-white)]">
                  {r.team2Name}
                </span>
              </div>
              <span className="text-[10px] text-[var(--val-white)]/30">details →</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
