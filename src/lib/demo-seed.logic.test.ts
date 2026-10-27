import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/bonus-calculation", () => ({ calculateBonusProjection: vi.fn(async () => ({ status: "READY", items: [], reviewReasons: [], baseAmount: "0.00", bonusRate: null, bonusAmount: null })) }));

import { seedDemoBaseline, validateDemoBaseline } from "./demo-seed";
import { calculateBonusProjection } from "@/lib/bonus-calculation";
import { policyRiskDetailsSchema } from "./policy-risk-details";
import { policyTypeLabel } from "./status";

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
            if (delegate === "commission" && method === "findFirst") return { id: "demo-org:demo:commission:001", expectedAmount: 1594.83, paidDate: new Date("2026-09-22T12:00:00.000Z") };
            if (delegate === "policyInsuredAsset" && method === "findFirst") return { id: "demo-org:demo:policy-asset-2:001" };
            if (delegate === "receipt" && method === "create") {
              const data = args.data as Record<string, unknown>; const id = `demo-generated-receipt-${++receiptIndex}`;
              const receipt = { id, ...data }; storedReceipts.set(`${data.policyId}:${data.receiptSequence}`, receipt); return receipt;
            }
            if (delegate === "receipt" && method === "upsert") {
              const data = args.create as Record<string, unknown>;
              const where = args.where as { id?: string };
              const existing = [...storedReceipts.entries()].find(([, receipt]) => receipt.id === where.id);
              const key = existing?.[0] ?? `${data.policyId}:${data.receiptSequence ?? data.id}`;
              const receipt = { id: where.id, ...data };
              storedReceipts.set(key, receipt);
              return receipt;
            }
            if (delegate === "receipt" && method === "findFirst") {
              const where = args.where as { policyId: string; receiptSequence: number | null };
              return storedReceipts.get(`${where.policyId}:${where.receiptSequence}`) ?? null;
            }
            if (delegate === "receipt" && method === "findMany") {
              const where = args.where as { policyId: string; endorsementId?: null };
              return [...storedReceipts.values()].filter(receipt => receipt.policyId === where.policyId && (where.endorsementId !== null || receipt.endorsementId == null)).sort((left, right) => Number((left.dueDate as Date).getTime()) - Number((right.dueDate as Date).getTime()));
            }
            if (delegate === "receipt" && method === "update") {
              const data = args.data as Record<string, unknown>; const where = args.where as { id: string };
              const existingEntry = [...storedReceipts.entries()].find(([, receipt]) => receipt.id === where.id);
              if (!existingEntry) throw new Error("TEST_RECEIPT_NOT_FOUND");
              const [key, existing] = existingEntry;
              const updated = { ...existing, ...data };
              storedReceipts.set(key, updated);
              return updated;
            }
            return null;
          };
        },
      });
    },
  });
  return { transaction, calls, storedReceipts };
}

