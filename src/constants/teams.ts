import type { Region } from "@/generated/prisma/client";

export interface VctTeamDef {
  name: string;
  tag: string;
  region: Region;
  budget: number;
  prestige: number;
}

export const VCT_TEAMS: VctTeamDef[] = [
  // ─── EMEA ───
  { name: "Fnatic", tag: "FNC", region: "EMEA", budget: 2500000, prestige: 95 },
  { name: "Team Heretics", tag: "TH", region: "EMEA", budget: 1800000, prestige: 82 },
  { name: "Team Vitality", tag: "VIT", region: "EMEA", budget: 2000000, prestige: 85 },
  { name: "Gentle Mates", tag: "GM", region: "EMEA", budget: 1200000, prestige: 70 },
  { name: "Karmine Corp", tag: "KC", region: "EMEA", budget: 1500000, prestige: 75 },
  { name: "Natus Vincere", tag: "NAVI", region: "EMEA", budget: 2200000, prestige: 88 },
  { name: "BBL Esports", tag: "BBL", region: "EMEA", budget: 1000000, prestige: 65 },
  { name: "FUT Esports", tag: "FUT", region: "EMEA", budget: 900000, prestige: 60 },
  { name: "Eternal Fire", tag: "EF", region: "EMEA", budget: 1600000, prestige: 78 },
  { name: "Team Liquid", tag: "TL", region: "EMEA", budget: 2300000, prestige: 90 },
  { name: "GIANTX", tag: "GX", region: "EMEA", budget: 850000, prestige: 58 },
  { name: "Pcific Esports", tag: "PCFIC", region: "EMEA", budget: 700000, prestige: 45 },

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
