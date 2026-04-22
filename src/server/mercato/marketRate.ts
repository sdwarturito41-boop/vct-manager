import type { Player, Role, PlayerTier } from "@/generated/prisma/client";

type PlayerStats = Pick<Player, "acs" | "kd" | "adr" | "role" | "tier">;

const BASE_PER_ROLE_VCT: Record<Role, number> = {
  IGL: 40_000,
  Duelist: 35_000,
  Initiator: 30_000,
  Sentinel: 30_000,
  Controller: 30_000,
  Flex: 32_000,
};

const TIER_MULT: Record<PlayerTier, number> = {
  VCT: 1.0,
  VCL: 0.5,
};

export function playerRating(p: Pick<Player, "acs" | "kd" | "adr">): number {
  const acsNorm = Math.max(0, Math.min(1, (p.acs - 150) / 150));
  const kdNorm = Math.max(0, Math.min(1, (p.kd - 0.8) / 0.6));
  const adrNorm = Math.max(0, Math.min(1, (p.adr - 120) / 80));
  return 0.4 * acsNorm + 0.3 * kdNorm + 0.3 * adrNorm;
}

export function marketRate(p: PlayerStats): number {
  const base = BASE_PER_ROLE_VCT[p.role] * TIER_MULT[p.tier];
  const rating = playerRating(p);
  return Math.round(base * (0.7 + rating));
}
