import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient();

(async () => {
  const total = await prisma.player.count({ where: { isRetired: false } });
  const scraped = await prisma.player.count({
    where: { isRetired: false, lastScrapedAt: { not: null } },
  });
  const unscraped = total - scraped;

  console.log(`Total DB players (non-retired): ${total}`);
  console.log(`Scraped (lastScrapedAt set):    ${scraped}`);
  console.log(`NEVER scraped:                  ${unscraped}`);
  console.log();

  const never = await prisma.player.findMany({
    where: { isRetired: false, lastScrapedAt: null },
    select: { ign: true, currentTeam: true, region: true, role: true, acs: true },
    orderBy: { acs: "desc" },
  });

  console.log(`── Sample of NEVER-scraped (${never.length} total) ──`);
  for (const p of never.slice(0, 40)) {
    console.log(
      `  ${p.ign.padEnd(18)} ${(p.currentTeam ?? "").padEnd(22)} ${p.region.padEnd(10)} ${p.role.padEnd(12)} ACS=${p.acs.toFixed(0)}`,
    );
  }

  // Check if Alfajer, Boaster etc. were matched
  const testNames = ["Alfajer", "Boaster", "crashies", "SUYGETSU", "Shao", "sheydos", "xand"];
  console.log();
  console.log("── Known pros — scraped status ──");
  for (const ign of testNames) {
    const p = await prisma.player.findFirst({
      where: { ign: { equals: ign, mode: "insensitive" } },
      select: { ign: true, lastScrapedAt: true, vlrRounds: true },
    });
    if (!p) {
      console.log(`  ${ign.padEnd(12)} NOT IN DB`);
    } else if (p.lastScrapedAt) {
      console.log(`  ${p.ign.padEnd(12)} SCRAPED (rounds=${p.vlrRounds}, at ${p.lastScrapedAt.toISOString().slice(0, 10)})`);
    } else {
      console.log(`  ${p.ign.padEnd(12)} NEVER SCRAPED`);
    }
  }
})().finally(() => prisma.$disconnect());
