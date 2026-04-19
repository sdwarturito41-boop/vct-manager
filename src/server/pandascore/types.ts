import type { Region, Role } from "@/generated/prisma/client";

export interface TeamSeedData {
  name: string;
  tag: string;
  region: Region;
  budget: number;
  prestige: number;
  logoUrl: string | null;
  players: PlayerSeedData[];
}

export interface PlayerSeedData {
  ign: string;
  firstName: string;
  lastName: string;
  nationality: string;
  age: number;
  role: Role;
  imageUrl: string | null;
  salary: number;
  acs: number;
  kd: number;
  adr: number;
  kast: number;
  hs: number;
  pandascoreId: string | null;
  tier: "VCT" | "VCL";
}
