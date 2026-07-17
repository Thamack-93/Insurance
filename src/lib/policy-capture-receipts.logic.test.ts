import { describe, expect, it, vi } from "vitest";
import {
  buildAutoCaptureReceiptPayload,
  buildAutoCaptureReceiptPayloads,
  syncAutoCaptureReceipt,
  syncAutoCaptureReceipts,
} from "@/lib/policy-capture-receipts";

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
        clientType: "PERSON",
        clientEmail: null,
        clientPhone: null,
        clientAddress: null,
        clientRfc: null,
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

  it("splits semianual captures into two receipts", () => {
    const payloads = buildAutoCaptureReceiptPayloads({
      policyId: "policy-1",
      clientId: "client-1",
      insurerId: "insurer-1",
      userId: "user-1",
      draft: {
        policyNumber: "P-123",
        clientName: "Cliente Demo",
        clientType: "PERSON",
        clientEmail: null,
        clientPhone: null,
        clientAddress: null,
        clientRfc: null,
        insurerName: "Aseguradora Demo",
        policyType: "AUTO",
        serialNumber: null,
        startDate: "2026-07-22",
        endDate: "2027-07-22",
        issueDate: null,
        paymentFrequency: "SEMIANNUAL",
        paymentPlan: null,
        premiumAmount: 11093.34,
        currency: "MXN",
        requestNumber: null,
        insuredObject: "Auto demo",
        beneficiaryInfo: null,
        notes: null,
        sourcePolicyNumber: null,
      },
    });

    expect(payloads).toHaveLength(2);
    expect(payloads[0]?.receiptNumber).toBe("1");
    expect(payloads[1]?.receiptNumber).toBe("2");
    expect(payloads[0]?.periodStartDate.toISOString()).toBe("2026-07-22T06:00:00.000Z");
    expect(payloads[0]?.periodEndDate.toISOString()).toBe("2027-01-22T06:00:00.000Z");
    expect(payloads[1]?.periodStartDate.toISOString()).toBe("2027-01-22T06:00:00.000Z");
    expect(payloads[1]?.periodEndDate.toISOString()).toBe("2027-07-22T06:00:00.000Z");
    expect(payloads[0]?.amount).toBeCloseTo(5546.67);
    expect(payloads[1]?.amount).toBeCloseTo(5546.67);
  });

  it("honors custom amounts provided per receipt", () => {
    const payloads = buildAutoCaptureReceiptPayloads({
      policyId: "policy-1",
      clientId: "client-1",
      insurerId: "insurer-1",
      userId: "user-1",
      receiptPlan: [
        { receiptNumber: "1", amount: 5935.26 },
        { receiptNumber: "2", amount: 5158.08 },
      ],
      draft: {
        policyNumber: "P-123",
        clientName: "Cliente Demo",
        clientType: "PERSON",
        clientEmail: null,
        clientPhone: null,
        clientAddress: null,
        clientRfc: null,
        insurerName: "Aseguradora Demo",
        policyType: "AUTO",
        serialNumber: null,
        startDate: "2026-07-22",
        endDate: "2027-07-22",
        issueDate: null,
        paymentFrequency: "SEMIANNUAL",
        paymentPlan: null,
        premiumAmount: 11093.34,
        currency: "MXN",
        requestNumber: null,
        insuredObject: null,
        beneficiaryInfo: null,
        notes: null,
        sourcePolicyNumber: null,
      },
    });

    expect(payloads).toHaveLength(2);
    expect(payloads[0]?.amount).toBe(5935.26);
    expect(payloads[1]?.amount).toBe(5158.08);
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
        clientType: "PERSON",
        clientEmail: null,
        clientPhone: null,
        clientAddress: null,
        clientRfc: null,
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

  it("upserts every receipt term for semianual captures", async () => {
    const create = vi.fn(async (args: { data: unknown }) => ({
      id: `receipt-${(args.data as { receiptNumber: string }).receiptNumber}`,
      ...(args.data as Record<string, unknown>),
    }));
    const update = vi.fn(async (args: { where: { id: string }; data: unknown }) => ({
      id: args.where.id,
      ...(args.data as Record<string, unknown>),
    }));
    const findFirst = vi.fn().mockResolvedValue(null);

    const db = {
      receipt: {
        findFirst,
        create,
        update,
      },
    } as never;

    await syncAutoCaptureReceipts(db, {
      policyId: "policy-1",
      clientId: "client-1",
      insurerId: "insurer-1",
      userId: "user-1",
      draft: {
        policyNumber: "P-123",
        clientName: "Cliente Demo",
        clientType: "PERSON",
        clientEmail: null,
        clientPhone: null,
        clientAddress: null,
        clientRfc: null,
        insurerName: "Aseguradora Demo",
        policyType: "AUTO",
        serialNumber: null,
        startDate: "2026-07-22",
        endDate: "2027-07-22",
        issueDate: null,
        paymentFrequency: "SEMIANNUAL",
        paymentPlan: null,
        premiumAmount: 11093.34,
        currency: "MXN",
        requestNumber: null,
        insuredObject: null,
        beneficiaryInfo: null,
        notes: null,
        sourcePolicyNumber: null,
      },
    });

    expect(create).toHaveBeenCalledTimes(2);
    expect(update).not.toHaveBeenCalled();
    expect(findFirst).toHaveBeenCalledTimes(2);
    expect((create.mock.calls[0]?.[0].data as { receiptNumber: string }).receiptNumber).toBe("1");
    expect((create.mock.calls[1]?.[0].data as { receiptNumber: string }).receiptNumber).toBe("2");
  });
});