describe("seedDemoBaseline", () => {
  beforeEach(() => vi.useFakeTimers().setSystemTime(new Date("2026-09-25T12:00:00.000Z")));
  afterEach(() => vi.useRealTimers());

  it("creates deterministic portfolio examples using the live collection and commission contracts", async () => {
    vi.mocked(calculateBonusProjection).mockClear();
    const { transaction, calls, storedReceipts } = createTransactionRecorder();
    await seedDemoBaseline(transaction as never, "demo-org", "demo-owner");
    await seedDemoBaseline(transaction as never, "demo-org", "demo-owner");

    const creates = calls.filter(({ method }) => method === "create");
    const upserts = calls.filter(({ args }) => "create" in args);
    const count = (delegate: string) => creates.filter((call) => call.delegate === delegate).length;
    expect(count("client")).toBe(0);
    expect(upserts.filter(({ delegate }) => delegate === "client")).toHaveLength(40);
    expect(upserts.filter(({ delegate }) => delegate === "policy")).toHaveLength(80);
    const clients = upserts.filter(({ delegate }) => delegate === "client").map(({ args }) => args.create as Record<string, unknown>);
    expect(clients.slice(0, 20)).toEqual(clients.slice(20));
    expect(count("receipt")).toBe(190);
    expect(upserts.filter(({ delegate }) => delegate === "claim")).toHaveLength(10);
    expect(upserts.filter(({ delegate }) => delegate === "commission")).toHaveLength(358);
    const seededPolicies = upserts.filter(({ delegate }) => delegate === "policy").slice(0, 40).map(({ args }) => args.create as Record<string, unknown>);
    for (const frequency of ["ANNUAL", "SEMIANNUAL", "QUARTERLY", "MONTHLY"]) expect(seededPolicies.filter(policy => policy.paymentFrequency === frequency)).toHaveLength(10);
    const policyCountsByClient = [...seededPolicies.reduce((counts, policy) => counts.set(String(policy.clientId), (counts.get(String(policy.clientId)) ?? 0) + 1), new Map<string, number>()).values()].sort((left, right) => left - right);
    expect(policyCountsByClient).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 4, 6]);
    expect(seededPolicies.every(policy => typeof policy.insuredObject === "string" && policy.insuredObject.length > 0)).toBe(true);
    const structuredRiskDetails = seededPolicies.map((policy) => policyRiskDetailsSchema.parse(policy.riskDetails));
    expect(structuredRiskDetails).toHaveLength(40);
    expect(structuredRiskDetails.map(({ sourceText }) => sourceText)).toEqual(seededPolicies.map(({ insuredObject }) => insuredObject));
    expect(new Set(seededPolicies.map(({ policyType }) => policyType))).toEqual(new Set(["AUTO", "GMM", "HOGAR", "EMPRESARIAL", "VIDA"]));
    expect(seededPolicies.every(({ policyType }) => policyTypeLabel(String(policyType)) !== "Tipo no reconocido")).toBe(true);
    for (const policy of seededPolicies) {
      const evidence = JSON.parse(String(policy.bonusEligibilityJson)) as Record<string, unknown>;
      expect(evidence).toMatchObject({ productEligible: true, sellerAttributionConfirmed: true, sourceReference: expect.stringContaining("sintética"), evidenceAsOf: "2026-09-25" });
      if (policy.policyType === "AUTO") expect(evidence).toMatchObject({ fleetUnder50: true, autoExclusionsReviewed: true });
      if (["HOGAR", "EMPRESARIAL"].includes(String(policy.policyType))) expect(evidence).toMatchObject({ businessType: expect.any(String), facultativeInsuranceReviewed: true, specialConditionsReviewed: true, directedBusinessReviewed: true, frontingReviewed: true, damageExclusionsReviewed: true });
    }
    expect(new Set(structuredRiskDetails.map(({ policyType }) => policyType))).toEqual(new Set(["AUTO", "GMM", "HOGAR", "EMPRESARIAL", "VIDA"]));
    expect(upserts.filter(({ delegate }) => delegate === "policyInsuredAsset")).toHaveLength(80);
    expect(upserts.filter(({ delegate }) => delegate === "policyInsuredParty")).toHaveLength(32);
    expect(seededPolicies[0]?.endDate).toEqual(new Date("2026-10-04T12:00:00.000Z"));
    const schedules = creates.filter(({ delegate }) => delegate === "receipt").map(({ args }) => args.data as Record<string, unknown>);
    expect(schedules.filter(receipt => receipt.periodStartDate instanceof Date)).toHaveLength(190);
    const receiptUpdates = calls.filter(({ delegate, method }) => delegate === "receipt" && method === "update").map(({ args }) => args.data as Record<string, unknown>);
    expect(receiptUpdates.some(({ status }) => status === "PAID")).toBe(true);
    expect(receiptUpdates).toContainEqual(expect.objectContaining({ status: "OVERDUE", dueDate: new Date("2026-09-22T12:00:00.000Z") }));
    expect(receiptUpdates).toContainEqual(expect.objectContaining({ status: "PENDING", dueDate: new Date("2026-09-30T12:00:00.000Z") }));
    expect(upserts.filter(({ delegate }) => delegate === "payment").length).toBeGreaterThan(2);
    const finalReceiptStatuses = [...storedReceipts.values()].map(({ status }) => status);
    expect(finalReceiptStatuses.filter((status) => status === "PAID")).toHaveLength(176);
    expect(finalReceiptStatuses.filter((status) => status === "PENDING")).toHaveLength(2);
    expect(finalReceiptStatuses.filter((status) => status === "OVERDUE")).toHaveLength(1);
    expect(finalReceiptStatuses.filter((status) => status === "CANCELLED")).toHaveLength(12);

    const commissions = upserts.filter((call) => call.delegate === "commission").slice(0, 179).map(({ args }) => args.create as Record<string, unknown>);
    expect(commissions).toHaveLength(179);
    expect(new Set(commissions.map(({ receiptId }) => receiptId)).size).toBe(179);
    expect(commissions.every(({ calculationBreakdownJson }) => typeof calculationBreakdownJson === "string" && JSON.parse(calculationBreakdownJson).breakdown.length === 1)).toBe(true);
    expect(commissions.filter(({ status }) => status === "PAID")).toHaveLength(1);
    expect(commissions.filter(({ status }) => status === "PENDING")).toHaveLength(175);
    expect(commissions.filter(({ status }) => status === "OVERDUE")).toHaveLength(1);
    expect(commissions.filter(({ status }) => status === "EXPECTED")).toHaveLength(2);
    expect(commissions[0]).toMatchObject({ paidDate: new Date("2026-09-22T12:00:00.000Z"), actualAmount: 1594.83, expectedAmount: 1594.83 });
    for (const commission of commissions) {
      const receipt = [...storedReceipts.values()].find((candidate) => candidate.id === commission.receiptId);
      const breakdown = JSON.parse(String(commission.calculationBreakdownJson)).breakdown[0] as Record<string, unknown>;
      const components = breakdown.components as Record<string, number>;
      const net = Math.round((Number(receipt?.amount) - components.vatAmount - components.issuanceExpenseAmount - components.surchargeAmount + components.discountAmount + Number.EPSILON) * 100) / 100;
      expect(Number(breakdown.netPremium)).toBe(net);
      expect(Number(breakdown.expectedAmount)).toBe(Number(commission.expectedAmount));
      expect(Number(breakdown.expectedAmount)).toBe(Math.round(net * Number(breakdown.rate) / 100 * 100) / 100);
      expect(String(breakdown.ruleEvidence)).toContain("sintética DEMO");
    }
    expect(calls.filter(({ delegate, method }) => delegate === "receipt" && method === "update").map(({ args }) => args.data).some((data) => (data as Record<string, unknown>).commissionCalculationStatus === "CALCULATED")).toBe(true);
    expect([...storedReceipts.values()].filter(({ commissionCalculationStatus }) => commissionCalculationStatus === "CALCULATED")).toHaveLength(179);
    expect([...storedReceipts.values()].some(({ commissionCalculationStatus }) => commissionCalculationStatus === "REVIEW")).toBe(false);
    expect(calculateBonusProjection).toHaveBeenCalledTimes(6);
    expect(vi.mocked(calculateBonusProjection).mock.calls.map(([,, program]) => program.key)).toEqual([
      "AUTO_2026", "DAMAGE_CHUBB_2026", "DAMAGE_Q_2026", "AUTO_2026", "DAMAGE_CHUBB_2026", "DAMAGE_Q_2026",
    ]);
    expect(upserts.find(({ delegate }) => delegate === "commissionStatement")?.args.create).toMatchObject({ status: "APPLIED" });
    expect(upserts.find(({ delegate }) => delegate === "commissionStatementRow")?.args.create).toMatchObject({ status: "APPLIED" });

    const collectionItems = upserts
      .filter(({ delegate, args }) => delegate === "workItem" && (args.create as Record<string, unknown>).sourceType === "Collection")
      .map(({ args }) => args.create as Record<string, unknown>);
    // The confirmed promise points to the upcoming policy 4 installment; the
    // missed promise points to the single overdue policy 2 installment.
    expect([...new Set(collectionItems.map(({ sourceId }) => sourceId))]).toEqual(["receipt:demo-generated-receipt-19:collection-followup", "receipt:demo-generated-receipt-2:collection-followup"]);
    expect(JSON.parse(String(collectionItems[0].metadataJson))).toMatchObject({ kind: "COLLECTION_FOLLOWUP", outcome: "PROMISED_PAYMENT", promisedPaymentDate: "2026-09-28T12:00:00.000Z" });
    expect(JSON.parse(String(collectionItems[1].metadataJson))).toMatchObject({ kind: "COLLECTION_FOLLOWUP", outcome: "PROMISED_PAYMENT", promisedPaymentDate: "2026-09-22T12:00:00.000Z" });
    expect(collectionItems.every((item) => item.workItemType === "TASK" && item.taskType === "PAYMENT" && item.status === "OPEN")).toBe(true);

    const document = upserts.find(({ delegate }) => delegate === "document")?.args.create as Record<string, unknown>;
    expect(document.filePath).toBe("demo://demo-org/synthetic/policy-001");
  });

  it("validates all policy, payment, expiry, near-renewal and descriptive examples", async () => {
    let policiesWithoutRiskDetails = 0;
    let unrecognizedPolicyTypes = 0;
    const count = vi.fn(async ({ where }: { where?: { paymentFrequency?: string; insuredObject?: unknown; status?: string; riskDetails?: unknown; policyType?: unknown } }) => {
      if (where?.policyType) return unrecognizedPolicyTypes;
      if (where?.riskDetails) return policiesWithoutRiskDetails;
      if (where?.paymentFrequency) return 10;
      if (where?.insuredObject) return 40;
      if (where?.status === "EXPIRED") return 8;
      if (where?.status === "CANCELLED") return 1;
      if (where?.status === "ACTIVE") return 1;
      return 40;
    });
    const receiptCount = vi.fn(async ({ where }: { where?: Record<string, unknown> }): Promise<number> => {
      if (where?.commissionCalculationStatus || where?.commissions) return 0;
      if (where?.status === "PAID") return 176;
      if (where?.status === "PENDING") return 2;
      if (where?.status === "OVERDUE") return 1;
      if (where?.status === "CANCELLED") return 12;
      return 191;
    });
    const paymentCount = vi.fn(async ({ where }: { where?: { status?: string } }): Promise<number> => where?.status === "POSTED" ? 176 : where?.status === "REVERSED" ? 1 : 177);
    const claimCount = vi.fn(async ({ where }: { where?: { status?: string } }): Promise<number> => where?.status === "RESOLVED" ? 1 : 5);
    const tx = {
      client: { count: vi.fn().mockResolvedValue(20) }, policy: { count }, receipt: { count: receiptCount },
      payment: { count: paymentCount },
      claim: { count: claimCount }, commission: { count: vi.fn(async () => 179) },
      commissionStatement: { count: vi.fn().mockResolvedValue(0) }, commissionStatementRow: { count: vi.fn().mockResolvedValue(0) },
      workItem: { count: vi.fn().mockResolvedValue(2) }, document: { findUnique: vi.fn().mockResolvedValue({ organizationId: "demo-org", filePath: "demo://demo-org/synthetic/policy-001", notes: "PDF sintético" }) },
    };
    await expect(validateDemoBaseline(tx as never, "demo-org")).resolves.toMatchObject({ policies: 40, receipts: 191, structuredPolicies: 40, completePremiumBreakdownPolicies: 40, bonusReadyPolicies: 40, commissions: 179, commissionSnapshots: 179, receiptsMissingCommission: 0, receiptsNeedingCommissionReview: 0, commissionStatementsInReview: 0, commissionStatementRowsInReview: 0, unrecognizedPolicyTypes: 0, receiptSchedules: { ANNUAL: 10, SEMIANNUAL: 10, QUARTERLY: 10, MONTHLY: 10 }, scenarios: { describedPolicies: 40, expiredPolicies: 8, renewalsWithinTenDays: 1, paidReceipts: 176, pendingReceipts: 2, overdueReceipts: 1, postedPayments: 176, reversedPayments: 1, cancelledPolicies: 1, cancelledReceipts: 12, resolvedClaims: 1 } });
    expect(receiptCount).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: { not: "CANCELLED" }, commissionCalculationStatus: { in: ["NOT_CALCULATED", "REVIEW"] } }) }));
    policiesWithoutRiskDetails = 1;
    await expect(validateDemoBaseline(tx as never, "demo-org")).rejects.toThrow("DEMO_SEED_VALIDATION_FAILED");
    policiesWithoutRiskDetails = 0;
    unrecognizedPolicyTypes = 1;
    await expect(validateDemoBaseline(tx as never, "demo-org")).rejects.toThrow("DEMO_SEED_VALIDATION_FAILED");
    unrecognizedPolicyTypes = 0;
    receiptCount.mockImplementation(async ({ where }) => where?.status === "OVERDUE" ? 0 : where?.status === "PAID" ? 176 : where?.status === "PENDING" ? 2 : where?.status === "CANCELLED" ? 12 : 191);
    await expect(validateDemoBaseline(tx as never, "demo-org")).rejects.toThrow("DEMO_SEED_VALIDATION_FAILED");
    receiptCount.mockImplementation(async ({ where }) => where?.status === "PAID" ? 176 : where?.status === "PENDING" ? 2 : where?.status === "OVERDUE" ? 1 : where?.status === "CANCELLED" ? 12 : 191);
    tx.client.count.mockResolvedValue(26);
    await expect(validateDemoBaseline(tx as never, "demo-org")).rejects.toThrow("DEMO_SEED_VALIDATION_FAILED");
    tx.client.count.mockResolvedValue(20);
    paymentCount.mockImplementation(async ({ where }) => where?.status === "POSTED" ? 175 : where?.status === "REVERSED" ? 1 : 176);
    await expect(validateDemoBaseline(tx as never, "demo-org")).rejects.toThrow("DEMO_SEED_VALIDATION_FAILED");
  });
});
