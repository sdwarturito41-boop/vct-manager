import type { AttrKey } from "@/constants/role-weights";

/** Per-agent stat breakdown stored in Player.agentStats JSON. */
export type AgentStatsEntry = {
  rounds: number;
  acs: number;
  kd: number;
  kast: number;
  adr: number;
  kpr: number;
  apr: number;
  fkpr: number;
  fdpr: number;
  hs_pct: number;
  /**
   * reliable: rounds >= 200
   * small_sample: rounds >= 50
   * insufficient: rounds < 50
   */
  confidence: "reliable" | "small_sample" | "insufficient";
};

export type AgentStatsMap = Record<string, AgentStatsEntry>;

/** 0-20 FM-style attribute output. Exported keys mirror AttrKey. */
export type Attributes = Record<AttrKey, number>;

/** Raw stat shape consumed by computeAttributes. Subset of Player fields. */
export type PlayerRaw = {
  id?: string;
  role: string;
  rating: number;
  acs: number;
  kd: number;
  adr: number;
  kast: number;
  hs: number; // hs_pct on Player
  kpr: number;
  apr: number;
  fkpr: number;
  fdpr: number;
  clPct: number;
  clTotal: number;
  kills: number;
  deaths: number;
  vlrAssists: number;
  fk: number;
  fd: number;
  vlrRounds: number;
  agentStats: AgentStatsMap | unknown;
  isIgl: boolean;
};
