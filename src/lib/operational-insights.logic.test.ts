import { describe, expect, it } from "vitest";
import {
  groupOperationalInsightSignals,
  getOutstandingReceiptBalance,
  isPromiseSignalDue,
  paginateOperationalInsightRecords,
  readOperationalInsightGroup,
  readOperationalInsightPage,
  selectOperationalInsightCandidatePage,
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

  it("keeps the database's global date order and uses the extra row only as a next-page marker", () => {
    const orderedRows = Array.from({ length: 26 }, (_, index) => ({
      recordKey: `Receipt:${index}`,
      recordDate: new Date(Date.UTC(2026, 9, 1, 0, index)),
    }));
    const page = selectOperationalInsightCandidatePage(orderedRows);

    expect(page.rows).toHaveLength(25);
    expect(page.rows.map(({ recordKey }) => recordKey)).toEqual(orderedRows.slice(0, 25).map(({ recordKey }) => recordKey));
    expect(page.hasNext).toBe(true);
    expect(selectOperationalInsightCandidatePage(orderedRows.slice(0, 25)).hasNext).toBe(false);
    expect(selectOperationalInsightCandidatePage([{ recordKey: null, recordDate: null }]).rows).toEqual([]);
  });

  it("reads safe group and page parameters", () => {
    expect(readOperationalInsightGroup(["claims", "work"])).toBe("claims");
    expect(readOperationalInsightGroup("invalid")).toBe("all");
    expect(readOperationalInsightPage("-3")).toBe(1);
    expect(readOperationalInsightPage("9999")).toBe(100);
    expect(readOperationalInsightPage("nope")).toBe(1);
  });

  it("uses the collection promise date and keeps partial payment balances actionable", () => {
    const today = new Date("2026-10-02T18:00:00.000Z");
    const metadataJson = JSON.stringify({ outcome: "PROMISED_PAYMENT", promisedPaymentDate: "2026-10-02T06:00:00.000Z" });
    const dueInput = { metadataJson, today, receiptAmount: 100 };
    expect(isPromiseSignalDue({ ...dueInput, postedPaymentAmounts: [] })).toBe("promise-today");
    expect(isPromiseSignalDue({ ...dueInput, postedPaymentAmounts: [40] })).toBe("promise-today");
    expect(isPromiseSignalDue({ ...dueInput, postedPaymentAmounts: [95] })).toBeNull();
    expect(isPromiseSignalDue({
      ...dueInput,
      metadataJson: JSON.stringify({ outcome: "PROMISED_PAYMENT", promisedPaymentDate: "2026-10-01T06:00:00.000Z" }),
      postedPaymentAmounts: [50],
    })).toBe("promise-broken");
    expect(isPromiseSignalDue({
      ...dueInput,
      metadataJson: JSON.stringify({ outcome: "PROMISED_PAYMENT", promisedPaymentDate: "2026-10-01T06:00:00.000Z" }),
      postedPaymentAmounts: [],
    })).toBe("promise-broken");
    expect(isPromiseSignalDue({ ...dueInput, metadataJson: "{invalid", postedPaymentAmounts: [] })).toBeNull();
    expect(isPromiseSignalDue({ ...dueInput, metadataJson: "[]", postedPaymentAmounts: [] })).toBeNull();
    expect(isPromiseSignalDue({
      ...dueInput,
      metadataJson: JSON.stringify({ outcome: "PROMISED_PAYMENT", promisedPaymentDate: "2026-13-40T00:00:00.000Z" }),
      postedPaymentAmounts: [],
    })).toBeNull();
  });

  it("respects the receipt detail close tolerance when identifying outstanding balance", () => {
    expect(getOutstandingReceiptBalance(100, [95])).toBe(0);
    expect(getOutstandingReceiptBalance(100, [94])).toBe(6);
    expect(getOutstandingReceiptBalance(100, [110])).toBe(0);
  });
});
