import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/dashboard-queries", () => {
  const getTodayData = vi.fn(async () => ({
    paymentsDueToday: [
      {
        id: "receipt-today-1",
        client: { fullName: "Cliente Hoy" },
        policy: { id: "policy-today-1", policyNumber: "POL-100" },
        receiptNumber: "REC-100",
        insurer: { name: "Aseguradora Uno" },
        dueDate: new Date("2026-07-26T00:00:00.000Z"),
        amount: 1200,
      },
    ],
    overduePayments: [
      {
        id: "receipt-overdue-1",
        client: { fullName: "Cliente Vencido" },
        policy: { id: "policy-overdue-1", policyNumber: "POL-200" },
        receiptNumber: "REC-200",
        insurer: { name: "Aseguradora Dos" },
        dueDate: new Date("2026-07-20T00:00:00.000Z"),
        amount: 2300,
      },
    ],
    paymentsDue7: [],
    urgentRenewals: [
      {
        id: "policy-renewal-1",
        policyNumber: "POL-300",
        client: { fullName: "Cliente Renovación" },
        insurer: { name: "Aseguradora Renovación" },
        premiumAmount: 4500,
        currency: "MXN",
        endDate: new Date("2026-07-27T00:00:00.000Z"),
      },
    ],
    overdueWorkItems: [
      {
        id: "task-1",
        title: "Llamar a cliente",
        folio: "T-1",
        client: { fullName: "Cliente Pendiente" },
        policy: { id: "policy-task-1", policyNumber: "POL-400", endDate: new Date("2026-07-30T00:00:00.000Z") },
        insurer: { name: "Aseguradora Pendiente" },
        dueDate: new Date("2026-07-25T00:00:00.000Z"),
        priority: "HIGH",
      },
    ],
    commissionsToReview: [
      {
        id: "commission-1",
        client: { fullName: "Cliente Comisión" },
        policy: { id: "policy-commission-1", policyNumber: "POL-500" },
        insurer: { name: "Aseguradora Tres" },
      },
    ],
  }));

  return { getTodayData };
});

vi.mock("@/lib/search", () => {
  const globalSearch = vi.fn(async (query: string) => {
    if (query.includes("940454625")) {
      return [
        {
          id: "policy-1",
          type: "policy",
          title: "940454625",
          subtitle: "Cliente Vencimiento · Qualitas",
          href: "/policies/policy-1",
        },
      ];
    }
    return [];
  });

  return { globalSearch };
});

vi.mock("@/lib/data-quality", () => ({
  getPolicyDataQualityScores: vi.fn(async () => [
    {
      polizaId: "policy-1",
      poliza: "940454625",
      clienteId: "client-1",
      cliente: "Cliente Vencimiento",
      aseguradora: "Qualitas",
      endDate: new Date("2026-07-31T00:00:00.000Z"),
      status: "ACTIVE",
      premiumAmount: 1000,
      paymentFrequency: "ANNUAL",
      insuredObject: null,
      notes: null,
      score: 72,
      nivel: "Bueno",
      completitud: 60,
      issues: [
        {
          code: "POLICY_WITHOUT_RECEIPTS",
          etiqueta: "Sin recibos",
          descripcion: "La póliza no tiene ningún recibo registrado.",
          penalizacion: 20,
          entityType: "Policy",
          entityId: "policy-1",
        },
      ],
    },
  ]),
  getReceiptReviewIssues: vi.fn(async () => [
    {
      issueId: "issue-1",
      reason: "RECEIPT_OVERDUE",
      status: "OPEN",
      dispositionLabel: "Abierto",
      suppressedByRuleId: null,
      duplicateOfId: null,
      receiptId: "receipt-1",
      receiptNumber: "REC-001",
      policyId: "policy-1",
      policyNumber: "940454625",
      clientName: "Cliente Vencimiento",
      insurerName: "Qualitas",
      amount: 1500,
      paidAmount: 0,
      currency: "MXN",
      dueDate: new Date("2026-07-03T00:00:00.000Z"),
      paidDate: null,
      paymentCount: 0,
      gapDays: null,
      resolutionNote: null,
      reviewedAt: null,
      createdAt: new Date("2026-07-04T00:00:00.000Z"),
    },
  ]),
  getRenewalReviewSuggestions: vi.fn(async () => [
    {
      suggestionId: "renewal-1",
      status: "OPEN",
      dispositionLabel: "Abierto",
      suppressedByRuleId: null,
      duplicateOfId: null,
      reason: "RENEWAL_SUGGESTION",
      resolutionNote: null,
      reviewedAt: null,
      sourcePolicyId: "policy-1",
      sourcePolicyNumber: "940454625",
      sourcePolicyStatus: "ACTIVE",
      clientName: "Cliente Vencimiento",
      insurerName: "Qualitas",
      sourceStartDate: new Date("2025-08-01T00:00:00.000Z"),
      sourceEndDate: new Date("2026-07-31T00:00:00.000Z"),
      targetPolicyId: null,
      targetPolicyNumber: null,
      targetPolicyStatus: null,
      createdAt: new Date("2026-07-04T00:00:00.000Z"),
      updatedAt: new Date("2026-07-04T00:00:00.000Z"),
    },
  ]),
}));

