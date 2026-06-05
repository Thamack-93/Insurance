import { describe, expect, it } from "vitest";
import {
  comparePriority,
  getLocalDateKey,
  notificationEventCatalog,
  isDigestHourDue,
  shouldNotifyFromState,
} from "./notification-foundation";

describe("notification-foundation", () => {
  it("respects channel, preference, and priority thresholds", () => {
    expect(
      shouldNotifyFromState({
        priority: "URGENT",
        minPriority: "HIGH",
        channelEnabled: true,
        preferenceEnabled: true,
      }),
    ).toBe(true);

    expect(
      shouldNotifyFromState({
        priority: "MEDIUM",
        minPriority: "HIGH",
        channelEnabled: true,
        preferenceEnabled: true,
      }),
    ).toBe(false);

    expect(
      shouldNotifyFromState({
        priority: "URGENT",
        minPriority: "LOW",
        channelEnabled: false,
        preferenceEnabled: true,
      }),
    ).toBe(false);
  });

  it("derives local schedule keys and matching hours", () => {
    expect(getLocalDateKey(new Date("2024-06-15T16:30:00Z"), "UTC")).toBe("2024-06-15");
    expect(isDigestHourDue(new Date("2024-06-15T08:15:00Z"), 8, "UTC")).toBe(true);
    expect(isDigestHourDue(new Date("2024-06-15T09:15:00Z"), 8, "UTC")).toBe(false);
  });

  it("exposes the default notification catalog in the expected order", () => {
    expect(notificationEventCatalog.map((item) => item.eventType)).toEqual([
      "TEST_MESSAGE",
      "DAILY_DIGEST",
    ]);
    expect(comparePriority("URGENT", "HIGH")).toBeGreaterThan(0);
  });
});
