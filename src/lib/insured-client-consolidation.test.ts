import { describe, expect, it } from "vitest";
import { isInsuredClientName, normalizePersonKey, splitInsuredClientName } from "./insured-client-consolidation";

describe("insured-client-consolidation", () => {
  it("splits contractor and insured names from the imported marker format", () => {
    const parts = splitInsuredClientName("CHARBEL SALOMON MURAD KOPPEL - ASEGURADO:ANDREA VALDEZ LLEDIAS");

    expect(parts.hasMarker).toBe(true);
    expect(parts.contractorName).toBe("CHARBEL SALOMON MURAD KOPPEL");
    expect(parts.insuredName).toBe("ANDREA VALDEZ LLEDIAS");
  });

  it("keeps plain names unchanged", () => {
    const parts = splitInsuredClientName("ALEJANDRA AZOTLA BAJALIL");

    expect(parts.hasMarker).toBe(false);
    expect(parts.contractorName).toBe("ALEJANDRA AZOTLA BAJALIL");
    expect(parts.insuredName).toBe("ALEJANDRA AZOTLA BAJALIL");
  });

  it("normalizes accents and spacing for matching", () => {
    expect(normalizePersonKey("José  Ignacio Bauza Acevedo")).toBe("joseignaciobauzaacevedo");
    expect(normalizePersonKey("JOSE IGNACIO BAUZA ACEVEDO")).toBe("joseignaciobauzaacevedo");
    expect(isInsuredClientName("X - ASEGURADO:Y")).toBe(true);
  });
});