vi.mock("@/lib/risk-engine", () => ({
  detectRisks: vi.fn(async () => [
    {
      alertType: "INCONSISTENT_DATES",
      severity: "CRITICAL",
      title: "Fechas inconsistentes",
      description: "940454625",
      entityType: "Policy",
      entityId: "policy-1",
      suggestedAction: "Corregir vigencia de poliza.",
    },
    {
      alertType: "RECEIPT_OVERDUE",
      severity: "CRITICAL",
      title: "Recibo vencido sin pago",
      description: "REC-001 · 940454625 · Cliente Vencimiento · MXN 1,500.00",
      entityType: "Receipt",
      entityId: "receipt-1",
      suggestedAction: "Contactar cliente y registrar seguimiento.",
    },
  ]),
}));

vi.mock("@/lib/vigency-maintenance", () => ({
  getLatestMaintenanceRun: vi.fn(async () => ({
    id: "run-1",
    type: "POLICY_VIGENCY_AUDIT",
    status: "COMPLETED",
    summaryJson: JSON.stringify({
      paymentFrequencyReviewSample: [
        {
          policyId: "policy-1",
          policyNumber: "940454625",
          currentFrequency: "ANNUAL",
          receiptCount: 2,
          reason: "Frecuencia a revisar por recibos consecutivos.",
        },
      ],
      receiptIssuesOpened: 1,
      receiptIssuesResolved: 0,
      familiesLinked: 0,
      overlappingFamilies: 0,
      paymentFrequenciesNormalized: 0,
    }),
    startedAt: new Date("2026-07-04T00:00:00.000Z"),
    completedAt: new Date("2026-07-04T00:30:00.000Z"),
    createdAt: new Date("2026-07-04T00:00:00.000Z"),
    updatedAt: new Date("2026-07-04T00:30:00.000Z"),
  })),
}));

import { buildAssistantReply } from "@/lib/assistant-local";
import { getTodayData } from "@/lib/dashboard-queries";

