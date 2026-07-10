import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/dashboard-queries", () => {
  const getTodayData = vi.fn(async () => ({
    paymentsDueToday: [
      {
        id: "receipt-today-1",
        client: { fullName: "Cliente Hoy" },
        policy: { policyNumber: "POL-100" },
        receiptNumber: "REC-100",
        insurer: { name: "Aseguradora Uno" },
      },
    ],
    overduePayments: [
      {
        id: "receipt-overdue-1",
        client: { fullName: "Cliente Vencido" },
        policy: { policyNumber: "POL-200" },
        receiptNumber: "REC-200",
        insurer: { name: "Aseguradora Dos" },
      },
    ],
    paymentsDue7: [],
    urgentRenewals: [
      {
        id: "policy-renewal-1",
        policyNumber: "POL-300",
        client: { fullName: "Cliente Renovación" },
        endDate: new Date("2026-07-16T00:00:00.000Z"),
      },
    ],
    overdueWorkItems: [
      {
        id: "task-1",
        title: "Llamar a cliente",
        folio: "T-1",
        policy: { policyNumber: "POL-400" },
      },
    ],
    commissionsToReview: [
      {
        id: "commission-1",
        client: { fullName: "Cliente Comisión" },
        policy: { policyNumber: "POL-500" },
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

describe("assistant local replies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the today summary for hoy", async () => {
    const reply = await buildAssistantReply({ id: "user-1", role: "ADMIN" }, "hoy");

    expect(reply.reply).toContain("Hoy tienes 1 recibo vencido");
    expect(reply.reply).toContain("1 que vencen hoy");
    expect(reply.sections[0]?.title).toBe("Cobros de hoy");
    expect(reply.sections[0]?.items[0]?.title).toContain("Cliente Vencido");
    expect(reply.quickPrompts.map((prompt) => prompt.prompt)).toContain("hoy");
  });

  it("returns the requested renewal window for renovaciones 10 dias", async () => {
    const reply = await buildAssistantReply({ id: "user-1", role: "ADMIN" }, "dime mis renovaciones a 10 dias");

    expect(reply.reply).toContain("10 días");
    expect(reply.sections[0]?.title).toBe("Renovaciones en 10 días");
    expect(reply.sections[0]?.items[0]?.title).toBe("POL-300");
    expect(reply.sections[0]?.items[0]?.subtitle).toContain("Cliente Renovación");
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
    expect(reply.sections[0]?.title).toBe("Pólizas con fechas o vigencias a revisar");
    expect(reply.sections[0]?.items[0]?.title).toBe("940454625");
    expect(reply.sections[1]?.title).toBe("Recibos con conciliación pendiente");
    expect(reply.sections[1]?.items[0]?.title).toBe("REC-001");
    expect(reply.sections[2]?.title).toBe("Renovaciones relacionadas");
    expect(reply.sections[2]?.items[0]?.title).toBe("940454625");
    expect(reply.sections[3]?.title).toBe("Mantenimiento de vigencia");
    expect(reply.quickPrompts.map((prompt) => prompt.prompt)).toContain("pólizas con fechas inconsistentes");
  });
});
