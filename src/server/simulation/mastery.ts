import type { PrismaClient } from "@/generated/prisma/client";
import { VALORANT_AGENTS } from "@/constants/agents";

export interface MasteryUpdateInput {
  playerId: string;
  agentName: string;
  mapName: string;
  myScore: number;
  oppScore: number;
  playerACS: number;
  naturalRole: string;
  isScrim?: boolean;
}

/**
 * Compute the base delta for a match result.
 * Positive = improvement, negative = decline.
 */
function computeBaseDelta(myScore: number, oppScore: number): number {
  const diff = myScore - oppScore;
  if (diff >= 7) return 0.30;   // stomp win (13-6 or better)
  if (diff >= 2) return 0.15;   // normal win (13-7 to 13-11)
  if (diff >= 1) return 0.08;   // close win (13-12)
  if (diff === -1) return -0.05; // close loss (12-13)
  if (diff >= -4) return -0.10; // normal loss (9-13 to 12-13)
  return -0.20;                  // stomp loss (6-13 or worse)
}

/**
 * Apply mastery progression after a map is played.
 * Implements the full formula:
 * - Base delta by score diff (stomp/normal/close win/loss)
 * - ACS multiplier (>300 or <150 = x2)
 * - Level slowdown (harder to gain mastery at high stars)
 * - Natural role bonus (off-role = x0.85)
 * - Scrim reduction (x0.5)
 * Also updates player.mapFactors[mapName] at 20% of the rate.
 */
export async function applyMasteryUpdate(
  prisma: PrismaClient,
  input: MasteryUpdateInput,
): Promise<{ newStars: number; delta: number }> {
  const { playerId, agentName, mapName, myScore, oppScore, playerACS, naturalRole, isScrim } = input;

  let delta = computeBaseDelta(myScore, oppScore);

  // ACS modifier (individual performance amplification)
  if (playerACS > 300) delta *= 2.0;
  else if (playerACS < 150) delta *= 2.0; // penalty also amplified

  // Scrim reduction (experimenting is safer but slower gain)
  if (isScrim) delta *= 0.5;

  // Find current mastery entry
  const existing = await prisma.playerAgentPool.findUnique({
    where: { playerId_agentName_mapName: { playerId, agentName, mapName } },
  });
  const currentStars = existing?.stars ?? 0;

  // Level slowdown: 1.0 at 0 stars, 0.6 at 5 stars
  const slowdown = 1 - (currentStars / 5) * 0.4;
  delta *= slowdown;

  // Natural role bonus/penalty
  const agentData = VALORANT_AGENTS.find((a) => a.name === agentName);
  const agentRole = agentData?.role;
  if (agentRole && agentRole !== naturalRole && naturalRole !== "Flex") {
    delta *= 0.85;
  }

  // Coach training effect — boost positive deltas by up to +50% based on trainingEff
  if (delta > 0) {
    const player = await prisma.player.findUnique({
      where: { id: playerId },
      select: { team: { select: { coach: { select: { trainingEff: true } } } } },
    });
    const trainingEff = player?.team?.coach?.trainingEff;
    if (trainingEff && trainingEff > 0) {
      delta *= 1 + trainingEff / 200;
    }
  }

  // Clamp and apply
  const newStars = Math.min(5, Math.max(0, currentStars + delta));

  if (existing) {
    await prisma.playerAgentPool.update({
      where: { id: existing.id },
      data: { stars: newStars, lastPlayedMatch: 0 },
    });
  } else {
    // Brand new agent pool entry — start at delta (or 1 if positive, 0 if negative)
    await prisma.playerAgentPool.create({
      data: {
        playerId,
        agentName,
        mapName,
        stars: Math.max(0, Math.min(5, delta + 1)), // starting from 1 baseline
        lastPlayedMatch: 0,
      },
    });
  }

  // Update individual map factor (5x slower)
  // Only for competitive matches (not scrims — scrims shouldn't shift map factors)
  if (!isScrim) {
    const player = await prisma.player.findUnique({
      where: { id: playerId },
      select: { mapFactors: true },
    });
    if (player) {
      const factors = (player.mapFactors ?? {}) as Record<string, number>;
      const currentFactor = factors[mapName] ?? 1.0;
      const factorDelta = delta * 0.2;
      const newFactor = Math.min(1.4, Math.max(0.6, currentFactor + factorDelta));
      factors[mapName] = newFactor;
      await prisma.player.update({
        where: { id: playerId },
        data: { mapFactors: factors },
      });
    }
  }

  return { newStars, delta };
}

/**
 * Apply passive decay (rust) to agents not played recently.
 * Called before the match for the team's players:
 * - Increment lastPlayedMatch counter for all agent pool entries of these players
 * - After 3+ matches of absence, apply -0.02 per additional absent match
 */
export async function applyPassiveDecay(
  prisma: PrismaClient,
  playerIds: string[],
  playedAgentsByPlayer: Record<string, string>, // playerId -> agentName just played
): Promise<void> {
  if (playerIds.length === 0) return;

  // Get all agent pool entries for these players
  const entries = await prisma.playerAgentPool.findMany({
    where: { playerId: { in: playerIds } },
  });

  for (const entry of entries) {
    const playedAgent = playedAgentsByPlayer[entry.playerId];
    if (playedAgent === entry.agentName) {
      // This is the agent just played, reset counter (handled in applyMasteryUpdate too)
      continue;
    }

    const newCount = entry.lastPlayedMatch + 1;
    let newStars = entry.stars;

    // Start rust after 3 matches of absence
    if (newCount > 3) {
      newStars = Math.max(0, entry.stars - 0.02);
    }

    await prisma.playerAgentPool.update({
      where: { id: entry.id },
      data: { lastPlayedMatch: newCount, stars: newStars },
    });
  }
}
