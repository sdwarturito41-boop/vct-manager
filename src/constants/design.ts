/**
 * VCT Manager design tokens — locked charter.
 *
 * Hard rules:
 *   - Fond #111318 / navbar #0C0D12
 *   - Accent violet #7C5CFC (primary CTA, links, brand)
 *   - Cards rgba(255,255,255,0.03) on top of fond, border rgba(255,255,255,0.07)
 *   - Texte primaire #fff, secondaire rgba(255,255,255,0.3)
 *   - Succès #32D764 / Warning #FFB400 / Danger #FF5050
 *   - Border-radius : 12px cards · 6px badges · 8px stat items
 *   - No gradient, shadow, blur, glow, neon — flat surfaces only.
 *   - Inter font, weights 400 / 500 only (never 600/700).
 *   - Sentence case in UI. No ALL CAPS, no Title Case.
 *
 * Legacy aliases (D.red, D.gold, D.green, D.primary, D.textPrimary, …) are
 * preserved so the whole codebase re-skins from this file without per-import
 * edits. Their colour values are remapped to the new charter.
 */

// ── Charter palette ────────────────────────────────────────────

/** Page background. */
export const BG_BASE = "#111318";
/** Top navigation strip (slightly darker than the page). */
export const NAV_BG = "#0C0D12";
/** Slightly raised alt rows / table headers. */
export const BG_ALT = "rgba(255,255,255,0.02)";
/** Standard card surface (flat over BG_BASE). */
export const CARD_BG = "rgba(255,255,255,0.03)";
/** Card hairline border. */
export const CARD_BORDER = "rgba(255,255,255,0.07)";
/** Faint hairline (table row separators, secondary borders). */
export const CARD_BORDER_FAINT = "rgba(255,255,255,0.04)";

/** Brand accent — violet. Used for primary CTAs, links, active nav. */
export const VIOLET_500 = "#7C5CFC";
export const VIOLET_700 = "#4A37A8";
export const VIOLET_50 = "#E7DFFC";

/** Semantic accents. */
export const SUCCESS = "#32D764"; // teal-ish green — positive deltas, wins
export const WARNING = "#FFB400"; // amber — stars + cautions
export const DANGER  = "#FF5050"; // red — losses, errors, danger states

/** Text. */
export const INK_PRIMARY = "#FFFFFF";
export const INK_MUTED   = "rgba(255,255,255,0.6)";  // body labels
export const INK_SUBTLE  = "rgba(255,255,255,0.3)";  // charter "secondaire"
export const INK_FAINT   = "rgba(255,255,255,0.15)"; // very low contrast hints

/** Backwards-compat exports so legacy imports keep resolving. */
export const INDIGO_600 = VIOLET_500;
export const INDIGO_900 = VIOLET_700;
export const INDIGO_50  = VIOLET_50;
export const TEAL_400   = SUCCESS;
export const CORAL_400  = DANGER;
export const AMBER_200  = WARNING;
export const NAV_CARD   = "rgba(255,255,255,0.04)";
export const NAV_BORDER = CARD_BORDER;

// ── Border-radius scale ────────────────────────────────────────

export const RADIUS_CARD = 12;
export const RADIUS_BADGE = 6;
export const RADIUS_STAT = 8;

// ── Token dictionary (D.*) — preserves legacy names ────────────

