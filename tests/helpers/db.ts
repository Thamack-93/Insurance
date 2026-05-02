import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../src/generated/prisma/client";

const dbPath = path.join(process.cwd(), "data", "pg.sqlite");

let cached: PrismaClient | null = null;

export function getTestDb(): PrismaClient {
  if (!cached) {
    const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
    cached = new PrismaClient({ adapter });
  }
  return cached;
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
    where: { status: "ACTIVE" },
    include: { client: true, insurer: true },
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
