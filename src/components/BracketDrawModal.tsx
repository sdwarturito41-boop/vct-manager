"use client";

import { useEffect, useMemo, useState } from "react";
import { D } from "@/constants/design";

type Team = {
  id: string;
  name: string;
  tag: string;
  logoUrl: string | null;
  region: string;
};

type Pair = {
  matchId: string;
  bye: Team;
  swissSurvivor: Team;
};

type Props = {
  stage: string;
  pairs: Pair[];
  onClose: () => void;
};

type Phase =
  | { type: "intro" }
  | { type: "draw"; pairIndex: number }
  | { type: "pick"; pairIndex: number }
  | { type: "reveal"; pairIndex: number }
  | { type: "done" };

// Timings (ms). Total runtime ≈ pairs × (DRAW + PICK + REVEAL) ≈ 4 × 4500 ≈ 18s.
const TIMING = {
  intro: 1400,
  draw: 1400,
  pick: 1800,
  reveal: 1300,
  outro: 800,
} as const;

export function BracketDrawModal({ stage, pairs, onClose }: Props) {
  const [phase, setPhase] = useState<Phase>({ type: "intro" });

  // Survivors that have been "claimed" — used to grey them out as the draw
  // unfolds.
  const claimedSurvivorIds = useMemo(() => {
    const claimed = new Set<string>();
    if (phase.type === "intro") return claimed;
    const upto = phase.type === "done" ? pairs.length - 1 : phase.pairIndex;
    for (let i = 0; i < upto; i++) claimed.add(pairs[i].swissSurvivor.id);
    if (phase.type === "reveal" || phase.type === "done") {
      claimed.add(pairs[phase.type === "done" ? pairs.length - 1 : phase.pairIndex].swissSurvivor.id);
    }
    return claimed;
  }, [phase, pairs]);

  // Drive the phase machine.
  useEffect(() => {
    if (phase.type === "intro") {
      const t = setTimeout(() => setPhase({ type: "draw", pairIndex: 0 }), TIMING.intro);
      return () => clearTimeout(t);
    }
    if (phase.type === "draw") {
      const t = setTimeout(() => setPhase({ type: "pick", pairIndex: phase.pairIndex }), TIMING.draw);
      return () => clearTimeout(t);
    }
    if (phase.type === "pick") {
      const t = setTimeout(() => setPhase({ type: "reveal", pairIndex: phase.pairIndex }), TIMING.pick);
      return () => clearTimeout(t);
    }
    if (phase.type === "reveal") {
      const t = setTimeout(() => {
        if (phase.pairIndex + 1 < pairs.length) {
          setPhase({ type: "draw", pairIndex: phase.pairIndex + 1 });
        } else {
          setPhase({ type: "done" });
        }
      }, TIMING.reveal);
      return () => clearTimeout(t);
    }
    return;
  }, [phase, pairs.length]);

  const skip = () => setPhase({ type: "done" });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.85)", backdropFilter: "blur(4px)" }}
      onClick={() => phase.type === "done" && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-[760px] flex-col overflow-hidden rounded-xl"
        style={{
          background: D.surface,
          border: `1px solid ${D.border}`,
          fontFamily: "Inter, system-ui, sans-serif",
        }}
      >
        <Header
          stage={stage}
          phase={phase}
          totalPairs={pairs.length}
          onSkip={phase.type === "done" ? null : skip}
          onClose={phase.type === "done" ? onClose : null}
        />

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {/* Seed #1 cards row */}
          <div className="mb-4">
            <SectionTitle>Seed #1 — byes</SectionTitle>
            <div className="mt-3 grid grid-cols-4 gap-3">
              {pairs.map((p, i) => {
                const revealedAt = phase.type === "intro" ? -1
                  : phase.type === "done" ? pairs.length - 1
                  : phase.pairIndex;
                const isRevealed = i <= revealedAt;
                const isCurrent = phase.type !== "intro" && phase.type !== "done" && phase.pairIndex === i;
                return (
                  <ByeCard
                    key={p.matchId}
                    team={p.bye}
                    revealed={isRevealed}
                    isCurrent={isCurrent}
                  />
                );
              })}
            </div>
          </div>

          {/* Swiss survivors row */}
          <div className="mb-4">
            <SectionTitle>Swiss survivors</SectionTitle>
            <div className="mt-3 grid grid-cols-4 gap-3">
              {pairs.map((p, i) => {
                const claimed = claimedSurvivorIds.has(p.swissSurvivor.id);
                const isHighlighted = phase.type === "pick" && phase.pairIndex === i;
                return (
                  <SurvivorCard
                    key={p.swissSurvivor.id}
                    team={p.swissSurvivor}
                    claimed={claimed}
                    highlighted={isHighlighted}
                  />
                );
              })}
            </div>
          </div>

          {/* Matchup slots */}
          <div className="mt-6">
            <SectionTitle>UB Quarterfinals</SectionTitle>
            <div className="mt-3 grid grid-cols-2 gap-3">
              {pairs.map((p, i) => {
                const filled = phase.type === "done"
                  ? true
                  : phase.type === "reveal"
                    ? i <= phase.pairIndex
                    : phase.type !== "intro" && i < phase.pairIndex;
                return (
                  <MatchupSlot
                    key={p.matchId}
                    slot={i + 1}
                    bye={filled ? p.bye : null}
                    swiss={filled ? p.swissSurvivor : null}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes vct-flip-in {
          from { transform: rotateY(180deg); opacity: 0; }
          to { transform: rotateY(0deg); opacity: 1; }
        }
        @keyframes vct-pulse-pick {
          0%, 100% { box-shadow: 0 0 0 0 rgba(83,74,183,0.0); }
          50% { box-shadow: 0 0 0 4px rgba(83,74,183,0.45); }
        }
        @keyframes vct-fade-in-up {
          from { transform: translateY(8px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────

function Header({
  stage,
  phase,
  totalPairs,
  onSkip,
  onClose,
}: {
  stage: string;
  phase: Phase;
  totalPairs: number;
  onSkip: (() => void) | null;
  onClose: (() => void) | null;
}) {
  const stepLabel =
    phase.type === "intro" ? "Cérémonie d'ouverture"
    : phase.type === "done" ? "Bracket draw complete"
    : `Pick ${phase.pairIndex + 1} / ${totalPairs}`;

  const phaseLabel =
    phase.type === "intro" ? "—"
    : phase.type === "draw" ? "Tirage du Seed #1…"
    : phase.type === "pick" ? "Choix de l'adversaire…"
    : phase.type === "reveal" ? "Match formé"
    : "—";

  return (
    <div
      className="flex items-center justify-between px-6 py-4"
      style={{ borderBottom: `1px solid ${D.border}` }}
    >
      <div className="flex flex-col">
        <span className="text-[11px] font-medium" style={{ color: D.textMuted }}>
          {stage.replace(/_/g, " ")} · BRACKET DRAW
        </span>
        <span className="text-[16px] font-medium" style={{ color: D.textPrimary }}>
          {stepLabel}
        </span>
        <span className="text-[11px]" style={{ color: D.textSubtle }}>
          {phaseLabel}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {onSkip && (
          <button
            onClick={onSkip}
            className="rounded px-3 py-1.5 text-[11px] transition-colors"
            style={{
              background: "transparent",
              color: D.textMuted,
              border: `1px solid ${D.borderFaint}`,
            }}
          >
            Skip
          </button>
        )}
        {onClose && (
          <button
            onClick={onClose}
            className="rounded px-4 py-1.5 text-[12px] font-medium transition-colors"
            style={{ background: D.primary, color: "#fff" }}
          >
            Continue
          </button>
        )}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="text-[10px] font-medium uppercase tracking-wide"
      style={{ color: D.textSubtle, letterSpacing: 0.6 }}
    >
      {children}
    </span>
  );
}

function ByeCard({
  team,
  revealed,
  isCurrent,
}: {
  team: Team;
  revealed: boolean;
  isCurrent: boolean;
}) {
  return (
    <div
      className="relative aspect-[3/4] rounded-lg p-3 flex flex-col items-center justify-center gap-2"
      style={{
        background: revealed ? D.card : "transparent",
        border: revealed
          ? `1px solid ${isCurrent ? D.primary : D.borderFaint}`
          : `1px dashed ${D.borderFaint}`,
        boxShadow: isCurrent ? `0 0 0 3px rgba(83,74,183,0.30)` : "none",
        animation: revealed ? "vct-flip-in 600ms cubic-bezier(0.22,1,0.36,1)" : undefined,
        transformOrigin: "center",
      }}
    >
      {revealed ? (
        <>
          {team.logoUrl ? (
            <img src={team.logoUrl} alt={team.name} className="h-10 w-10 object-contain" />
          ) : (
            <div
              className="flex h-10 w-10 items-center justify-center rounded"
              style={{ background: D.surface, color: D.textMuted, border: `1px solid ${D.borderFaint}` }}
            >
              <span className="text-[10px]">{team.tag}</span>
            </div>
          )}
          <div className="flex flex-col items-center gap-0.5">
            <span className="text-[12px] font-medium" style={{ color: D.textPrimary }}>
              {team.tag}
            </span>
            <span className="text-[9px]" style={{ color: D.textSubtle }}>
              {team.region}
            </span>
          </div>
          <span
            className="rounded px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-wide"
            style={{
              background: "rgba(83,74,183,0.18)",
              color: D.primary,
              letterSpacing: 0.4,
            }}
          >
            Seed #1
          </span>
        </>
      ) : (
        <div
          className="flex h-full w-full items-center justify-center rounded"
          style={{
            background: `linear-gradient(135deg, ${D.card} 0%, ${D.surface} 100%)`,
            border: `1px solid ${D.borderFaint}`,
          }}
        >
          <span className="text-[24px]" style={{ color: D.textSubtle }}>
            ?
          </span>
        </div>
      )}
    </div>
  );
}

function SurvivorCard({
  team,
  claimed,
  highlighted,
}: {
  team: Team;
  claimed: boolean;
  highlighted: boolean;
}) {
  return (
    <div
      className="rounded-lg p-3 flex flex-col items-center justify-center gap-2 transition-opacity"
      style={{
        background: D.card,
        border: `1px solid ${highlighted ? D.primary : D.borderFaint}`,
        opacity: claimed && !highlighted ? 0.35 : 1,
        animation: highlighted ? "vct-pulse-pick 900ms ease-in-out infinite" : undefined,
        transition: "opacity 400ms ease-out",
      }}
    >
      {team.logoUrl ? (
        <img src={team.logoUrl} alt={team.name} className="h-9 w-9 object-contain" />
      ) : (
        <div
          className="flex h-9 w-9 items-center justify-center rounded"
          style={{ background: D.surface, color: D.textMuted }}
        >
          <span className="text-[10px]">{team.tag}</span>
        </div>
      )}
      <div className="flex flex-col items-center gap-0.5">
        <span className="text-[12px] font-medium" style={{ color: D.textPrimary }}>
          {team.tag}
        </span>
        <span className="text-[9px]" style={{ color: D.textSubtle }}>
          {team.region}
        </span>
      </div>
    </div>
  );
}

function MatchupSlot({
  slot,
  bye,
  swiss,
}: {
  slot: number;
  bye: Team | null;
  swiss: Team | null;
}) {
  const filled = bye !== null && swiss !== null;
  return (
    <div
      className="rounded-lg p-3 flex items-center justify-between"
      style={{
        background: filled ? D.card : "transparent",
        border: `1px solid ${filled ? D.borderFaint : "transparent"}`,
        borderStyle: filled ? "solid" : "dashed",
        borderColor: filled ? D.borderFaint : D.borderFaint,
        minHeight: 56,
        animation: filled ? "vct-fade-in-up 500ms cubic-bezier(0.22,1,0.36,1)" : undefined,
      }}
    >
      <span
        className="text-[10px] font-medium"
        style={{ color: D.textSubtle, minWidth: 28 }}
      >
        QF{slot}
      </span>
      {filled && bye && swiss ? (
        <div className="flex items-center gap-2 flex-1 justify-center">
          <TeamMini team={bye} />
          <span className="text-[10px]" style={{ color: D.textSubtle }}>vs</span>
          <TeamMini team={swiss} />
        </div>
      ) : (
        <span className="text-[10px]" style={{ color: D.textSubtle }}>
          en attente…
        </span>
      )}
      <span style={{ minWidth: 28 }} />
    </div>
  );
}

function TeamMini({ team }: { team: Team }) {
  return (
    <div className="flex items-center gap-1.5">
      {team.logoUrl ? (
        <img src={team.logoUrl} alt={team.name} className="h-5 w-5 object-contain" />
      ) : (
        <span className="text-[10px]" style={{ color: D.textMuted }}>
          {team.tag}
        </span>
      )}
      <span className="text-[12px] font-medium" style={{ color: D.textPrimary }}>
        {team.tag}
      </span>
    </div>
  );
}