describe("assistant local replies", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-26T12:00:00-06:00"));
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the today summary and details as plain text", async () => {
    const reply = await buildAssistantReply({ id: "user-1", role: "ADMIN" }, "hoy");

    expect(reply.reply).toContain("Hoy tienes 1 recibo vencido");
    expect(reply.reply).toContain("1 que vencen hoy");
    expect(reply.reply).toContain("Cliente Vencido");
    expect(reply.reply).toContain("[Ver recibo](/receipts/receipt-overdue-1)");
    expect(reply.reply).toContain("Cliente Renovación");
    expect(reply.sections).toEqual([]);
    expect(reply.quickPrompts).toEqual([]);
  });

  it("returns operational receipt details as plain text for overdue queries", async () => {
    const reply = await buildAssistantReply({ id: "user-1", role: "ADMIN" }, "recibos vencidos");

    expect(reply.reply).toContain("1 recibo vencido");
    expect(reply.reply).toContain("Cliente Vencido");
    expect(reply.reply).toContain("REC-200");
    expect(reply.reply).toContain("2,300");
    expect(reply.reply).toContain("/receipts/receipt-overdue-1");
    expect(reply.sections).toEqual([]);
    expect(reply.quickPrompts).toEqual([]);
  });

  it("uses capped wording when a local list reaches its query limit", async () => {
    const current = await getTodayData();
    const first = current.overduePayments[0];
    vi.mocked(getTodayData).mockResolvedValueOnce({
      ...current,
      overduePayments: [
        ...current.overduePayments,
        ...Array.from({ length: 7 }, (_, index) => ({ ...first, id: `receipt-overdue-${index + 2}` })),
      ],
    });

    const reply = await buildAssistantReply({ id: "user-1", role: "ADMIN" }, "hoy");

    expect(reply.reply).toContain("8 o más recibos vencidos");
    expect(reply.reply).toContain("Muestro 3 de al menos 8");
  });

  it("returns the requested renewal window for renovaciones 10 dias", async () => {
    const reply = await buildAssistantReply({ id: "user-1", role: "ADMIN" }, "dime mis renovaciones a 10 dias");

    expect(reply.reply).toContain("10 días");
    expect(reply.reply).toContain("POL-300");
    expect(reply.reply).toContain("Cliente Renovación");
    expect(reply.reply).toContain("Aseguradora Renovación");
    expect(reply.reply).toContain("Prima");
    expect(reply.reply).toContain("/policies/policy-renewal-1");
    expect(reply.sections).toEqual([]);
    expect(reply.quickPrompts).toEqual([]);
  });

  it("starts a policy change flow instead of a generic search", async () => {
    const reply = await buildAssistantReply({ id: "user-1", role: "ADMIN" }, "necesito cambiar la fecha de vencimiento de la poliza 940454625");

    expect(reply.reply).toContain("Encontré 940454625");
    expect(reply.reply).toContain("nueva fecha de vencimiento");
    expect(reply.sections[0]?.title).toBe("Cambiar vencimiento");
    expect(reply.sections[0]?.items[0]?.title).toBe("940454625");
    expect(reply.sections[0]?.items[0]?.href).toBe("/policies/policy-1");
  });

  it("returns a targeted consistency audit for vigencia and receipts", async () => {
    const reply = await buildAssistantReply(
      { id: "user-1", role: "ADMIN" },
      "necesito que me digas que polizas no coinciden sus fechas de vencimiento, renovacion, inicio de vigencia y sus recibos",
    );

    expect(reply.reply).toContain("fechas o vigencias");
    expect(reply.reply).toContain("Pólizas con fechas o vigencias a revisar");
    expect(reply.reply).toContain("[940454625](/policies/policy-1)");
    expect(reply.reply).toContain("REC-001");
    expect(reply.reply).toContain("Renovaciones relacionadas");
    expect(reply.reply).toContain("Mantenimiento de vigencia");
    expect(reply.sections).toEqual([]);
    expect(reply.quickPrompts).toEqual([]);
  });

  it("keeps mutation preparation structured while local reads stay text-only", async () => {
    const reply = await buildAssistantReply({ id: "user-1", role: "ADMIN" }, "cambiar la fecha de vencimiento de la poliza 940454625");

    expect(reply.sections).toHaveLength(1);
    expect(reply.sections[0]?.title).toBe("Cambiar vencimiento");
    expect(reply.quickPrompts.length).toBeGreaterThan(0);
  });

  it("formats search results as inline links without result cards", async () => {
    const reply = await buildAssistantReply({ id: "user-1", role: "ADMIN" }, "buscar póliza 940454625");

    expect(reply.reply).toContain("[940454625](/policies/policy-1)");
    expect(reply.sections).toEqual([]);
    expect(reply.quickPrompts).toEqual([]);
  });
});
