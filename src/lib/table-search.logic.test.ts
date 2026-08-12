import { describe, expect, it } from "vitest";

import {
  amountMatchWindow,
  normalizeSearchText,
  parseSearchAmount,
  parseSearchDate,
  parseSearchQuery,
  valueSearchVariants,
  variantsMatchQuery,
} from "./table-search";

describe("normalizeSearchText", () => {
  it("strips accents and case so 'Pólizas' matches 'polizas'", () => {
    expect(normalizeSearchText("  Pólizas   Vigentes ")).toBe("polizas vigentes");
  });
});

describe("parseSearchAmount", () => {
  it("reads amounts the way they are rendered", () => {
    expect(parseSearchAmount("$12,500")).toBe(12500);
    expect(parseSearchAmount("12,500.50")).toBe(12500.5);
    expect(parseSearchAmount("12500")).toBe(12500);
  });

  it("returns null for anything that is not an amount", () => {
    expect(parseSearchAmount("juan")).toBeNull();
    expect(parseSearchAmount("POL-2024")).toBeNull();
    expect(parseSearchAmount("")).toBeNull();
  });
});

describe("amountMatchWindow", () => {
  it("catches stored decimals that render as the searched integer", () => {
    const window = amountMatchWindow(12500);
    expect(12500.49).toBeGreaterThanOrEqual(window.gte);
    expect(12500.49).toBeLessThan(window.lt);
    expect(12501).not.toBeLessThan(window.lt);
  });
});

describe("parseSearchDate", () => {
  it("reads the dd/MM/yyyy form the app renders", () => {
    const range = parseSearchDate("05/03/2026");
    expect(range).not.toBeNull();
    expect(range!.to.getTime() - range!.from.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("reads ISO days and whole months", () => {
    expect(parseSearchDate("2026-03-05")).not.toBeNull();
    const march = parseSearchDate("03/2026");
    expect(march).not.toBeNull();
    expect(march!.to.getTime() - march!.from.getTime()).toBe(31 * 24 * 60 * 60 * 1000);
    expect(parseSearchDate("marzo 2026")).not.toBeNull();
  });

  it("rejects impossible and non-date text", () => {
    expect(parseSearchDate("45/13/2026")).toBeNull();
    expect(parseSearchDate("renovación")).toBeNull();
  });
});

describe("valueSearchVariants", () => {
  it("offers the grouped forms of a number", () => {
    const variants = valueSearchVariants(12500);
    expect(variants).toContain("12500");
    expect(variants.some((variant) => variant.includes("12,500"))).toBe(true);
  });

  it("offers the displayed forms of a date", () => {
    const variants = valueSearchVariants(new Date("2026-03-05T12:00:00.000Z"));
    expect(variants).toContain("2026-03-05");
    expect(variants).toContain("05/03/2026");
  });

  it("ignores empty values", () => {
    expect(valueSearchVariants(null)).toEqual([]);
    expect(valueSearchVariants("")).toEqual([]);
  });
});

describe("variantsMatchQuery", () => {
  it("finds an amount typed the way it is displayed", () => {
    const variants = valueSearchVariants(12500);
    expect(variantsMatchQuery(variants, parseSearchQuery("$12,500"))).toBe(true);
    expect(variantsMatchQuery(variants, parseSearchQuery("12500"))).toBe(true);
    expect(variantsMatchQuery(variants, parseSearchQuery("999"))).toBe(false);
  });

  it("finds a date typed the way it is displayed", () => {
    const variants = valueSearchVariants(new Date("2026-03-05T12:00:00.000Z"));
    expect(variantsMatchQuery(variants, parseSearchQuery("05/03/2026"))).toBe(true);
    expect(variantsMatchQuery(variants, parseSearchQuery("2026-03-05"))).toBe(true);
    expect(variantsMatchQuery(variants, parseSearchQuery("06/03/2026"))).toBe(false);
  });

  it("matches accented text without the accent", () => {
    expect(variantsMatchQuery(["Póliza de Automóvil"], parseSearchQuery("automovil"))).toBe(true);
  });

  it("matches everything when the query is empty", () => {
    expect(variantsMatchQuery([], parseSearchQuery("   "))).toBe(true);
  });
});

describe("parseSearchQuery", () => {
  it("classifies a query as text, amount or date", () => {
    expect(parseSearchQuery("$1,200").amount).toBe(1200);
    expect(parseSearchQuery("$1,200").date).toBeNull();
    expect(parseSearchQuery("01/02/2026").date).not.toBeNull();
    expect(parseSearchQuery("Juan Pérez").amount).toBeNull();
    expect(parseSearchQuery("Juan Pérez").text).toBe("juan perez");
  });
});
