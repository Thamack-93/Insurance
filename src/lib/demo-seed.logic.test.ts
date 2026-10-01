import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { seedDemoBaseline, validateDemoBaseline } from "./demo-seed";

function createTransactionRecorder() {
  const calls: Array<{ delegate: string; method: string; args: Record<string, unknown> }> = [];
  let receiptIndex = 0;
  const storedReceipts = new Map<string, Record<string, unknown>>();
  const transaction = new Proxy({}, {
    get(_target, delegate: string) {
      return new Proxy({}, {
        get(_delegateTarget, method: string) {
          return async (args: Record<string, unknown>) => {
            calls.push({ delegate, method, args });
            if (delegate === "commission" && method === "findFirst") return { id: "demo-org:demo:commission:001" };
            if (delegate === "receipt" && method === "create") {
              const data = args.data as Record<string, unknown>; const id = `demo-generated-receipt-${++receiptIndex}`;
              const receipt = { id, ...data }; storedReceipts.set(`${data.policyId}:${data.receiptSequence}`, receipt); return receipt;
            }
            if (delegate === "receipt" && method === "findFirst") {
              const where = args.where as { policyId: string; receiptSequence: number | null };
              return storedReceipts.get(`${where.policyId}:${where.receiptSequence}`) ?? null;
            }
            if (delegate === "receipt" && method === "update") {
              const data = args.data as Record<string, unknown>; const where = args.where as { id: string };
              const existing = [...storedReceipts.values()].find(receipt => receipt.id === where.id);
              return { ...existing, ...data };
            }
            return null;
          };
        },
      });
    },
  });
  return { transaction, calls };
}

describe("seedDemoBaseline", () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime(new Date("2026-09-25T12:00:00.000Z")));
  afterEach(() => vi.useRealTimers());

  it("creates deterministic portfolio examples using the live collection and commission contracts", async () => {
    const { transaction, calls } = createTransactionRecorder();
    await seedDemoBaseline(transaction as never, "demo-org", "demo-owner");
    await seedDemoBaseline(transaction as never, "demo-org", "demo-owner");

    const creates = calls.filter(({ method }) => method === "create");
    const upserts = calls.filter(({ args }) => "create" in args);
    const count = (delegate: string) => creates.filter((call) => call.delegate === delegate).length;
    expect(count("client")).toBe(0);
    expect(upserts.filter(({ delegate }) => delegate === "client")).toHaveLength(50);
    expect(upserts.filter(({ delegate }) => delegate === "policy")).toHaveLength(40);
    const clients = upserts.filter(({ delegate }) => delegate === "client").map(({ args }) => args.create as Record<string, unknown>);
    expect(clients.slice(0, 25)).toEqual(clients.slice(25));
    expect(count("receipt")).toBe(95);
    expect(upserts.filter(({ delegate }) => delegate === "claim")).toHaveLength(8);
    expect(upserts.filter(({ delegate }) => delegate === "commission")).toHaveLength(8);
    const seededPolicies = upserts.filter(({ delegate }) => delegate === "policy").slice(0, 20).map(({ args }) => args.create as Record<string, unknown>);
    for (const frequency of ["ANNUAL", "SEMIANNUAL", "QUARTERLY", "MONTHLY"]) expect(seededPolicies.filter(policy => policy.paymentFrequency === frequency)).toHaveLength(5);
    const schedules = creates.filter(({ delegate }) => delegate === "receipt").map(({ args }) => args.data as Record<string, unknown>);
    expect(schedules.filter(receipt => receipt.periodStartDate instanceof Date)).toHaveLength(95);

    const commissions = upserts.filter((call) => call.delegate === "commission").slice(0, 4).map(({ args }) => args.create as Record<string, unknown>);
    expect(commissions.map(({ status }) => status)).toEqual(["PAID", "OVERDUE", "PENDING", "PENDING"]);
    expect(commissions[0]).toMatchObject({ paidDate: new Date("2026-09-22T12:00:00.000Z"), actualAmount: 1850 });
    expect(commissions[1]).toMatchObject({ expectedDate: new Date("2026-09-13T12:00:00.000Z"), paidDate: null });

    const collectionItems = upserts
      .filter(({ delegate, args }) => delegate === "workItem" && (args.create as Record<string, unknown>).sourceType === "Collection")
      .map(({ args }) => args.create as Record<string, unknown>);
    // Policy 2 is semiannual and policy 3 quarterly, so their first generated
    // receipts are 2 and 4 in the flattened schedule (not 2 and 3).
    expect([...new Set(collectionItems.map(({ sourceId }) => sourceId))]).toEqual(["receipt:demo-generated-receipt-2:collection-followup", "receipt:demo-generated-receipt-4:collection-followup"]);
    expect(JSON.parse(String(collectionItems[0].metadataJson))).toMatchObject({ kind: "COLLECTION_FOLLOWUP", outcome: "PROMISED_PAYMENT", promisedPaymentDate: "2026-09-28T12:00:00.000Z" });
    expect(JSON.parse(String(collectionItems[1].metadataJson))).toMatchObject({ kind: "COLLECTION_FOLLOWUP", outcome: "PROMISED_PAYMENT", promisedPaymentDate: "2026-09-22T12:00:00.000Z" });
    expect(collectionItems.every((item) => item.workItemType === "TASK" && item.taskType === "PAYMENT" && item.status === "OPEN")).toBe(true);

    const document = upserts.find(({ delegate }) => delegate === "document")?.args.create as Record<string, unknown>;
    expect(document.filePath).toBe("demo://demo-org/synthetic/policy-001");
  });

  it("validates exact per-frequency policy counts and the complete 95-receipt schedule", async () => {
    const count = vi.fn(async ({ where }: { where?: { paymentFrequency?: string } }) => where?.paymentFrequency ? 5 : 20);
    const tx = {
      client: { count: vi.fn().mockResolvedValue(25) }, policy: { count }, receipt: { count: vi.fn().mockResolvedValue(95) },
      claim: { count: vi.fn().mockResolvedValue(4) }, commission: { count: vi.fn().mockResolvedValue(4) }, quote: { count: vi.fn().mockResolvedValue(4) },
      workItem: { count: vi.fn().mockResolvedValue(2) }, document: { findUnique: vi.fn().mockResolvedValue({ organizationId: "demo-org", filePath: "demo://demo-org/synthetic/policy-001", notes: "PDF sintético" }) },
    };
    await expect(validateDemoBaseline(tx as never, "demo-org")).resolves.toMatchObject({ policies: 20, receipts: 95, receiptSchedules: { ANNUAL: 5, SEMIANNUAL: 5, QUARTERLY: 5, MONTHLY: 5 } });
    tx.receipt.count.mockResolvedValue(94);
    await expect(validateDemoBaseline(tx as never, "demo-org")).rejects.toThrow("DEMO_SEED_VALIDATION_FAILED");
    tx.receipt.count.mockResolvedValue(95);
    tx.client.count.mockResolvedValue(26);
    await expect(validateDemoBaseline(tx as never, "demo-org")).rejects.toThrow("DEMO_SEED_VALIDATION_FAILED");
  });
});
