import { describe, expect, it } from "vitest";
import { getInsurerHref } from "@/lib/insurer-navigation";

describe("insurer navigation", () => {
  it("sends administrators to the insurer catalog", () => {
    expect(getInsurerHref("insurer-1", true)).toBe("/insurers/insurer-1");
  });

  it("sends agents to their filtered portfolio", () => {
    expect(getInsurerHref("insurer/1", false)).toBe("/portfolio?insurerId=insurer%2F1");
  });
});
