import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient;
  prismaQueryCount: { n: number };
};

// Per-query console.log is opt-in via PRISMA_LOG=1 (works in prod too — flip
// on Vercel env to debug N+1 patterns where pooler latency makes them painful).
// The QUERY COUNTER is always on so timing middlewares can read it for free.
const verboseLog = process.env.PRISMA_LOG === "1";

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [{ emit: "event", level: "query" }, "warn", "error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

if (!globalForPrisma.prismaQueryCount) {
  globalForPrisma.prismaQueryCount = { n: 0 };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (prisma as any).$on("query", (e: { query: string; params: string; duration: number }) => {
    globalForPrisma.prismaQueryCount.n += 1;
    if (verboseLog) {
      const q = e.query.length > 140 ? e.query.slice(0, 140) + "…" : e.query;
      console.log(`[prisma #${globalForPrisma.prismaQueryCount.n}] ${e.duration}ms · ${q}`);
    }
  });
}

/** Read the current total query count (monotonically increasing). */
export function getQueryCount(): number {
  return globalForPrisma.prismaQueryCount?.n ?? 0;
}
