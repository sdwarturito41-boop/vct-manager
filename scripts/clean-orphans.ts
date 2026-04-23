import { PrismaClient } from "../src/generated/prisma/client";

const prisma = new PrismaClient();

(async () => {
  console.log("═══════════════════════════════════════");
  console.log(" Orphan cleanup — save-scoped tables");
  console.log("═══════════════════════════════════════");

  const validTeamIds = new Set(
    (await prisma.team.findMany({ select: { id: true } })).map((t) => t.id),
  );
  const validPlayerIds = new Set(
    (await prisma.player.findMany({ select: { id: true } })).map((p) => p.id),
  );
  const validSaveIds = new Set(
    (await prisma.save.findMany({ select: { id: true } })).map((s) => s.id),
  );
  const validCoachIds = new Set(
    (await prisma.coach.findMany({ select: { id: true } })).map((c) => c.id),
  );

  let totalDeleted = 0;
  const log = (label: string, n: number) => {
    if (n > 0) totalDeleted += n;
    console.log(`  ${label.padEnd(40)} ${n > 0 ? `deleted ${n}` : "clean"}`);
  };

  // Scrim.teamId
  const scrimOrphans = await prisma.scrim.findMany({
    where: { teamId: { notIn: Array.from(validTeamIds) } },
    select: { id: true },
  });
  if (scrimOrphans.length > 0) {
    await prisma.scrim.deleteMany({
      where: { id: { in: scrimOrphans.map((s) => s.id) } },
    });
  }
  log("Scrim (orphan teamId)", scrimOrphans.length);

  // Match.team1Id / team2Id
  const matchOrphans = await prisma.match.findMany({
    where: {
      OR: [
        { team1Id: { notIn: Array.from(validTeamIds) } },
        { team2Id: { notIn: Array.from(validTeamIds) } },
      ],
    },
    select: { id: true },
  });
  if (matchOrphans.length > 0) {
    await prisma.match.deleteMany({ where: { id: { in: matchOrphans.map((m) => m.id) } } });
  }
  log("Match (orphan team1/team2)", matchOrphans.length);

  // Message.teamId
  const messageOrphans = await prisma.message.findMany({
    where: { teamId: { notIn: Array.from(validTeamIds) } },
    select: { id: true },
  });
  if (messageOrphans.length > 0) {
    await prisma.message.deleteMany({ where: { id: { in: messageOrphans.map((m) => m.id) } } });
  }
  log("Message (orphan teamId)", messageOrphans.length);

  // Sponsor.teamId
  const sponsorOrphans = await prisma.sponsor.findMany({
    where: { teamId: { notIn: Array.from(validTeamIds) } },
    select: { id: true },
  });
  if (sponsorOrphans.length > 0) {
    await prisma.sponsor.deleteMany({ where: { id: { in: sponsorOrphans.map((s) => s.id) } } });
  }
  log("Sponsor (orphan teamId)", sponsorOrphans.length);

  // TransferOffer.fromTeamId + toTeamId + playerId
  const offerOrphans = await prisma.transferOffer.findMany({
    where: {
      OR: [
        { fromTeamId: { notIn: Array.from(validTeamIds) } },
        { AND: [{ toTeamId: { not: null } }, { toTeamId: { notIn: Array.from(validTeamIds) } }] },
        { playerId: { notIn: Array.from(validPlayerIds) } },
      ],
    },
    select: { id: true },
  });
  if (offerOrphans.length > 0) {
    await prisma.transferOffer.deleteMany({ where: { id: { in: offerOrphans.map((o) => o.id) } } });
  }
  log("TransferOffer (orphan team/player)", offerOrphans.length);

  // TrainingSession.teamId / playerId
  const trainOrphans = await prisma.trainingSession.findMany({
    where: {
      OR: [
        { teamId: { notIn: Array.from(validTeamIds) } },
        { playerId: { notIn: Array.from(validPlayerIds) } },
      ],
    },
    select: { id: true },
  });
  if (trainOrphans.length > 0) {
    await prisma.trainingSession.deleteMany({ where: { id: { in: trainOrphans.map((t) => t.id) } } });
  }
  log("TrainingSession (orphan team/player)", trainOrphans.length);

  // Injury.playerId
  const injuryOrphans = await prisma.injury.findMany({
    where: { playerId: { notIn: Array.from(validPlayerIds) } },
    select: { id: true },
  });
  if (injuryOrphans.length > 0) {
    await prisma.injury.deleteMany({ where: { id: { in: injuryOrphans.map((i) => i.id) } } });
  }
  log("Injury (orphan playerId)", injuryOrphans.length);

  // PlayerAgentPool.playerId
  const poolOrphans = await prisma.playerAgentPool.findMany({
    where: { playerId: { notIn: Array.from(validPlayerIds) } },
    select: { id: true },
  });
  if (poolOrphans.length > 0) {
    await prisma.playerAgentPool.deleteMany({ where: { id: { in: poolOrphans.map((p) => p.id) } } });
  }
  log("PlayerAgentPool (orphan playerId)", poolOrphans.length);

  // Team.coachId — nullify (not delete) if coach gone
  const teamBadCoach = await prisma.team.findMany({
    where: {
      AND: [{ coachId: { not: null } }, { coachId: { notIn: Array.from(validCoachIds) } }],
    },
    select: { id: true },
  });
  if (teamBadCoach.length > 0) {
    await prisma.team.updateMany({
      where: { id: { in: teamBadCoach.map((t) => t.id) } },
      data: { coachId: null },
    });
  }
  log("Team.coachId (orphan → null)", teamBadCoach.length);

  // Messages, Sponsors etc. save-scoped with bad saveId
  for (const [label, model] of [
    ["Match (orphan saveId)", "match"],
    ["Message (orphan saveId)", "message"],
    ["Sponsor (orphan saveId)", "sponsor"],
    ["Scrim (orphan saveId)", "scrim"],
    ["Injury (orphan saveId)", "injury"],
    ["TrainingSession (orphan saveId)", "trainingSession"],
    ["TransferOffer (orphan saveId)", "transferOffer"],
    ["MetaPatch (orphan saveId)", "metaPatch"],
    ["MapPool (orphan saveId)", "mapPool"],
    ["PlayerAgentPool (orphan saveId)", "playerAgentPool"],
  ] as const) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = (prisma as any)[model];
    const orphans = await client.findMany({
      where: {
        AND: [{ saveId: { not: null } }, { saveId: { notIn: Array.from(validSaveIds) } }],
      },
      select: { id: true },
    });
    if (orphans.length > 0) {
      await client.deleteMany({ where: { id: { in: orphans.map((o: { id: string }) => o.id) } } });
    }
    log(label, orphans.length);
  }

  console.log();
  console.log(`Total orphan rows removed: ${totalDeleted}`);
  console.log("Now retry: npx prisma db push --accept-data-loss");
})().finally(() => prisma.$disconnect());
