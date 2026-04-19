"use client";

import { countryToFlag } from "@/lib/country-flag";
import { formatCurrency, formatStat } from "@/lib/format";

interface PlayerData {
  id: string;
  ign: string;
  firstName: string;
  lastName: string;
  nationality: string;
  age: number;
  role: string;
  imageUrl: string | null;
  salary: number;
  acs: number;
  kd: number;
  adr: number;
  kast: number;
  hs: number;
  isActive?: boolean;
}

const ROLE_COLORS: Record<string, string> = {
  Duelist: "bg-[var(--val-red)]/20 text-[var(--val-red)] border-[var(--val-red)]/30",
  Initiator: "bg-[var(--val-green)]/20 text-[var(--val-green)] border-[var(--val-green)]/30",
  Sentinel: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  Controller: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  IGL: "bg-[var(--val-gold)]/20 text-[var(--val-gold)] border-[var(--val-gold)]/30",
};

interface PlayerCardProps {
  player: PlayerData;
  actions?: React.ReactNode;
}

export function PlayerCard({ player, actions }: PlayerCardProps) {
  const roleStyle = ROLE_COLORS[player.role] ?? "bg-[var(--val-gray)]/20 text-[var(--val-white)]";

  return (
    <div className="group relative rounded-lg border border-[var(--val-gray)] bg-[var(--val-surface)] p-5 transition-all hover:border-[var(--val-red)]/40 hover:shadow-lg hover:shadow-[var(--val-red)]/5">
      {/* Header */}
      <div className="mb-4 flex items-start gap-4">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--val-gray)] bg-[var(--val-bg)]">
          {player.imageUrl ? (
            <img
              src={player.imageUrl}
              alt={player.ign}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="text-xl font-bold text-[var(--val-gray)]">
              {player.ign.charAt(0)}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-bold uppercase tracking-wider text-[var(--val-white)]">
            {player.ign}
          </h3>
          <p className="truncate text-sm text-[var(--val-white)]/50">
            {player.firstName} &ldquo;{player.ign}&rdquo; {player.lastName}
          </p>
        </div>
      </div>

      {/* Role + Nationality */}
      <div className="mb-4 flex items-center gap-2">
        <span
          className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-semibold uppercase tracking-widest ${roleStyle}`}
        >
          {player.role}
        </span>
        <span className="text-sm">
          {countryToFlag(player.nationality)}
        </span>
        <span className="text-xs text-[var(--val-white)]/40">
          Age {player.age}
        </span>
      </div>

      {/* Stats Grid */}
      <div className="mb-4 grid grid-cols-5 gap-1 rounded border border-[var(--val-gray)]/50 bg-[var(--val-bg)] p-2">
        {[
          { label: "ACS", value: formatStat(player.acs, 0) },
          { label: "K/D", value: formatStat(player.kd, 2) },
          { label: "ADR", value: formatStat(player.adr, 0) },
          { label: "KAST", value: `${formatStat(player.kast, 0)}%` },
          { label: "HS%", value: `${formatStat(player.hs, 0)}%` },
        ].map((stat) => (
          <div key={stat.label} className="text-center">
            <div className="text-[10px] font-medium uppercase tracking-wider text-[var(--val-white)]/30">
              {stat.label}
            </div>
            <div className="text-sm font-bold text-[var(--val-white)]">
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* Salary */}
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-[var(--val-white)]/30">
          Salary/wk
        </span>
        <span className="text-sm font-semibold text-[var(--val-gold)]">
          {formatCurrency(player.salary)}
        </span>
      </div>

      {/* Actions slot */}
      {actions && <div className="mt-4 border-t border-[var(--val-gray)]/50 pt-4">{actions}</div>}
    </div>
  );
}
