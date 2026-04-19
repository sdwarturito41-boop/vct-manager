import { serverTrpc } from "@/lib/trpc-server";
import { notFound } from "next/navigation";
import { formatStat } from "@/lib/format";
import { ALL_MAPS, getMapByName } from "@/constants/maps";

interface MapScore {
  mapName: string;
  team1Score: number;
  team2Score: number;
  team1Half1: number;
  team1Half2: number;
  team2Half1: number;
  team2Half2: number;
  overtime: boolean;
  scoreboard: ScoreboardEntry[];
  mvpPlayerId?: string;
  highlights?: string[];
}

interface ScoreboardEntry {
  playerId: string;
  playerIgn: string;
  teamId: string;
  acs: number;
  kills: number;
  deaths: number;
  assists: number;
  kd: number;
  adr: number;
  kast: number;
  fk: number;
  fd: number;
  hs: number;
}

export default async function MatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const api = await serverTrpc();
  const match = await api.match.getById({ matchId: id });

  if (!match) {
    notFound();
  }

  const score = match.score as { team1: number; team2: number } | null;
  const maps = (match.maps as MapScore[] | null) ?? [];

  return (
    <div className="space-y-6">
      {/* Back link */}
      <a
        href="/dashboard"
        className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-[var(--val-white)]/40 transition-colors hover:text-[var(--val-red)]"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back to Dashboard
      </a>

      {/* Match Header */}
      <div className="rounded-lg border border-[var(--val-gray)] bg-[var(--val-surface)] p-8">
        <div className="mb-4 text-center text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--val-white)]/30">
          {match.stageId.replace(/_/g, " ")} &middot; {match.format}
        </div>

        <div className="flex items-center justify-center gap-8">
          {/* Team 1 */}
          <div className="text-right">
            <div
              className={`text-2xl font-black uppercase tracking-[0.1em] ${
                match.winnerId === match.team1Id
                  ? "text-[var(--val-green)]"
                  : "text-[var(--val-white)]"
              }`}
            >
              {match.team1.name}
            </div>
            <div className="text-xs text-[var(--val-white)]/30">
              [{match.team1.tag}]
            </div>
          </div>

          {/* Score */}
          <div className="flex items-center gap-3">
            {score ? (
              <>
                <span
                  className={`text-4xl font-black ${
                    match.winnerId === match.team1Id
                      ? "text-[var(--val-white)]"
                      : "text-[var(--val-white)]/30"
                  }`}
                >
                  {score.team1}
                </span>
                <span className="text-lg text-[var(--val-white)]/20">:</span>
                <span
                  className={`text-4xl font-black ${
                    match.winnerId === match.team2Id
                      ? "text-[var(--val-white)]"
                      : "text-[var(--val-white)]/30"
                  }`}
                >
                  {score.team2}
                </span>
              </>
            ) : (
              <span className="text-sm font-bold uppercase tracking-widest text-[var(--val-red)]">
                Upcoming
              </span>
            )}
          </div>

          {/* Team 2 */}
          <div className="text-left">
            <div
              className={`text-2xl font-black uppercase tracking-[0.1em] ${
                match.winnerId === match.team2Id
                  ? "text-[var(--val-green)]"
                  : "text-[var(--val-white)]"
              }`}
            >
              {match.team2.name}
            </div>
            <div className="text-xs text-[var(--val-white)]/30">
              [{match.team2.tag}]
            </div>
          </div>
        </div>

        {match.winnerId && (
          <div className="mt-4 text-center text-xs font-semibold uppercase tracking-[0.2em] text-[var(--val-gold)]">
            {match.winnerId === match.team1Id
              ? match.team1.name
              : match.team2.name}{" "}
            Victory
          </div>
        )}
      </div>

      {/* Per-map results */}
      {maps.length > 0 && (
        <div className="space-y-4">
          {maps.map((map, mapIndex) => {
            const mapInfo = getMapByName(map.mapName);

            return (
              <div
                key={mapIndex}
                className="overflow-hidden rounded-lg border border-[var(--val-gray)] bg-[var(--val-surface)]"
              >
                {/* Map header */}
                <div className="flex items-center justify-between border-b border-[var(--val-gray)] p-4">
                  <div className="flex items-center gap-3">
                    {mapInfo && (
                      <img
                        src={mapInfo.imageUrl}
                        alt={map.mapName}
                        className="h-8 w-8 rounded object-cover"
                      />
                    )}
                    <div>
                      <h3 className="text-sm font-bold uppercase tracking-[0.15em] text-[var(--val-white)]">
                        Map {mapIndex + 1}: {map.mapName}
                      </h3>
                      <div className="text-[10px] text-[var(--val-white)]/30">
                        {map.team1Half1}-{map.team2Half1} / {map.team1Half2}-
                        {map.team2Half2}
                        {map.overtime && " / OT"}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span
                      className={`text-xl font-black ${
                        map.team1Score > map.team2Score
                          ? "text-[var(--val-white)]"
                          : "text-[var(--val-white)]/30"
                      }`}
                    >
                      {map.team1Score}
                    </span>
                    <span className="text-sm text-[var(--val-white)]/20">:</span>
                    <span
                      className={`text-xl font-black ${
                        map.team2Score > map.team1Score
                          ? "text-[var(--val-white)]"
                          : "text-[var(--val-white)]/30"
                      }`}
                    >
                      {map.team2Score}
                    </span>
                    {map.overtime && (
                      <span className="rounded bg-[var(--val-gold)]/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[var(--val-gold)]">
                        OT
                      </span>
                    )}
                  </div>
                </div>

                {/* Scoreboard */}
                {map.scoreboard && map.scoreboard.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--val-gray)]/50">
                          {[
                            "Player",
                            "ACS",
                            "K",
                            "D",
                            "A",
                            "K/D",
                            "ADR",
                            "KAST%",
                            "FK",
                            "FD",
                            "HS%",
                          ].map((h) => (
                            <th
                              key={h}
                              className="px-3 py-2 text-left text-[9px] font-semibold uppercase tracking-[0.2em] text-[var(--val-white)]/20"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {map.scoreboard.map((entry) => {
                          const isMvp = entry.playerId === map.mvpPlayerId;
                          const isTeam1 = entry.teamId === match.team1Id;

                          return (
                            <tr
                              key={entry.playerId}
                              className={`border-b border-[var(--val-gray)]/20 ${
                                isMvp ? "bg-[var(--val-gold)]/5" : ""
                              }`}
                            >
                              <td className="px-3 py-2">
                                <div className="flex items-center gap-2">
                                  <span
                                    className={`h-1 w-1 rounded-full ${
                                      isTeam1
                                        ? "bg-blue-400"
                                        : "bg-[var(--val-red)]"
                                    }`}
                                  />
                                  <span className="font-bold text-[var(--val-white)]">
                                    {entry.playerIgn}
                                  </span>
                                  {isMvp && (
                                    <span className="rounded bg-[var(--val-gold)]/20 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider text-[var(--val-gold)]">
                                      MVP
                                    </span>
                                  )}
                                </div>
                              </td>
                              <td className="px-3 py-2 font-bold text-[var(--val-white)]">
                                {formatStat(entry.acs, 0)}
                              </td>
                              <td className="px-3 py-2 text-[var(--val-green)]">
                                {entry.kills}
                              </td>
                              <td className="px-3 py-2 text-[var(--val-red)]">
                                {entry.deaths}
                              </td>
                              <td className="px-3 py-2 text-[var(--val-white)]/60">
                                {entry.assists}
                              </td>
                              <td className="px-3 py-2 text-[var(--val-white)]/60">
                                {formatStat(entry.kd, 2)}
                              </td>
                              <td className="px-3 py-2 text-[var(--val-white)]/60">
                                {formatStat(entry.adr, 0)}
                              </td>
                              <td className="px-3 py-2 text-[var(--val-white)]/60">
                                {formatStat(entry.kast, 0)}%
                              </td>
                              <td className="px-3 py-2 text-[var(--val-white)]/60">
                                {entry.fk}
                              </td>
                              <td className="px-3 py-2 text-[var(--val-white)]/60">
                                {entry.fd}
                              </td>
                              <td className="px-3 py-2 text-[var(--val-white)]/60">
                                {formatStat(entry.hs, 0)}%
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Highlights */}
                {map.highlights && map.highlights.length > 0 && (
                  <div className="border-t border-[var(--val-gray)]/50 p-4">
                    <div className="mb-2 text-[9px] font-semibold uppercase tracking-[0.2em] text-[var(--val-white)]/20">
                      Highlights
                    </div>
                    <ul className="space-y-1">
                      {map.highlights.map((highlight, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2 text-xs text-[var(--val-white)]/50"
                        >
                          <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-[var(--val-red)]" />
                          {highlight}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!match.isPlayed && (
        <div className="rounded-lg border border-dashed border-[var(--val-gray)] bg-[var(--val-surface)] p-12 text-center">
          <p className="text-sm text-[var(--val-white)]/30">
            This match has not been played yet.
          </p>
        </div>
      )}
    </div>
  );
}
