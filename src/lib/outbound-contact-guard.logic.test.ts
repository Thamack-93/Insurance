import { describe, expect, it } from "vitest";

import { isSyntheticOutboundPhone } from "./outbound-contact-guard";

describe("synthetic outbound phone guard", () => {
  it.each([
    "5555555555",
    "+52 5555555555",
    "0000000000",
    "+52 0000000000",
    "5210000000000",
  ])("blocks demo phone %s", (phone) => {
    expect(isSyntheticOutboundPhone(phone)).toBe(true);
  });

  it("keeps a real Mexican phone eligible", () => {
    expect(isSyntheticOutboundPhone("+52 55 1234 5678")).toBe(false);
  });
});
