import { initTRPC, TRPCError } from "@trpc/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const createTRPCContext = async () => {
  const session = await auth();
  return { prisma, session, userId: session?.user?.id };
};

export type TRPCContext = Awaited<ReturnType<typeof createTRPCContext>>;

const t = initTRPC.context<TRPCContext>().create({
  errorFormatter({ shape, error }) {
    if (error.code === "INTERNAL_SERVER_ERROR") {
      console.error("[tRPC INTERNAL]", error.message, "\nstack:", error.stack);
    }
    return shape;
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;

/** Logged-in user required — does NOT require a save to exist yet. */
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, userId: ctx.userId } });
});

/**
 * Logged-in user + active save required. Use this for every game-state query
 * (team, match, season, league, etc.). `ctx.save` is guaranteed non-null inside.
 */
export const saveProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.userId) throw new TRPCError({ code: "UNAUTHORIZED" });
  const save = await ctx.prisma.save.findUnique({ where: { userId: ctx.userId } });
  if (!save) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "NO_SAVE",
    });
  }
  return next({ ctx: { ...ctx, userId: ctx.userId, save } });
});
