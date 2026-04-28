/**
 * VALO.GG design tokens — v1.0 (Avril 2026).
 *
 * Hard rules (see docs/valogg_design_system.pdf):
 * - No gradient, shadow, blur, glow, neon — flat surfaces only.
 * - Inter font, weights 400 / 500 only (never 600/700).
 * - Sizes: display 22 · heading 16 · body 13 · caption 11.
 * - Sentence case in UI. No ALL CAPS, no Title Case, no letter-tracking.
 * - Overall /20 is a hidden internal value. UI always shows stars + label.
 * - Amber reserved exclusively for the star rating (★).
 * - Teal = success / positive delta, Coral = failure / negative delta.
 * - Missing data: "—" (em dash), never "N/A" or 0.
 *
 * Most older components import `D.red`, `D.gold`, `D.textPrimary` etc. Those
 * names are preserved as aliases mapping to the new semantics so the whole
 * app re-skins without editing every import:
 *
 *   D.red    → coral (negative / danger)
 *   D.green  → teal (positive / success)
 *   D.gold   → amber (star rating)
 *   D.bg / surface / card → light surfaces (was dark).
 */

// ── VALO.GG brand palette ───────────────────────────────────────

export const INDIGO_600 = "#534AB7"; // primary accent
export const INDIGO_900 = "#26215C"; // text on light indigo, VCT badges
export const INDIGO_50 = "#EEEDFE";  // indigo hover / badge bg

export const TEAL_400 = "#1D9E75";   // success
export const CORAL_400 = "#D85A30";  // failure / alert
export const AMBER_200 = "#EF9F27";  // stars ONLY

// Dark surfaces — navigation bar area only.
export const NAV_BG = "#0d0d12";
export const NAV_CARD = "#1a1a24";
export const NAV_BORDER = "#2C2C2A";

// Surfaces — VALO.GG brand on a dark canvas (user preference: pure white
// hurts the eyes during long manager sessions). Brand accents (indigo, teal,
// coral, amber) remain semantically identical and read well on dark.
const BG_PRIMARY = "#0F0F14";        // page background
const BG_SECONDARY = "#16161E";      // subtle alt rows, table headers
const BG_SURFACE = "#13131A";        // cards / panels
const INK_PRIMARY = "#ECE8E1";       // primary text
const INK_MUTED = "#9A9AAE";         // secondary text
const INK_SUBTLE = "rgba(236,232,225,0.45)";
const INK_FAINT = "rgba(236,232,225,0.18)";
const HAIRLINE = "rgba(255,255,255,0.08)"; // 0.5px hairlines on dark
const HAIRLINE_FAINT = "rgba(255,255,255,0.04)";

// ── Token dictionary (D.*) — preserves legacy names as aliases ──

export const D = {
  // Surfaces (dark canvas)
  bg: BG_PRIMARY,
  surface: BG_SECONDARY,
  card: BG_SURFACE,
  secondary: BG_SECONDARY,
  hoverBg: "rgba(83,74,183,0.10)",
  floatBg: "rgba(15,15,20,0.92)",
  floatBorder: HAIRLINE,

  // Dark surfaces (nav only)
  navBg: NAV_BG,
  navCard: NAV_CARD,
  navBorder: NAV_BORDER,

  // Brand
  primary: INDIGO_600,
  primaryDark: INDIGO_900,
  primaryLight: INDIGO_50,

  // Semantic accents (legacy aliases → new tokens)
  red: CORAL_400,      // negative / alerts / defeat
  green: TEAL_400,     // positive / wins / success
  gold: AMBER_200,     // ★ rating exclusively
  amber: AMBER_200,    // (same)
  blue: INDIGO_600,    // "blue" in older code == primary
  purple: INDIGO_600,  // controller role folded into primary
  coral: CORAL_400,
  teal: TEAL_400,

  // Text
  textPrimary: INK_PRIMARY,
  textMuted: INK_MUTED,
  textSubtle: INK_SUBTLE,
  textFaint: INK_FAINT,

  // Borders (0.5px hairlines per spec)
  border: HAIRLINE,
  borderFaint: HAIRLINE_FAINT,
  borderStrong: HAIRLINE,

  // Role colours — restrained palette, no neon.
  roleDuelist: CORAL_400,
  roleInitiator: INDIGO_600,
  roleController: TEAL_400,
  roleSentinel: INDIGO_900,
  roleFlex: AMBER_200,

  // Eco types (kept for back-compat with match-day UIs).
  ecoFullBuy: { bg: "rgba(29,158,117,0.1)", color: TEAL_400 },
  ecoForceBuy: { bg: "rgba(239,159,39,0.1)", color: AMBER_200 },
  ecoEco: { bg: "rgba(216,90,48,0.1)", color: CORAL_400 },
  ecoPistol: { bg: "rgba(0,0,0,0.04)", color: INK_PRIMARY },
} as const;

export function roleColor(role: string): string {
  const r = role.toLowerCase();
  if (r === "duelist") return D.roleDuelist;
  if (r === "initiator") return D.roleInitiator;
  if (r === "controller") return D.roleController;
  if (r === "sentinel") return D.roleSentinel;
  return D.roleFlex;
}

// Glow / text-shadow helpers are kept as identity so legacy callers don't
// crash, but they intentionally return nothing — the design system forbids
// shadows and glows.
export function glowFilter(_color: string, _intensity = 0.5): string {
  return "none";
}
export const TEXT_SHADOW = "none";
export const TEXT_SHADOW_SUBTLE = "none";

// ── Star system ─────────────────────────────────────────────────

/** Unicode glyphs used across the app. Empty is filled block per spec. */
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

/** Attribute /20 → colour. Teal >=14, Indigo >=9, Coral <9. */
export function attrColorFor(value: number): string {
  if (value >= 14) return TEAL_400;
  if (value >= 9) return INDIGO_600;
  return CORAL_400;
}

// ── Label presets — re-expressed per VALO.GG (no more uppercase) ──
// Legacy keys kept; classes now follow sentence case + 400/500 weights.
export const LABELS = {
  caption: "text-[11px] font-normal",     // 11 / 400
  body: "text-[13px] font-normal",        // 13 / 400
  heading: "text-[16px] font-medium",     // 16 / 500
  display: "text-[22px] font-medium",     // 22 / 500
  // Deprecated aliases kept to avoid breaking older imports.
  tiny: "text-[11px] font-normal",
  small: "text-[11px] font-normal",
  medium: "text-[13px] font-normal",
  hero: "text-[22px] font-medium",
} as const;

/** Standard card styling per spec (12px radius, 0.5px hairline, flat). */
export const CARD_STYLE = {
  background: BG_PRIMARY,
  border: `0.5px solid ${HAIRLINE}`,
  borderRadius: 12,
} as const;

/** Kept for back-compat. No backdrop-filter (blur is forbidden). */
export const FLOAT_CARD = CARD_STYLE;
export const SOLID_CARD = CARD_STYLE;
