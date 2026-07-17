import fs from "node:fs";
import path from "node:path";
import { createHmac, randomBytes, scryptSync } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { Page } from "@playwright/test";
import { PrismaClient } from "../../src/generated/prisma/client";

const localEnvPath = path.join(process.cwd(), ".env.local");
const SESSION_COOKIE_NAME = "pd_session";
const DEV_SECRET = "policydesk-dev-secret-change-in-production-please-0123456789";
const TEST_ADMIN_EMAIL = "ci-admin@policydesk.local";
const TEST_ADMIN_NAME = "CI Admin";
const TEST_CLIENT_EMAIL = "ci-client@policydesk.local";
const TEST_CLIENT_NAME = "CI Client";
const TEST_INSURER_NAME = "CI Insurer";
const TEST_POLICY_NUMBER = "CI-POL-0001";

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

type SeededFixture = {
  adminId: string;
  clientId: string;
  insurerId: string;
  policyId: string;
};

let seededFixturePromise: Promise<SeededFixture> | null = null;

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

function assertDisposableTestDatabase(connectionString: string) {
  if (process.env.PLAYWRIGHT_ENFORCE_DISPOSABLE_DB !== "1") return;

  try {
    const url = new URL(connectionString);
    const host = url.hostname.toLowerCase();
    const allowedHosts = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);
    if (allowedHosts.has(host)) return;
  } catch {
    // Let the existing validation report the malformed URL.
    return;
  }

  throw new Error(
    "Playwright tests must use a disposable local Postgres database when PLAYWRIGHT_ENFORCE_DISPOSABLE_DB=1.",
  );
}

function getSessionSecret() {
  const secret = process.env.SESSION_SECRET ?? process.env.AUTH_SECRET;
  if (secret && secret.length >= 16) {
    return secret;
  }
  return DEV_SECRET;
}

function hashTestPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${derived}`;
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
    assertDisposableTestDatabase(connectionString);

    const adapter = new PrismaPg({ connectionString });
    globalForTests.prisma = new PrismaClient({ adapter });
  }

  return globalForTests.prisma;
}

async function ensureBaseFixture(): Promise<SeededFixture> {
  if (!seededFixturePromise) {
    seededFixturePromise = (async () => {
      const db = getTestDb();
      const admin = await db.user.upsert({
        where: { email: TEST_ADMIN_EMAIL },
        update: {
          name: TEST_ADMIN_NAME,
          active: true,
          role: "ADMIN",
        },
        create: {
          email: TEST_ADMIN_EMAIL,
          name: TEST_ADMIN_NAME,
          passwordHash: hashTestPassword("ci-admin-password"),
          role: "ADMIN",
          active: true,
        },
      });

      const insurer =
        (await db.insurer.findFirst({
          where: { name: TEST_INSURER_NAME },
          orderBy: { createdAt: "asc" },
        })) ??
        (await db.insurer.create({
          data: {
            name: TEST_INSURER_NAME,
            status: "ACTIVE",
          },
        }));
      await db.insurer.update({
        where: { id: insurer.id },
        data: {
          name: TEST_INSURER_NAME,
          status: "ACTIVE",
        },
      });

      const client =
        (await db.client.findFirst({
          where: { email: TEST_CLIENT_EMAIL },
          orderBy: { createdAt: "asc" },
        })) ??
        (await db.client.create({
          data: {
            fullName: TEST_CLIENT_NAME,
            email: TEST_CLIENT_EMAIL,
            status: "ACTIVE",
            type: "PERSON",
            portfolioOwnerId: admin.id,
            createdById: admin.id,
            updatedById: admin.id,
          },
        }));
      await db.client.update({
        where: { id: client.id },
        data: {
          fullName: TEST_CLIENT_NAME,
          email: TEST_CLIENT_EMAIL,
          status: "ACTIVE",
          type: "PERSON",
          portfolioOwnerId: admin.id,
          createdById: admin.id,
          updatedById: admin.id,
        },
      });

      const policy =
        (await db.policy.findFirst({
          where: {
            policyNumber: TEST_POLICY_NUMBER,
            clientId: client.id,
            insurerId: insurer.id,
          },
          orderBy: { createdAt: "asc" },
        })) ??
        (await db.policy.create({
          data: {
            policyNumber: TEST_POLICY_NUMBER,
            clientId: client.id,
            insurerId: insurer.id,
            policyType: "AUTO",
            status: "ACTIVE",
            paymentFrequency: "ANNUAL",
            startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            premiumAmount: 1234.56,
            currency: "MXN",
            createdById: admin.id,
            updatedById: admin.id,
          },
        }));
      await db.policy.update({
        where: { id: policy.id },
        data: {
          policyNumber: TEST_POLICY_NUMBER,
          clientId: client.id,
          insurerId: insurer.id,
          policyType: "AUTO",
          status: "ACTIVE",
          paymentFrequency: "ANNUAL",
          startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          premiumAmount: 1234.56,
          currency: "MXN",
          createdById: admin.id,
          updatedById: admin.id,
        },
      });

      return {
        adminId: admin.id,
        clientId: client.id,
        insurerId: insurer.id,
        policyId: policy.id,
      };
    })();
  }

  return seededFixturePromise;
}

export type SeededReceipt = {
  id: string;
  receiptNumber: string;
  clientId: string;
  policyId: string;
  insurerId: string;
};

/**
 * Creates a PENDING receipt on the shared test fixture policy. Returns the
 * receipt id and a unique number.
 */
export async function seedPendingReceipt(prefix: string): Promise<SeededReceipt> {
  const db = getTestDb();
  const fixture = await ensureBaseFixture();

  const policy = await db.policy.findUnique({
    where: { id: fixture.policyId },
    include: { client: true, insurer: true },
  });

  if (!policy || policy.status === "CANCELLED") {
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
 * Removes any renewal work items created as side-effects of payment registration
 * for a given policy during the test. Filtered by a recency window.
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
    await db.workItem.deleteMany({
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
  const fixture = await ensureBaseFixture();
  const admin = await db.user.findUnique({ where: { id: fixture.adminId } });
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

export async function getAgentSessionCookie(): Promise<string> {
  const db = getTestDb();
  const agent = await db.user.findFirst({
    where: {
      active: true,
      role: "AGENT",
    },
    orderBy: { createdAt: "asc" },
  });

  if (!agent) {
    throw new Error("No active agent user found in the seeded database.");
  }

  const { token } = await createSessionToken({
    userId: agent.id,
    email: agent.email,
    name: agent.name,
    role: "AGENT",
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

export async function authenticatePageAsAgent(page: Page): Promise<void> {
  const cookie = await getAgentSessionCookie();
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
