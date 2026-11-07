import { describe, expect, it } from "vitest";
import { buildHistoricalCollections, type HistoricalReceiptEvidence } from "@/lib/historical-collections";

const date = (value: string) => new Date(`${value}T12:00:00.000Z`);
const cutoff = date("2026-04-30");
const start = date("2026-04-01");
const month = [{ month: "2026-04", start, cutoff }];

function receipt(overrides: Partial<HistoricalReceiptEvidence> = {}): HistoricalReceiptEvidence {
  return {
    id: "r1", dueDate: date("2026-04-10"), createdAt: date("2026-04-01"), updatedAt: date("2026-04-01"),
    amount: 100, currency: "MXN", status: "PENDING", cancelledAt: null, payments: [], ...overrides,
  };
}

describe("historical collections", () => {
  it("sums partial payments recorded and effective by month end only once", () => {
    const result = buildHistoricalCollections([receipt({ payments: [
      { amount: 30, paidDate: date("2026-04-12"), createdAt: date("2026-04-12"), status: "POSTED", reversedAt: null },
      { amount: 20, paidDate: date("2026-04-30"), createdAt: date("2026-04-30"), status: "POSTED", reversedAt: null },
      { amount: 15, paidDate: date("2026-04-20"), createdAt: date("2026-05-01"), status: "POSTED", reversedAt: null },
      { amount: 10, paidDate: date("2026-05-01"), createdAt: date("2026-04-25"), status: "POSTED", reversedAt: null },
    ] })], month);
    expect(result[0].currencies[0]).toMatchObject({ receipts: 1, incompleteReceipts: 0, dueAmount: 100, collectedAmount: 50, outstandingAmount: 50 });
  });

  it("excludes cancellations and reversals effective before the cutoff", () => {
    const rows = [
      receipt({ id: "cancelled", status: "CANCELLED", cancelledAt: date("2026-04-20") }),
      receipt({ id: "reversed", payments: [{ amount: 70, paidDate: date("2026-04-12"), createdAt: date("2026-04-12"), status: "REVERSED", reversedAt: date("2026-04-28") }] }),
      receipt({ id: "still-valid-at-cutoff", payments: [{ amount: 25, paidDate: date("2026-04-12"), createdAt: date("2026-04-12"), status: "REVERSED", reversedAt: date("2026-05-02") }] }),
    ];
    expect(buildHistoricalCollections(rows, month)[0].currencies[0]).toMatchObject({ receipts: 2, dueAmount: 200, collectedAmount: 25, outstandingAmount: 175 });
  });

  it("keeps currencies separate and hides exact totals when historical evidence is incomplete", () => {
    const result = buildHistoricalCollections([
      receipt({ id: "usd", currency: "USD", amount: 50 }),
      receipt({ id: "unknown", amount: 100, updatedAt: date("2026-05-01") }),
    ], month);
    expect(result[0].currencies).toEqual([
      { currency: "MXN", receipts: 1, incompleteReceipts: 1, dueAmount: null, collectedAmount: null, outstandingAmount: null },
      { currency: "USD", receipts: 1, incompleteReceipts: 0, dueAmount: 50, collectedAmount: 0, outstandingAmount: 50 },
    ]);
  });

  it("marks undated reversal and cancellation state as incomplete", () => {
    const result = buildHistoricalCollections([
      receipt({ id: "cancelled-without-date", status: "CANCELLED" }),
      receipt({ id: "reversal-without-date", payments: [{ amount: 10, paidDate: date("2026-04-12"), createdAt: date("2026-04-12"), status: "REVERSED", reversedAt: null }] }),
    ], month);
    expect(result[0].currencies[0]).toMatchObject({ receipts: 2, incompleteReceipts: 2, dueAmount: null, collectedAmount: null, outstandingAmount: null });
  });

  it("omits receipts that did not exist by cutoff or fall outside the due cohort", () => {
    const result = buildHistoricalCollections([
      receipt({ id: "created-later", createdAt: date("2026-05-01") }),
      receipt({ id: "due-later", dueDate: date("2026-05-01") }),
      receipt({ id: "due-earlier", dueDate: date("2026-03-31") }),
    ], month);
    expect(result[0].currencies).toEqual([]);
  });
});
