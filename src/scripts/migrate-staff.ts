/**
 * One-shot migration: turns the legacy `Coach` model into entries in the
 * unified `Staff` model (role=COACH) AND seeds every team without complete
 * staff with default Manager / Analysts / Fitness so the minimum slot
 * requirements are satisfied (1 Manager, 1 Analyst required per team).
 *
 * Idempotent — re-running it doesn't double-create.
 *
 * Run with:
 *   DATABASE_URL=… npx tsx src/scripts/migrate-staff.ts
 */
import { PrismaClient } from "@/generated/prisma/client";
import type { StaffRole, Region } from "@/generated/prisma/client";
import { scaledSalary, STAFF_SLOTS } from "@/constants/staff";

const prisma = new PrismaClient();

// Name pools per region — small but believable. Same pattern as the
// player-rookie generator in generate.ts.
const STAFF_FIRST_NAMES = ["Marc", "Tom", "Ben", "Liam", "Noah", "Lucas", "Ethan", "Sam", "Felix", "Jonas", "Pablo", "Diego", "Hiro", "Kenji", "Wei", "Chen"];
const STAFF_LAST_NAMES = ["Smith", "Müller", "Dubois", "Rossi", "Silva", "Park", "Tanaka", "Wang", "Costa", "Bauer", "Andersson", "Novak", "Vidal", "Akimov"];

function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function pick<T>(arr: ReadonlyArray<T>): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function nationalityFor(region: Region): string {
  switch (region) {
    case "EMEA": return pick(["France", "Germany", "Spain", "UK", "Sweden", "Türkiye", "Poland"]);
    case "Americas": return pick(["USA", "Brazil", "Canada", "Mexico", "Argentina"]);
    case "Pacific": return pick(["South Korea", "Japan", "Singapore", "Thailand", "Indonesia"]);
    case "China": return pick(["China"]);
  }
}

function generateStaffRecord(
  role: StaffRole,
  region: Region,
  prestige: number,
): {
  name: string;
  role: StaffRole;
  region: string;
  nationality: string;
  age: number;
  salary: number;
  skill1: number;
  skill2: number;
  skill3: number;
  contractEndSeason: number;
  contractEndWeek: number;
} {
  // Skills scale roughly with team prestige: prestige 50 → skills ~50,
  // prestige 95 → skills ~75.
  const skillBase = 30 + (prestige / 100) * 50;
  const variance = () => randInt(-8, 8);
  const skill1 = Math.max(10, Math.min(95, Math.round(skillBase + variance())));
  const skill2 = Math.max(10, Math.min(95, Math.round(skillBase + variance())));
  const skill3 = Math.max(10, Math.min(95, Math.round(skillBase + variance())));
  const avgSkill = (skill1 + skill2 + skill3) / 3;
  return {
    name: `${pick(STAFF_FIRST_NAMES)} ${pick(STAFF_LAST_NAMES)}`,
    role,
    region,
    nationality: nationalityFor(region),
    age: randInt(28, 48),
    salary: scaledSalary(role, avgSkill),
    skill1,
    skill2,
    skill3,
    contractEndSeason: 2, // 1-season contract by default
    contractEndWeek: 52,
  };
}

async function main() {
  console.log("── Staff migration starting ──\n");

  // 1) Migrate existing Coach records → Staff with role=COACH (idempotent:
  //    skip teams that already have a COACH staff entry).
  const coaches = await prisma.coach.findMany({
    include: { teams: { select: { id: true, saveId: true, region: true } } },
  });
  let coachMigrated = 0;
  for (const coach of coaches) {
    for (const team of coach.teams) {
      if (!team.saveId) continue;
      const existing = await prisma.staff.findFirst({
        where: { teamId: team.id, role: "COACH" },
      });
      if (existing) continue;
      // Map Coach.{utilityBoost, trainingEff, scoutingSkill} → skill1/2/3.
      await prisma.staff.create({
        data: {
          saveId: team.saveId,
          name: coach.name,
          role: "COACH",
          region: team.region,
          nationality: coach.nationality,
          age: coach.age,
          salary: coach.salary,
          imageUrl: coach.imageUrl ?? null,
          skill1: coach.utilityBoost,
          skill2: coach.trainingEff,
          skill3: coach.scoutingSkill,
          contractEndSeason: coach.contractEndSeason,
          contractEndWeek: coach.contractEndWeek,
          teamId: team.id,
        },
      });
      coachMigrated++;
    }
  }
  console.log(`Migrated ${coachMigrated} Coach → Staff(role=COACH).`);

  // 2) Seed minimum required staff for every team in every save.
  //    Required: 1 Manager, 1 Analyst per team. We also seed default
  //    Fitness for AI teams (skip for user team — let them choose).
  const teams = await prisma.team.findMany({
    select: {
      id: true,
      saveId: true,
      region: true,
      prestige: true,
      isPlayerTeam: true,
    },
  });

  let createdByRole: Record<StaffRole, number> = {
    COACH: 0, ANALYST: 0, MANAGER: 0, FITNESS: 0,
  };

  for (const team of teams) {
    if (!team.saveId) continue;

    const existing = await prisma.staff.findMany({
      where: { teamId: team.id },
      select: { role: true },
    });
    const haveByRole: Record<StaffRole, number> = {
      COACH: 0, ANALYST: 0, MANAGER: 0, FITNESS: 0,
    };
    for (const e of existing) haveByRole[e.role]++;

    // Manager — always required (min 1).
    if (haveByRole.MANAGER < STAFF_SLOTS.MANAGER.min) {
      await prisma.staff.create({
        data: {
          saveId: team.saveId,
          teamId: team.id,
          ...generateStaffRecord("MANAGER", team.region, team.prestige),
        },
      });
      createdByRole.MANAGER++;
    }
    // Analyst — min 1. For AI teams with prestige > 70 give 2 (top orgs have deeper bench).
    const analystTarget = team.isPlayerTeam ? 1 : team.prestige > 70 ? 2 : 1;
    while (haveByRole.ANALYST < analystTarget) {
      await prisma.staff.create({
        data: {
          saveId: team.saveId,
          teamId: team.id,
          ...generateStaffRecord("ANALYST", team.region, team.prestige),
        },
      });
      haveByRole.ANALYST++;
      createdByRole.ANALYST++;
    }
    // Fitness — only AI teams pre-seeded. User chooses.
    if (!team.isPlayerTeam && haveByRole.FITNESS < 1) {
      await prisma.staff.create({
        data: {
          saveId: team.saveId,
          teamId: team.id,
          ...generateStaffRecord("FITNESS", team.region, team.prestige),
        },
      });
      createdByRole.FITNESS++;
    }
  }

  console.log(`\nSeeded staff across ${teams.length} teams:`);
  for (const role of ["MANAGER", "ANALYST", "FITNESS"] as const) {
    console.log(`  ${role.padEnd(8)} +${createdByRole[role]}`);
  }
  console.log("\n── Done ──");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
