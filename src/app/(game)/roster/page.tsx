"use client";

import { trpc } from "@/lib/trpc-client";
import { PlayerCard } from "@/components/PlayerCard";
import type { PlayerInfo } from "@/lib/types";

export default function RosterPage() {
  const { data: team, isLoading: teamLoading } = trpc.team.get.useQuery(
    undefined,
    { retry: false }
  );
  const { data: allPlayers, isLoading: playersLoading } =
    trpc.player.rosterAll.useQuery(undefined, { retry: false });

  const utils = trpc.useUtils();

  const toggleMutation = trpc.team.togglePlayerActive.useMutation({
    onSuccess: () => {
      utils.player.rosterAll.invalidate();
      utils.team.get.invalidate();
    },
  });

  const sellMutation = trpc.player.sell.useMutation({
    onSuccess: () => {
      utils.player.rosterAll.invalidate();
      utils.team.get.invalidate();
    },
  });

  const handleRelease = (player: PlayerInfo) => {
    const recover = player.salary * 2;
    if (
      window.confirm(
        `Release ${player.ign}? You'll recover $${recover.toLocaleString()}`
      )
    ) {
      sellMutation.mutate({ playerId: player.id });
    }
  };

  const isLoading = teamLoading || playersLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--val-gray)] border-t-[var(--val-red)]" />
      </div>
    );
  }

  if (!team || !allPlayers) {
    return (
      <div className="flex items-center justify-center py-32">
        <p className="text-sm text-[var(--val-white)]/40">No team found.</p>
      </div>
    );
  }

  const players = allPlayers as PlayerInfo[];
  const activePlayers = players.filter((p: PlayerInfo) => p.isActive);
  const benchPlayers = players.filter((p: PlayerInfo) => !p.isActive);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-black uppercase tracking-[0.15em] text-[var(--val-white)]">
          Roster
        </h1>
        <p className="mt-1 text-sm uppercase tracking-[0.1em] text-[var(--val-white)]/30">
          {allPlayers.length} players &middot; {activePlayers.length} active
        </p>
      </div>

      {/* Active Roster */}
      {activePlayers.length > 0 && (
        <div>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--val-green)]">
            Active Roster
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {activePlayers.map((player: PlayerInfo) => (
              <PlayerCard
                key={player.id}
                player={player}
                actions={
                  <div className="flex gap-2">
                    <button
                      onClick={() =>
                        toggleMutation.mutate({
                          playerId: player.id,
                          isActive: false,
                        })
                      }
                      disabled={toggleMutation.isPending}
                      className="flex-1 rounded border border-[var(--val-gray)] bg-[var(--val-bg)] py-2 text-xs font-bold uppercase tracking-[0.15em] text-[var(--val-white)]/50 transition-all hover:border-[var(--val-red)]/40 hover:text-[var(--val-red)]"
                    >
                      Move to Bench
                    </button>
                    <button
                      onClick={() => handleRelease(player)}
                      disabled={sellMutation.isPending}
                      className="rounded border border-[var(--val-red)]/20 bg-[var(--val-red)]/5 px-3 py-2 text-xs font-bold uppercase tracking-[0.15em] text-[var(--val-red)]/70 transition-all hover:bg-[var(--val-red)]/15 hover:text-[var(--val-red)]"
                    >
                      Release
                    </button>
                  </div>
                }
              />
            ))}
          </div>
        </div>
      )}

      {/* Bench */}
      {benchPlayers.length > 0 && (
        <div>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--val-white)]/40">
            Bench
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {benchPlayers.map((player: PlayerInfo) => (
              <PlayerCard
                key={player.id}
                player={player}
                actions={
                  <div className="flex gap-2">
                    <button
                      onClick={() =>
                        toggleMutation.mutate({
                          playerId: player.id,
                          isActive: true,
                        })
                      }
                      disabled={toggleMutation.isPending}
                      className="flex-1 rounded bg-[var(--val-green)]/10 py-2 text-xs font-bold uppercase tracking-[0.15em] text-[var(--val-green)] transition-all hover:bg-[var(--val-green)]/20"
                    >
                      Activate
                    </button>
                    <button
                      onClick={() => handleRelease(player)}
                      disabled={sellMutation.isPending}
                      className="rounded border border-[var(--val-red)]/20 bg-[var(--val-red)]/5 px-3 py-2 text-xs font-bold uppercase tracking-[0.15em] text-[var(--val-red)]/70 transition-all hover:bg-[var(--val-red)]/15 hover:text-[var(--val-red)]"
                    >
                      Release
                    </button>
                  </div>
                }
              />
            ))}
          </div>
        </div>
      )}

      {allPlayers.length === 0 && (
        <div className="rounded-lg border border-dashed border-[var(--val-gray)] bg-[var(--val-surface)] p-12 text-center">
          <p className="text-sm text-[var(--val-white)]/30">
            No players on your roster. Head to the{" "}
            <a href="/market" className="text-[var(--val-red)] underline">
              Market
            </a>{" "}
            to sign free agents.
          </p>
        </div>
      )}
    </div>
  );
}
