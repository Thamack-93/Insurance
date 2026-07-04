import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "@prisma/config";

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

function normalizePostgresConnectionString(connectionString: string) {
  try {
    const url = new URL(connectionString);
    const sslMode = url.searchParams.get("sslmode")?.toLowerCase();
    if (sslMode === "prefer" || sslMode === "require" || sslMode === "verify-ca") {
      url.searchParams.set("sslmode", "verify-full");
      return url.toString();
    }
  } catch {
    // Validation below reports malformed or unsupported URLs.
  }
  return connectionString;
}

const databaseUrl =
  process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();
const normalizedDatabaseUrl = databaseUrl ? normalizePostgresConnectionString(databaseUrl) : "";
const isPostgresUrl = databaseUrl ? /^postgres(ql)?:\/\//i.test(databaseUrl) : false;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL_UNPOOLED or DATABASE_URL is required for Prisma config. Set a Postgres URL in the environment or .env.local.",
  );
}

if (!isPostgresUrl) {
  throw new Error(
    "DATABASE_URL_UNPOOLED or DATABASE_URL must point to Postgres for Prisma client generation. SQLite fallback is no longer supported in the Prisma runtime.",
  );
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: normalizedDatabaseUrl,
  },
});
