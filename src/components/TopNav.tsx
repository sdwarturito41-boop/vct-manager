"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { trpc } from "@/lib/trpc-client";
import { D } from "@/constants/design";
import { formatCurrency } from "@/lib/format";
import { formatGameDate } from "@/lib/game-date";
import { AdvanceDayButton } from "@/components/AdvanceDayButton";

import { MAIN_TABS, activeMainTab } from "@/constants/nav";

export function TopNav() {
  const pathname = usePathname();
  const active = activeMainTab(pathname);
  const { data: team } = trpc.team.get.useQuery(undefined, { retry: false });
  const { data: season } = trpc.season.getCurrent.useQuery(undefined, { retry: false });
  const { data: unreadCount = 0 } = trpc.message.unreadCount.useQuery(undefined, {
    retry: false,
    refetchInterval: 15000,
  });

  return (
    <header
      className="flex shrink-0 items-center justify-between px-6"
      style={{
        height: 52,
        background: D.navBg,
        borderBottom: `1px solid ${D.navBorder}`,
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <div className="flex items-center gap-6">
        {/* Logo + team identity */}
        <Link href="/dashboard" className="flex items-center gap-3">
          {team?.logoUrl ? (
            <img src={team.logoUrl} alt={team.name} className="h-8 w-8 object-contain" />
          ) : (
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full"
              style={{ background: D.navCard, border: `1px solid ${D.navBorder}` }}
            >
              <span className="text-[12px] font-medium" style={{ color: "#ffffff" }}>
                {team?.name?.slice(0, 2) ?? "·"}
              </span>
            </div>
          )}
          <span className="text-[14px] font-medium" style={{ color: "#ffffff" }}>
            {team?.name ?? "valo.gg"}
          </span>
        </Link>

        {/* Main tabs */}
        <nav className="flex items-center gap-5">
          {MAIN_TABS.map((tab) => {
            const isActive = active?.label === tab.label;
            const showBadge = tab.label === "Career" && unreadCount > 0;
            return (
              <Link
                key={tab.label}
                href={tab.href}
                className="relative flex items-center gap-1.5 py-4.5 text-[13px] transition-colors"
                style={{
                  color: isActive ? "#ffffff" : "rgba(255,255,255,0.55)",
                  fontWeight: isActive ? 500 : 400,
                }}
              >
                {tab.label}
                {showBadge && (
                  <span
                    className="rounded-full px-1.5 text-[10px] tabular-nums"
                    style={{
                      background: D.primary,
                      color: "#ffffff",
                      minWidth: 16,
                      textAlign: "center",
                    }}
                  >
                    {unreadCount}
                  </span>
                )}
                {isActive && (
                  <span
                    className="absolute bottom-0 left-0 right-0"
                    style={{ height: 2, background: D.primary }}
                  />
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="flex items-center gap-3">
        {season && (
          <div className="flex flex-col items-end leading-tight">
            <span className="text-[12px] tabular-nums" style={{ color: "#ffffff" }}>
              {formatGameDate(season.currentDay)}
            </span>
            <span className="text-[10px]" style={{ color: "rgba(255,255,255,0.5)" }}>
              Week {season.currentWeek}
            </span>
          </div>
        )}
        {team && (
          <span
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] tabular-nums"
            style={{
              background: "rgba(29,158,117,0.16)",
              color: D.teal,
              border: `1px solid rgba(29,158,117,0.3)`,
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: 999, background: D.teal }} />
            {formatCurrency(team.budget)}
          </span>
        )}
        <div style={{ minWidth: 140 }}>
          <AdvanceDayButton />
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/auth/login" })}
          className="text-[11px] transition-colors"
          style={{ color: "rgba(255,255,255,0.45)" }}
          aria-label="Sign out"
        >
          ↪
        </button>
      </div>
    </header>
  );
}
