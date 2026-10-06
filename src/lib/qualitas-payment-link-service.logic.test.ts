import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const db = vi.hoisted(() => ({
  receipt: { findFirst: vi.fn() },
  user: { findFirst: vi.fn() },
  $transaction: vi.fn(),
}));
const provider = vi.hoisted(() => ({
  isQualitasClientRecipientEnabled: vi.fn(() => true),
  isQualitasInsurerName: vi.fn((value: string) => /qualitas/i.test(value)),
  isQualitasPaymentLinkEnabled: vi.fn(() => true),
  maskQualitasEmail: vi.fn((value: string) => `m***@${value.split("@")[1]}`),
  maskQualitasPhone: vi.fn((value: string) => `••••${value.slice(-4)}`),
  normalizeQualitasEmail: vi.fn((value: string | null | undefined) => value?.includes("@") ? value.trim().toLowerCase() : null),
  normalizeQualitasPhone: vi.fn((value: string | null | undefined) => value?.replace(/\D/g, "") || null),
  prepareQualitasPaymentLink: vi.fn(async () => ({ transportReady: true })),
  requestQualitasPaymentLink: vi.fn(async (_prepared?: unknown, _options?: { onFinalSubmissionStarted?: () => void }) => {
    void _prepared;
    void _options;
    return { outcome: "SUCCESS", reason: "SUCCESS_CODE_0" };
  }),
}));
const writeActivityLog = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/activity-log", () => ({ writeActivityLog }));
vi.mock("@/lib/organization-context", () => ({ assertOrganizationContextInTransaction: vi.fn(async () => {}) }));
vi.mock("@/lib/organization-capabilities", () => ({
  resolveOrganizationCapability: vi.fn(async (organizationId: string, capability: string) => ({
    organizationId,
    capability,
    enabled: true,
    limitValue: null,
    reason: "PLAN",
  })),
}));
vi.mock("@/lib/qualitas-payment-link", () => provider);

import { requestQualitasPaymentLinkForReceipt } from "./qualitas-payment-link-service";

const context = {
  userId: "user-1", userEmail: "agent@example.com", userName: "Agent", userRole: "USER", platformRole: "NONE",
  organizationId: "org-1", organizationName: "Org", organizationSlug: "org", organizationStatus: "ACTIVE",
  membershipId: "membership-1", membershipRole: "AGENT" as const,
};

const receipt = {
  id: "receipt-1", organizationId: "org-1", status: "PENDING", amount: 1000, currency: "MXN",
  client: { id: "client-1", fullName: "Cliente", email: "client@example.com", phone: "5550101234", organizationId: "org-1" },
  policy: { id: "policy-1", policyNumber: "POL-1", status: "ACTIVE", organizationId: "org-1" },
  insurer: { id: "insurer-1", name: "Qualitas", organizationId: "org-1" },
};

