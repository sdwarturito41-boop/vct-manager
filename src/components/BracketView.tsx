"use client";

import Link from "next/link";
import { KICKOFF_SEEDS } from "@/server/schedule/generate";
import type { Region } from "@/generated/prisma/client";
import { D } from "@/constants/design";

interface BMatch {
  id: string;
  stageId: string;
  isPlayed: boolean;
  winnerId: string | null;
  score: unknown;
  format: string;
  week: number;
  team1: { id: string; name: string; tag: string; logoUrl: string | null };
  team2: { id: string; name: string; tag: string; logoUrl: string | null };
}

interface Props {
  matches: BMatch[];
  userTeamId: string;
  region: string;
  isUserRegion: boolean;
  teamNameToLogo: Record<string, string | null>;
}

// ── Slot data: either a real DB match or a static bracket slot ──

interface SlotData {
  match: BMatch | null;
  t1: { name: string; tag: string; logo: string | null } | null;
  t2: { name: string; tag: string; logo: string | null } | null;
  label: string;
  format: string;
  isFinal?: boolean;
}

export function BracketView({ matches, userTeamId, region, isUserRegion, teamNameToLogo }: Props) {
  const seed = KICKOFF_SEEDS[region as Region];
  if (!seed) return null;

  const byRound = new Map<string, BMatch[]>();
  for (const m of matches) {
    if (!byRound.has(m.stageId)) byRound.set(m.stageId, []);
    byRound.get(m.stageId)!.push(m);
  }

  // ── Build R1 slots ──
  const r1Db = byRound.get("KICKOFF_UB_R1") ?? [];
  const r1Slots: SlotData[] = seed.round1Matchups.map(([a, b]) => {
    const dbMatch = r1Db.find(
      (m) => (m.team1.name === a && m.team2.name === b) || (m.team1.name === b && m.team2.name === a),
    );
    return {
      match: dbMatch ?? null,
      t1: { name: a, tag: a.split(" ").pop() ?? a, logo: teamNameToLogo[a] ?? null },
      t2: { name: b, tag: b.split(" ").pop() ?? b, logo: teamNameToLogo[b] ?? null },
      label: "",
      format: "BO3",
    };
  });

  // ── Build R2 slots ──
  const r2Db = byRound.get("KICKOFF_UB_QF") ?? [];
  const r2Slots: SlotData[] = seed.qfPairings.map(([byeName, r1Idx]) => {
    const r1Slot = r1Slots[r1Idx];
    const r1Winner = r1Slot.match?.isPlayed
      ? (r1Slot.match.winnerId === r1Slot.match.team1.id ? r1Slot.match.team1 : r1Slot.match.team2)
      : null;

    const dbMatch = r2Db.find((m) => m.team1.name === byeName || m.team2.name === byeName);
    const [r1a, r1b] = seed.round1Matchups[r1Idx];
    const tbd = `W(${shortName(r1a)}/${shortName(r1b)})`;

    return {
      match: dbMatch ?? null,
      t1: { name: byeName, tag: shortName(byeName), logo: teamNameToLogo[byeName] ?? null },
      t2: r1Winner
        ? { name: r1Winner.name, tag: r1Winner.tag, logo: r1Winner.logoUrl }
        : { name: tbd, tag: "TBD", logo: null },
      label: "",
      format: "BO3",
    };
  });

  // ── Build Semi slots ──
  const semiDb = byRound.get("KICKOFF_UB_SF") ?? [];
  const qfDb = byRound.get("KICKOFF_UB_QF") ?? [];
  const topQfTeams = new Set<string>();
  const botQfTeams = new Set<string>();
  for (let i = 0; i < seed.qfPairings.length; i++) {
    const byeName = seed.qfPairings[i][0];
    const qfMatch = qfDb.find((m) => m.team1.name === byeName || m.team2.name === byeName);
    const teamNames = qfMatch ? [qfMatch.team1.name, qfMatch.team2.name] : [byeName];
    for (const name of teamNames) {
      if (i < 2) topQfTeams.add(name);
      else botQfTeams.add(name);
    }
  }

  const semiSlots: SlotData[] = [0, 1].map((position) => {
    const targetTeams = position === 0 ? topQfTeams : botQfTeams;
    const dbMatch = semiDb.find((m) =>
      targetTeams.has(m.team1.name) || targetTeams.has(m.team2.name),
    ) ?? null;

    if (dbMatch) {
      return {
        match: dbMatch,
        t1: { name: dbMatch.team1.name, tag: dbMatch.team1.tag, logo: dbMatch.team1.logoUrl },
        t2: { name: dbMatch.team2.name, tag: dbMatch.team2.tag, logo: dbMatch.team2.logoUrl },
        label: "", format: "BO3",
      };
    }
    return { match: null, t1: null, t2: null, label: "", format: "BO3" };
  });

  // ── Build Final slot ──
  const finalDb = (byRound.get("KICKOFF_UB_FINAL") ?? [])[0] ?? null;
  const finalSlot: SlotData = finalDb
    ? {
        match: finalDb,
        t1: { name: finalDb.team1.name, tag: finalDb.team1.tag, logo: finalDb.team1.logoUrl },
        t2: { name: finalDb.team2.name, tag: finalDb.team2.tag, logo: finalDb.team2.logoUrl },
        label: "", format: "BO5", isFinal: true,
      }
    : { match: null, t1: null, t2: null, label: "", format: "BO5", isFinal: true };

  return (
    <div className="flex flex-col">
      {/* Region header */}
      <div
        className="flex items-center justify-between px-10 py-5"
        style={{ borderBottom: `1px solid ${D.border}` }}
      >
        <div className="flex items-center gap-3">
          <span
            className="text-[22px] font-medium uppercase tracking-[0.05em]"
            style={{ color: D.textPrimary }}
          >
            {region}
          </span>
          {isUserRegion && (
            <span
              className="rounded-full px-3 py-1 text-[10px] font-medium uppercase tracking-[0.25em]"
              style={{
                background: "rgba(255,70,85,0.12)",
                color: D.red,
                border: `1px solid rgba(255,70,85,0.3)`,
              }}
            >
              Your Region
            </span>
          )}
        </div>
      </div>

      {/* Upper Bracket */}
      <div className="px-10 py-6" style={{ borderBottom: `1px solid ${D.borderFaint}` }}>
        <SectionHeader label="Upper Bracket" color={D.green} sub="Winner → Masters Seed #1" />
        <div className="mt-4">
          <UpperBracketGrid
            r1={r1Slots}
            r2={r2Slots}
            semi={semiSlots}
            final_={finalSlot}
            userTeamId={userTeamId}
          />
        </div>
      </div>

      {/* Middle bracket */}
      <div className="px-10 py-6" style={{ borderBottom: `1px solid ${D.borderFaint}` }}>
        <SectionHeader label="Middle" color={D.gold} sub="1 defeat → Masters Seed #2" />
        <div className="mt-4">
          <GenericBracketGrid
            rounds={["KICKOFF_MID_R1","KICKOFF_MID_R2","KICKOFF_MID_QF","KICKOFF_MID_SF","KICKOFF_MID_FINAL"]}
            roundLabels={["Mid R1","Mid R2","Mid QF","Mid SF","Mid Final · BO5"]}
            byRound={byRound} userTeamId={userTeamId}
          />
        </div>
      </div>

      {/* Lower bracket */}
      <div className="px-10 py-6" style={{ borderBottom: `1px solid ${D.border}` }}>
        <SectionHeader label="Lower" color={D.red} sub="2 defeats — loser eliminated → Masters Seed #3" />
        <div className="mt-4">
          <GenericBracketGrid
            rounds={["KICKOFF_LB_R1","KICKOFF_LB_R2","KICKOFF_LB_R3","KICKOFF_LB_QF","KICKOFF_LB_SF","KICKOFF_LB_FINAL"]}
            roundLabels={["LB R1","LB R2","LB R3","LB QF","LB SF","LB Final · BO5"]}
            byRound={byRound} userTeamId={userTeamId}
          />
        </div>
      </div>
    </div>
  );
}

