// Single source of truth for the top + sub navigation. The TopNav reads the
// `mainTabs` array; the SubNav looks up the active tab and renders its
// `subs`. Adding a new page means appending it to the right `subs` list.

export type SubTab = { label: string; href: string };
export type MainTab = {
  label: string;
  href: string;       // default destination when the main tab is clicked
  paths: string[];    // route prefixes that mark this tab as active
  subs: SubTab[];
};

export const MAIN_TABS: readonly MainTab[] = [
  {
    label: "Portal",
    href: "/dashboard",
    paths: ["/dashboard"],
    subs: [{ label: "Overview", href: "/dashboard" }],
  },
  {
    label: "Squad",
    href: "/roster",
    paths: ["/roster", "/training", "/tactics", "/player"],
    subs: [
      { label: "Roster", href: "/roster" },
      { label: "Tactics", href: "/tactics" },
      { label: "Training", href: "/training" },
    ],
  },
  {
    label: "Recruitment",
    href: "/market",
    paths: ["/market"],
    subs: [{ label: "Market", href: "/market" }],
  },
  {
    label: "Match day",
    href: "/league",
    paths: ["/league", "/scrims", "/season"],
    subs: [
      { label: "League", href: "/league" },
      { label: "Schedule", href: "/scrims" },
      { label: "Season", href: "/season" },
    ],
  },
  {
    label: "Club",
    href: "/staff",
    paths: ["/staff", "/sponsors"],
    subs: [
      { label: "Staff", href: "/staff" },
      { label: "Sponsors", href: "/sponsors" },
    ],
  },
  {
    label: "Career",
    href: "/inbox",
    paths: ["/inbox", "/patches"],
    subs: [
      { label: "Inbox", href: "/inbox" },
      { label: "Patches", href: "/patches" },
    ],
  },
] as const;

/** Returns the main tab whose path prefixes match the current pathname. */
export function activeMainTab(pathname: string): MainTab | null {
  return (
    MAIN_TABS.find((t) =>
      t.paths.some((p) => pathname === p || pathname.startsWith(p + "/")),
    ) ?? null
  );
}
