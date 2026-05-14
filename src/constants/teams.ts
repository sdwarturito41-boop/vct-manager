import type { Region } from "@/generated/prisma/client";

/**
 * VCT team definition. `budget` is the operational/general pool — what the
 * Team.budget column holds. Optional `transferBudget` + `wageBudgetSeason`
 * carve out FM-style season allocations. When all three are set, the row is
 * cloned verbatim; otherwise the create flow falls back to the default
 * 30/55/15 split via allocateSeasonBudget.
 *
 * Total capital per team = budget + transferBudget + wageBudgetSeason. The
 * 2026 EMEA league fixed splits live below and reflect the real-world
 * partner-tier hierarchy (Fnatic / Liquid > Vitality / KC > mid-table >
 * Pacific Esports).
 */
export interface VctTeamDef {
  name: string;
  tag: string;
  region: Region;
  budget: number;            // operational
  prestige: number;
  transferBudget?: number;
  wageBudgetSeason?: number;
  /**
   * Riot in-game capsule bundle — annual projection. Paid in 4 quarterly
   * installments (split 35% transfer / 65% operational). Reflects real-world
   * fan engagement rather than competitive results — Heretics / KC / GM
   * top the EMEA charts thanks to their French community even when Fnatic
   * is higher-ranked competitively.
   */
  bundleRevenueAnnual?: number;
}

