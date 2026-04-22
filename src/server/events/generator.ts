import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Random event generator for the manager sim.
 * Called from advanceDay for each user-managed team each day.
 * Generates messages + optional side-effects (injuries, offers, etc.).
 *
 * Trigger rates are tuned to average ~1–3 events per week.
 */

interface EventContext {
  teamId: string;
  season: number;
  week: number;
  currentDay: number;
}

type EventGenerator = (prisma: PrismaClient, ctx: EventContext) => Promise<boolean>;

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

// ─────────────────────────────────────────────────
// Individual event generators
// ─────────────────────────────────────────────────

/** Player dissatisfied with lack of playtime (bench or poor personal results) */
const eventPlayerUnhappy: EventGenerator = async (prisma, ctx) => {
  const players = await prisma.player.findMany({
    where: { teamId: ctx.teamId, isActive: true, isRetired: false },
    orderBy: { acs: "asc" },
    take: 3,
  });
  if (players.length === 0) return false;

  const player = pick(players);
  const moods = [
    `${player.ign} feels like his role in the team is shrinking.`,
    `${player.ign} has been quiet in the comms lately, and the team noticed.`,
    `${player.ign} approached the board asking about his future with the team.`,
  ];
  const raiseWanted = Math.round(player.salary * rand(1.1, 1.35));

  await prisma.message.create({
    data: {
      teamId: ctx.teamId,
      category: "PLAYER",
      fromName: player.ign,
      fromRole: "Player",
      subject: `${player.ign} wants a raise`,
      body: `${pick(moods)}\n\nHe's asking for a salary bump — roughly $${raiseWanted.toLocaleString()}/week would make him feel valued.\n\nIgnoring this could affect his morale and in-game performance.`,
      eventType: "player_raise_request",
      eventData: { playerId: player.id, proposedSalary: raiseWanted },
      requiresAction: true,
      week: ctx.week,
      season: ctx.season,
    },
  });
  return true;
};

/** Player suffers an injury — out for X weeks */
const eventInjury: EventGenerator = async (prisma, ctx) => {
  const players = await prisma.player.findMany({
    where: { teamId: ctx.teamId, isActive: true, isRetired: false },
  });
  if (players.length === 0) return false;

  // Check no one is already injured
  const existing = await prisma.injury.findMany({
    where: { playerId: { in: players.map((p) => p.id) }, isActive: true },
  });
  const availablePlayers = players.filter((p) => !existing.some((i) => i.playerId === p.id));
  if (availablePlayers.length === 0) return false;

  const player = pick(availablePlayers);
  const severity = pick(["minor", "minor", "moderate", "severe"] as const);
  const weeksOut = severity === "minor" ? randInt(1, 2) : severity === "moderate" ? randInt(2, 4) : randInt(4, 8);
  const endWeek = ctx.week + weeksOut;

  const ailments = {
    minor: ["wrist strain", "bruised finger", "eye strain", "headache cluster"],
    moderate: ["mild RSI in the wrist", "back pain", "shoulder inflammation"],
    severe: ["torn tendon", "severe wrist injury", "mental health leave", "concussion"],
  };
  const description = pick(ailments[severity]);

  await prisma.injury.create({
    data: {
      playerId: player.id,
      startWeek: ctx.week,
      startSeason: ctx.season,
      endWeek,
      endSeason: ctx.season,
      severity,
      description,
      isActive: true,
    },
  });

  await prisma.message.create({
    data: {
      teamId: ctx.teamId,
      category: "PLAYER",
      fromName: "Medical Staff",
      fromRole: "Medical",
      subject: `Injury report — ${player.ign}`,
      body: `${player.ign} has been diagnosed with ${description}.\n\nExpected recovery: ${weeksOut} week${weeksOut === 1 ? "" : "s"}.\n\nHe won't be available for matches during this period. You may want to look at the bench or the market.`,
      eventType: "injury",
      eventData: { playerId: player.id, severity, weeksOut, endWeek },
      requiresAction: false,
      week: ctx.week,
      season: ctx.season,
    },
  });
  return true;
};

