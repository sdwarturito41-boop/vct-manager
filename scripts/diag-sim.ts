import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";

const p = new PrismaClient();

(async () => {
  console.log("DB:", (process.env.DATABASE_URL ?? "").slice(0, 40) + "...");

  // ── Saves ───────────────────────────────────────────────
  const saves = await p.save.findMany({ select: { id: true, name: true, createdAt: true } });
  console.log(`\nSaves: ${saves.length}`);
  for (const s of saves) console.log(`  ${s.id}  ${s.name}  ${s.createdAt.toISOString().slice(0, 10)}`);
  if (saves.length === 0) {
    console.log("→ aucune save. Le front connecte peut-être un autre DB.");
    return;
  }

  // ── Players totaux ──────────────────────────────────────
  const totalPlayers = await p.player.count();
  const bySave = await p.player.groupBy({ by: ["saveId"], _count: true });
  console.log(`\nPlayers total: ${totalPlayers}`);
  for (const g of bySave) console.log(`  saveId=${g.saveId ?? "(null)"}  ${g._count} players`);

  // ── Teams ───────────────────────────────────────────────
  const totalTeams = await p.team.count();
  const teamsBySave = await p.team.groupBy({ by: ["saveId"], _count: true });
  console.log(`\nTeams total: ${totalTeams}`);
  for (const g of teamsBySave) console.log(`  saveId=${g.saveId ?? "(null)"}  ${g._count} teams`);

  // ── Focus première save ─────────────────────────────────
  const save = saves[0];
  console.log(`\n── Save: ${save.name} ────────────────────`);

  const season = await p.season.findFirst({ where: { saveId: save.id } });
  console.log(`Season: ${season?.number} · Stage: ${season?.currentStage} · Day: ${season?.currentDay} · Week: ${season?.currentWeek}`);

  const played = await p.match.count({ where: { saveId: save.id, isPlayed: true } });
  const unplayed = await p.match.count({ where: { saveId: save.id, isPlayed: false } });
  console.log(`Matches — played: ${played}  unplayed: ${unplayed}`);

  const nextUnplayed = await p.match.findMany({
    where: { saveId: save.id, isPlayed: false },
    orderBy: [{ day: "asc" }],
    take: 10,
    select: { stageId: true, day: true, team1Id: true, team2Id: true },
  });
  console.log("Next 10 unplayed:");
  for (const m of nextUnplayed) console.log(`  ${m.stageId.padEnd(28)} day=${m.day}  ${m.team1Id.slice(0, 8)} vs ${m.team2Id.slice(0, 8)}`);

  // ── Rosters vides ───────────────────────────────────────
  const teams = await p.team.findMany({
    where: { saveId: save.id },
    include: { players: { where: { isActive: true } } },
  });
  const empty = teams.filter((t) => t.players.length === 0);
  console.log(`\nTeams avec 0 actifs: ${empty.length} / ${teams.length}`);
  if (empty.length > 0) console.log("  →", empty.slice(0, 8).map((t) => t.name).join(", "));

  // ── Active vs retired ───────────────────────────────────
  const active = await p.player.count({ where: { saveId: save.id, isActive: true } });
  const retired = await p.player.count({ where: { saveId: save.id, isRetired: true } });
  const inactive = await p.player.count({ where: { saveId: save.id, isActive: false, isRetired: false } });
  console.log(`\nPlayers (save=${save.name}): active=${active}  inactive=${inactive}  retired=${retired}`);
})().finally(() => p.$disconnect());
