import { describe, expect, it } from "vitest";
import {
  birthdayAutomaticDedupeKey,
  buildBirthdayReminderMessage,
  calculateAge,
  isBirthdayToday,
} from "./birthday-reminders";

describe("birthday-reminders", () => {
  it("matches birthdays in CDMX and treats February 29 as February 28 in non-leap years", () => {
    expect(isBirthdayToday(new Date("1990-07-25T00:00:00Z"), new Date("2026-07-25T15:00:00Z"))).toBe(true);
    expect(isBirthdayToday(new Date("1992-02-29T00:00:00Z"), new Date("2025-02-28T15:00:00Z"))).toBe(true);
    expect(isBirthdayToday(new Date("1992-02-29T00:00:00Z"), new Date("2024-02-28T15:00:00Z"))).toBe(false);
  });

  it("calculates age, formats the grouped message, and deduplicates by local date", () => {
    const now = new Date("2026-07-25T15:00:00Z");
    expect(calculateAge(new Date("1990-07-25T00:00:00Z"), now)).toBe(36);
    const message = buildBirthdayReminderMessage([
      { id: "client-1", fullName: "Ana Pérez", birthDate: new Date("1990-07-25T00:00:00Z"), age: 36 },
    ], now);
    expect(message.body).toContain("Ana Pérez cumple 36 años");
    expect(birthdayAutomaticDedupeKey("user-1", now)).toContain("2026-07-25");
  });
});
