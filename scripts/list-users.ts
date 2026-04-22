import { PrismaClient } from "../src/generated/prisma/client";

async function main() {
  const prisma = new PrismaClient();
  const users = await prisma.user.findMany({
    include: { team: { select: { name: true, wins: true, losses: true, champPts: true } } },
  });
  for (const u of users) {
    console.log(`${u.email ?? "(no email)"} → ${u.team?.name ?? "(no team)"} ${u.team ? `[${u.team.wins}W ${u.team.losses}L ${u.team.champPts}pts]` : ""}`);
  }
  await prisma.$disconnect();
}
main();
