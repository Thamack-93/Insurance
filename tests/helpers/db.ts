import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { createHmac } from "node:crypto";
import path from "node:path";
import type { Page } from "@playwright/test";
import { PrismaClient } from "../../src/generated/prisma/client";

const databasePath = path.join(process.cwd(), "data", "pg.sqlite");

const globalForTests = globalThis as unknown as {
  prisma?: PrismaClient;
};

const SESSION_COOKIE_NAME = "pd_session";
const TEST_SESSION_SECRET =
  process.env.SESSION_SECRET ?? process.env.AUTH_SECRET ?? "policydesk-dev-secret-change-in-production-please-0123456789";

export function getTestDb() {
  if (!globalForTests.prisma) {
    const adapter = new PrismaBetterSqlite3({
      url: `file:${databasePath}`,
    });

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
 * found in the seeded database. Returns the receipt id and a unique number.
 */
export async function seedPendingReceipt(prefix: string): Promise<SeededReceipt> {
  const db = getTestDb();

  const policy = await db.policy.findFirst({
    where: { status: { not: "CANCELLED" } },
    include: { client: true, insurer: true },
    orderBy: { createdAt: "asc" },
  });

  if (!policy) {
    throw new Error("No active policy found in seeded DB; run `npm run db:seed`.");
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
 * Removes any tasks created as side-effects of payment registration for a given policy
 * during the test (renewal tasks). Filtered by folio prefix `TASK-` plus a recency window.
 */
export async function cleanupRecentRenewalTasks(policyId: string, sinceMs: number): Promise<void> {
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

  const payload = {
    userId: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signatureB64 = createHmac("sha256", TEST_SESSION_SECRET)
    .update(payloadB64)
    .digest("base64url");

  return `${SESSION_COOKIE_NAME}=${payloadB64}.${signatureB64}`;
}

export async function authenticatePageAsAdmin(page: Page): Promise<void> {
  const cookie = await getAdminSessionCookie();
  const [name, ...rest] = cookie.split("=");
  const value = rest.join("=");
  const baseUrl = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5011").origin;

  await page.context().addCookies([
    {
      name,
      value,
      url: baseUrl,
    },
  ]);
}
