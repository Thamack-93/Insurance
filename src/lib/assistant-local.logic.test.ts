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
});
