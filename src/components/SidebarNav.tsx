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

// Per VALO.GG spec: navigation is the only dark surface on the site, with
// muted-white text and indigo primary as the active accent (never coral/red).
const NAV_TEXT = "rgba(255,255,255,0.72)";
const NAV_TEXT_ACTIVE = "#FFFFFF";
const NAV_TEXT_SUBTLE = "rgba(255,255,255,0.4)";

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
        background: D.navBg,
        borderRight: `1px solid ${D.navBorder}`,
        fontFamily: "Inter, system-ui, sans-serif",
        color: NAV_TEXT,
      }}
    >
      {/* Brand */}
      <div className="px-5 py-5" style={{ borderBottom: `1px solid ${D.navBorder}` }}>
        <div className="text-[11px]" style={{ color: NAV_TEXT_SUBTLE }}>
          Manager
        </div>
        <div className="mt-0.5 text-[16px] font-medium" style={{ color: NAV_TEXT_ACTIVE }}>
          valo<span style={{ color: D.primary }}>.gg</span>
        </div>
      </div>

      {/* Team identity */}
      {team && (
        <div
          className="flex flex-col gap-2.5 px-5 py-4"
          style={{ borderBottom: `1px solid ${D.navBorder}` }}
        >
          <div className="flex items-center gap-2.5">
            {team.logoUrl ? (
              <img src={team.logoUrl} alt={team.name} className="h-8 w-8 shrink-0 object-contain" />
            ) : (
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded"
                style={{ background: D.navCard, border: `1px solid ${D.navBorder}` }}
              >
                <span className="text-[11px] font-medium" style={{ color: NAV_TEXT_ACTIVE }}>
                  {team.name.slice(0, 2)}
                </span>
              </div>
            )}
            <div className="min-w-0">
              <div
                className="truncate text-[13px] font-medium"
                style={{ color: NAV_TEXT_ACTIVE }}
              >
                {team.name}
              </div>
              <div className="text-[11px]" style={{ color: NAV_TEXT_SUBTLE }}>
                {team.region}
              </div>
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[11px]" style={{ color: NAV_TEXT_SUBTLE }}>
              Budget
            </span>
            <span className="text-[13px] font-medium tabular-nums" style={{ color: NAV_TEXT_ACTIVE }}>
              {formatCurrency(team.budget)}
            </span>
          </div>
        </div>
      )}

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className="group relative flex items-center px-5 py-2.5 text-[13px] transition-colors"
              style={{
                color: isActive ? NAV_TEXT_ACTIVE : NAV_TEXT,
                background: isActive ? D.navCard : "transparent",
                fontWeight: isActive ? 500 : 400,
              }}
              onMouseEnter={(e) => {
                if (!isActive) e.currentTarget.style.color = NAV_TEXT_ACTIVE;
              }}
              onMouseLeave={(e) => {
                if (!isActive) e.currentTarget.style.color = NAV_TEXT;
              }}
            >
              {isActive && (
                <div
                  className="absolute left-0 top-0 bottom-0 w-[2px]"
                  style={{ background: D.primary }}
                />
              )}
              <span className="flex-1">{item.label}</span>
              {item.href === "/inbox" && unreadCount > 0 && (
                <span
                  className="ml-auto rounded-full px-1.5 text-[11px] font-medium tabular-nums"
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
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div
        className="flex flex-col gap-2 px-5 py-4"
        style={{ borderTop: `1px solid ${D.navBorder}` }}
      >
        <button
          onClick={() => signOut({ callbackUrl: "/auth/login" })}
          className="text-left text-[11px] transition-colors"
          style={{ color: NAV_TEXT_SUBTLE }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = NAV_TEXT_ACTIVE;
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = NAV_TEXT_SUBTLE;
          }}
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
