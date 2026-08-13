import { describe, expect, it } from "vitest";
import { buildCanonicalHref } from "./navigation-redirects";

describe("canonical navigation redirects", () => {
  it("preserves unrelated query parameters while forcing the canonical view", () => {
    expect(buildCanonicalHref(
      "/today",
      { q: "renovación", view: "old", page: "2" },
      { view: "insights" },
    )).toBe("/today?q=renovaci%C3%B3n&page=2&view=insights");
  });

  it("does not duplicate a forced parameter", () => {
    expect(buildCanonicalHref(
      "/operations",
      { view: "claims", q: "cliente" },
      { view: "renewals" },
    )).toBe("/operations?q=cliente&view=renewals");
  });
});
