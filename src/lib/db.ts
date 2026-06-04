import fs from "node:fs";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const localEnvPath = path.join(process.cwd(), ".env.local");

function loadLocalEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const contents = fs.readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = trimmed.slice(separatorIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadLocalEnvFile(localEnvPath);

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function normalizePostgresConnectionString(connectionString: string) {
  try {
    const url = new URL(connectionString);
    const sslMode = url.searchParams.get("sslmode")?.toLowerCase();
    if (sslMode === "prefer" || sslMode === "require" || sslMode === "verify-ca") {
      url.searchParams.set("sslmode", "verify-full");
      return url.toString();
    }
  } catch {
    // The validation below will report malformed or unsupported URLs.
  }
  return connectionString;
}

export function getDb() {
  if (!globalForPrisma.prisma) {
    const rawConnectionString = process.env.DATABASE_URL?.trim();
    const connectionString = rawConnectionString ? normalizePostgresConnectionString(rawConnectionString) : "";
    if (!connectionString) {
      throw new Error("DATABASE_URL is required to initialize Prisma.");
    }
    if (!/^postgres(ql)?:\/\//i.test(connectionString)) {
      throw new Error(
        "DATABASE_URL must point to Postgres. The Prisma runtime client does not support any other database type here.",
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
