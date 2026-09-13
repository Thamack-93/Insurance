import { describe, expect, it } from "vitest";
import { compareAutoQuoteConsistency, normalizeAutoQuoteTerms } from "./quote-comparisons";

describe("auto quote comparison", () => {
  it("flags vehicle, period, and currency mismatches", () => {
    const left = normalizeAutoQuoteTerms({ vehicle: { vin: "VIN-1" }, coveragePeriod: { start: "2026-01-01" }, premium: { currency: "mxn" } });
    const right = { vehicle: { vin: "VIN-2" }, coveragePeriod: { start: "2026-02-01" }, premium: { currency: "USD" } };
    expect(left.premium?.currency).toBe("MXN");
    expect(compareAutoQuoteConsistency(left, right)).toEqual(["Vehículos distintos.", "Periodos de cobertura distintos.", "Monedas distintas."]);
  });
});
