import { PrismaClient } from "../src/generated/prisma/client";

const p = new PrismaClient();

(async () => {
  const total = await p.playerRelation.count();
  const active = await p.playerRelation.count({ where: { isCurrentlyTogether: true } });
  const historical = total - active;

  const byType = {
    DUO: await p.playerRelation.count({ where: { type: "DUO", isCurrentlyTogether: true } }),
    MENTOR: await p.playerRelation.count({ where: { type: "MENTOR", isCurrentlyTogether: true } }),
    CLASH: await p.playerRelation.count({ where: { type: "CLASH", isCurrentlyTogether: true } }),
  };

  console.log("═══════════════════════════════════════");
  console.log(" PlayerRelation diagnostics");
  console.log("═══════════════════════════════════════");
  console.log(`Total rows: ${total}`);
  console.log(`  Active: ${active}  Historical (decaying): ${historical}`);
  console.log(`  By type (active): DUO=${byType.DUO} MENTOR=${byType.MENTOR} CLASH=${byType.CLASH}`);
  console.log();

  const topDuos = await p.playerRelation.findMany({
    where: { type: "DUO", isCurrentlyTogether: true },
    orderBy: { strength: "desc" },
    take: 10,
    include: {
      playerA: { select: { ign: true } },
      playerB: { select: { ign: true } },
    },
  });
  console.log("Top DUOs by chemistry:");
  for (const r of topDuos) {
    console.log(
      `  ${r.playerA.ign} + ${r.playerB.ign}: ${Math.round(r.strength * 100)}% · ${Math.round(r.weeksTogether)}w`,
    );
  }
  console.log();

  const clashes = await p.playerRelation.findMany({
    where: { type: "CLASH", isCurrentlyTogether: true },
    orderBy: { strength: "desc" },
    include: {
      playerA: { select: { ign: true } },
      playerB: { select: { ign: true } },
    },
  });
  console.log(`Active CLASHes (${clashes.length}):`);
  for (const r of clashes) {
    console.log(
      `  ${r.playerA.ign} × ${r.playerB.ign}: intensity ${r.strength.toFixed(2)}`,
    );
  }
  console.log();

  const mentors = await p.playerRelation.findMany({
    where: { type: "MENTOR", isCurrentlyTogether: true },
    include: {
      playerA: { select: { ign: true, age: true } },
      playerB: { select: { ign: true, age: true } },
    },
  });
  console.log(`Active MENTORships (${mentors.length}):`);
  for (const r of mentors) {
    console.log(
      `  ${r.playerA.ign} (${r.playerA.age}) mentors ${r.playerB.ign} (${r.playerB.age}) · ${Math.round(r.weeksTogether)}w`,
    );
  }

  const decaying = await p.playerRelation.findMany({
    where: { isCurrentlyTogether: false },
    orderBy: { weeksTogether: "desc" },
    take: 10,
    include: {
      playerA: { select: { ign: true } },
      playerB: { select: { ign: true } },
    },
  });
  console.log();
  console.log(`Decaying historical (top 10 by remaining weeks):`);
  for (const r of decaying) {
    console.log(
      `  ${r.playerA.ign} + ${r.playerB.ign} [${r.type}]: ${r.weeksTogether.toFixed(1)}w left`,
    );
  }
})().finally(() => p.$disconnect());