export const VCT_TEAMS: VctTeamDef[] = [
  // ─── EMEA — 2026 partner-tier budgets (real-world calibration) ───
  // Totals (transfer + wage + operational): Fnatic 4.2M → Pacific 0.9M.
  // Bundle annual = 4× quarterly Riot capsule revenue. French communities
  // (Heretics / KC / GM) outsell Fnatic on merch volume despite lower rank.
  { name: "Fnatic",          tag: "FNC",   region: "EMEA", prestige: 95, budget:  700000, transferBudget: 1500000, wageBudgetSeason: 2000000, bundleRevenueAnnual:  560000 },
  { name: "Team Liquid",     tag: "TL",    region: "EMEA", prestige: 90, budget:  700000, transferBudget: 1200000, wageBudgetSeason: 1900000, bundleRevenueAnnual:  280000 },
  { name: "Team Vitality",   tag: "VIT",   region: "EMEA", prestige: 85, budget:  600000, transferBudget:  900000, wageBudgetSeason: 1700000, bundleRevenueAnnual:  260000 },
  { name: "Karmine Corp",    tag: "KC",    region: "EMEA", prestige: 75, budget:  600000, transferBudget:  700000, wageBudgetSeason: 1500000, bundleRevenueAnnual:  720000 },
  { name: "Natus Vincere",   tag: "NAVI",  region: "EMEA", prestige: 88, budget:  550000, transferBudget:  650000, wageBudgetSeason: 1400000, bundleRevenueAnnual:  320000 },
  { name: "Team Heretics",   tag: "TH",    region: "EMEA", prestige: 82, budget:  500000, transferBudget:  500000, wageBudgetSeason: 1200000, bundleRevenueAnnual:  800000 },
  { name: "Gentle Mates",    tag: "GM",    region: "EMEA", prestige: 70, budget:  500000, transferBudget:  400000, wageBudgetSeason: 1100000, bundleRevenueAnnual:  640000 },
  { name: "GIANTX",          tag: "GX",    region: "EMEA", prestige: 58, budget:  450000, transferBudget:  350000, wageBudgetSeason: 1000000, bundleRevenueAnnual:  200000 },
  { name: "Eternal Fire",    tag: "EF",    region: "EMEA", prestige: 78, budget:  420000, transferBudget:  280000, wageBudgetSeason:  900000, bundleRevenueAnnual:  180000 },
  { name: "BBL Esports",     tag: "BBL",   region: "EMEA", prestige: 65, budget:  370000, transferBudget:  230000, wageBudgetSeason:  800000, bundleRevenueAnnual:  400000 },
  { name: "FUT Esports",     tag: "FUT",   region: "EMEA", prestige: 60, budget:  340000, transferBudget:  180000, wageBudgetSeason:  680000, bundleRevenueAnnual:  160000 },
  { name: "Pacific Esports", tag: "PCFIC", region: "EMEA", prestige: 45, budget:  260000, transferBudget:  120000, wageBudgetSeason:  520000, bundleRevenueAnnual:  100000 },

  // ─── Americas ───
  { name: "Sentinels", tag: "SEN", region: "Americas", budget: 3000000, prestige: 95 },
  { name: "Cloud9", tag: "C9", region: "Americas", budget: 2500000, prestige: 88 },
  { name: "100 Thieves", tag: "100T", region: "Americas", budget: 2200000, prestige: 85 },
  { name: "NRG", tag: "NRG", region: "Americas", budget: 1800000, prestige: 80 },
  { name: "Evil Geniuses", tag: "EG", region: "Americas", budget: 2000000, prestige: 82 },
  { name: "LOUD", tag: "LOUD", region: "Americas", budget: 1500000, prestige: 90 },
  { name: "FURIA Esports", tag: "FUR", region: "Americas", budget: 1200000, prestige: 75 },
  { name: "MIBR", tag: "MIBR", region: "Americas", budget: 1100000, prestige: 70 },
  { name: "Leviatán Esports", tag: "LEV", region: "Americas", budget: 1000000, prestige: 72 },
  { name: "KRÜ Esports", tag: "KRÜ", region: "Americas", budget: 900000, prestige: 65 },
  { name: "G2 Esports", tag: "G2", region: "Americas", budget: 2400000, prestige: 92 },
  { name: "Team Envy", tag: "NV", region: "Americas", budget: 1800000, prestige: 80 },

  // ─── Pacific ───
  { name: "Paper Rex", tag: "PR", region: "Pacific", budget: 1800000, prestige: 92 },
  { name: "Kiwoom DRX", tag: "KRX", region: "Pacific", budget: 1600000, prestige: 88 },
  { name: "T1", tag: "T1", region: "Pacific", budget: 2000000, prestige: 85 },
  { name: "Gen.G Esports", tag: "Gen.G", region: "Pacific", budget: 1700000, prestige: 82 },
  { name: "Global Esports", tag: "GE", region: "Pacific", budget: 1000000, prestige: 65 },
  { name: "ZETA DIVISION", tag: "ZETA", region: "Pacific", budget: 1200000, prestige: 70 },
  { name: "DetonatioN FocusMe", tag: "DFM", region: "Pacific", budget: 1100000, prestige: 68 },
  { name: "FULL SENSE", tag: "FS", region: "Pacific", budget: 800000, prestige: 55 },
  { name: "Rex Regum Qeon", tag: "RRQ", region: "Pacific", budget: 850000, prestige: 58 },
  { name: "Team Secret", tag: "TS", region: "Pacific", budget: 1300000, prestige: 72 },
  { name: "Nongshim RedForce", tag: "NS", region: "Pacific", budget: 1400000, prestige: 75 },
  { name: "VARREL", tag: "VA", region: "Pacific", budget: 800000, prestige: 52 },

  // ─── China ───
  { name: "EDward Gaming", tag: "EDG", region: "China", budget: 2500000, prestige: 90 },
  { name: "Bilibili Gaming", tag: "BLG", region: "China", budget: 2000000, prestige: 85 },
  { name: "FunPlus Phoenix", tag: "FPX", region: "China", budget: 2200000, prestige: 88 },
  { name: "Trace Esports", tag: "TE", region: "China", budget: 1500000, prestige: 75 },
  { name: "JD Gaming", tag: "JDG", region: "China", budget: 1800000, prestige: 80 },
  { name: "All Gamers", tag: "AG", region: "China", budget: 1200000, prestige: 68 },
  { name: "Dragon Ranger Gaming", tag: "DRG", region: "China", budget: 1000000, prestige: 62 },
  { name: "Nova Esports", tag: "NOVA", region: "China", budget: 1100000, prestige: 65 },
  { name: "Wolves Esports", tag: "WOL", region: "China", budget: 900000, prestige: 58 },
  { name: "TEC Esports", tag: "TEC", region: "China", budget: 850000, prestige: 55 },
  { name: "TYLOO", tag: "TYLOO", region: "China", budget: 1300000, prestige: 72 },
  { name: "XLG Gaming", tag: "XLG", region: "China", budget: 900000, prestige: 50 },
];

export const TEAMS_BY_REGION = (region: Region) =>
  VCT_TEAMS.filter((t) => t.region === region);
