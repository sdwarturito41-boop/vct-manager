import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient;
  prismaQueryCount: { n: number; lastReset: number };
};

// Dev-only: log every query + a running counter so we can grep for N+1 in
// hot procedures (e.g. advanceDay). Disable PRISMA_LOG=0 to silence.
const enableLog = process.env.NODE_ENV !== "production" && process.env.PRISMA_LOG !== "0";

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient(
    enableLog
      ? { log: [{ emit: "event", level: "query" }, "warn", "error"] }
      : undefined,
  );

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

if (enableLog && !globalForPrisma.prismaQueryCount) {
  globalForPrisma.prismaQueryCount = { n: 0, lastReset: Date.now() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).$on("query", (e: { query: string; params: string; duration: number }) => {
    globalForPrisma.prismaQueryCount.n += 1;
    // Truncate the query for readability; full param dump is rarely useful at this level.
    const q = e.query.length > 140 ? e.query.slice(0, 140) + "…" : e.query;
    console.log(`[prisma #${globalForPrisma.prismaQueryCount.n}] ${e.duration}ms · ${q}`);
  });
}

/**
 * Returns the current query counter and resets it. Call at the start of a hot
 * procedure and at the end to see how many queries it fired.
 *
 *   const before = readAndResetQueryCount();
 *   // ... do work ...
 *   const used = readAndResetQueryCount() - before;
 *   console.log(`[advanceDay] used ${used} queries`);
 */
export function readAndResetQueryCount(): number {
  if (!globalForPrisma.prismaQueryCount) return 0;
  const n = globalForPrisma.prismaQueryCount.n;
  globalForPrisma.prismaQueryCount.n = 0;
  globalForPrisma.prismaQueryCount.lastReset = Date.now();
  return n;
}
