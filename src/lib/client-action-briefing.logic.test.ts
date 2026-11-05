import { describe, expect, it } from "vitest";
import { businessAddDays } from "@/lib/business-dates";
import { buildClientActionOverview, buildClientActions, hasMeaningfulClientAttention, type ClientActionData } from "@/lib/client-action-briefing.logic";

const today = new Date("2026-11-04T06:00:00.000Z");

function emptyData(): ClientActionData {
  return { today, receipts: [], renewals: [], workItems: [], claims: [], activity: [] };
}

describe("client action briefing", () => {
  it("orders overdue, today, upcoming deadlines, other open work, and activity", () => {
    const data = emptyData();
    data.receipts = [
      { id: "receipt-overdue", clientId: "c1", client: { fullName: "Cliente" }, receiptNumber: "R-1", dueDate: businessAddDays(today, -2), amount: "100", currency: "MXN", status: "OVERDUE", policyId: "p1", policy: { policyNumber: "P-1" } },
      { id: "receipt-today", clientId: "c1", client: { fullName: "Cliente" }, receiptNumber: "R-2", dueDate: today, amount: "250", currency: "USD", status: "PENDING", policyId: "p1", policy: { policyNumber: "P-1" } },
    ];
    data.renewals = [{ policyId: "p2", clientId: "c1", clientName: "Cliente", policyNumber: "P-2", endDate: businessAddDays(today, 20) }];
    data.workItems = [{
      id: "task-later", sourceType: "Task", sourceId: "task-later", workItemType: "TASK", taskType: "GENERAL", status: "OPEN", priority: "MEDIUM", priorityRank: 20,
      severity: null, folio: "T-1", title: "Llamar al cliente", description: null, entityType: "Task", entityId: "task-later", clientId: "c1", policyId: null,
      insurerId: null, receiptId: null, startDate: today, dueDate: businessAddDays(today, 14), closedDate: null, readAt: null, notes: null, createdAt: today,
      updatedAt: today, createdById: null, updatedById: null, client: { id: "c1", fullName: "Cliente" }, policy: null, insurer: null, receipt: null,
    } as never];
    data.claims = [{ id: "claim", clientId: "c1", client: { fullName: "Cliente" }, folio: "C-1", claimType: "AUTO", status: "OPEN", dueDate: null }];
    data.activity = [{ id: "activity", entityType: "Client", entityId: "c1", action: "UPDATE_CLIENT", oldValue: null, newValue: null, userId: "u1", createdAt: businessAddDays(today, -1) }];

    expect(buildClientActions(data).map((action) => action.priority)).toEqual([
      "OVERDUE", "TODAY", "UPCOMING", "OPEN", "OPEN", "ACTIVITY",
    ]);
  });

  it("excludes cancelled receipts and closed work items", () => {
    const data = emptyData();
    data.receipts = [{ id: "cancelled", clientId: "c1", client: { fullName: "Cliente" }, receiptNumber: "R-1", dueDate: businessAddDays(today, -1), amount: "100", currency: "MXN", status: "CANCELLED", policyId: "p1", policy: { policyNumber: "P-1" } }];
    data.workItems = [{ id: "closed", workItemType: "TASK", status: "RESOLVED", clientId: "c1", client: { id: "c1", fullName: "Cliente" } } as never];

    expect(buildClientActions(data)).toEqual([]);
    expect(hasMeaningfulClientAttention([])).toBe(false);
  });

  it("keeps original amounts and currencies separate and avoids duplicate linked records", () => {
    const data = emptyData();
    data.receipts = [
      { id: "mxn", clientId: "c1", client: { fullName: "Cliente" }, receiptNumber: "R-MXN", dueDate: businessAddDays(today, 1), amount: "1234.56", currency: "MXN", status: "PENDING", policyId: "p1", policy: { policyNumber: "P-1" } },
      { id: "usd", clientId: "c1", client: { fullName: "Cliente" }, receiptNumber: "R-USD", dueDate: businessAddDays(today, 2), amount: "95.25", currency: "USD", status: "PENDING", policyId: "p1", policy: { policyNumber: "P-1" } },
    ];
    data.workItems = [{
      id: "receipt-task", sourceType: "Collection", workItemType: "TASK", taskType: "PAYMENT", status: "OPEN", entityType: "Receipt", entityId: "mxn", clientId: "c1", receiptId: "mxn", dueDate: businessAddDays(today, -1),
    } as never];

    const actions = buildClientActions(data);
    expect(actions.map(({ recordKey }) => recordKey)).toEqual(["receipt:mxn", "receipt:usd"]);
    expect(actions.map(({ amount, currency }) => [amount, currency])).toEqual([["1234.56", "MXN"], ["95.25", "USD"]]);
  });

  it("does not treat activity alone as a pending action and ranks client groups by their most urgent item", () => {
    const data = emptyData();
    data.activity = [{ id: "old-activity", entityType: "Client", entityId: "c1", action: "UPDATE_CLIENT", oldValue: null, newValue: null, userId: "u1", createdAt: businessAddDays(today, -8) }];
    expect(hasMeaningfulClientAttention(buildClientActions(data))).toBe(false);

    const actions = [
      { id: "later", recordKey: "policy:p2", clientId: "c2", clientName: "B", kind: "renewal", priority: "UPCOMING", title: "Renovación", detail: "", dueDate: businessAddDays(today, 10), href: "/policies/p2" },
      { id: "overdue", recordKey: "receipt:r1", clientId: "c1", clientName: "A", kind: "receipt", priority: "OVERDUE", title: "Recibo", detail: "", dueDate: businessAddDays(today, -1), href: "/receipts/r1" },
    ] as const;
    expect(buildClientActionOverview([...actions]).map(({ clientId }) => clientId)).toEqual(["c1", "c2"]);
  });
});
