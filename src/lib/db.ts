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
    // Web/runtime traffic must use the pooled, restricted application URL.
    // Direct connections are reserved for operator tooling and migrations.
    const rawConnectionString = (process.env.DATABASE_URL?.trim()) ||
      (process.env.NODE_ENV === "production" ? "" : process.env.DATABASE_URL_UNPOOLED?.trim());
    const connectionString = rawConnectionString ? normalizePostgresConnectionString(rawConnectionString) : "";
    if (!connectionString) {
      throw new Error("DATABASE_URL is required to initialize the Prisma runtime client.");
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

/**
 * Direct connection for migrations, backup/restore and other operator-only
 * workflows. This helper is intentionally not used by request-time DAL code.
 */
export function getDirectDatabaseUrl(): string {
  const admin = process.env.DATABASE_ADMIN_URL?.trim();
  const value = admin || process.env.DATABASE_URL_UNPOOLED?.trim();
  if (!value) throw new Error("DATABASE_ADMIN_URL is required for direct operational database work.");
  if (!admin && (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production")) {
    throw new Error("DATABASE_ADMIN_URL is required for direct operational database work in production.");
  }
  if (/pooler/i.test(value)) throw new Error("DATABASE_ADMIN_URL must be a direct Neon connection, not a pooler URL.");
  try {
    const username = decodeURIComponent(new URL(value).username);
    const runtimeRole = process.env.TENANT_RLS_APP_ROLE?.trim() || "policydesk_app";
    if (username === runtimeRole) throw new Error("DATABASE_ADMIN_URL_MUST_NOT_USE_RUNTIME_ROLE");
  } catch (error) {
    if (error instanceof Error && error.message === "DATABASE_ADMIN_URL_MUST_NOT_USE_RUNTIME_ROLE") throw error;
  }
  return normalizePostgresConnectionString(value);
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
