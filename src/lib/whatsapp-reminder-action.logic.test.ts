import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireOrganizationContext: vi.fn(),
  assertOrganizationContextInTransaction: vi.fn(),
  writeActivityLog: vi.fn(),
  revalidatePath: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/organization-context", () => ({
  requireOrganizationContext: mocks.requireOrganizationContext,
  assertOrganizationContextInTransaction: mocks.assertOrganizationContextInTransaction,
}));
vi.mock("@/lib/activity-log", () => ({ writeActivityLog: mocks.writeActivityLog }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { prepareWhatsAppReceiptReminder } from "@/app/(dashboard)/receipts/actions";

const context = {
  userId: "agent-1",
  userEmail: "agent@example.com",
  userName: "Agente",
  userRole: "USER",
  platformRole: "NONE",
  organizationId: "org-a",
  organizationName: "Org A",
  organizationSlug: "org-a",
  organizationStatus: "ACTIVE",
  membershipId: "membership-a",
  membershipRole: "AGENT" as const,
};

function makeReceipt(overrides: Record<string, unknown> = {}) {
  return {
    id: "receipt-a",
    status: "PENDING",
    dueDate: new Date("2026-08-31T06:00:00.000Z"),
    amount: 1200,
    currency: "MXN",
    client: {
      id: "client-a",
      fullName: "Ana Pérez",
      phone: "+525512345678",
      secondaryPhone: null,
    },
    policy: { policyNumber: "POLIZA-123456", clientId: "client-a" },
    insurer: { name: "Aseguradora Demo" },
    payments: [],
    ...overrides,
  };
}

function configure(receipt: ReturnType<typeof makeReceipt>) {
  const tx = {
    receipt: { findFirst: vi.fn().mockResolvedValue(receipt) },
    client: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  mocks.getDb.mockReturnValue({
    $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
  });
  return tx;
}

describe("prepareWhatsAppReceiptReminder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOrganizationContext.mockResolvedValue(context);
    mocks.assertOrganizationContextInTransaction.mockResolvedValue(undefined);
  });

  it("uses the primary phone and records only a sanitized receipt handoff", async () => {
    configure(makeReceipt());

    const result = await prepareWhatsAppReceiptReminder({ receiptId: "receipt-a" });

    expect(result).toMatchObject({ ok: true, outcome: "OPEN_WHATSAPP", phoneSource: "PRIMARY" });
    expect(result).toEqual(expect.objectContaining({ url: expect.stringMatching(/^https:\/\/wa\.me\/525512345678\?text=/) }));
    expect(mocks.writeActivityLog).toHaveBeenCalledTimes(1);
    expect(mocks.writeActivityLog).toHaveBeenCalledWith(expect.objectContaining({
      action: "WHATSAPP_REMINDER_OPENED",
      newValue: { phoneSource: "PRIMARY", template: "receipt_due_v1", status: "HANDOFF_OPENED_NOT_SENT" },
    }));
    expect(JSON.stringify(mocks.writeActivityLog.mock.calls)).not.toContain("525512345678");
  });

  it("asks for a phone when primary and secondary are unusable", async () => {
    configure(makeReceipt({ client: { id: "client-a", fullName: "Ana", phone: "bad", secondaryPhone: null } }));

    await expect(prepareWhatsAppReceiptReminder({ receiptId: "receipt-a" })).resolves.toEqual({
      ok: true,
      outcome: "CAPTURE_PHONE",
    });
    expect(mocks.writeActivityLog).not.toHaveBeenCalled();
  });

  it("saves a captured phone as the primary value and creates both safe audit events", async () => {
    const tx = configure(makeReceipt({ client: { id: "client-a", fullName: "Ana", phone: null, secondaryPhone: null } }));

    const result = await prepareWhatsAppReceiptReminder({ receiptId: "receipt-a", capturedPhone: "55 1234 5678" });

    expect(result).toMatchObject({ ok: true, outcome: "OPEN_WHATSAPP", phoneSource: "CAPTURED" });
    expect(tx.client.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { phone: "+525512345678", updatedById: "agent-1" },
    }));
    expect(mocks.writeActivityLog).toHaveBeenCalledTimes(2);
    expect(mocks.writeActivityLog).toHaveBeenCalledWith(expect.objectContaining({ action: "CLIENT_PHONE_CAPTURED_FOR_WHATSAPP", newValue: { captured: true, source: "RECEIPT_REMINDER" } }));
    expect(JSON.stringify(mocks.writeActivityLog.mock.calls)).not.toContain("Hola");
  });

  it("blocks receipts with any posted payment", async () => {
    configure(makeReceipt({ payments: [{ id: "payment-a" }] }));

    await expect(prepareWhatsAppReceiptReminder({ receiptId: "receipt-a" })).resolves.toEqual({
      ok: false,
      error: expect.stringContaining("pago registrado"),
    });
    expect(mocks.writeActivityLog).not.toHaveBeenCalled();
  });
});
