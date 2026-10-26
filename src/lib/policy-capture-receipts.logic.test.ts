import { describe, expect, it, vi } from "vitest";
import {
  buildAutoCaptureReceiptPayload,
  buildAutoCaptureReceiptPayloads,
  syncAutoCaptureReceipt,
  syncAutoCaptureReceipts,
} from "@/lib/policy-capture-receipts";

describe("policy-capture-receipts", () => {
  it.each([
    ["SINGLE", 1],
    ["ANNUAL", 1],
    ["SEMIANNUAL", 2],
    ["QUARTERLY", 4],
    ["MONTHLY", 12],
  ])("builds all %s receipt terms as pending", (paymentFrequency, expectedCount) => {
    const payloads = buildAutoCaptureReceiptPayloads({
      organizationId: "org-test",
      policyId: "policy-new",
      clientId: "client-1",
      insurerId: "insurer-1",
      userId: "user-1",
      draft: {
        policyNumber: "P-NEW",
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
        paymentFrequency,
        paymentPlan: null,
        premiumAmount: 1200,
        currency: "MXN",
        requestNumber: null,
        insuredObject: null,
        beneficiaryInfo: null,
        notes: null,
        sourcePolicyNumber: null,
      },
    });

    expect(payloads).toHaveLength(expectedCount);
    expect(payloads.every((payload) => payload.status === "PENDING" && payload.paidDate === null)).toBe(true);
    expect(payloads[0]?.dueDate).toEqual(payloads[0]?.periodStartDate);
    expect(payloads.reduce((sum, payload) => sum + payload.amount, 0)).toBe(1200);
  });

  it("calculates 16% IVA on the pre-tax base and reconciles the known receipt", () => {
    const payload = buildAutoCaptureReceiptPayload({
      organizationId: "org-test",
      policyId: "policy-iva",
      clientId: "client-1",
      insurerId: "insurer-1",
      userId: "user-1",
      premiumBreakdown: { issuanceExpenseAmount: 0, surchargeAmount: 121.5, discountAmount: 0 },
      draft: {
        policyNumber: "P-IVA",
        clientName: "Cliente Demo",
        clientType: "PERSON",
        clientEmail: null,
        clientPhone: null,
        clientAddress: null,
        clientRfc: null,
        insurerName: "Aseguradora Demo",
        policyType: "AUTO",
        serialNumber: null,
        startDate: "2026-01-01",
        endDate: "2027-01-01",
        issueDate: null,
        paymentFrequency: "SINGLE",
        paymentPlan: null,
        premiumAmount: 1707.18,
        currency: "MXN",
        requestNumber: null,
        insuredObject: null,
        beneficiaryInfo: null,
        notes: null,
        sourcePolicyNumber: null,
      },
    });

    expect(payload.vatAmount).toBe(235.47);
    expect(payload.issuanceExpenseAmount).toBe(0);
    expect(payload.surchargeAmount).toBe(121.5);
    expect(payload.discountAmount).toBe(0);
    expect(payload.commissionCalculationStatus).toBe("NOT_CALCULATED");
    expect(payload.commissionReviewReason).toBeNull();
    expect((payload.amount - payload.vatAmount! - payload.issuanceExpenseAmount! - payload.surchargeAmount! + payload.discountAmount!)).toBeCloseTo(1350.21, 2);
    expect((1350.21 + 121.5) * 0.16).toBeCloseTo(payload.vatAmount!, 2);
  });

  it("puts issuance on the first receipt and allocates surcharge and discounts by net premium", () => {
    const payloads = buildAutoCaptureReceiptPayloads({
      organizationId: "org-test",
      policyId: "policy-monthly-breakdown",
      clientId: "client-1",
      insurerId: "insurer-1",
      userId: "user-1",
      premiumBreakdown: { issuanceExpenseAmount: 12, surchargeAmount: 24, discountAmount: 12 },
      draft: {
        policyNumber: "P-MONTHLY",
        clientName: "Cliente Demo",
        clientType: "PERSON",
        clientEmail: null,
        clientPhone: null,
        clientAddress: null,
        clientRfc: null,
        insurerName: "Aseguradora Demo",
        policyType: "AUTO",
        serialNumber: null,
        startDate: "2026-01-01",
        endDate: "2027-01-01",
        issueDate: null,
        paymentFrequency: "MONTHLY",
        paymentPlan: null,
        premiumAmount: 1200,
        currency: "MXN",
        requestNumber: null,
        insuredObject: null,
        beneficiaryInfo: null,
        notes: null,
        sourcePolicyNumber: null,
      },
    });

    expect(payloads).toHaveLength(12);
    expect(payloads[0]?.issuanceExpenseAmount).toBe(12);
    expect(payloads.slice(1).every((item) => item.issuanceExpenseAmount === 0)).toBe(true);
    expect(payloads.reduce((sum, item) => sum + item.vatAmount!, 0)).toBeCloseTo(165.52, 2);
    expect(payloads.reduce((sum, item) => sum + item.surchargeAmount!, 0)).toBeCloseTo(24, 2);
    expect(payloads.reduce((sum, item) => sum + item.discountAmount!, 0)).toBeCloseTo(12, 2);
    const net = (item: typeof payloads[number]) => item.amount - item.vatAmount! - item.issuanceExpenseAmount! - item.surchargeAmount! + item.discountAmount!;
    expect(payloads[0]!.surchargeAmount! / net(payloads[0]!)).toBeCloseTo(payloads[1]!.surchargeAmount! / net(payloads[1]!), 4);
    expect(payloads[0]!.discountAmount! / net(payloads[0]!)).toBeCloseTo(payloads[1]!.discountAmount! / net(payloads[1]!), 4);
  });

  it("preserves policy totals across uneven quarterly receipts, including negative financing and cent residuals", () => {
    const payloads = buildAutoCaptureReceiptPayloads({
      organizationId: "org-test",
      policyId: "policy-quarterly-breakdown",
      clientId: "client-1",
      insurerId: "insurer-1",
      userId: "user-1",
      premiumBreakdown: { issuanceExpenseAmount: 101.03, surchargeAmount: -120.07, discountAmount: 13.19 },
      receiptPlan: [
        { receiptNumber: "1", amount: 1000.01 },
        { receiptNumber: "2", amount: 1000.02 },
        { receiptNumber: "3", amount: 1000.03 },
        { receiptNumber: "4", amount: 1000.04 },
      ],
      draft: {
        policyNumber: "P-QUARTERLY",
        clientName: "Cliente Demo",
        clientType: "PERSON",
        clientEmail: null,
        clientPhone: null,
        clientAddress: null,
        clientRfc: null,
        insurerName: "Aseguradora Demo",
        policyType: "AUTO",
        serialNumber: null,
        startDate: "2026-01-01",
        endDate: "2027-01-01",
        issueDate: null,
        paymentFrequency: "QUARTERLY",
        paymentPlan: null,
        premiumAmount: 4000.10,
        currency: "MXN",
        requestNumber: null,
        insuredObject: null,
        beneficiaryInfo: null,
        notes: null,
        sourcePolicyNumber: null,
      },
    });

    expect(payloads).toHaveLength(4);
    expect(payloads[0]?.issuanceExpenseAmount).toBe(101.03);
    expect(payloads.slice(1).every((item) => item.issuanceExpenseAmount === 0)).toBe(true);
    expect(payloads.reduce((sum, item) => sum + item.vatAmount!, 0)).toBeCloseTo(551.74, 2);
    expect(payloads.reduce((sum, item) => sum + item.surchargeAmount!, 0)).toBeCloseTo(-120.07, 2);
    expect(payloads.reduce((sum, item) => sum + item.discountAmount!, 0)).toBeCloseTo(13.19, 2);
    expect(payloads.every((item) => item.surchargeAmount! <= 0)).toBe(true);
  });

  it("uses matching notice vencimiento and control number for a single receipt", () => {
    const payload = buildAutoCaptureReceiptPayload({
      organizationId: "org-test",
      policyId: "policy-new",
      clientId: "client-1",
      insurerId: "insurer-1",
      userId: "user-1",
      receiptEvidence: {
        policyNumber: "940463089",
        receiptControlNumber: "0312242788",
        dueDate: "2026-11-08",
        periodLabel: "01/01",
        amountDue: 7067.18,
        depositAmount: 7067,
        currency: "MXN",
        paymentMethod: "CONTADO",
        paymentConfirmed: false,
        warnings: [],
      },
      draft: {
        policyNumber: "0940463089",
        clientName: "Cliente Demo",
        clientType: "PERSON",
        clientEmail: null,
        clientPhone: null,
        clientAddress: null,
        clientRfc: null,
        insurerName: "Aseguradora Demo",
        policyType: "AUTO",
        serialNumber: null,
        startDate: "2026-10-25",
        endDate: "2027-10-25",
        issueDate: null,
        paymentFrequency: "SINGLE",
        paymentPlan: null,
        premiumAmount: 7067.18,
        currency: "MXN",
        requestNumber: null,
        insuredObject: null,
        beneficiaryInfo: null,
        notes: null,
        sourcePolicyNumber: null,
      },
    });

    expect(payload.receiptNumber).toBe("0312242788");
    expect(payload.dueDate.toISOString()).toBe("2026-11-08T06:00:00.000Z");
    expect(payload.status).toBe("PENDING");
    expect(payload.paidDate).toBeNull();
  });

  it("builds a pending receipt from the capture draft", () => {
    const payload = buildAutoCaptureReceiptPayload({
      organizationId: "org-test",
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
      organizationId: "org-test",
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

  it.each([
    ["SINGLE", 1],
    ["ANNUAL", 1],
    ["MONTHLY", 12],
    ["QUARTERLY", 4],
    ["SEMIANNUAL", 2],
  ])("builds a complete %s receipt schedule", (paymentFrequency, expectedCount) => {
    const startDate = "2026-09-29";
    const endDate = "2027-09-29";
    const payloads = buildAutoCaptureReceiptPayloads({
      organizationId: "org-test",
      policyId: "policy-renewal",
      clientId: "client-1",
      insurerId: "insurer-1",
      userId: "user-1",
      draft: {
        policyNumber: "P-RENEWAL",
        clientName: "Cliente Demo",
        clientType: "PERSON",
        clientEmail: null,
        clientPhone: null,
        clientAddress: null,
        clientRfc: null,
        insurerName: "Aseguradora Demo",
        policyType: "AUTO",
        serialNumber: null,
        startDate,
        endDate,
        issueDate: null,
        paymentFrequency,
        paymentPlan: "Contado",
        premiumAmount: 1200,
        currency: "MXN",
        requestNumber: null,
        insuredObject: null,
        beneficiaryInfo: null,
        notes: null,
        sourcePolicyNumber: "P-OLD",
      },
    });

    expect(payloads).toHaveLength(expectedCount);
    expect(payloads.reduce((sum, payload) => sum + payload.amount, 0)).toBe(1200);
    expect(payloads[0]?.periodStartDate.toISOString()).toBe("2026-09-29T06:00:00.000Z");
    expect(payloads.at(-1)?.periodEndDate.toISOString()).toBe("2027-09-29T06:00:00.000Z");
    for (const [index, payload] of payloads.entries()) {
      expect(payload.receiptNumber).toBe(String(index + 1));
      expect(payload.dueDate).toEqual(payload.periodStartDate);
      if (index > 0) expect(payload.periodStartDate).toEqual(payloads[index - 1]?.periodEndDate);
    }
  });

  it("honors custom amounts provided per receipt", () => {
    const payloads = buildAutoCaptureReceiptPayloads({
      organizationId: "org-test",
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
      organizationId: "org-test",
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
      organizationId: "org-test",
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
