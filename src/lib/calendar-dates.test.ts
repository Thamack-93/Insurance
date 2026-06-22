import { describe, expect, it } from "vitest";
import {
  calendarDateInputValue,
  daysUntilCalendarDate,
  formatCalendarDate,
  isCalendarDateBeforeToday,
} from "./calendar-dates";

describe("calendar-dates", () => {
  it("treats YYYY-MM-DD strings as calendar dates instead of instants", () => {
    expect(formatCalendarDate("2026-05-28")).toBe("28/05/2026");
    expect(calendarDateInputValue("2026-05-28")).toBe("2026-05-28");
  });

  it("keeps calendar comparisons aligned with the visible date", () => {
    const reference = new Date("2026-05-28T05:59:59.000Z");

    expect(daysUntilCalendarDate("2026-05-28", reference)).toBe(0);
    expect(isCalendarDateBeforeToday("2026-05-28", reference)).toBe(false);
  });
});
