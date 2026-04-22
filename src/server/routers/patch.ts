import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "@/server/trpc";

function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

export const patchRouter = router({
  getCurrentPatch: protectedProcedure.query(async ({ ctx }) => {
    const season = await ctx.prisma.season.findFirst({ where: { isActive: true } });
    if (!season) throw new TRPCError({ code: "NOT_FOUND", message: "No active season." });

    const patch = await ctx.prisma.metaPatch.findFirst({
      where: { season: season.number, stage: season.currentStage },
      orderBy: { createdAt: "desc" },
    });

    if (!patch) return null;
    return {
      id: patch.id,
      season: patch.season,
      stage: patch.stage,
      notes: patch.notes,
      createdAt: patch.createdAt,
      buffs: toStringArray(patch.buffs),
      nerfs: toStringArray(patch.nerfs),
    };
  }),

  listPatches: protectedProcedure.query(async ({ ctx }) => {
    const patches = await ctx.prisma.metaPatch.findMany({
      orderBy: [{ season: "desc" }, { createdAt: "desc" }],
    });
    return patches.map((p) => ({
      id: p.id,
      season: p.season,
      stage: p.stage,
      notes: p.notes,
      createdAt: p.createdAt,
      buffs: toStringArray(p.buffs),
      nerfs: toStringArray(p.nerfs),
    }));
  }),
});
