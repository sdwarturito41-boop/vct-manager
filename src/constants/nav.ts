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
    label: "Accueil",
    href: "/dashboard",
    paths: ["/dashboard", "/match-prep"],
    subs: [
      { label: "Vue d'ensemble", href: "/dashboard" },
      { label: "Plan de match", href: "/match-prep" },
    ],
  },
  {
    label: "Équipe",
    href: "/roster",
    paths: ["/roster", "/training", "/tactics", "/player"],
    subs: [
      { label: "Effectif", href: "/roster" },
      { label: "Tactique", href: "/tactics" },
      { label: "Entraînement", href: "/training" },
    ],
  },
  {
    label: "Recrutement",
    href: "/market",
    paths: ["/market"],
    subs: [{ label: "Marché", href: "/market" }],
  },
  {
    label: "Compétition",
    href: "/league",
    paths: ["/league", "/scrims", "/season"],
    subs: [
      { label: "Classement", href: "/league" },
      { label: "Scrims", href: "/scrims" },
      { label: "Saison", href: "/season" },
    ],
  },
  {
    label: "Club",
    href: "/finance",
    paths: ["/staff", "/sponsors", "/finance"],
    subs: [
      { label: "Finances", href: "/finance" },
      { label: "Staff", href: "/staff" },
      { label: "Sponsors", href: "/sponsors" },
    ],
  },
  {
    label: "Carrière",
    href: "/inbox",
    paths: ["/inbox", "/patches"],
    subs: [
      { label: "Messages", href: "/inbox" },
      { label: "Patchs", href: "/patches" },
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
