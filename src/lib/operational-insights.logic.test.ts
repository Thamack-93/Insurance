import { describe, expect, it } from "vitest";
import {
  groupOperationalInsightSignals,
  getOutstandingReceiptBalance,
  isPromiseSignalDue,
  paginateOperationalInsightRecords,
  readOperationalInsightGroup,
  readOperationalInsightPage,
  type OperationalInsightSignal,
} from "@/lib/operational-insights.logic";

function signal(input: Partial<OperationalInsightSignal> & Pick<OperationalInsightSignal, "id" | "group" | "recordKey">): OperationalInsightSignal {
  return {
    id: input.id,
    group: input.group,
    recordKey: input.recordKey,
    recordTitle: input.recordTitle ?? "Acme",
    recordSubtitle: input.recordSubtitle ?? "Registro 1",
    href: input.href ?? "/policies/policy-1",
    label: input.label ?? input.id,
    detail: input.detail ?? "Requiere atención",
    date: input.date ?? new Date("2026-10-02T12:00:00.000Z"),
  };
}

describe("operational insights presentation logic", () => {
  it("groups multiple signals for a record into a single actionable row", () => {
    const records = groupOperationalInsightSignals([
      signal({ id: "renewal", group: "renewals", recordKey: "Policy:1", label: "Renovación estancada" }),
      signal({ id: "task", group: "work", recordKey: "Policy:1", label: "Pendiente urgente", date: new Date("2026-10-01T12:00:00.000Z") }),
      signal({ id: "receipt", group: "collections", recordKey: "Receipt:2" }),
    ]);

    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ id: "Policy:1", groups: ["renewals", "work"], signals: [{ id: "renewal" }, { id: "task" }] });
    expect(records[0].date.toISOString()).toBe("2026-10-01T12:00:00.000Z");
  });

  it("filters by group, returns 25 rows, and indicates pagination", () => {
    const records = groupOperationalInsightSignals(Array.from({ length: 27 }, (_, index) =>
      signal({ id: `signal-${index}`, group: index % 2 ? "work" : "claims", recordKey: `Claim:${index}` }),
    ));

    const page = paginateOperationalInsightRecords(records, "work", 1, false);
    expect(page.records).toHaveLength(13);
    expect(page.hasNext).toBe(false);

    const all = paginateOperationalInsightRecords(records, "all", 1, false);
    expect(all.records).toHaveLength(25);
    expect(all.hasNext).toBe(true);
  });

  it("reads safe group and page parameters", () => {
    expect(readOperationalInsightGroup(["claims", "work"])).toBe("claims");
    expect(readOperationalInsightGroup("invalid")).toBe("all");
    expect(readOperationalInsightPage("-3")).toBe(1);
    expect(readOperationalInsightPage("9999")).toBe(100);
    expect(readOperationalInsightPage("nope")).toBe(1);
  });

  it("uses the collection flow promise date and posted payment timestamp", () => {
    const today = new Date("2026-10-02T18:00:00.000Z");
    const metadataJson = JSON.stringify({ outcome: "PROMISED_PAYMENT", promisedPaymentDate: "2026-10-02T06:00:00.000Z" });
    expect(isPromiseSignalDue({ metadataJson, today, postedPaymentDates: [] })).toBe("promise-today");
    expect(isPromiseSignalDue({ metadataJson, today, postedPaymentDates: [new Date("2026-10-02T06:00:00.000Z")] })).toBeNull();
    expect(isPromiseSignalDue({ metadataJson, today, postedPaymentDates: [new Date("2026-10-02T12:00:00.000Z")] })).toBe("promise-today");
    expect(isPromiseSignalDue({
      metadataJson: JSON.stringify({ outcome: "PROMISED_PAYMENT", promisedPaymentDate: "2026-10-01T06:00:00.000Z" }),
      today,
      postedPaymentDates: [],
    })).toBe("promise-broken");
    expect(isPromiseSignalDue({ metadataJson: "{invalid", today, postedPaymentDates: [] })).toBeNull();
  });

  it("respects the receipt detail close tolerance when identifying outstanding balance", () => {
    expect(getOutstandingReceiptBalance(100, [95])).toBe(0);
    expect(getOutstandingReceiptBalance(100, [94])).toBe(6);
    expect(getOutstandingReceiptBalance(100, [110])).toBe(0);
  });
});
