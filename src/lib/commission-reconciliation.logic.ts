import type { CommissionDraftRow } from "./commission-reconciliation";

export type CommissionMatchCandidate = {
  id: string;
  expectedAmount: unknown;
  receipt: { currency: string } | null;
};

export type CommissionStatementMatch = {
  status: "MATCHED" | "AMBIGUOUS" | "REVIEW";
  commissionId?: string;
  matchReason?: string;
  discrepancyReason?: string;
};

function normalizedCurrency(value: string | null | undefined) {
  return value?.trim().toUpperCase() || "";
}

function sameMoney(left: number, right: number) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.round(left * 100) === Math.round(right * 100);
}

/** Classify all rows together so duplicate assignments never become auto-applicable. */
export function classifyCommissionDraftRows(
  rows: CommissionDraftRow[],
  candidatesByRowKey: Map<string, CommissionMatchCandidate[]>,
): CommissionStatementMatch[] {
  const provisional = rows.map((row): CommissionStatementMatch => {
    if (row.warnings.length || row.amount === undefined) {
      return { status: "REVIEW", discrepancyReason: row.warnings.join(" ") || "Importe no reconocido." };
    }

    const candidates = candidatesByRowKey.get(row.rowKey) ?? [];
    if (!candidates.length) return { status: "REVIEW", discrepancyReason: "No se encontró una comisión para la identidad importada." };

    const rowCurrency = normalizedCurrency(row.currency);
    const currencyMatches = rowCurrency
      ? candidates.filter((candidate) => normalizedCurrency(candidate.receipt?.currency) === rowCurrency)
      : [];
    if (!currencyMatches.length) return { status: "REVIEW", discrepancyReason: "La moneda no coincide con la comisión o falta en el estado." };

    const amountMatches = currencyMatches.filter((candidate) => sameMoney(row.amount!, Number(candidate.expectedAmount)));
    if (!amountMatches.length) return { status: "REVIEW", discrepancyReason: "El importe difiere del esperado; requiere revisión manual." };
    if (amountMatches.length > 1) return { status: "AMBIGUOUS", discrepancyReason: "Varias comisiones coinciden en identidad, moneda e importe." };

    return { status: "MATCHED", commissionId: amountMatches[0].id, matchReason: "Identidad, moneda e importe exactos" };
  });

  const rowIndexesByPossibleCommissionId = new Map<string, Set<number>>();
  rows.forEach((row, index) => {
    const rowCurrency = normalizedCurrency(row.currency);
    if (!rowCurrency) return;
    for (const candidate of candidatesByRowKey.get(row.rowKey) ?? []) {
      if (normalizedCurrency(candidate.receipt?.currency) !== rowCurrency) continue;
      const indexes = rowIndexesByPossibleCommissionId.get(candidate.id) ?? new Set<number>();
      indexes.add(index);
      rowIndexesByPossibleCommissionId.set(candidate.id, indexes);
    }
  });

  for (const [commissionId, indexes] of rowIndexesByPossibleCommissionId) {
    if (indexes.size < 2) continue;
    for (const index of indexes) {
      provisional[index] = {
        status: "AMBIGUOUS",
        commissionId: undefined,
        discrepancyReason: `Varias filas del estado coinciden con la comisión ${commissionId}; revisar posible duplicado o pago dividido.`,
      };
    }
  }

  return provisional;
}
