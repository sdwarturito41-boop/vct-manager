"use client";

interface StatsBarProps {
  label: string;
  value: number;
  color?: string;
}

export function StatsBar({
  label,
  value,
  color = "var(--val-red)",
}: StatsBarProps) {
  const clampedValue = Math.max(0, Math.min(100, value));

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-widest text-[var(--val-white)]/60">
          {label}
        </span>
        <span className="text-sm font-bold text-[var(--val-white)]">
          {clampedValue}
        </span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--val-bg)] border border-[var(--val-gray)]/50">
        <div
          className="h-full rounded-full transition-all duration-500 ease-out"
          style={{
            width: `${clampedValue}%`,
            backgroundColor: color,
            boxShadow: `0 0 8px ${color}40`,
          }}
        />
      </div>
    </div>
  );
}
