import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const db = vi.hoisted(() => ({
  policy: { findFirst: vi.fn() },
  receipt: { findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  payment: { create: vi.fn(), createMany: vi.fn() },
}));
const tenant = vi.hoisted(() => ({
  assertOrganizationContextInTransaction: vi.fn(async () => {}),
  withTenantTransaction: vi.fn(async (_context: unknown, callback: (tx: typeof db) => unknown) => callback(db)),
}));
const activity = vi.hoisted(() => ({ writeActivityLog: vi.fn(async () => ({ id: "observation-1" })) }));
const lookup = vi.hoisted(() => ({
  isQualitasInsurerName: vi.fn((value: string) => /qualitas/i.test(value)),
  lookupQualitasPendingReceipts: vi.fn(async () => ({ outcome: "OK" as const, nextDueDate: "2026-10-14" })),
}));

vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/organization-context", () => tenant);
vi.mock("@/lib/organization-capabilities", () => ({
  resolveOrganizationCapability: vi.fn(async (organizationId: string, capability: string) => ({
    organizationId, capability, enabled: true, limitValue: null, reason: "PLAN",
  })),
}));
vi.mock("@/lib/activity-log", () => activity);
vi.mock("@/lib/qualitas-payment-link", () => lookup);
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/payment-frequency", () => ({ supportsDomiciliatedPaymentMethod: vi.fn(() => false) }));
vi.mock("@/lib/payment-service", () => ({ recordPayment: vi.fn() }));

import { checkQualitasReceiptStatus } from "./qualitas-receipt-monitor";

const context = {
  userId: "user-1", userEmail: "agent@example.com", userName: "Agent", userRole: "USER", platformRole: "NONE",
  organizationId: "org-1", organizationName: "Org", organizationSlug: "org", organizationStatus: "ACTIVE",
  membershipId: "membership-1", membershipRole: "AGENT" as const,
};

describe("read-only Quálitas receipt check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("QUALITAS_RECEIPT_MONITOR_ENABLED", "1");
    db.policy.findFirst.mockResolvedValue({
      id: "policy-1", policyNumber: "940461570", paymentFrequency: "MONTHLY", status: "ACTIVE",
      qualitasReceiptMonitorEnabled: false, insurer: { name: "Qualitas" }, client: { id: "client-1", fullName: "Cliente" },
    });
    db.receipt.findMany.mockResolvedValue([{
      id: "receipt-1", receiptNumber: "1", dueDate: new Date("2026-10-28T12:00:00.000Z"),
      status: "PENDING", amount: 6890.09, currency: "MXN",
    }]);
  });

  it("records only a sanitized audit observation when the portal date differs", async () => {
    const result = await checkQualitasReceiptStatus("policy-1", context);

    expect(result).toMatchObject({
      status: "INCONCLUSIVE",
      reason: "DUE_DATE_MISMATCH",
      portalDueDate: "2026-10-14",
      targetReceipt: { id: "receipt-1", dueDate: "2026-10-28", amount: 6890.09 },
    });
    expect(activity.writeActivityLog).toHaveBeenCalledTimes(1);
    expect(activity.writeActivityLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "QUALITAS_RECEIPT_CHECKED",
      entityType: "Policy",
      entityId: "policy-1",
      newValue: expect.objectContaining({
        status: "INCONCLUSIVE",
        reason: "DUE_DATE_MISMATCH",
        localDueDate: "2026-10-28",
        portalDueDate: "2026-10-14",
        targetReceiptAmount: 6890.09,
      }),
    }));
    expect(db.receipt.update).not.toHaveBeenCalled();
    expect(db.receipt.updateMany).not.toHaveBeenCalled();
    expect(db.payment.create).not.toHaveBeenCalled();
    expect(db.payment.createMany).not.toHaveBeenCalled();
  });
});
