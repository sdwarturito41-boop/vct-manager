"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc-client";
import { PlayerCard } from "@/components/PlayerCard";
import { formatCurrency } from "@/lib/format";
import type { PlayerInfo } from "@/lib/types";

type RoleFilter = "Duelist" | "Initiator" | "Sentinel" | "Controller" | "IGL" | "";
type RegionFilter = "EMEA" | "Americas" | "Pacific" | "China" | "";

const ROLES: RoleFilter[] = ["", "Duelist", "Initiator", "Sentinel", "Controller", "IGL"];
const REGIONS: RegionFilter[] = ["", "EMEA", "Americas", "Pacific", "China"];

export default function MarketPage() {
  const [role, setRole] = useState<RoleFilter>("");
  const [region, setRegion] = useState<RegionFilter>("");

  const { data: team } = trpc.team.get.useQuery(undefined, { retry: false });
  const { data: freeAgents, isLoading } = trpc.player.market.useQuery(
    {
      role: role || undefined,
      region: region || undefined,
    }
  );

  const utils = trpc.useUtils();
  const buyMutation = trpc.player.buy.useMutation({
    onSuccess: () => {
      utils.team.get.invalidate();
      utils.player.market.invalidate();
    },
  });

  const handleSign = (playerId: string, salary: number) => {
    if (!team) return;
    const cost = salary * 4;
    if (team.budget < cost) {
      alert(
        `Insufficient budget. Need ${formatCurrency(cost)}, have ${formatCurrency(team.budget)}.`
      );
      return;
    }
    if (confirm(`Sign this player for ${formatCurrency(cost)} (4 weeks salary)?`)) {
      buyMutation.mutate({ playerId });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-black uppercase tracking-[0.15em] text-[var(--val-white)]">
            Market
          </h1>
          <p className="mt-1 text-sm uppercase tracking-[0.1em] text-[var(--val-white)]/30">
            Free Agents
          </p>
        </div>
        {team && (
          <div className="text-right">
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--val-white)]/30">
              Available Budget
            </div>
            <div className="text-lg font-bold text-[var(--val-gold)]">
              {formatCurrency(team.budget)}
            </div>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Role filter */}
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as RoleFilter)}
          className="rounded border border-[var(--val-gray)] bg-[var(--val-bg)] px-4 py-2.5 text-sm text-[var(--val-white)] outline-none transition-colors focus:border-[var(--val-red)]"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r || "All Roles"}
            </option>
          ))}
        </select>

        {/* Region filter */}
        <select
          value={region}
          onChange={(e) => setRegion(e.target.value as RegionFilter)}
          className="rounded border border-[var(--val-gray)] bg-[var(--val-bg)] px-4 py-2.5 text-sm text-[var(--val-white)] outline-none transition-colors focus:border-[var(--val-red)]"
        >
          {REGIONS.map((r) => (
            <option key={r} value={r}>
              {r || "All Regions"}
            </option>
          ))}
        </select>
      </div>

      {/* Results */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--val-gray)] border-t-[var(--val-red)]" />
        </div>
      ) : freeAgents && freeAgents.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {(freeAgents as PlayerInfo[]).map((player: PlayerInfo) => (
            <PlayerCard
              key={player.id}
              player={player}
              actions={
                <button
                  onClick={() => handleSign(player.id, player.salary)}
                  disabled={buyMutation.isPending}
                  className="w-full rounded bg-[var(--val-red)] py-2.5 text-xs font-bold uppercase tracking-[0.15em] text-white transition-all hover:bg-[var(--val-red)]/90 hover:shadow-lg hover:shadow-[var(--val-red)]/25 disabled:opacity-50"
                >
                  {buyMutation.isPending ? "Signing..." : "Sign Player"}
                </button>
              }
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--val-gray)] bg-[var(--val-surface)] p-12 text-center">
          <p className="text-sm text-[var(--val-white)]/30">
            No free agents found matching your filters.
          </p>
        </div>
      )}
    </div>
  );
}
