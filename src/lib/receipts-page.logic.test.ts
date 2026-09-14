import { describe, expect, it, vi } from "vitest";
import { isReceiptQualitasEnabled, resolveReceiptAuxiliary } from "@/lib/receipts-page";

describe("receipt page resilience", () => {
  it("uses the auxiliary fallback and reports the rejected query", () => {
    const onRejected = vi.fn();
    const reason = new Error("database unavailable");

    const value = resolveReceiptAuxiliary({ status: "rejected", reason }, "fallback", onRejected);

    expect(value).toBe("fallback");
    expect(onRejected).toHaveBeenCalledWith(reason);
  });

  it("preserves fulfilled auxiliary data without reporting an error", () => {
    const onRejected = vi.fn();

    const value = resolveReceiptAuxiliary({ status: "fulfilled", value: ["payment"] }, [], onRejected);

    expect(value).toEqual(["payment"]);
    expect(onRejected).not.toHaveBeenCalled();
  });

  it.each([
    [{ enabled: false }, true, false],
    [null, true, false],
    [{ enabled: true }, false, false],
    [{ enabled: true }, true, true],
  ])("fails closed for Quálitas capability %j with global flag %s", (capability, globalFlag, expected) => {
    expect(isReceiptQualitasEnabled(capability, globalFlag)).toBe(expected);
  });
});