// ── Upper bracket with fixed grid layout ──

const SLOT_H = 64; // height of one match card
const SLOT_GAP = 12; // gap between cards in same round
const LINE_COLOR = "rgba(255,255,255,0.1)";

function UpperBracketGrid({ r1, r2, semi, final_, userTeamId }: {
  r1: SlotData[]; r2: SlotData[]; semi: SlotData[]; final_: SlotData; userTeamId: string;
}) {
  const colW = 210;
  const connW = 40;
  const totalW = colW * 4 + connW * 3;
  const r1TotalH = SLOT_H * 4 + SLOT_GAP * 3;

  const r1Y = Array.from({ length: 4 }, (_, i) => i * (SLOT_H + SLOT_GAP));
  const r2Y = r1Y;
  const semiY = [0, 1].map((i) => (r2Y[i * 2] + r2Y[i * 2 + 1] + SLOT_H) / 2 - SLOT_H / 2);
  const finalY = (semiY[0] + semiY[1] + SLOT_H) / 2 - SLOT_H / 2;

  const headerH = 24;
  const totalH = r1TotalH + headerH;

  const x1 = 0;
  const x1r = x1 + colW;
  const x2 = x1r + connW;
  const x2r = x2 + colW;
  const x3 = x2r + connW;
  const x3r = x3 + colW;
  const x4 = x3r + connW;

  return (
    <div className="overflow-x-auto">
      <div className="relative" style={{ width: totalW, height: totalH, minWidth: totalW }}>
        <svg className="absolute inset-0 pointer-events-none" width={totalW} height={totalH}>
          {r1Y.map((y, i) => {
            const cy = headerH + y + SLOT_H / 2;
            return <line key={`r1r2-${i}`} x1={x1r} y1={cy} x2={x2} y2={cy} stroke={LINE_COLOR} strokeWidth="1" />;
          })}

          {[0, 1].map((pair) => {
            const top = headerH + r2Y[pair * 2] + SLOT_H / 2;
            const bot = headerH + r2Y[pair * 2 + 1] + SLOT_H / 2;
            const mid = (top + bot) / 2;
            const jx = x2r + connW / 2;
            return (
              <g key={`r2semi-${pair}`}>
                <line x1={x2r} y1={top} x2={jx} y2={top} stroke={LINE_COLOR} strokeWidth="1" />
                <line x1={x2r} y1={bot} x2={jx} y2={bot} stroke={LINE_COLOR} strokeWidth="1" />
                <line x1={jx} y1={top} x2={jx} y2={bot} stroke={LINE_COLOR} strokeWidth="1" />
                <line x1={jx} y1={mid} x2={x3} y2={mid} stroke={LINE_COLOR} strokeWidth="1" />
              </g>
            );
          })}

          {(() => {
            const top = headerH + semiY[0] + SLOT_H / 2;
            const bot = headerH + semiY[1] + SLOT_H / 2;
            const mid = (top + bot) / 2;
            const jx = x3r + connW / 2;
            return (
              <g>
                <line x1={x3r} y1={top} x2={jx} y2={top} stroke={LINE_COLOR} strokeWidth="1" />
                <line x1={x3r} y1={bot} x2={jx} y2={bot} stroke={LINE_COLOR} strokeWidth="1" />
                <line x1={jx} y1={top} x2={jx} y2={bot} stroke={LINE_COLOR} strokeWidth="1" />
                <line x1={jx} y1={mid} x2={x4} y2={mid} stroke={LINE_COLOR} strokeWidth="1" />
              </g>
            );
          })()}
        </svg>

        <Header x={x1} text="Round 1" />
        <Header x={x2} text="Round 2" />
        <Header x={x3} text="Semifinal" />
        <Header x={x4} text="Final · BO5" />

        {r1.map((slot, i) => (
          <div key={`r1-${i}`} className="absolute" style={{ left: x1, top: headerH + r1Y[i], width: colW }}>
            <MatchCard slot={slot} userTeamId={userTeamId} />
          </div>
        ))}

        {r2.map((slot, i) => (
          <div key={`r2-${i}`} className="absolute" style={{ left: x2, top: headerH + r2Y[i], width: colW }}>
            <MatchCard slot={slot} userTeamId={userTeamId} />
          </div>
        ))}

        {semi.map((slot, i) => (
          <div key={`semi-${i}`} className="absolute" style={{ left: x3, top: headerH + semiY[i], width: colW }}>
            <MatchCard slot={slot} userTeamId={userTeamId} />
          </div>
        ))}

        <div className="absolute" style={{ left: x4, top: headerH + finalY, width: colW }}>
          <MatchCard slot={final_} userTeamId={userTeamId} isFinal />
        </div>
      </div>
    </div>
  );
}

