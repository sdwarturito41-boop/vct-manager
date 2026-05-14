import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, saveProcedure } from "../trpc";
import type { Region, Role } from "@/generated/prisma/client";

/**
 * Recruitment Hub — FM26-inspired unified entry point for everything mercato:
 *   - Board objectives (what the org expects this window)
 *   - Roster gaps (missing roles / weak links)
 *   - Expiring contracts (players with < 8 weeks left)
 *   - Shortlist (scouted players, reveal status per analyst skill)
 *   - Free agents / Buyout market (stats hidden unless scouted)
 *
 * Each candidate row carries an `isScoutedByMe` flag — the UI uses that to
 * decide whether to show full stats or just the name/role/region card.
 */

const ROLES_PRIMARY = ["Duelist", "Initiator", "Sentinel", "Controller"] as const;

export const recruitmentRouter = router({
  /** Single payload the Recruitment Hub page hydrates from. */
  hub: saveProcedure
    .input(
      z.object({
        region: z.enum(["EMEA", "Americas", "Pacific", "China", "ALL"]).optional(),
      }).optional(),
    )
    .query(async ({ ctx, input }) => {
      const team = await ctx.prisma.team.findFirst({
        where: { saveId: ctx.save.id, isPlayerTeam: true },
        select: {
          id: true,
          name: true,
          region: true,
          budget: true,
          transferBudget: true,
          wageBudgetSeason: true,
          prestige: true,
          players: {
            where: { isActive: true, isRetired: false },
            select: {
              id: true,
              role: true,
              overall: true,
              salary: true,
              isReserve: true,
            },
          },
          staff: {
            where: { role: "ANALYST" },
            select: { skill1: true },
          },
        },
      });
      if (!team) throw new TRPCError({ code: "NOT_FOUND", message: "Team not found." });

      // Best analyst → determines reveal window (4 → 1 weeks).
      const bestAnalystSkill = team.staff.reduce((m, s) => Math.max(m, s.skill1), 0);
      const revealWeeks = Math.max(1, Math.round(5 - (bestAnalystSkill / 100) * 4));

      const season = await ctx.prisma.season.findFirst({
        where: { saveId: ctx.save.id, isActive: true },
        select: { number: true, currentWeek: true },
      });
      const absWeek = season ? season.number * 52 + season.currentWeek : 0;

      // ── 1. Board objectives ──
      // Static-for-now derivation: missing primary roles + win-rate health.
      const rolesPresent = new Set(
        team.players.filter((p) => !p.isReserve).map((p) => p.role),
      );
      const missingRoles = ROLES_PRIMARY.filter((r) => !rolesPresent.has(r as Role));
      const teamAvg = team.players.length
        ? team.players.reduce((s, p) => s + (p.overall ?? 10), 0) / team.players.length
        : 10;

      const objectives: Array<{ kind: "ROLE_GAP" | "UPGRADE" | "DEPTH"; label: string }> = [];
      for (const role of missingRoles) {
        objectives.push({
          kind: "ROLE_GAP",
          label: `Signer un ${role} pour combler le poste vacant`,
        });
      }
      if (teamAvg < 12) {
        objectives.push({
          kind: "UPGRADE",
          label: `Renforcer l'effectif (moyenne ${Math.round(teamAvg)} OVR)`,
        });
      }
      if (team.players.filter((p) => !p.isReserve).length < 5) {
        objectives.push({
          kind: "DEPTH",
          label: "Compléter l'effectif titulaire (minimum 5 joueurs)",
        });
      }

      // ── 2. Roster gaps — slot-aware breakdown ──
      const rosterGaps = ROLES_PRIMARY.map((role) => {
        const occupants = team.players.filter(
          (p) => p.role === (role as Role) && !p.isReserve,
        );
        const avgOverall = occupants.length
          ? Math.round(
              occupants.reduce((s, p) => s + (p.overall ?? 10), 0) / occupants.length,
            )
          : null;
        return {
          role,
          count: occupants.length,
          avgOverall,
          status:
            occupants.length === 0
              ? ("MISSING" as const)
              : avgOverall != null && avgOverall < 11
                ? ("WEAK" as const)
                : ("OK" as const),
        };
      });

      // ── 3. Expiring contracts (user team) ──
      const expiringPlayers = await ctx.prisma.player.findMany({
        where: {
          teamId: team.id,
          isActive: true,
          isRetired: false,
        },
        select: {
          id: true,
          ign: true,
          role: true,
          age: true,
          salary: true,
          overall: true,
          contractEndSeason: true,
          contractEndWeek: true,
          imageUrl: true,
        },
      });
      const currentSeason = season?.number ?? 1;
      const currentWeek = season?.currentWeek ?? 1;
      const expiring = expiringPlayers
        .map((p) => {
          const weeksLeft =
            (p.contractEndSeason - currentSeason) * 52 + (p.contractEndWeek - currentWeek);
          return { ...p, weeksLeft };
        })
        .filter((p) => p.weeksLeft <= 8 && p.weeksLeft >= 0)
        .sort((a, b) => a.weeksLeft - b.weeksLeft);

      // ── 4. Shortlist (scouted by user team) ──
      const shortlist = await ctx.prisma.shortlist.findMany({
        where: { teamId: team.id },
        orderBy: { addedWeek: "desc" },
        select: {
          id: true,
          addedWeek: true,
          player: {
            select: {
              id: true,
              ign: true,
              firstName: true,
              lastName: true,
              role: true,
              region: true,
              nationality: true,
              age: true,
              salary: true,
              buyoutClause: true,
              teamId: true,
              currentTeam: true,
              imageUrl: true,
              overall: true,
              potential: true,
              potentialRevealed: true,
              acs: true,
              kd: true,
              kast: true,
              adr: true,
            },
          },
        },
      });
      const shortlistedPlayerIds = new Set(shortlist.map((s) => s.player.id));

      // ── 5. Free agents pool (region-aware, capped) ──
      const targetRegion = input?.region && input.region !== "ALL" ? input.region : null;
      const freeAgents = await ctx.prisma.player.findMany({
        where: {
          teamId: null,
          currentTeam: null,
          isRetired: false,
          isActive: true,
          ...(targetRegion ? { region: targetRegion } : {}),
        },
        select: {
          id: true,
          ign: true,
          firstName: true,
          lastName: true,
          role: true,
          region: true,
          nationality: true,
          age: true,
          salary: true,
          imageUrl: true,
          // Sensitive fields the UI gates on `isScoutedByMe`:
          overall: true,
          acs: true,
          kd: true,
          kast: true,
          potential: true,
          potentialRevealed: true,
        },
        orderBy: { overall: "desc" },
        take: 30,
      });

      // ── 6. Buyout market — listed players + free agents on contract ──
      const buyoutMarket = await ctx.prisma.player.findMany({
        where: {
          isRetired: false,
          isActive: true,
          isTransferListed: true,
          NOT: { teamId: team.id },
          ...(targetRegion ? { region: targetRegion } : {}),
        },
        select: {
          id: true,
          ign: true,
          firstName: true,
          lastName: true,
          role: true,
          region: true,
          nationality: true,
          age: true,
          salary: true,
          buyoutClause: true,
          imageUrl: true,
          currentTeam: true,
          team: { select: { id: true, name: true, tag: true, logoUrl: true } },
          overall: true,
          acs: true,
          kd: true,
          kast: true,
          potential: true,
          potentialRevealed: true,
        },
        orderBy: { overall: "desc" },
        take: 30,
      });

      function withScoutingFlag<T extends { id: string; potentialRevealed: boolean }>(
        p: T,
        addedWeek: number | undefined,
      ): T & {
        isScoutedByMe: boolean;
        scoutingProgressWeeks: number;
        scoutingTotalWeeks: number;
      } {
        const onShortlist = shortlistedPlayerIds.has(p.id);
        const elapsed = addedWeek != null ? Math.max(0, absWeek - addedWeek) : 0;
        // Fully scouted only when revealed AND on shortlist; UI shows
        // intermediate "scouting in progress" otherwise.
        const isScoutedByMe = onShortlist && p.potentialRevealed;
        return {
          ...p,
          isScoutedByMe,
          scoutingProgressWeeks: onShortlist ? elapsed : 0,
          scoutingTotalWeeks: revealWeeks,
        };
      }

      // Build addedWeek lookup once
      const addedWeekByPlayer = new Map(shortlist.map((s) => [s.player.id, s.addedWeek]));

      return {
        team: {
          id: team.id,
          name: team.name,
          region: team.region,
          transferEnvelope: team.transferBudget + team.budget,
          analystSkill: bestAnalystSkill,
          revealWeeks,
        },
        objectives,
        rosterGaps,
        expiring: expiring.map((p) => ({
          id: p.id,
          ign: p.ign,
          role: p.role,
          age: p.age,
          salary: p.salary,
          overall: p.overall,
          weeksLeft: p.weeksLeft,
          imageUrl: p.imageUrl,
        })),
        shortlist: shortlist.map((s) => ({
          shortlistId: s.id,
          addedWeek: s.addedWeek,
          player: withScoutingFlag(s.player, s.addedWeek),
        })),
        freeAgents: freeAgents.map((p) =>
          withScoutingFlag(p, addedWeekByPlayer.get(p.id)),
        ),
        buyoutMarket: buyoutMarket.map((p) =>
          withScoutingFlag(p, addedWeekByPlayer.get(p.id)),
        ),
      };
    }),
});
