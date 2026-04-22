/**
 * One-off script to reset your team's W/L/champPts to realistic values.
 *
 * Run:
 *   npx tsx scripts/reset-user-stats.ts
 *
 * Targets the team whose owner user has email USER_EMAIL below.
 */
import { PrismaClient } from "../src/generated/prisma/client";

const USER_EMAIL = "hugofeuilloy41@gmail.com";

async function main() {
  const prisma = new PrismaClient();

  const user = await prisma.user.findUnique({
    where: { email: USER_EMAIL },
    include: { team: true },
  });

  if (!user) {
    console.error(`No user found with email ${USER_EMAIL}`);
    process.exit(1);
  }
  if (!user.team) {
    console.error(`User ${user.email} has no team`);
    process.exit(1);
  }

  const before = {
    wins: user.team.wins,
    losses: user.team.losses,
    champPts: user.team.champPts,
  };

  // Recompute wins/losses from actual played matches
  const matches = await prisma.match.findMany({
    where: {
      isPlayed: true,
      OR: [{ team1Id: user.team.id }, { team2Id: user.team.id }],
    },
  });

  let wins = 0;
  let losses = 0;
  for (const m of matches) {
    if (m.winnerId === user.team.id) wins++;
    else if (m.winnerId) losses++;
  }

  // Recompute champPts from scratch:
  //  +1 per group-stage BO win
  //  +placement points at final stages
  const placementByStage: Record<string, { winner: number; loser: number }> = {
    KICKOFF_UB_FINAL: { winner: 4, loser: 0 },
    KICKOFF_MID_FINAL: { winner: 3, loser: 0 },
    KICKOFF_LB_FINAL: { winner: 2, loser: 1 },
    MASTERS_1_GRAND_FINAL: { winner: 4, loser: 3 },
    MASTERS_1_LB_FINAL: { winner: 0, loser: 2 },
    MASTERS_1_LB_SF: { winner: 0, loser: 1 },
    MASTERS_2_GRAND_FINAL: { winner: 4, loser: 3 },
    MASTERS_2_LB_FINAL: { winner: 0, loser: 2 },
    MASTERS_2_LB_SF: { winner: 0, loser: 1 },
    STAGE_1_PO_GF: { winner: 4, loser: 3 },
    STAGE_1_PO_LB_FINAL: { winner: 0, loser: 2 },
    STAGE_1_PO_LB_R2: { winner: 0, loser: 1 },
    STAGE_2_PO_GF: { winner: 4, loser: 3 },
    STAGE_2_PO_LB_FINAL: { winner: 0, loser: 2 },
    STAGE_2_PO_LB_R2: { winner: 0, loser: 1 },
  };

  const groupStages = new Set([
    "STAGE_1_ALPHA", "STAGE_1_OMEGA", "STAGE_2_ALPHA", "STAGE_2_OMEGA",
  ]);

  let champPts = 0;
  for (const m of matches) {
    if (!m.winnerId) continue;
    const isWinner = m.winnerId === user.team.id;

    if (groupStages.has(m.stageId) && isWinner) {
      champPts += 1;
    }
    const placement = placementByStage[m.stageId];
    if (placement) {
      champPts += isWinner ? placement.winner : placement.loser;
    }
  }

  await prisma.team.update({
    where: { id: user.team.id },
    data: { wins, losses, champPts },
  });

  console.log(`Team: ${user.team.name}`);
  console.log(`  Before: ${before.wins}W ${before.losses}L  ${before.champPts} champPts`);
  console.log(`  After:  ${wins}W ${losses}L  ${champPts} champPts`);
  console.log(`  (Recomputed from ${matches.length} played matches)`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