describe("qualitas payment link service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.receipt.findFirst.mockResolvedValue(receipt);
    db.user.findFirst.mockResolvedValue({ id: "user-1", email: "agent@example.com", phone: "5550109999" });
    db.$transaction.mockImplementation(async (callback: (tx: typeof db) => unknown) => callback(db));
  });

  it("re-reads the receipt and records a masked, successful request", async () => {
    const stages: string[] = [];
    db.$transaction.mockImplementation(async (callback: (tx: typeof db) => unknown) => {
      const result = await callback(db);
      stages.push("transaction_committed");
      return result;
    });
    writeActivityLog.mockImplementation(async ({ action }: { action: string }) => {
      stages.push(action);
    });
    provider.prepareQualitasPaymentLink.mockImplementationOnce(async () => {
      stages.push("provider_contact");
      return { transportReady: true };
    });
    provider.requestQualitasPaymentLink.mockImplementationOnce(async () => {
      stages.push("provider_result");
      return { outcome: "SUCCESS", reason: "SUCCESS_CODE_0" };
    });

    const result = await requestQualitasPaymentLinkForReceipt({ receiptId: "receipt-1", recipientType: "CLIENT", deliveryChannel: "EMAIL", context });
    expect(result).toMatchObject({ ok: true, outcome: "SUCCESS", destination: "m***@example.com", auditStatus: "RECORDED" });
    expect(provider.requestQualitasPaymentLink).toHaveBeenCalled();
    expect(writeActivityLog).toHaveBeenNthCalledWith(1, expect.objectContaining({
      action: "QUALITAS_PAYMENT_LINK_ATTEMPT_STARTED",
      newValue: expect.objectContaining({ receiptId: "receipt-1", result: "PENDING", correlationId: expect.any(String) }),
    }));
    expect(writeActivityLog).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: "QUALITAS_PAYMENT_LINK_REQUESTED",
      newValue: expect.objectContaining({ receiptId: "receipt-1", result: "SUCCESS", correlationId: expect.any(String) }),
    }));
    expect(writeActivityLog.mock.calls[0][0].newValue.correlationId).toBe(writeActivityLog.mock.calls[1][0].newValue.correlationId);
    expect(JSON.stringify(writeActivityLog.mock.calls)).not.toContain("client@example.com");
    expect(JSON.stringify(writeActivityLog.mock.calls)).not.toContain("5550101234");
    expect(stages.indexOf("transaction_committed")).toBeLessThan(stages.indexOf("provider_contact"));
    expect(stages.indexOf("provider_result")).toBeLessThan(stages.lastIndexOf("QUALITAS_PAYMENT_LINK_REQUESTED"));
  });

  it("records a provider rejection without confusing it with an application failure", async () => {
    provider.requestQualitasPaymentLink.mockResolvedValueOnce({ outcome: "POLICY_NOT_FOUND", reason: "POLICY_NOT_FOUND" });

    const result = await requestQualitasPaymentLinkForReceipt({ receiptId: "receipt-1", recipientType: "AGENT", deliveryChannel: "WHATSAPP", context });

    expect(result).toMatchObject({ ok: true, outcome: "POLICY_NOT_FOUND", auditStatus: "RECORDED" });
    expect(writeActivityLog).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: "QUALITAS_PAYMENT_LINK_REQUESTED",
      newValue: expect.objectContaining({ result: "FAILED", reason: "POLICY_NOT_FOUND" }),
    }));
  });

  it("keeps a confirmed provider delivery successful when its final audit write fails", async () => {
    writeActivityLog.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("audit unavailable"));

    const result = await requestQualitasPaymentLinkForReceipt({ receiptId: "receipt-1", recipientType: "AGENT", deliveryChannel: "WHATSAPP", context });

    expect(result).toMatchObject({ ok: true, outcome: "SUCCESS", auditStatus: "PENDING" });
    expect(result).toMatchObject({ message: expect.stringContaining("Quálitas confirmó el envío") });
    expect(result).toMatchObject({ message: expect.stringContaining("Verifica si llegó") });
    expect(provider.requestQualitasPaymentLink).toHaveBeenCalledTimes(1);
    expect(writeActivityLog).toHaveBeenCalledTimes(2);
    expect(writeActivityLog.mock.calls[0][0]).toMatchObject({
      action: "QUALITAS_PAYMENT_LINK_ATTEMPT_STARTED",
      newValue: expect.objectContaining({ result: "PENDING" }),
    });
    expect(JSON.stringify(writeActivityLog.mock.calls)).not.toContain("5550109999");
  });

  it("classifies a thrown response after final submission as uncertain", async () => {
    provider.requestQualitasPaymentLink.mockImplementationOnce(async (_prepared?: unknown, options?: { onFinalSubmissionStarted?: () => void }) => {
      options?.onFinalSubmissionStarted?.();
      throw new Error("response lost after POST");
    });

    const uncertain = await requestQualitasPaymentLinkForReceipt({ receiptId: "receipt-1", recipientType: "AGENT", deliveryChannel: "WHATSAPP", context });

    expect(uncertain).toMatchObject({ ok: true, outcome: "UNCERTAIN_POST_SUBMISSION", reason: "FINAL_RESPONSE_UNRECOGNIZED", auditStatus: "RECORDED" });
    expect(uncertain).toMatchObject({ message: expect.stringContaining("Verifica si llegó por el canal elegido antes de volver a solicitar") });
    expect(provider.requestQualitasPaymentLink).toHaveBeenCalledTimes(1);
    expect(writeActivityLog).toHaveBeenNthCalledWith(2, expect.objectContaining({
      action: "QUALITAS_PAYMENT_LINK_REQUESTED",
      newValue: expect.objectContaining({ result: "UNCERTAIN", reason: "FINAL_RESPONSE_UNRECOGNIZED" }),
    }));
  });

  it("preserves Quálitas duplicate responses", async () => {
    provider.requestQualitasPaymentLink.mockResolvedValueOnce({ outcome: "ALREADY_IN_PROGRESS", reason: "DUPLICATE_LINK_99991" });

    const result = await requestQualitasPaymentLinkForReceipt({ receiptId: "receipt-1", recipientType: "AGENT", deliveryChannel: "WHATSAPP", context });

    expect(result).toMatchObject({ ok: true, outcome: "ALREADY_IN_PROGRESS", auditStatus: "RECORDED" });
    expect(result).toMatchObject({ message: expect.stringContaining("ya existe una liga de pago en proceso") });
    expect(provider.requestQualitasPaymentLink).toHaveBeenCalledTimes(1);
  });

  it("does not contact Quálitas when the pre-send attempt cannot be audited", async () => {
    writeActivityLog.mockRejectedValueOnce(new Error("audit unavailable"));

    const result = await requestQualitasPaymentLinkForReceipt({ receiptId: "receipt-1", recipientType: "AGENT", deliveryChannel: "WHATSAPP", context });

    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("no se envió solicitud") });
    expect(provider.prepareQualitasPaymentLink).not.toHaveBeenCalled();
    expect(provider.requestQualitasPaymentLink).not.toHaveBeenCalled();
  });

  it("fails closed for a non-Quálitas receipt without contacting the provider", async () => {
    db.receipt.findFirst.mockResolvedValue({ ...receipt, insurer: { ...receipt.insurer, name: "AXA" } });
    const result = await requestQualitasPaymentLinkForReceipt({ receiptId: "receipt-1", recipientType: "AGENT", deliveryChannel: "EMAIL", context });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("no es una póliza Quálitas") });
    expect(provider.prepareQualitasPaymentLink).not.toHaveBeenCalled();
  });
});
