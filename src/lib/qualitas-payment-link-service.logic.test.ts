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
  requestQualitasPaymentLink: vi.fn(async () => ({ outcome: "SUCCESS", reason: "SUCCESS_CODE_0" })),
}));
const writeActivityLog = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/activity-log", () => ({ writeActivityLog }));
vi.mock("@/lib/organization-context", () => ({ assertOrganizationContextInTransaction: vi.fn(async () => {}) }));
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
    const result = await requestQualitasPaymentLinkForReceipt({ receiptId: "receipt-1", recipientType: "CLIENT", deliveryChannel: "EMAIL", context });
    expect(result).toMatchObject({ ok: true, outcome: "SUCCESS", destination: "m***@example.com" });
    expect(provider.requestQualitasPaymentLink).toHaveBeenCalled();
    expect(writeActivityLog).toHaveBeenCalledWith(expect.objectContaining({ action: "QUALITAS_PAYMENT_LINK_REQUESTED", newValue: expect.objectContaining({ receiptId: "receipt-1" }) }));
  });

  it("fails closed for a non-Quálitas receipt without contacting the provider", async () => {
    db.receipt.findFirst.mockResolvedValue({ ...receipt, insurer: { ...receipt.insurer, name: "AXA" } });
    const result = await requestQualitasPaymentLinkForReceipt({ receiptId: "receipt-1", recipientType: "AGENT", deliveryChannel: "EMAIL", context });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("no es una póliza Quálitas") });
    expect(provider.prepareQualitasPaymentLink).not.toHaveBeenCalled();
  });
});
