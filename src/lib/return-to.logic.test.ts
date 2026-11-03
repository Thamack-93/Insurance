import { describe, expect, it } from "vitest";
import { appendReturnTo, normalizeReturnTo } from "./return-to";

describe("safe return navigation", () => {
  it("allows returning to the current bonus projection", () => {
    expect(normalizeReturnTo("/bonuses?run=run_123", "/receipts")).toBe("/bonuses?run=run_123");
    expect(appendReturnTo("/receipts/receipt_123", "/bonuses?run=run_123"))
      .toBe("/receipts/receipt_123?returnTo=%2Fbonuses%3Frun%3Drun_123");
  });

  it("rejects external return destinations", () => {
    expect(normalizeReturnTo("https://example.com/bonuses", "/receipts")).toBe("/receipts");
  });

  it("preserves a filtered Data Quality review queue as a safe return destination", () => {
    const queue = "/data-quality?tab=revisiones&q=POL-123&page=2";
    expect(normalizeReturnTo(queue, "/receipts")).toBe(queue);
    expect(appendReturnTo("/receipts/receipt_123/edit", queue))
      .toBe("/receipts/receipt_123/edit?returnTo=%2Fdata-quality%3Ftab%3Drevisiones%26q%3DPOL-123%26page%3D2");
  });
});
