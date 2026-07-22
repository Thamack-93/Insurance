import { describe, expect, it } from "vitest";
import { addDays } from "date-fns";
import { NON_PAYMENT_CANCELLATION_DAYS } from "./nonpayment-cancellation.logic";

describe("non-payment cancellation policy", () => {
  const dueDate = new Date("2026-01-01T06:00:00.000Z");

  it("does not reach the cutoff on day 65", () => {
    const now = addDays(dueDate, NON_PAYMENT_CANCELLATION_DAYS);
    expect(dueDate < addDays(now, -NON_PAYMENT_CANCELLATION_DAYS)).toBe(false);
  });

  it("reaches the cutoff on day 66", () => {
    const now = addDays(dueDate, NON_PAYMENT_CANCELLATION_DAYS + 1);
    expect(dueDate < addDays(now, -NON_PAYMENT_CANCELLATION_DAYS)).toBe(true);
  });
});
