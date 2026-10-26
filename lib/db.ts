import path from "node:path";
import { PrismaClient } from "@prisma/client";

/**
 * Lazily constructed Prisma client (one per process). Construction is deferred so that
 * importing this module — e.g. during `next build` — never touches the database.
 */
const globalForPrisma = globalThis as unknown as { __prisma?: InstanceType<typeof PrismaClient> };

export function db() {
  if (!globalForPrisma.__prisma) {
    // Local fallback: if DATABASE_URL is missing (e.g. a broken .env), use the SQLite file that `npm run setup` creates.
    const url = process.env.DATABASE_URL?.trim() || `file:${path.join(process.cwd(), "prisma", "dev.db")}`;
    globalForPrisma.__prisma = new PrismaClient({ datasourceUrl: url });
  }
  return globalForPrisma.__prisma;
}