export const D = {
  // Surfaces
  bg: BG_BASE,
  surface: BG_ALT,
  card: CARD_BG,
  secondary: BG_ALT,
  hoverBg: "rgba(124,92,252,0.10)",
  floatBg: BG_BASE,
  floatBorder: CARD_BORDER,

  // Navigation
  navBg: NAV_BG,
  navCard: NAV_CARD,
  navBorder: NAV_BORDER,

  // Brand
  primary: VIOLET_500,
  primaryDark: VIOLET_700,
  primaryLight: VIOLET_50,

  // Semantic accents (legacy aliases mapped to new charter)
  red: DANGER,
  green: SUCCESS,
  gold: WARNING,
  amber: WARNING,
  blue: VIOLET_500,
  purple: VIOLET_500,
  coral: DANGER,
  teal: SUCCESS,

  // Text
  textPrimary: INK_PRIMARY,
  textMuted: INK_MUTED,
  textSubtle: INK_SUBTLE,
  textFaint: INK_FAINT,

  // Borders
  border: CARD_BORDER,
  borderFaint: CARD_BORDER_FAINT,
  borderStrong: CARD_BORDER,

  // Border-radius scale
  radiusCard: RADIUS_CARD,
  radiusBadge: RADIUS_BADGE,
  radiusStat: RADIUS_STAT,

  // Role colours — coherent with the charter palette.
  roleDuelist: DANGER,     // aggressive
  roleInitiator: VIOLET_500, // primary
  roleController: SUCCESS,  // map-control / utility
  roleSentinel: "#5A78FF",  // cooler blue — distinct from Initiator
  roleFlex: WARNING,        // amber

  // Eco type chips (match-day UI).
  ecoFullBuy:  { bg: "rgba(50,215,100,0.10)", color: SUCCESS },
  ecoForceBuy: { bg: "rgba(255,180,0,0.10)",  color: WARNING },
  ecoEco:      { bg: "rgba(255,80,80,0.10)",  color: DANGER },
  ecoPistol:   { bg: "rgba(255,255,255,0.04)", color: INK_PRIMARY },
} as const;

export function roleColor(role: string): string {
  const r = role.toLowerCase();
  if (r === "duelist") return D.roleDuelist;
  if (r === "initiator") return D.roleInitiator;
  if (r === "controller") return D.roleController;
  if (r === "sentinel") return D.roleSentinel;
  return D.roleFlex;
}

// Glow / text-shadow helpers — identity so legacy callers don't crash, but
// return nothing per design system (shadows and glows are forbidden).
export function glowFilter(_color: string, _intensity = 0.5): string {
  return "none";
}
export const TEXT_SHADOW = "none";
export const TEXT_SHADOW_SUBTLE = "none";

// ── Star system ─────────────────────────────────────────────────

export const STAR_FULL = "★";
export const STAR_EMPTY = "■";
export const STAR_HALF = "½";

/** Overall /20 → { stars: 0..5 in 0.5 steps, label }. Overall itself is hidden. */
export function overallToStars(overall: number): { stars: number; label: string } {
  if (overall >= 17.0) return { stars: 5, label: "World class" };
  if (overall >= 14.5) return { stars: 4.5, label: "Elite" };
  if (overall >= 12.0) return { stars: 4, label: "Very good" };
  if (overall >= 9.5) return { stars: 3.5, label: "Good" };
  if (overall >= 7.0) return { stars: 3, label: "Average" };
  return { stars: 2.5, label: "Fringe" };
}

/** Attribute /20 → colour. Success ≥14, Violet ≥9, Danger <9. */
export function attrColorFor(value: number): string {
  if (value >= 14) return SUCCESS;
  if (value >= 9) return VIOLET_500;
  return DANGER;
}

// ── Label presets ──────────────────────────────────────────────

export const LABELS = {
  caption: "text-[11px] font-normal",
  body: "text-[13px] font-normal",
  heading: "text-[16px] font-medium",
  display: "text-[22px] font-medium",
  // Deprecated aliases (legacy callers).
  tiny: "text-[11px] font-normal",
  small: "text-[11px] font-normal",
  medium: "text-[13px] font-normal",
  hero: "text-[22px] font-medium",
} as const;

/** Standard card styling per charter (12px radius, hairline, flat). */
export const CARD_STYLE = {
  background: CARD_BG,
  border: `1px solid ${CARD_BORDER}`,
  borderRadius: RADIUS_CARD,
} as const;

/** Compact badge styling per charter (6px radius). */
export const BADGE_STYLE = {
  borderRadius: RADIUS_BADGE,
} as const;

/** Stat item styling per charter (8px radius). */
export const STAT_STYLE = {
  borderRadius: RADIUS_STAT,
} as const;

/** Kept for back-compat. No backdrop-filter (blur is forbidden). */
export const FLOAT_CARD = CARD_STYLE;
export const SOLID_CARD = CARD_STYLE;
