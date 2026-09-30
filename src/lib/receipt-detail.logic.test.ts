import { describe, expect, it, vi } from "vitest";
import {
  loadRequiredReceiptDetail,
  RECEIPT_DETAIL_AUXILIARY_GROUPS,
  resolveReceiptDetailAuxiliary,
} from "@/lib/receipt-detail";

describe("receipt detail loading resilience", () => {
  it.each(RECEIPT_DETAIL_AUXILIARY_GROUPS)("falls back and identifies a failed %s query", (group) => {
    const onRejected = vi.fn();
    const reason = new Error("database unavailable");

    const value = resolveReceiptDetailAuxiliary(group, { status: "rejected", reason }, [], onRejected);

    expect(value).toEqual([]);
    expect(onRejected).toHaveBeenCalledExactlyOnceWith(group, reason);
  });

  it("preserves fulfilled auxiliary data without logging a failure", () => {
    const onRejected = vi.fn();
    const rows = [{ id: "receipt-payment" }];

    const value = resolveReceiptDetailAuxiliary("payments", { status: "fulfilled", value: rows }, [], onRejected);

    expect(value).toBe(rows);
    expect(onRejected).not.toHaveBeenCalled();
  });

  it("logs and rethrows a required receipt read failure", async () => {
    const onRejected = vi.fn();
    const reason = new Error("required receipt read failed");

    await expect(loadRequiredReceiptDetail(() => Promise.reject(reason), onRejected)).rejects.toBe(reason);
    expect(onRejected).toHaveBeenCalledExactlyOnceWith(reason);
  });

  it("returns the required receipt read result unchanged", async () => {
    const onRejected = vi.fn();
    const receipt = { id: "receipt-1" };

    await expect(loadRequiredReceiptDetail(() => Promise.resolve(receipt), onRejected)).resolves.toBe(receipt);
    expect(onRejected).not.toHaveBeenCalled();
  });
});
