import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient();

(async () => {
  const names = ["Alfajer", "Boaster", "Shao", "crashies", "Derke", "ZmjjKK", "primmie"];
  console.log("═══════════════════════════════════════");
  console.log(" Scraped stats for known pros");
  console.log("═══════════════════════════════════════");
  for (const ign of names) {
    const p = await prisma.player.findFirst({
      where: { ign: { equals: ign, mode: "insensitive" } },
    });
    if (!p) {
      console.log(`${ign.padEnd(12)} NOT in DB`);
      continue;
    }
    console.log(
      `${p.ign.padEnd(12)} rating=${p.rating.toFixed(2)} acs=${p.acs.toFixed(0)} kd=${p.kd.toFixed(2)} kast=${p.kast.toFixed(0)}% hs=${p.hs.toFixed(0)}%`,
    );
    console.log(
      `${"".padEnd(12)} kpr=${p.kpr.toFixed(2)} apr=${p.apr.toFixed(2)} fkpr=${p.fkpr.toFixed(2)} fdpr=${p.fdpr.toFixed(2)}`,
    );
    console.log(
      `${"".padEnd(12)} clPct=${p.clPct.toFixed(2)} clTotal=${p.clTotal} vlrRounds=${p.vlrRounds} scrapedAt=${p.lastScrapedAt?.toISOString() ?? "never"}`,
    );
    console.log(
      `${"".padEnd(12)} kills=${p.kills} deaths=${p.deaths} assists=${p.vlrAssists} fk=${p.fk} fd=${p.fd}`,
    );
    const agents = p.agentStats as Record<string, { rounds: number; acs: number }>;
    const agentKeys = Object.keys(agents);
    console.log(
      `${"".padEnd(12)} agents=${agentKeys.length > 0 ? agentKeys.slice(0, 5).join(",") : "(empty)"}`,
    );
    console.log();
  }
})().finally(() => prisma.$disconnect());
