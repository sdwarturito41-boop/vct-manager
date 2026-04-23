/**
 * Per-agent mobility tier (0-5). Used by Movement speed attribute.
 *
 * The score reflects the agent's in-kit mobility options (dashes, teleports,
 * satchels, sprints) — not base walk speed (which is identical across all
 * agents in Valorant). Higher = more options to reposition / peek fast.
 *
 * Scale:
 *   5 = dedicated mobility kit (Jett dash, Raze satchels, Neon sprint)
 *   4 = strong movement utility (Phoenix run-it-back, Yoru TP, Omen TP)
 *   3 = one movement ability (Chamber TP, Clove, Reyna dismiss)
 *   2 = light mobility (Sage slow orb counter, Astra TP orb)
 *   1 = static anchor (Harbor, Viper, Killjoy, Deadlock, Cypher)
 */
export const AGENT_SPEED: Record<string, number> = {
  // Duelists
  Jett: 5,
  Raze: 5,
  Neon: 5,
  Phoenix: 4,
  Yoru: 4,
  Reyna: 3,
  Iso: 3,

  // Initiators
  Sova: 2,
  Breach: 2,
  KAYO: 3,
  Skye: 3,
  Fade: 3,
  Gekko: 2,
  Tejo: 3,

  // Controllers
  Omen: 4,
  Brimstone: 2,
  Astra: 2,
  Harbor: 1,
  Viper: 1,
  Clove: 4,

  // Sentinels
  Killjoy: 1,
  Cypher: 1,
  Sage: 2,
  Chamber: 3,
  Deadlock: 1,
  Vyse: 2,
};

export function getAgentSpeed(agent: string): number {
  return AGENT_SPEED[agent] ?? 3;
}
