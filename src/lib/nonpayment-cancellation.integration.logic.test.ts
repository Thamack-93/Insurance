import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { BOOTSTRAP_ORGANIZATION_ID, SYSTEM_USER_ID } from "@/lib/tenant-organization-foundation";
import { getDb } from "@/lib/db";
import { cancelPolicyForNonPayment } from "@/lib/nonpayment-cancellation";

const enabled = process.env.RESTORE_INTEGRATION === "1";
const suffix = `${process.pid}-${Date.now()}`;
const ids = {
  client: `nonpayment-client-${suffix}`,
  insurer: `nonpayment-insurer-${suffix}`,
  policy: `nonpayment-policy-${suffix}`,
  receipt: `nonpayment-receipt-${suffix}`,
};

describe.skipIf(!enabled)("non-payment cancellation concurrency", () => {
  beforeAll(async () => {
    const db = getDb();
    await db.organization.update({ where: { id: BOOTSTRAP_ORGANIZATION_ID }, data: { status: "ACTIVE" } });
    await db.client.create({ data: { id: ids.client, organizationId: BOOTSTRAP_ORGANIZATION_ID, fullName: "Concurrency Client" } });
    await db.insurer.create({ data: { id: ids.insurer, organizationId: BOOTSTRAP_ORGANIZATION_ID, name: "Concurrency Insurer" } });
    await db.policy.create({
      data: {
        id: ids.policy,
        organizationId: BOOTSTRAP_ORGANIZATION_ID,
        policyNumber: `CONCURRENT-${suffix}`,
        clientId: ids.client,
        insurerId: ids.insurer,
        policyType: "AUTO",
        status: "ACTIVE",
        startDate: new Date("2026-01-01T00:00:00.000Z"),
        endDate: new Date("2027-01-01T00:00:00.000Z"),
        premiumAmount: 1000,
        paymentFrequency: "ANNUAL",
        createdById: SYSTEM_USER_ID,
        updatedById: SYSTEM_USER_ID,
      },
    });
    await db.receipt.create({
      data: {
        id: ids.receipt,
        organizationId: BOOTSTRAP_ORGANIZATION_ID,
        receiptNumber: `CONCURRENT-R-${suffix}`,
        policyId: ids.policy,
        clientId: ids.client,
        insurerId: ids.insurer,
        periodStartDate: new Date("2026-01-01T00:00:00.000Z"),
        periodEndDate: new Date("2026-02-01T00:00:00.000Z"),
        dueDate: new Date("2026-01-15T00:00:00.000Z"),
        amount: 1000,
        status: "OVERDUE",
        createdById: SYSTEM_USER_ID,
        updatedById: SYSTEM_USER_ID,
      },
    });
  });

  afterAll(async () => {
    if (!enabled) return;
    const db = getDb();
    await db.activityLog.deleteMany({ where: { organizationId: BOOTSTRAP_ORGANIZATION_ID, entityId: { in: [ids.policy, ids.receipt] } } });
    await db.receipt.deleteMany({ where: { id: ids.receipt, organizationId: BOOTSTRAP_ORGANIZATION_ID } });
    await db.policy.deleteMany({ where: { id: ids.policy, organizationId: BOOTSTRAP_ORGANIZATION_ID } });
    await db.insurer.deleteMany({ where: { id: ids.insurer, organizationId: BOOTSTRAP_ORGANIZATION_ID } });
    await db.client.deleteMany({ where: { id: ids.client, organizationId: BOOTSTRAP_ORGANIZATION_ID } });
  });

  it("allows exactly one simultaneous cancellation to mutate receipts and audit", async () => {
    const now = new Date("2026-08-25T12:00:00.000Z");
    const results = await Promise.all([
      cancelPolicyForNonPayment(BOOTSTRAP_ORGANIZATION_ID, ids.receipt, SYSTEM_USER_ID, now),
      cancelPolicyForNonPayment(BOOTSTRAP_ORGANIZATION_ID, ids.receipt, SYSTEM_USER_ID, now),
    ]);

    expect(results.filter((result) => result.cancelled)).toHaveLength(1);
    expect(results.filter((result) => !result.cancelled)).toHaveLength(1);
    const db = getDb();
    expect(await db.activityLog.count({ where: { organizationId: BOOTSTRAP_ORGANIZATION_ID, entityId: ids.policy, action: "POLICY_CANCEL_NON_PAYMENT" } })).toBe(1);
    expect(await db.activityLog.count({ where: { organizationId: BOOTSTRAP_ORGANIZATION_ID, entityId: ids.receipt, action: "RECEIPT_CANCEL_NON_PAYMENT" } })).toBe(1);
  });
});
