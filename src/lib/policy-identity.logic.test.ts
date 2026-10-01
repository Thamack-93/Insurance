import { describe, expect, it } from "vitest";
import { getPolicyObjectDescription, getPolicyOptionLabel, policyObjectSearchTerms } from "@/lib/policy-identity";

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

  it("omits duplicate descriptions and reports when no description exists", () => {
    expect(getPolicyObjectDescription({
      insuredAssets: [
        { description: "Equipo médico", isPrimary: true },
        { description: " equipo MÉDICO " },
      ],
    })).toBe("Equipo médico");
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