function Header({ x, text }: { x: number; text: string }) {
  return (
    <div
      className="absolute text-[10px] font-medium uppercase tracking-[0.3em]"
      style={{ left: x, top: 0, color: D.textSubtle }}
    >
      {text}
    </div>
  );
}

// ── Generic bracket grid for Middle/Lower ──

function GenericBracketGrid({ rounds, roundLabels, byRound, userTeamId }: {
  rounds: string[]; roundLabels: string[];
  byRound: Map<string, BMatch[]>; userTeamId: string;
}) {
  const roundSlots: SlotData[][] = rounds.map((roundId) => {
    const matches = byRound.get(roundId) ?? [];
    return matches.map((m) => ({
      match: m,
      t1: { name: m.team1.name, tag: m.team1.tag, logo: m.team1.logoUrl },
      t2: { name: m.team2.name, tag: m.team2.tag, logo: m.team2.logoUrl },
      label: "", format: m.format,
      isFinal: roundId.includes("FINAL"),
    }));
  });

  const colW = 200;
  const connW = 36;
  const headerH = 24;
  const maxSlots = Math.max(...roundSlots.map((s) => s.length), 1);
  const contentH = maxSlots * (SLOT_H + SLOT_GAP) - SLOT_GAP;
  const totalH = headerH + contentH;
  const totalW = colW * rounds.length + connW * Math.max(0, rounds.length - 1);

  const cardCenters: number[][] = roundSlots.map((slots) => {
    const n = Math.max(slots.length, 1);
    const roundH = n * (SLOT_H + SLOT_GAP) - SLOT_GAP;
    const yOff = (contentH - roundH) / 2;
    return Array.from({ length: n }, (_, i) => headerH + yOff + i * (SLOT_H + SLOT_GAP) + SLOT_H / 2);
  });

  return (
    <div className="overflow-x-auto">
      <div className="relative" style={{ width: totalW, height: totalH, minWidth: totalW }}>
        <svg className="absolute inset-0 pointer-events-none" width={totalW} height={totalH}>
          {rounds.map((_, colIdx) => {
            if (colIdx >= rounds.length - 1) return null;
            const cur = cardCenters[colIdx];
            const next = cardCenters[colIdx + 1];
            if (!cur.length || !next.length) return null;

            const xRight = colW * (colIdx + 1) + connW * colIdx;
            const xLeft = colW * (colIdx + 1) + connW * (colIdx + 1);
            const xMid = (xRight + xLeft) / 2;

            if (cur.length === next.length) {
              return cur.map((cy, i) => (
                <line key={`s-${colIdx}-${i}`} x1={xRight} y1={cy} x2={xLeft} y2={next[i]} stroke={LINE_COLOR} strokeWidth="1" />
              ));
            }

            return next.map((nextY, ni) => {
              const i1 = ni * 2;
              const i2 = ni * 2 + 1;
              const y1 = cur[i1] ?? nextY;
              const y2 = i2 < cur.length ? cur[i2] : y1;
              return (
                <g key={`m-${colIdx}-${ni}`}>
                  <line x1={xRight} y1={y1} x2={xMid} y2={y1} stroke={LINE_COLOR} strokeWidth="1" />
                  {y2 !== y1 && <line x1={xRight} y1={y2} x2={xMid} y2={y2} stroke={LINE_COLOR} strokeWidth="1" />}
                  {y2 !== y1 && <line x1={xMid} y1={y1} x2={xMid} y2={y2} stroke={LINE_COLOR} strokeWidth="1" />}
                  <line x1={xMid} y1={nextY} x2={xLeft} y2={nextY} stroke={LINE_COLOR} strokeWidth="1" />
                </g>
              );
            });
          })}
        </svg>

        {rounds.map((roundId, colIdx) => {
          const x = colW * colIdx + connW * colIdx;
          const slots = roundSlots[colIdx];
          const n = Math.max(slots.length, 1);
          const roundH = n * (SLOT_H + SLOT_GAP) - SLOT_GAP;
          const yOff = (contentH - roundH) / 2;
          const isFinal = roundId.includes("FINAL");

          return (
            <div key={roundId}>
              <div
                className="absolute text-[10px] font-medium uppercase tracking-[0.3em]"
                style={{ left: x, top: 0, color: D.textSubtle }}
              >
                {roundLabels[colIdx]}
              </div>
              {slots.length > 0 ? slots.map((slot, i) => (
                <div key={`${roundId}-${i}`} className="absolute" style={{ left: x, top: headerH + yOff + i * (SLOT_H + SLOT_GAP), width: colW }}>
                  <MatchCard slot={slot} userTeamId={userTeamId} isFinal={isFinal} />
                </div>
              )) : (
                <div className="absolute" style={{ left: x, top: headerH + yOff, width: colW }}>
                  <div
                    className="rounded p-3 text-center"
                    style={{
                      height: SLOT_H,
                      border: `1px dashed ${D.borderFaint}`,
                    }}
                  >
                    <span className="text-[10px]" style={{ color: D.textFaint }}>
                      TBD
                    </span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Sub-components ──

function SectionHeader({ label, color, sub }: { label: string; color: string; sub: string }) {
  return (
    <div className="flex items-center gap-3">
      <span
        className="text-[11px] font-medium uppercase tracking-[0.3em]"
        style={{ color }}
      >
        {label}
      </span>
      <span
        className="text-[10px] uppercase tracking-[0.2em]"
        style={{ color: D.textSubtle }}
      >
        {sub}
      </span>
    </div>
  );
}

function MatchCard({ slot, userTeamId, isFinal }: { slot: SlotData; userTeamId: string; isFinal?: boolean }) {
  const { match, t1, t2 } = slot;
  const score = match?.score as { team1: number; team2: number } | null;
  const t1Won = match?.winnerId === match?.team1?.id;
  const t2Won = match?.winnerId === match?.team2?.id;
  const isUser = match?.team1?.id === userTeamId || match?.team2?.id === userTeamId;
  const isTbd = !t1 && !t2;

  if (isTbd) {
    return (
      <div
        className="rounded"
        style={{
          background: D.card,
          border: `1px dashed ${D.borderFaint}`,
        }}
      >
        <div className="px-2.5 py-2 text-[10px]" style={{ color: D.textFaint }}>
          TBD
        </div>
        <div style={{ borderTop: `1px dashed ${D.borderFaint}` }} />
        <div className="px-2.5 py-2 text-[10px]" style={{ color: D.textFaint }}>
          TBD
        </div>
      </div>
    );
  }

  const borderColor = isUser
    ? "rgba(255,70,85,0.45)"
    : isFinal
      ? "rgba(198,155,58,0.35)"
      : D.border;
  const bgColor = isUser
    ? "rgba(255,70,85,0.06)"
    : D.surface;

  const inner = (
    <div
      className="rounded transition-colors"
      style={{
        background: bgColor,
        border: `1px solid ${borderColor}`,
      }}
    >
      <TeamRow
        name={t1?.name ?? "TBD"}
        logo={t1?.logo ?? null}
        score={match?.isPlayed && score ? score.team1 : null}
        won={t1Won}
        lost={t2Won && match?.isPlayed}
        isTbd={!t1}
      />
      <div style={{ borderTop: `1px solid ${D.borderFaint}` }} />
      <TeamRow
        name={t2?.name ?? "TBD"}
        logo={t2?.logo ?? null}
        score={match?.isPlayed && score ? score.team2 : null}
        won={t2Won}
        lost={t1Won && match?.isPlayed}
        isTbd={!t2 || t2.tag === "TBD"}
      />
    </div>
  );

  if (match?.isPlayed) return <Link href={`/match/${match.id}`}>{inner}</Link>;
  return inner;
}

function TeamRow({ name, logo, score, won, lost, isTbd }: {
  name: string; logo: string | null; score: number | null; won: boolean; lost?: boolean; isTbd: boolean;
}) {
  return (
    <div
      className="flex items-center justify-between px-2.5 py-1.5"
      style={{ opacity: lost ? 0.35 : 1 }}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {logo ? (
          <img src={logo} alt="" className="h-4 w-4 shrink-0 object-contain" />
        ) : (
          <div
            className="h-4 w-4 shrink-0 rounded"
            style={{ background: isTbd ? D.borderFaint : D.card }}
          />
        )}
        <span
          className="truncate text-[11px] font-medium"
          style={{
            color: isTbd ? D.textSubtle : D.textPrimary,
            fontStyle: isTbd ? "italic" : undefined,
          }}
        >
          {name}
        </span>
      </div>
      {score !== null && (
        <span
          className="ml-2 text-[12px] font-medium tabular-nums"
          style={{ color: won ? D.textPrimary : D.textSubtle }}
        >
          {score}
        </span>
      )}
    </div>
  );
}

function shortName(name: string): string {
  const parts = name.split(" ");
  if (parts.length === 1) return name;
  return parts[parts.length - 1];
}
