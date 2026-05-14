/**
 * One-shot: applies the 2026 EMEA partner-tier budget splits to every save
 * already in the DB. Idempotent — running it twice produces the same result.
 *
 * Run with:
 *   DATABASE_URL=… npx tsx src/scripts/apply-emea-budgets-2026.ts
 */
import { PrismaClient } from "@/generated/prisma/client";
import { VCT_TEAMS } from "@/constants/teams";

const prisma = new PrismaClient();

async function main() {
  const emea = VCT_TEAMS.filter(
    (t) =>
      t.region === "EMEA" &&
      t.transferBudget != null &&
      t.wageBudgetSeason != null,
  );

  console.log(`Updating ${emea.length} EMEA teams across all saves…\n`);

  for (const def of emea) {
    const transfer = def.transferBudget!;
    const wage = def.wageBudgetSeason!;
    const bundle = def.bundleRevenueAnnual ?? 0;
    const total = def.budget + transfer + wage;
    const res = await prisma.team.updateMany({
      where: { name: def.name, region: "EMEA" },
      data: {
        budget: def.budget,
        transferBudget: transfer,
        wageBudgetSeason: wage,
        seasonStartBudget: total,
        bundleRevenueAnnual: bundle,
      },
    });
    console.log(
      `  ${def.name.padEnd(18)} → ${res.count} row(s) ` +
        `[op $${def.budget.toLocaleString()} · ` +
        `transfer $${transfer.toLocaleString()} · ` +
        `wage $${wage.toLocaleString()} · ` +
        `total $${total.toLocaleString()} · ` +
        `bundle $${bundle.toLocaleString()}/yr]`,
    );
  }

  // Repair the legacy typo: "Pcific Esports" → "Pacific Esports". Run an
  // unconditional rename so any save still carrying the old spelling gets
  // upgraded along with this budget pass.
  const renamed = await prisma.team.updateMany({
    where: { name: "Pcific Esports" },
    data: { name: "Pacific Esports" },
  });
  if (renamed.count > 0) {
    console.log(`\nRenamed ${renamed.count} legacy "Pcific Esports" row(s).`);
  }
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
