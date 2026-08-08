import { describe, expect, it } from "vitest";
import { notificationLink } from "@/lib/notifications-shared";

describe("notification links", () => {
  it("keeps insurer catalog links for administrators", () => {
    expect(notificationLink("Insurer", "insurer-1", true)).toBe("/insurers/insurer-1");
  });

  it("routes agent insurer notifications to the filtered portfolio", () => {
    expect(notificationLink("Insurer", "insurer/1", false)).toBe("/portfolio?insurerId=insurer%2F1");
  });
});
