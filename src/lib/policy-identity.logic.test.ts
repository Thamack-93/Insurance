import { describe, expect, it } from "vitest";
import { cleanPolicyObjectDescription, getPolicyObjectDescription, getPolicyOptionLabel, policyObjectSearchTerms } from "@/lib/policy-identity";

describe("getPolicyObjectDescription", () => {
  it("prefers the generic insured object when present", () => {
    expect(getPolicyObjectDescription({
      insuredObject: "  Oficina en renta ",
      insuredAssets: [{ description: "Edificio principal", isPrimary: true }],
    })).toBe("Oficina en renta");
  });

  it("falls back to the primary asset description", () => {
    expect(getPolicyObjectDescription({
      insuredAssets: [
        { description: "Equipo secundario" },
        { description: "Camión de reparto", isPrimary: true },
      ],
    })).toBe("Camión de reparto y 1 más");
  });

  it("cleans registry-style vehicle text and removes non-descriptive fragments", () => {
    expect(cleanPolicyObjectDescription("BUICK, ENCORE, 2016, LEATHERETTE N 5"))
      .toBe("Buick Encore · 2016 · Leatherette N 5");
    expect(cleanPolicyObjectDescription("MAZDA, CX7, 2009, GRAND TOURING 4X · Modelo 2009 · Serie 1G123"))
      .toBe("Mazda CX7 · 2009 · Grand Touring 4X · Serie 1G123");
    expect(getPolicyObjectDescription({
      insuredObject: "NO ESPECIFICADA, NO ESPECIFICADA, ...",
      insuredAssets: [{ description: "MAZDA, CX7, 2009, GRAND TOURING 4X", isPrimary: true }],
    })).toBe("Mazda CX7 · 2009 · Grand Touring 4X");
  });

  it("omits duplicate descriptions and reports when no description exists", () => {
    expect(getPolicyObjectDescription({
      insuredAssets: [
        { description: "Equipo médico", isPrimary: true },
        { description: " equipo MÉDICO " },
      ],
    })).toBe("Equipo médico");
    expect(getPolicyObjectDescription({ insuredObject: "NO ESPECIFICADA, NO ESPECIFICADO" }))
      .toBe("Sin objeto asegurado descrito");
    expect(getPolicyObjectDescription({ insuredObject: "  ", insuredAssets: [] })).toBe("Sin objeto asegurado descrito");
  });

  it("uses descriptions in policy options and list search", () => {
    expect(getPolicyOptionLabel({ policyNumber: "POL-15", insuredObject: "Local comercial" }, ["Cliente Uno"]))
      .toBe("POL-15 · Local comercial · Cliente Uno");
    expect(policyObjectSearchTerms("local")).toEqual([
      { insuredObject: { contains: "local", mode: "insensitive" } },
      { insuredAssets: { some: { description: { contains: "local", mode: "insensitive" } } } },
    ]);
  });
});
