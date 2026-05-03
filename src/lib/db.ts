import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { databasePath } from "@/lib/files";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export function getDb() {
  if (!globalForPrisma.prisma) {
    const adapter = new PrismaBetterSqlite3({
      url: `file:${databasePath}`,
    });

    globalForPrisma.prisma = new PrismaClient({ adapter });
  }

  return globalForPrisma.prisma;
}

export async function resetDb() {
  const existing = globalForPrisma.prisma;
  globalForPrisma.prisma = undefined;
  if (existing) {
    try {
      await existing.$disconnect();
    } catch {
      // best-effort: ignore disconnect failures
    }
  }
}

export const db = getDb();
