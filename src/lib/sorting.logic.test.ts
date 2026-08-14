import { describe, expect, it } from "vitest";
import {
  compareNaturalText,
  comparePriorityDesc,
  receiptSequenceForNumber,
} from "@/lib/sorting";

describe("semantic list sorting", () => {
  it("orders receipt numbers numerically without changing their display value", () => {
    const values = ["12", "1", "10", "2", "11", "9"];
    expect(values.toSorted((left, right) => compareNaturalText(left, right))).toEqual([
      "1",
      "2",
      "9",
      "10",
      "11",
      "12",
    ]);
    expect(receiptSequenceForNumber("REC-001")).toBe(1);
    expect(receiptSequenceForNumber("REC-12")).toBe(12);
    expect(receiptSequenceForNumber("sin-secuencia")).toBeNull();
  });

  it("keeps urgent work ahead of lower priorities", () => {
    expect(comparePriorityDesc("HIGH", "LOW")).toBeLessThan(0);
    expect(comparePriorityDesc("URGENT", "HIGH")).toBeLessThan(0);
    expect(comparePriorityDesc("LOW", "MEDIUM")).toBeGreaterThan(0);
  });
});
