import { PrismaClient } from "../src/generated/prisma/client";

const p = new PrismaClient();

(async () => {
  const templates = await p.player.count({ where: { teamId: null } });
  const clones = await p.player.count({ where: { teamId: { not: null } } });
  const saves = await p.save.count();
  console.log("Template pool (teamId=null): " + templates);
  console.log("Cloned (teamId set): " + clones);
  console.log("Active saves: " + saves);

  const all = await p.player.findMany({
    where: { teamId: null },
    select: { currentTeam: true, ign: true },
  });
  const dupeCount = new Map<string, number>();
  for (const pl of all) {
    const k = pl.currentTeam + "::" + pl.ign;
    dupeCount.set(k, (dupeCount.get(k) || 0) + 1);
  }
  const dupes = [...dupeCount.values()].filter((n) => n > 1).length;
  console.log("Duplicated template entries: " + dupes);
})().finally(() => p.$disconnect());
