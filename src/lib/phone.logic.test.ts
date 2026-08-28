import { describe, expect, it } from "vitest";
import { isValidMexicanPhone, maskMexicanPhone, normalizeMexicanPhone } from "./phone";

describe("Mexican phone profile value", () => {
  it("stores a canonical +52 value from local or international input", () => {
    expect(normalizeMexicanPhone("55 1234 5678")).toBe("+525512345678");
    expect(normalizeMexicanPhone("+52 55 1234 5678")).toBe("+525512345678");
  });

  it("rejects invalid values and masks the stored number", () => {
    expect(normalizeMexicanPhone("12345")).toBeNull();
    expect(isValidMexicanPhone("+52 55 1234 5678")).toBe(true);
    expect(maskMexicanPhone("+52 55 1234 5678")).toBe("••••••5678");
  });
});
