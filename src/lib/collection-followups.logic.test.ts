import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  withSystemOrganizationTransaction: vi.fn(),
  writeActivityLog: vi.fn(),
  createNotificationEvent: vi.fn(),
}));

vi.mock("@/lib/organization-context", () => ({
  assertOrganizationContextInTransaction: vi.fn(),
  requireOrganizationContext: vi.fn(),
  withSystemOrganizationTransaction: mocks.withSystemOrganizationTransaction,
  withTenantTransaction: vi.fn(),
}));
vi.mock("@/lib/activity-log", () => ({ writeActivityLog: mocks.writeActivityLog }));
vi.mock("@/lib/work-items", () => ({ upsertWorkItemFromSource: vi.fn() }));
vi.mock("@/lib/notification-foundation", () => ({ createNotificationEvent: mocks.createNotificationEvent }));

import { runCollectionFollowUpScan } from "./collection-followups";

const now = new Date("2026-10-10T12:00:00.000Z");
const promisedPaymentDate = new Date("2026-10-09T12:00:00.000Z");

function makeItem(amount: number, payments: Array<{ amount: number; paidDate: Date; createdAt?: Date; status?: string }>) {
  return {
    id: "work-1",
    sourceId: "receipt:receipt-1:collection-followup",
    dueDate: new Date("2026-10-20T12:00:00.000Z"),
    assignedToId: "user-1",
    receiptId: "receipt-1",
    clientId: "client-1",
    policyId: "policy-1",
    metadataJson: JSON.stringify({ outcome: "PROMISED_PAYMENT", promisedPaymentDate: promisedPaymentDate.toISOString() }),
    receipt: { amount, payments },
  };
}

function setup(items: ReturnType<typeof makeItem>[]) {
  const tx = {
    maintenanceRun: {
      create: vi.fn().mockResolvedValue({ id: "run-1" }),
      update: vi.fn().mockResolvedValue({}),
    },
    workItem: { findMany: vi.fn().mockResolvedValue(items) },
  };
  mocks.withSystemOrganizationTransaction.mockImplementation(async (_organizationId: string, _reason: string, callback: (client: typeof tx) => unknown) => callback(tx));
  mocks.createNotificationEvent.mockResolvedValue({ status: "CREATED" });
  return tx;
}

describe("collection follow-up promise scan", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does not mark a promise fulfilled by a partial payment before its date", async () => {
    setup([makeItem(1000, [{ amount: 100, paidDate: new Date("2026-10-08T12:00:00.000Z") }])]);

    const result = await runCollectionFollowUpScan("org-1", now);

    expect(result.brokenPromises).toBe(1);
    expect(mocks.createNotificationEvent).toHaveBeenCalledWith(expect.objectContaining({ title: "Promesa de pago incumplida" }), expect.anything());
  });

  it("combines posted partial payments effective by the promise date", async () => {
    setup([makeItem(1000, [
      { amount: 400, paidDate: new Date("2026-10-08T12:00:00.000Z") },
      { amount: 600, paidDate: new Date("2026-10-09T11:00:00.000Z") },
    ])]);

    const result = await runCollectionFollowUpScan("org-1", now);

    expect(result.brokenPromises).toBe(0);
    expect(mocks.createNotificationEvent).not.toHaveBeenCalled();
  });

  it("does not count a payment effective after the promise date", async () => {
    setup([makeItem(1000, [{ amount: 1000, paidDate: new Date("2026-10-10T06:00:00.000Z") }])]);

    const result = await runCollectionFollowUpScan("org-1", now);

    expect(result.brokenPromises).toBe(1);
  });

  it("uses the effective paid date when it differs from the recorded date", async () => {
    setup([makeItem(1000, [{
      amount: 1000,
      paidDate: new Date("2026-10-08T12:00:00.000Z"),
      createdAt: new Date("2026-10-12T12:00:00.000Z"),
    }])]);

    const result = await runCollectionFollowUpScan("org-1", now);

    expect(result.brokenPromises).toBe(0);
  });

  it("allows payment through the end of the promised business day", async () => {
    setup([makeItem(1000, [{ amount: 1000, paidDate: new Date("2026-10-09T23:59:00.000Z") }])]);

    const result = await runCollectionFollowUpScan("org-1", now);

    expect(result.brokenPromises).toBe(0);
  });

  it("does not mark a promise broken during its promised business day", async () => {
    setup([makeItem(1000, [])]);

    const result = await runCollectionFollowUpScan("org-1", new Date("2026-10-09T20:00:00.000Z"));

    expect(result.brokenPromises).toBe(0);
    expect(mocks.createNotificationEvent).not.toHaveBeenCalled();
  });

  it("deduplicates repeated reminders within the same business day", async () => {
    const item = makeItem(1000, []);
    item.dueDate = new Date("2026-10-08T12:00:00.000Z");
    setup([item]);
    mocks.createNotificationEvent.mockResolvedValueOnce({ status: "CREATED" }).mockResolvedValueOnce(null);

    const first = await runCollectionFollowUpScan("org-1", new Date("2026-10-10T00:05:00.000Z"));
    const second = await runCollectionFollowUpScan("org-1", new Date("2026-10-10T05:55:00.000Z"));

    const firstDedupeKey = mocks.createNotificationEvent.mock.calls[0]?.[0].dedupeKey;
    const secondDedupeKey = mocks.createNotificationEvent.mock.calls[1]?.[0].dedupeKey;
    expect(firstDedupeKey).toBe("collection-followup:receipt:receipt-1:collection-followup:DUE_CONTACT:2026-10-09");
    expect(secondDedupeKey).toBe(firstDedupeKey);
    expect(first.notificationsCreated).toBe(1);
    expect(second.notificationsCreated).toBe(0);
  });

  it("uses the existing close tolerance and queries posted payments only", async () => {
    const tx = setup([makeItem(1000, [
      { amount: 997, paidDate: new Date("2026-10-08T12:00:00.000Z") },
    ])]);

    const result = await runCollectionFollowUpScan("org-1", now);

    expect(result.brokenPromises).toBe(0);
    expect(tx.workItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ receipt: expect.objectContaining({ select: expect.objectContaining({
        amount: true,
        payments: expect.objectContaining({ where: { status: "POSTED" }, select: { amount: true, paidDate: true } }),
      }) }) }),
    }));
  });
});
