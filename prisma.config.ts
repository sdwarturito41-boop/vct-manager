import "dotenv/config";
import { defineConfig } from "prisma/config";

// Use `process.env` directly (lazy string fallback) so `prisma generate` works
// on Vercel's install phase when DATABASE_URL isn't yet injected — env() would
// eagerly validate and crash. The real URL is read at runtime.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  engine: "classic",
  datasource: {
    url: process.env.DATABASE_URL ?? "postgresql://placeholder",
  },
});
