import { describe, expect, it } from "vitest";
import {
  buildFocusItems,
  buildTodayOperationsModel,
  formatCount,
  getTimeGreeting,
  type TodayData,
} from "@/lib/today-operations";

function emptyTodayData(): TodayData {
  return {
    overduePayments: [],
    paymentsDueToday: [],
    paymentsDue7: [],
    urgentRenewals: [],
    overdueWorkItems: [],
    clientsToContact: [],
    commissionsToReview: [],
    criticalRisks: [],
    recentActivity: [],
  } as TodayData;
}

describe("today operations presentation logic", () => {
  it("uses business-friendly greeting boundaries", () => {
    expect(getTimeGreeting(9, "Pedro")).toBe("Buen día, Pedro");
    expect(getTimeGreeting(14, "Pedro")).toBe("Buenas tardes, Pedro");
    expect(getTimeGreeting(21, "Pedro")).toBe("Buenas noches, Pedro");
    expect(getTimeGreeting(9)).toBe("Buen día");
  });

  it("communicates capped metrics without claiming an exact total", () => {
    expect(formatCount(3, 8)).toEqual({ value: 3, accessibleValue: "3" });
    expect(formatCount(8, 8)).toEqual({ value: "8+", accessibleValue: "8 o más" });
  });

  it("orders focus work by operational priority and stable date/id ties", () => {
    const data = emptyTodayData();
    data.overduePayments = [
      {
        id: "b",
        dueDate: new Date("2026-07-10T00:00:00Z"),
        client: { fullName: "B" },
        policy: { policyNumber: "POL-B" },
        receiptNumber: "REC-B",
        amount: 200,
        currency: "MXN",
      },
      {
        id: "a",
        dueDate: new Date("2026-07-10T00:00:00Z"),
        client: { fullName: "A" },
        policy: { policyNumber: "POL-A" },
        receiptNumber: "REC-A",
        amount: 100,
        currency: "MXN",
      },
    ] as never;
    data.paymentsDueToday = [
      {
        id: "today",
        dueDate: new Date("2026-07-21T00:00:00Z"),
        client: { fullName: "Today" },
        policy: { policyNumber: "POL-T" },
        receiptNumber: "REC-T",
        amount: 300,
        currency: "MXN",
      },
    ] as never;
    data.overdueWorkItems = [
      {
        id: "task",
        title: "Llamar cliente",
        folio: "TASK-1",
        startDate: new Date("2026-07-18T00:00:00Z"),
        dueDate: new Date("2026-07-19T00:00:00Z"),
        client: { fullName: "Task client" },
      },
    ] as never;

    expect(buildFocusItems(data).map((item) => item.id)).toEqual([
      "receipt-overdue-a",
      "receipt-overdue-b",
      "receipt-today-today",
      "work-item-task",
    ]);
  });

  it("derives a truthful empty summary from available data", () => {
    const model = buildTodayOperationsModel(emptyTodayData(), {
      name: "Pedro",
      now: new Date("2026-07-21T22:00:00Z"),
    });

    expect(model.greeting).toBe("Buenas tardes, Pedro");
    expect(model.summary).toContain("Tienes 0 acciones");
    expect(model.summary).toContain("0 afectan a clientes hoy");
    expect(model.summaryMetrics).toHaveLength(6);
    expect(model.summaryMetrics.map((metric) => metric.label)).toEqual([
      "Vencidos",
      "Vencen hoy",
      "Próx. 7 días",
      "Renovaciones",
      "Pendientes atrasados",
      "Comisiones",
    ]);
    expect(model.focusItems).toEqual([]);
  });

  it("uses capped wording for the upcoming-receipts metric", () => {
    const data = emptyTodayData();
    data.paymentsDue7 = Array.from({ length: 8 }, (_, index) => ({ id: `receipt-${index}` })) as never;

    const model = buildTodayOperationsModel(data, { now: new Date("2026-07-21T16:00:00Z") });
    const upcoming = model.summaryMetrics.find((metric) => metric.id === "due-7");

    expect(upcoming).toMatchObject({ value: "8+", accessibleValue: "8 o más" });
  });
});
