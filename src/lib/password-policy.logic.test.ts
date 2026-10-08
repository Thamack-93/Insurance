import { describe, expect, it } from "vitest";
import { isTemporaryPasswordExpired, temporaryPasswordExpiresAt, TEMPORARY_PASSWORD_TTL_MS } from "./password-policy";

describe("temporary password expiry", () => {
  const now = new Date("2026-10-07T12:00:00.000Z");

  it("expires exactly at its 24-hour deadline while a password change is required", () => {
    const expiresAt = temporaryPasswordExpiresAt(now);
    expect(expiresAt.getTime()).toBe(now.getTime() + TEMPORARY_PASSWORD_TTL_MS);
    expect(isTemporaryPasswordExpired(true, expiresAt, expiresAt)).toBe(true);
    expect(isTemporaryPasswordExpired(true, expiresAt, new Date(expiresAt.getTime() - 1))).toBe(false);
  });

  it("does not expire a permanent credential or a user without an expiry", () => {
    expect(isTemporaryPasswordExpired(false, new Date(0), now)).toBe(false);
    expect(isTemporaryPasswordExpired(true, null, now)).toBe(false);
  });
});