/** Rival team tries to poach one of your stars */
const eventPoachOffer: EventGenerator = async (prisma, ctx) => {
  const players = await prisma.player.findMany({
    where: { teamId: ctx.teamId, isActive: true, isRetired: false },
    orderBy: { acs: "desc" },
    take: 3,
  });
  if (players.length === 0) return false;

  const star = players[0];
  const rivals = await prisma.team.findMany({
    where: { id: { not: ctx.teamId } },
    orderBy: { prestige: "desc" },
    take: 8,
  });
  if (rivals.length === 0) return false;

  const rival = pick(rivals);
  const offer = Math.round(star.salary * rand(1.4, 2.0));

  await prisma.message.create({
    data: {
      teamId: ctx.teamId,
      category: "MARKET",
      fromName: rival.name,
      fromRole: "Rival Team",
      subject: `${rival.tag} inquires about ${star.ign}`,
      body: `${rival.name} has made contact regarding your player ${star.ign}.\n\nTheir representative mentioned a salary in the range of $${offer.toLocaleString()}/week and claim they're ready to trigger the buyout clause.\n\nWe can raise ${star.ign}'s salary to keep him happy, or prepare for a potential transfer offer.`,
      eventType: "poach_interest",
      eventData: { playerId: star.id, rivalId: rival.id, rivalName: rival.name, offerSalary: offer },
      requiresAction: false,
      week: ctx.week,
      season: ctx.season,
    },
  });
  return true;
};

/** Board expresses expectations (start of stage) */
const eventBoardExpectations: EventGenerator = async (prisma, ctx) => {
  const team = await prisma.team.findUnique({ where: { id: ctx.teamId } });
  if (!team) return false;

  const targets = team.prestige > 75 ? ["top 3", "semifinals", "winning the stage"]
    : team.prestige > 50 ? ["playoffs", "top 6", "a positive record"]
    : ["surviving elimination", "at least one win", "not finishing last"];
  const target = pick(targets);

  await prisma.message.create({
    data: {
      teamId: ctx.teamId,
      category: "BOARD",
      fromName: "Team Owner",
      fromRole: "Board",
      subject: "Stage expectations",
      body: `The board has reviewed this stage and set the target: ${target}.\n\nMeeting this expectation keeps your position and unlocks budget growth. Falling short could lead to tougher conversations next off-season.`,
      eventType: "board_expectations",
      eventData: { target, prestige: team.prestige },
      requiresAction: false,
      week: ctx.week,
      season: ctx.season,
    },
  });
  return true;
};

/** Sponsor warning if team is underperforming */
const eventSponsorWarning: EventGenerator = async (prisma, ctx) => {
  const team = await prisma.team.findUnique({ where: { id: ctx.teamId } });
  if (!team) return false;
  if (team.wins + team.losses < 3) return false; // too early

  const winRate = team.wins / Math.max(1, team.wins + team.losses);
  if (winRate > 0.35) return false; // only fires if losing a lot

  const sponsors = await prisma.sponsor.findMany({ where: { teamId: ctx.teamId, isActive: true } });
  if (sponsors.length === 0) return false;

  const sponsor = pick(sponsors);
  await prisma.message.create({
    data: {
      teamId: ctx.teamId,
      category: "SPONSOR",
      fromName: sponsor.name,
      fromRole: "Sponsor",
      subject: `${sponsor.name} — contract review`,
      body: `${sponsor.name} has expressed concern over the team's recent form.\n\nThey're reviewing their commitment and could reduce their weekly investment if results don't improve. Their current contract still has time left, but continued losses will hurt the renewal.\n\nKeep winning matches — their bonuses depend on it.`,
      eventType: "sponsor_warning",
      eventData: { sponsorId: sponsor.id, currentPayment: sponsor.weeklyPayment },
      requiresAction: false,
      week: ctx.week,
      season: ctx.season,
    },
  });
  return true;
};

/** Star performance from last match */
const eventStarPerformance: EventGenerator = async (prisma, ctx) => {
  const recent = await prisma.match.findFirst({
    where: {
      isPlayed: true,
      OR: [{ team1Id: ctx.teamId }, { team2Id: ctx.teamId }],
    },
    orderBy: { playedAt: "desc" },
  });
  if (!recent) return false;

  const players = await prisma.player.findMany({
    where: { teamId: ctx.teamId, isActive: true },
    orderBy: { acs: "desc" },
    take: 2,
  });
  if (players.length === 0) return false;
  const player = pick(players);

  const winTemplates = [
    `${player.ign} lit up the scoreboard in the latest match and is trending on social media.`,
    `Analysts are calling ${player.ign}'s performance "textbook" — the community loves it.`,
    `${player.ign} is receiving praise across the esports press for his recent display.`,
  ];

  await prisma.message.create({
    data: {
      teamId: ctx.teamId,
      category: "MEDIA",
      fromName: "Press Desk",
      fromRole: "Press",
      subject: `${player.ign} in the spotlight`,
      body: `${pick(winTemplates)}\n\nThis is great PR for the team — expect sponsor interest to rise.`,
      eventType: "star_performance",
      eventData: { playerId: player.id },
      requiresAction: false,
      week: ctx.week,
      season: ctx.season,
    },
  });
  return true;
};

