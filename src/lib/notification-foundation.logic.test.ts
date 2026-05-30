import { describe, expect, it } from "vitest";
import {
  comparePriority,
  isWithinQuietHours,
  notificationEventCatalog,
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

  it("detects quiet hours ranges, including overnight windows", () => {
    expect(isWithinQuietHours(new Date("2024-06-15T16:30:00Z"), "22:00", "07:00", "UTC")).toBe(
      false,
    );
    expect(isWithinQuietHours(new Date("2024-06-15T23:30:00Z"), "22:00", "07:00", "UTC")).toBe(
      true,
    );
    expect(isWithinQuietHours(new Date("2024-06-15T03:30:00Z"), "22:00", "07:00", "UTC")).toBe(
      true,
    );
  });

  it("exposes the default notification catalog in the expected order", () => {
    expect(notificationEventCatalog.map((item) => item.eventType)).toEqual([
      "TEST_MESSAGE",
      "DAILY_DIGEST",
      "URGENT_WORKITEM_ASSIGNED",
      "CRITICAL_RENEWAL",
      "OVERDUE_RECEIPT",
    ]);
    expect(comparePriority("URGENT", "HIGH")).toBeGreaterThan(0);
  });
});
