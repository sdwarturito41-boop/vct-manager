/**
 * VCT Manager design tokens — aligned with the RoundByRoundScreen style.
 * Import this in any component that needs consistent styling.
 *
 * Rules:
 * - No gradients, no box-shadows (except drop-shadow on images, text-shadow over images)
 * - Flat dark surfaces only
 * - Weights: 500 and normal only (no 600/700)
 * - Uppercase tracking-[0.2-0.4em] for small labels
 * - Tabular-nums for all stats/numbers
 * - Radius: 8px cards, 4px small elements
 * - Fonts: Inter, system-ui fallback
 */

export const D = {
  // ── Surfaces ──
  bg: "#0F0F14",           // page background
  surface: "#16161E",      // panels, top/bottom bars
  card: "#13131A",         // secondary cards
  hoverBg: "rgba(255,255,255,0.02)",
  floatBg: "rgba(15,15,20,0.65)",   // translucent floating panels over map
  floatBorder: "rgba(255,255,255,0.08)",

  // ── Accents ──
  red: "#FF4655",          // primary, user team, alerts
  green: "#4CAF7D",        // wins, good, ally
  gold: "#C69B3A",         // MVP, ACS, gold tier
  amber: "#EF9F27",        // force buy, warnings
  blue: "#60A5FA",         // preview/focus
  purple: "#8B5CF6",       // controller role

  // ── Text ──
  textPrimary: "#ECE8E1",
  textMuted: "#6B6B80",
  textSubtle: "rgba(236,232,225,0.35)",
  textFaint: "rgba(236,232,225,0.15)",

  // ── Borders ──
  border: "rgba(255,255,255,0.08)",
  borderFaint: "rgba(255,255,255,0.04)",
  borderStrong: "rgba(255,255,255,0.12)",

  // ── Role colors (Valorant agent roles) ──
  roleDuelist: "#FF4655",
  roleInitiator: "#22C55E",
  roleController: "#8B5CF6",
  roleSentinel: "#3B82F6",
  roleFlex: "#C69B3A",

  // ── Eco types ──
  ecoFullBuy: { bg: "rgba(76,175,125,0.1)", color: "#4CAF7D" },
  ecoForceBuy: { bg: "rgba(239,159,39,0.1)", color: "#EF9F27" },
  ecoEco: { bg: "rgba(255,70,85,0.1)", color: "#FF4655" },
  ecoPistol: { bg: "rgba(255,255,255,0.05)", color: "#ECE8E1" },
} as const;

/** Role → accent color lookup */
export function roleColor(role: string): string {
  const r = role.toLowerCase();
  if (r === "duelist") return D.roleDuelist;
  if (r === "initiator") return D.roleInitiator;
  if (r === "controller") return D.roleController;
  if (r === "sentinel") return D.roleSentinel;
  return D.roleFlex;
}

/** Drop-shadow filter for glowing logos/icons over a map background */
export function glowFilter(color: string, intensity = 0.5): string {
  const hex = color.replace("#", "");
  const alpha = Math.round(intensity * 255)
    .toString(16)
    .padStart(2, "0");
  return `drop-shadow(0 0 20px #${hex}${alpha})`;
}

/** Text shadow preset for readable text over images */
export const TEXT_SHADOW = "0 2px 10px rgba(0,0,0,0.9)";
export const TEXT_SHADOW_SUBTLE = "0 1px 4px rgba(0,0,0,0.8)";

/** Standard label class suffixes (Tailwind-compatible strings) */
export const LABELS = {
  tiny: "text-[10px] font-medium uppercase tracking-[0.25em]",
  small: "text-[11px] font-medium uppercase tracking-[0.2em]",
  medium: "text-[13px] font-medium uppercase tracking-[0.05em]",
  hero: "text-[22px] font-medium uppercase tracking-[0.05em]",
} as const;

/** Common floating card style — use in inline style or spread as CSS props */
export const FLOAT_CARD = {
  background: D.floatBg,
  backdropFilter: "blur(8px)",
  border: `1px solid ${D.floatBorder}`,
  borderRadius: 8,
} as const;

/** Dense solid card (non-translucent) for content sections */
export const SOLID_CARD = {
  background: D.surface,
  border: `1px solid ${D.borderFaint}`,
  borderRadius: 8,
} as const;