/** Coach tactical recommendation */
const eventCoachAdvice: EventGenerator = async (prisma, ctx) => {
  const team = await prisma.team.findUnique({
    where: { id: ctx.teamId },
    include: { coach: true },
  });
  if (!team?.coach) return false;

  const advice = [
    "We should consider switching to a more aggressive playstyle — the lineup is built for it.",
    "Our utility usage has been below average. Worth running extra utility drills this week.",
    "Our anchor on defense has been isolated too often. Re-think rotations in the next training.",
    "The meta is shifting. Our current picks might not be optimal for the upcoming patch.",
    "The entry fragger is getting traded too often. We need to set up better support for them.",
  ];

  await prisma.message.create({
    data: {
      teamId: ctx.teamId,
      category: "COACH",
      fromName: team.coach.name,
      fromRole: "Coach",
      subject: "Tactical note",
      body: `${pick(advice)}\n\nWorth considering — our win rate could depend on this.`,
      eventType: "coach_advice",
      eventData: { coachId: team.coach.id },
      requiresAction: false,
      week: ctx.week,
      season: ctx.season,
    },
  });
  return true;
};

// ─────────────────────────────────────────────────
// Main export: run events for a team
// ─────────────────────────────────────────────────

/**
 * Generate 0-2 random events for a team.
 * Called from advanceDay once per day.
 */
export async function runRandomEvents(
  prisma: PrismaClient,
  ctx: EventContext,
): Promise<number> {
  // Base probability of any event firing this day: ~25% per day = ~1.75 per week
  if (Math.random() > 0.25) return 0;

  const generators: { fn: EventGenerator; weight: number }[] = [
    { fn: eventPlayerUnhappy, weight: 10 },
    { fn: eventInjury, weight: 6 },
    { fn: eventPoachOffer, weight: 8 },
    { fn: eventBoardExpectations, weight: 2 }, // rare — stage-specific better
    { fn: eventSponsorWarning, weight: 5 },
    { fn: eventStarPerformance, weight: 7 },
    { fn: eventCoachAdvice, weight: 6 },
  ];

  // Weighted random pick
  const totalWeight = generators.reduce((s, g) => s + g.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const g of generators) {
    if (roll < g.weight) {
      const fired = await g.fn(prisma, ctx);
      return fired ? 1 : 0;
    }
    roll -= g.weight;
  }
  return 0;
}

/**
 * Clear injuries whose end date has passed.
 * Called during advanceDay to auto-heal players.
 */
export async function clearExpiredInjuries(
  prisma: PrismaClient,
  ctx: { season: number; week: number },
): Promise<number> {
  const expired = await prisma.injury.findMany({
    where: {
      isActive: true,
      OR: [
        { endSeason: { lt: ctx.season } },
        { endSeason: ctx.season, endWeek: { lte: ctx.week } },
      ],
    },
    include: { player: true },
  });
  if (expired.length === 0) return 0;

  for (const inj of expired) {
    await prisma.injury.update({ where: { id: inj.id }, data: { isActive: false } });
    // Announce recovery as a message
    if (inj.player.teamId) {
      await prisma.message.create({
        data: {
          teamId: inj.player.teamId,
          category: "PLAYER",
          fromName: "Medical Staff",
          fromRole: "Medical",
          subject: `${inj.player.ign} has recovered`,
          body: `${inj.player.ign} is cleared to play again after recovering from ${inj.description}.\n\nHe's back in the starting lineup.`,
          eventType: "injury_recovery",
          eventData: { playerId: inj.playerId },
          requiresAction: false,
          week: ctx.week,
          season: ctx.season,
        },
      });
    }
  }
  return expired.length;
}
