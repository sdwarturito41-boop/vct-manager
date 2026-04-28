"use client";

import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { D } from "@/constants/design";
import { formatGameDate } from "@/lib/game-date";

interface Props {
  pendingMatchId?: string | null;
  pendingOpponent?: string | null;
}

interface MatchResult {
  matchId: string;
  team1Id: string;
  team2Id: string;
  team1Name: string;
  team2Name: string;
  team1Tag: string;
  team2Tag: string;
  team1LogoUrl: string | null;
  team2LogoUrl: string | null;
  winnerId: string;
  score: { team1: number; team2: number };
  isUserMatch: boolean;
  needsVeto: boolean;
  stageId: string;
}

// Modal-driven Continue button. Idle → click → modal opens with a spinner
// while the day is simulated → results list streams in once advanceDay
// resolves. Lives inside the global TopNav so it's available everywhere.
export function AdvanceDayButton({ pendingMatchId, pendingOpponent }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<MatchResult[] | null>(null);
  const [day, setDay] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingFromAdvance, setPendingFromAdvance] = useState<{
    matchId: string;
    opponent: string;
  } | null>(null);

  const { data: userTeam } = trpc.team.get.useQuery(undefined, { retry: false });

  const mutation = trpc.season.advanceDay.useMutation({
    onSuccess: (data) => {
      setError(null);
      setDay(data.day);
      const vetoMatch = data.results.find((r) => r.needsVeto);
      if (vetoMatch) {
        setPendingFromAdvance({
          matchId: vetoMatch.matchId,
          opponent: `${vetoMatch.team1Name} vs ${vetoMatch.team2Name}`,
        });
      }
      const playable = data.results.filter((r) => !r.needsVeto);
      setResults(playable);
      router.refresh();
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  // Close modal on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !mutation.isPending) closeModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, mutation.isPending]);

  function closeModal() {
    setOpen(false);
    // Keep results around briefly so re-opening doesn't flicker, but clear
    // them next time the user starts a new advance.
  }

  function startAdvance() {
    setResults(null);
    setError(null);
    setPendingFromAdvance(null);
    setDay(null);
    setOpen(true);
    mutation.mutate();
  }

  // Determine which CTA to render: play user match (if any) vs continue.
  const matchToPlay = pendingMatchId ?? pendingFromAdvance?.matchId;
  const buttonOpponent = pendingOpponent ?? pendingFromAdvance?.opponent ?? null;

  return (
    <>
      {matchToPlay ? (
        <Link
          href={`/match-day/${matchToPlay}`}
          className="flex h-9 w-full items-center justify-center gap-2 rounded text-[12px] font-medium transition-colors"
          style={{
            background: D.coral,
            color: "#ffffff",
          }}
        >
          ▶ Play match
          {buttonOpponent && (
            <span style={{ opacity: 0.7, fontWeight: 400 }}>· {buttonOpponent}</span>
          )}
        </Link>
      ) : (
        <button
          onClick={startAdvance}
          disabled={mutation.isPending}
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            background: D.primary,
            color: "#ffffff",
          }}
        >
          Continue
          <span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>›</span>
        </button>
      )}

      {open && (
        <SimulationModal
          loading={mutation.isPending}
          error={error}
          day={day}
          results={results}
          userTeamId={userTeam?.id ?? null}
          pendingFromAdvance={pendingFromAdvance}
          onClose={closeModal}
        />
      )}
    </>
  );
}

// ─── Modal ──────────────────────────────────────────────────────────

