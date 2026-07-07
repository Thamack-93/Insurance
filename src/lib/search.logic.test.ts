import { describe, expect, it } from "vitest";
import { formatPolicyStatusLabel, formatPolicyValidity } from "@/lib/search";

describe("search policy helpers", () => {
  it("formats policy status labels without leaking undefined", () => {
    expect(formatPolicyStatusLabel("ACTIVE")).toBe("Activa");
    expect(formatPolicyStatusLabel(undefined)).toBe("Sin estado");
  });

  it("formats policy validity for search results", () => {
    expect(formatPolicyValidity(new Date("2026-07-06T00:00:00.000Z"), new Date("2027-07-06T00:00:00.000Z"))).toContain(
      "Vigencia",
    );
  });
});
