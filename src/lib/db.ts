import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export function getDb() {
  if (!globalForPrisma.prisma) {
    const connectionString = process.env.DATABASE_URL?.trim();
    if (!connectionString) {
      throw new Error("DATABASE_URL is required to initialize Prisma.");
    }
    if (!/^postgres(ql)?:\/\//i.test(connectionString)) {
      throw new Error(
        "DATABASE_URL must point to Postgres. SQLite fallback is not supported by the Prisma runtime client.",
      );
    }

    const adapter = new PrismaPg({ connectionString });

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
