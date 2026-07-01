import { describe, expect, it, vi } from "vitest";
import { buildAutoCaptureReceiptPayload, syncAutoCaptureReceipt } from "@/lib/policy-capture-receipts";

describe("policy-capture-receipts", () => {
  it("builds a pending receipt from the capture draft", () => {
    const payload = buildAutoCaptureReceiptPayload({
      policyId: "policy-1",
      clientId: "client-1",
      insurerId: "insurer-1",
      userId: "user-1",
      draft: {
        policyNumber: "P-123",
        clientName: "Cliente Demo",
        insurerName: "Aseguradora Demo",
        policyType: "AUTO",
        serialNumber: null,
        startDate: "2026-07-14",
        endDate: "2027-07-14",
        issueDate: "2026-06-23",
        paymentFrequency: "ANNUAL",
        paymentPlan: null,
        premiumAmount: 4254.73,
        currency: "MXN",
        requestNumber: "REQ-1",
        insuredObject: "Auto demo",
        beneficiaryInfo: null,
        notes: null,
        sourcePolicyNumber: "P-122",
      },
    });

    expect(payload.receiptNumber).toBe("1");
    expect(payload.policyId).toBe("policy-1");
    expect(payload.clientId).toBe("client-1");
    expect(payload.insurerId).toBe("insurer-1");
    expect(payload.periodStartDate.toISOString()).toBe("2026-07-14T06:00:00.000Z");
    expect(payload.periodEndDate.toISOString()).toBe("2027-07-14T06:00:00.000Z");
    expect(payload.dueDate.toISOString()).toBe("2026-07-14T06:00:00.000Z");
    expect(payload.amount).toBe(4254.73);
    expect(payload.currency).toBe("MXN");
    expect(payload.status).toBe("PENDING");
    expect(payload.paidDate).toBeNull();
    expect(payload.paymentMethod).toBeNull();
    expect(payload.notes).toContain("Renueva P-122");
    expect(payload.notes).toContain("Solicitud REQ-1");
    expect(payload.notes).toContain("Emision 2026-06-23");
  });

  it("creates the receipt when none exists and updates the existing one instead of duplicating it", async () => {
    const create = vi.fn(async (args: { data: unknown }) => ({
      id: "receipt-new",
      receiptNumber: "1",
      ...(args.data as Record<string, unknown>),
    }));
    const update = vi.fn(async (args: { where: { id: string }; data: unknown }) => ({
      id: args.where.id,
      receiptNumber: "1",
      ...(args.data as Record<string, unknown>),
    }));
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "receipt-existing", notes: "Nota manual" });

    const db = {
      receipt: {
        findFirst,
        create,
        update,
      },
    } as never;

    const input = {
      policyId: "policy-1",
      clientId: "client-1",
      insurerId: "insurer-1",
      userId: "user-1",
      draft: {
        policyNumber: "P-123",
        clientName: "Cliente Demo",
        insurerName: "Aseguradora Demo",
        policyType: "AUTO",
        serialNumber: null,
        startDate: "2026-07-14",
        endDate: "2027-07-14",
        issueDate: null,
        paymentFrequency: "ANNUAL",
        paymentPlan: null,
        premiumAmount: 4254.73,
        currency: "MXN",
        requestNumber: null,
        insuredObject: null,
        beneficiaryInfo: null,
        notes: null,
        sourcePolicyNumber: null,
      },
    } satisfies Parameters<typeof buildAutoCaptureReceiptPayload>[0];

    await syncAutoCaptureReceipt(db, input);
    await syncAutoCaptureReceipt(db, input);

    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(update.mock.calls[0]?.[0].where.id).toBe("receipt-existing");
    expect((update.mock.calls[0]?.[0].data as { notes: string }).notes).toBe("Nota manual");
  });
});
