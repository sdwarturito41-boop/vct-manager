"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { D } from "@/constants/design";
import { activeMainTab } from "@/constants/nav";

// Renders the sub-tabs of whichever main tab is currently active. Lives in
// the game layout so every page gets a contextual second navigation row
// without each page having to re-implement it.
export function SubNav() {
  const pathname = usePathname();
  const main = activeMainTab(pathname);
  if (!main) return null;
  // A single-route main tab (e.g. Recruitment) doesn't need a sub-row.
  if (main.subs.length <= 1) return null;

  return (
    <nav
      className="flex shrink-0 items-center gap-5 px-6"
      style={{
        height: 36,
        background: D.surface,
        borderBottom: `1px solid ${D.border}`,
      }}
    >
      {main.subs.map((sub) => {
        const isActive =
          pathname === sub.href || pathname.startsWith(sub.href + "/");
        return (
          <Link
            key={sub.href}
            href={sub.href}
            className="relative py-2 text-[12px] transition-colors"
            style={{
              color: isActive ? D.primary : D.textMuted,
              fontWeight: isActive ? 500 : 400,
            }}
          >
            {sub.label}
            {isActive && (
              <span
                className="absolute left-0 right-0"
                style={{ bottom: 0, height: 2, background: D.primary }}
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
