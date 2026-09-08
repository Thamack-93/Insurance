import { describe, expect, it } from "vitest";

import { buildWhatsAppAppUrl, isMobileWhatsAppDevice } from "./renewal-whatsapp-client";

describe("renewal WhatsApp desktop handoff", () => {
  it("builds the application URL only from a safe wa.me URL", () => {
    expect(buildWhatsAppAppUrl("https://wa.me/525512345678?text=Hola%20Ana")).toBe("whatsapp://send?phone=525512345678&text=Hola%20Ana");
  });

  it.each([
    "http://wa.me/525512345678?text=Hola",
    "https://example.com/525512345678?text=Hola",
    "https://user:pass@wa.me/525512345678?text=Hola",
    "https://wa.me:443/525512345678?text=Hola",
    "https://wa.me/525512345678?text=Hola&extra=1",
    "https://wa.me/525512345678?text=Hola#fragment",
  ])("rejects unsafe web URL %s", (value) => {
    expect(buildWhatsAppAppUrl(value)).toBeNull();
  });
});

describe("renewal WhatsApp device selection", () => {
  it("uses the mobile flow for iPhone, Android and iPadOS", () => {
    expect(isMobileWhatsAppDevice({ userAgent: "iPhone", platform: "iPhone" })).toBe(true);
    expect(isMobileWhatsAppDevice({ userAgent: "Android", platform: "Linux" })).toBe(true);
    expect(isMobileWhatsAppDevice({ userAgent: "Mozilla/5.0 Macintosh", platform: "MacIntel", maxTouchPoints: 5 })).toBe(true);
  });

  it("uses the desktop flow for a regular Mac", () => {
    expect(isMobileWhatsAppDevice({ userAgent: "Mozilla/5.0 Macintosh", platform: "MacIntel", maxTouchPoints: 0 })).toBe(false);
  });
});
