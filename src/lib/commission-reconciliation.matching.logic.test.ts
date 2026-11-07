import { describe, expect, it } from "vitest";
import type { CommissionDraftRow } from "./commission-reconciliation";
import { classifyCommissionDraftRows, type CommissionMatchCandidate } from "./commission-reconciliation.logic";

function row(rowKey: string, policyNumber: string, amount: number, currency = "MXN"): CommissionDraftRow {
  return { rowKey, policyNumber, currency, amount, raw: {}, warnings: [] };
}

function candidate(id: string, expectedAmount: number, currency = "MXN"): CommissionMatchCandidate {
  return { id, expectedAmount, receipt: { currency } };
}

describe("commission statement matching safety", () => {
  it("matches only an exact amount and normalized currency candidate", () => {
    const rowA = row("1", "POL-1", 1200, "mxn");
    const matches = classifyCommissionDraftRows([rowA], new Map([["1", [candidate("commission-1", 900), candidate("commission-2", 1200, "MXN")]]]));

    expect(matches).toEqual([{ status: "MATCHED", commissionId: "commission-2", matchReason: "Identidad, moneda e importe exactos" }]);
  });

  it("keeps a missing identity match for manual review", () => {
    const result = classifyCommissionDraftRows([row("1", "POL-MISSING", 1200)], new Map([["1", []]]));

    expect(result[0]).toMatchObject({ status: "REVIEW", discrepancyReason: expect.stringContaining("No se encontró") });
  });

  it("does not auto-match an amount discrepancy or a currency mismatch", () => {
    const rows = [row("amount", "POL-1", 1300), row("currency", "POL-2", 1200, "USD")];
    const matches = new Map<string, CommissionMatchCandidate[]>([
      ["amount", [candidate("commission-1", 1200)]],
      ["currency", [candidate("commission-2", 1200, "MXN")]],
    ]);

    expect(classifyCommissionDraftRows(rows, matches)).toEqual([
      { status: "REVIEW", discrepancyReason: "El importe difiere del esperado; requiere revisión manual." },
      { status: "REVIEW", discrepancyReason: "La moneda no coincide con la comisión o falta en el estado." },
    ]);
  });

  it("marks every row ambiguous when duplicate rows target the same commission", () => {
    const rows = [row("1", "POL-1", 1200), row("2", "POL-1", 600)];
    const matches = new Map<string, CommissionMatchCandidate[]>([
      ["1", [candidate("commission-1", 1200)]],
      ["2", [candidate("commission-1", 1200)]],
    ]);

    expect(classifyCommissionDraftRows(rows, matches)).toEqual([
      { status: "AMBIGUOUS", discrepancyReason: expect.stringContaining("posible duplicado o pago dividido") },
      { status: "AMBIGUOUS", discrepancyReason: expect.stringContaining("posible duplicado o pago dividido") },
    ]);
  });

  it("can disambiguate same-policy candidates by exact currency and amount", () => {
    const rows = [row("a", "POL-1", 1200, "MXN"), row("b", "POL-1", 500, "USD")];
    const matches = new Map<string, CommissionMatchCandidate[]>([
      ["a", [candidate("commission-mxn", 1200, "MXN"), candidate("commission-usd", 500, "USD")]],
      ["b", [candidate("commission-mxn", 1200, "MXN"), candidate("commission-usd", 500, "USD")]],
    ]);

    expect(classifyCommissionDraftRows(rows, matches)).toEqual([
      { status: "MATCHED", commissionId: "commission-mxn", matchReason: "Identidad, moneda e importe exactos" },
      { status: "MATCHED", commissionId: "commission-usd", matchReason: "Identidad, moneda e importe exactos" },
    ]);
  });
});
