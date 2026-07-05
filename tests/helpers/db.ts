import fs from "node:fs";
import path from "node:path";
import { createHmac } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { Page } from "@playwright/test";
import { PrismaClient } from "../../src/generated/prisma/client";

const localEnvPath = path.join(process.cwd(), ".env.local");
const SESSION_COOKIE_NAME = "pd_session";
const DEV_SECRET = "policydesk-dev-secret-change-in-production-please-0123456789";

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

const globalForTests = globalThis as unknown as {
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

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET ?? process.env.AUTH_SECRET;
  if (secret && secret.length >= 16) {
    return secret;
  }
  return DEV_SECRET;
}

async function createSessionToken(payload: { userId: string; email: string; name: string; role: "ADMIN" | "AGENT" }) {
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30;
  const data = { ...payload, exp };
  const payloadB64 = Buffer.from(JSON.stringify(data)).toString("base64url");
  const signatureB64 = createHmac("sha256", getSessionSecret()).update(payloadB64).digest("base64url");
  return { token: `${payloadB64}.${signatureB64}`, exp };
}

export function getTestDb() {
  if (!globalForTests.prisma) {
    const rawConnectionString = process.env.DATABASE_URL?.trim();
    const connectionString = rawConnectionString ? normalizePostgresConnectionString(rawConnectionString) : "";
    if (!connectionString) {
      throw new Error("DATABASE_URL is required to initialize Prisma for tests.");
    }
    if (!/^postgres(ql)?:\/\//i.test(connectionString)) {
      throw new Error("DATABASE_URL must point to Postgres for e2e tests.");
    }

    const adapter = new PrismaPg({ connectionString });
    globalForTests.prisma = new PrismaClient({ adapter });
  }

  return globalForTests.prisma;
}

export type SeededReceipt = {
  id: string;
  receiptNumber: string;
  clientId: string;
  policyId: string;
  insurerId: string;
};

/**
 * Creates a PENDING receipt attached to the first existing client/policy/insurer
 * found in the isolated test database. Returns the receipt id and a unique number.
 */
export async function seedPendingReceipt(prefix: string): Promise<SeededReceipt> {
  const db = getTestDb();

  const policy = await db.policy.findFirst({
    where: { status: { not: "CANCELLED" } },
    include: { client: true, insurer: true },
    orderBy: { createdAt: "asc" },
  });

  if (!policy) {
    throw new Error("No active policy found in the isolated test database.");
  }

  const receiptNumber = `${prefix}-${Date.now().toString(36).slice(-6).toUpperCase()}`;
  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const receipt = await db.receipt.create({
    data: {
      receiptNumber,
      policyId: policy.id,
      clientId: policy.clientId,
      insurerId: policy.insurerId,
      periodStartDate: now,
      periodEndDate: periodEnd,
      dueDate: periodEnd,
      amount: 1234.56,
      currency: "MXN",
      status: "PENDING",
    },
  });

  return {
    id: receipt.id,
    receiptNumber,
    clientId: policy.clientId,
    policyId: policy.id,
    insurerId: policy.insurerId,
  };
}

/**
 * Removes a receipt and its child payments. Safe to call even if already deleted.
 */
export async function cleanupReceipt(receiptId: string): Promise<void> {
  const db = getTestDb();
  try {
    await db.payment.deleteMany({ where: { receiptId } });
    await db.receipt.deleteMany({ where: { id: receiptId } });
  } catch {
    // ignore — best-effort cleanup
  }
}

/**
 * Removes any work items created as side-effects of payment registration for a given policy
 * during the test (renewal follow-ups). Filtered by folio prefix `TASK-` plus a recency window.
 */
export async function cleanupRecentRenewalWorkItems(policyId: string, sinceMs: number): Promise<void> {
  const db = getTestDb();
  try {
    await db.task.deleteMany({
      where: {
        policyId,
        taskType: "RENEWAL",
        createdAt: { gte: new Date(sinceMs) },
      },
    });
  } catch {
    // ignore
  }
}

export async function getAdminSessionCookie(): Promise<string> {
  const db = getTestDb();
  const admin = await db.user.findFirst({
    where: {
      active: true,
      role: "ADMIN",
    },
    orderBy: { createdAt: "asc" },
  });

  if (!admin) {
    throw new Error("No active admin user found in the seeded database.");
  }

  const { token } = await createSessionToken({
    userId: admin.id,
    email: admin.email,
    name: admin.name,
    role: "ADMIN",
  });

  return `${SESSION_COOKIE_NAME}=${token}`;
}

export async function authenticatePageAsAdmin(page: Page): Promise<void> {
  const cookie = await getAdminSessionCookie();
  const [name, ...rest] = cookie.split("=");
  const value = rest.join("=");
  const baseUrl = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5000").origin;

  await page.context().addCookies([
    {
      name,
      value,
      url: baseUrl,
    },
  ]);
}
