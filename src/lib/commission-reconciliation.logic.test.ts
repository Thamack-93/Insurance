import { describe, expect, it } from "vitest";
import { parseCommissionStatement } from "./commission-reconciliation";

describe("commission statement drafts", () => {
  it("normalizes CSV identity, money, dates, and review warnings", () => {
    const rows = parseCommissionStatement(Buffer.from("Póliza,Recibo,Moneda,Importe,Fecha pago\nA-1,R-1,MXN,1234.50,2026-09-01\n,,,bad,\n"), "text/csv");
    expect(rows[0]).toMatchObject({ policyNumber: "A-1", receiptNumber: "R-1", currency: "MXN", amount: 1234.5, paymentDate: "2026-09-01T00:00:00.000Z", warnings: [] });
    expect(rows[1]?.warnings).toEqual(expect.arrayContaining(["Falta identidad de póliza o recibo.", "Moneda no especificada."]));
  });
});
