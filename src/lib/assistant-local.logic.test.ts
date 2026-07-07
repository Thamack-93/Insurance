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
});
