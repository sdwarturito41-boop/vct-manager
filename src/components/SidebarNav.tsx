"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { trpc } from "@/lib/trpc-client";
import { formatCurrency } from "@/lib/format";
import { D } from "@/constants/design";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/inbox", label: "Inbox" },
  { href: "/roster", label: "Roster" },
  { href: "/market", label: "Market" },
  { href: "/scrims", label: "Scrims" },
  { href: "/training", label: "Training" },
  { href: "/tactics", label: "Tactics" },
  { href: "/staff", label: "Staff" },
  { href: "/sponsors", label: "Sponsors" },
  { href: "/season", label: "Season" },
  { href: "/league", label: "League" },
  { href: "/patches", label: "Patches" },
];

export function SidebarNav() {
  const pathname = usePathname();
  const { data: team } = trpc.team.get.useQuery(undefined, { retry: false });
  const { data: unreadCount = 0 } = trpc.message.unreadCount.useQuery(undefined, {
    retry: false,
    refetchInterval: 15000,
  });

  return (
    <aside
      className="flex w-56 shrink-0 flex-col"
      style={{
        background: D.surface,
        borderRight: `1px solid ${D.border}`,
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      {/* ── Brand ── */}
      <div className="px-5 py-5" style={{ borderBottom: `1px solid ${D.borderFaint}` }}>
        <div
          className="text-[10px] font-medium uppercase tracking-[0.4em]"
          style={{ color: D.textSubtle }}
        >
          Manager
        </div>
        <div
          className="mt-0.5 text-[15px] font-medium uppercase tracking-[0.1em]"
          style={{ color: D.textPrimary }}
        >
          VCT <span style={{ color: D.red }}>2026</span>
        </div>
      </div>

      {/* ── Team identity ── */}
      {team && (
        <div className="flex flex-col gap-2.5 px-5 py-4" style={{ borderBottom: `1px solid ${D.borderFaint}` }}>
          <div className="flex items-center gap-2.5">
            {team.logoUrl ? (
              <img src={team.logoUrl} alt={team.name} className="h-8 w-8 shrink-0 object-contain" />
            ) : (
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded"
                style={{ background: D.hoverBg, border: `1px solid ${D.borderFaint}` }}
              >
                <span className="text-[11px] font-medium" style={{ color: D.textPrimary }}>
                  {team.name.slice(0, 2).toUpperCase()}
                </span>
              </div>
            )}
            <div className="min-w-0">
              <div
                className="truncate text-[13px] font-medium uppercase tracking-[0.05em]"
                style={{ color: D.textPrimary }}
              >
                {team.name}
              </div>
              <div className="text-[9px] font-medium uppercase tracking-[0.2em]" style={{ color: D.textSubtle }}>
                {team.region}
              </div>
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span
              className="text-[9px] font-medium uppercase tracking-[0.25em]"
              style={{ color: D.textSubtle }}
            >
              Budget
            </span>
            <span className="text-[13px] font-medium tabular-nums" style={{ color: D.gold }}>
              {formatCurrency(team.budget)}
            </span>
          </div>
        </div>
      )}

      {/* ── Nav ── */}
      <nav className="flex-1 overflow-y-auto py-3">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className="group relative flex items-center px-5 py-2.5 text-[12px] font-medium uppercase tracking-[0.2em] transition-colors"
              style={{
                color: isActive ? D.textPrimary : D.textMuted,
                background: isActive ? "rgba(255,70,85,0.06)" : "transparent",
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.color = D.textPrimary;
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.color = D.textMuted;
              }}
            >
              {isActive && (
                <div
                  className="absolute left-0 top-0 bottom-0 w-[2px]"
                  style={{ background: D.red }}
                />
              )}
              <span className="flex-1">{item.label}</span>
              {item.href === "/inbox" && unreadCount > 0 && (
                <span
                  className="ml-auto rounded-full px-1.5 text-[9px] font-medium tabular-nums"
                  style={{
                    background: D.red,
                    color: "#ffffff",
                    minWidth: 16,
                    textAlign: "center",
                  }}
                >
                  {unreadCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* ── Footer ── */}
      <div className="flex flex-col gap-2 px-5 py-4" style={{ borderTop: `1px solid ${D.borderFaint}` }}>
        <button
          onClick={() => signOut({ callbackUrl: "/auth/login" })}
          className="text-left text-[10px] font-medium uppercase tracking-[0.25em] transition-colors"
          style={{ color: D.textSubtle }}
          onMouseEnter={(e) => { e.currentTarget.style.color = D.red; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = D.textSubtle; }}
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