function SimulationModal({
  loading,
  error,
  day,
  results,
  userTeamId,
  pendingFromAdvance,
  onClose,
}: {
  loading: boolean;
  error: string | null;
  day: number | null;
  results: MatchResult[] | null;
  userTeamId: string | null;
  pendingFromAdvance: { matchId: string; opponent: string } | null;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        background: "rgba(0,0,0,0.65)",
        backdropFilter: "blur(2px)",
      }}
      onClick={() => !loading && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[80vh] w-[480px] flex-col overflow-hidden rounded-xl"
        style={{
          background: D.surface,
          border: `1px solid ${D.border}`,
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3"
          style={{ borderBottom: `1px solid ${D.borderFaint}` }}
        >
          <div className="flex items-center gap-3">
            {loading && (
              <div
                className="h-4 w-4 animate-spin rounded-full"
                style={{
                  border: `2px solid ${D.borderFaint}`,
                  borderTopColor: D.primary,
                }}
              />
            )}
            <span className="text-[13px] font-medium" style={{ color: D.textPrimary }}>
              {loading ? "Simulating day…" : day != null ? `Day ${day} complete` : "Simulation"}
            </span>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            className="text-[18px] leading-none transition-colors disabled:cursor-not-allowed disabled:opacity-30"
            style={{ color: D.textMuted }}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="flex flex-col items-center justify-center gap-3 py-10">
              <div
                className="h-8 w-8 animate-spin rounded-full"
                style={{
                  border: `2px solid ${D.borderFaint}`,
                  borderTopColor: D.primary,
                }}
              />
              <span className="text-[12px]" style={{ color: D.textMuted }}>
                Running the match engine…
              </span>
            </div>
          )}

          {error && !loading && (
            <div
              className="rounded px-3 py-2 text-[12px]"
              style={{
                background: "rgba(216,90,48,0.12)",
                border: `1px solid rgba(216,90,48,0.3)`,
                color: D.coral,
              }}
            >
              {error}
            </div>
          )}

          {!loading && pendingFromAdvance && (
            <Link
              href={`/match-day/${pendingFromAdvance.matchId}`}
              onClick={onClose}
              className="mb-4 flex items-center justify-between rounded-lg px-4 py-3 transition-colors"
              style={{
                background: "rgba(216,90,48,0.10)",
                border: `1px solid rgba(216,90,48,0.3)`,
              }}
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px]" style={{ color: D.coral }}>
                  Awaiting your veto
                </span>
                <span className="text-[13px] font-medium" style={{ color: D.textPrimary }}>
                  {pendingFromAdvance.opponent}
                </span>
              </div>
              <span className="text-[12px]" style={{ color: D.coral }}>
                Play match →
              </span>
            </Link>
          )}

          {!loading && results && results.length > 0 && (
            <div className="flex flex-col gap-1">
              <div
                className="grid items-center gap-2 px-2 pb-1 text-[10px]"
                style={{
                  gridTemplateColumns: "1fr 60px 1fr 28px",
                  color: D.textSubtle,
                  borderBottom: `1px solid ${D.borderFaint}`,
                }}
              >
                <span className="text-right">Home</span>
                <span className="text-center">Score</span>
                <span>Away</span>
                <span />
              </div>
              {results.map((r) => {
                const isOurMatch =
                  userTeamId !== null &&
                  (r.team1Id === userTeamId || r.team2Id === userTeamId);
                const ourSide = r.team1Id === userTeamId ? "team1" : r.team2Id === userTeamId ? "team2" : null;
                const ourScore = ourSide === "team1" ? r.score.team1 : ourSide === "team2" ? r.score.team2 : 0;
                const oppScore = ourSide === "team1" ? r.score.team2 : ourSide === "team2" ? r.score.team1 : 0;
                const won = isOurMatch && r.winnerId === userTeamId;
                const lost = isOurMatch && r.winnerId !== userTeamId;

                return (
                  <Link
                    key={r.matchId}
                    href={`/match/${r.matchId}`}
                    onClick={onClose}
                    className="grid items-center gap-2 rounded px-2 py-2 text-[12px] transition-colors"
                    style={{
                      gridTemplateColumns: "1fr 60px 1fr 28px",
                      background: isOurMatch ? "rgba(83,74,183,0.08)" : "transparent",
                      borderBottom: `1px solid ${D.borderFaint}`,
                    }}
                  >
                    {/* Home — logo right, name truncated, right-aligned */}
                    <div className="flex items-center justify-end gap-1.5 min-w-0">
                      <span
                        className="truncate"
                        style={{
                          color:
                            r.winnerId === r.team1Id ? D.textPrimary : D.textMuted,
                          fontWeight: r.winnerId === r.team1Id ? 500 : 400,
                        }}
                      >
                        {r.team1Tag || r.team1Name}
                      </span>
                      <TeamCrest logo={r.team1LogoUrl} fallback={r.team1Tag || r.team1Name} />
                    </div>
                    {/* Score */}
                    <span
                      className="text-center tabular-nums"
                      style={{
                        color: D.textPrimary,
                        fontWeight: 500,
                      }}
                    >
                      {r.score.team1}–{r.score.team2}
                    </span>
                    {/* Away — logo left, name */}
                    <div className="flex items-center gap-1.5 min-w-0">
                      <TeamCrest logo={r.team2LogoUrl} fallback={r.team2Tag || r.team2Name} />
                      <span
                        className="truncate"
                        style={{
                          color:
                            r.winnerId === r.team2Id ? D.textPrimary : D.textMuted,
                          fontWeight: r.winnerId === r.team2Id ? 500 : 400,
                        }}
                      >
                        {r.team2Tag || r.team2Name}
                      </span>
                    </div>
                    <span
                      className="rounded text-center text-[10px] font-medium"
                      style={{
                        background: won
                          ? "rgba(29,158,117,0.18)"
                          : lost
                            ? "rgba(216,90,48,0.18)"
                            : "transparent",
                        color: won ? D.teal : lost ? D.coral : D.textSubtle,
                        padding: "2px 0",
                      }}
                    >
                      {won ? "W" : lost ? "L" : ""}
                      {!isOurMatch && Math.abs(ourScore - oppScore) === 0 && ""}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}

          {!loading && !error && results && results.length === 0 && !pendingFromAdvance && (
            <div className="py-6 text-center text-[12px]" style={{ color: D.textSubtle }}>
              No matches today.
            </div>
          )}
        </div>

        {/* Footer */}
        {!loading && (
          <div
            className="flex items-center justify-between px-5 py-3"
            style={{ borderTop: `1px solid ${D.borderFaint}` }}
          >
            <span className="text-[11px]" style={{ color: D.textSubtle }}>
              {day != null && `${formatGameDate(day)}`}
              {results && results.length > 0 && ` · ${results.length} matches`}
            </span>
            <button
              onClick={onClose}
              className="rounded px-3 py-1.5 text-[12px] font-medium transition-colors"
              style={{
                background: D.primary,
                color: "#ffffff",
              }}
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}


// ─── TeamCrest helper ───────────────────────────────────────────────

function TeamCrest({ logo, fallback }: { logo: string | null; fallback: string }) {
  if (logo) {
    return (
      <img
        src={logo}
        alt={fallback}
        className="h-5 w-5 shrink-0 object-contain"
      />
    );
  }
  return (
    <div
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[8px] font-medium"
      style={{
        background: D.card,
        border: `1px solid ${D.borderFaint}`,
        color: D.textMuted,
      }}
    >
      {fallback.slice(0, 2)}
    </div>
  );
}
