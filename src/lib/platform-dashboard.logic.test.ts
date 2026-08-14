import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getPlatformHealth, normalizePlatformPage, normalizePlatformStatus } from "@/lib/platform-dashboard";

describe("platform dashboard helpers", () => {
  it("normalizes safe pages and rejects invalid statuses", () => {
    expect(normalizePlatformPage("2")).toBe(2);
    expect(normalizePlatformPage("0")).toBe(1);
    expect(normalizePlatformPage("not-a-page")).toBe(1);
    expect(normalizePlatformStatus("ACTIVE")).toBe("ACTIVE");
    expect(normalizePlatformStatus("DELETE_ALL")).toBeUndefined();
  });

  it("reports deterministic organization health", () => {
    expect(getPlatformHealth({ status: "ACTIVE", activeMemberCount: 2, activeOwnerCount: 1 })).toEqual([]);
    expect(getPlatformHealth({ status: "ACTIVE", activeMemberCount: 0, activeOwnerCount: 0 })).toEqual(["NO_ACTIVE_OWNER", "NO_ACTIVE_MEMBERS"]);
    expect(getPlatformHealth({ status: "SUSPENDED", activeMemberCount: 2, activeOwnerCount: 1 })).toEqual(["INACTIVE_WITH_ACTIVE_MEMBERS"]);
  });
});
