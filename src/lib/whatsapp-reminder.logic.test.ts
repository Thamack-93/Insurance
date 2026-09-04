import { describe, expect, it } from "vitest";
import {
  buildReceiptDueMessage,
  buildWhatsAppReminderUrl,
  isSafeWhatsAppReminderUrl,
  selectWhatsAppPhone,
} from "./whatsapp-reminder";

describe("manual WhatsApp receipt reminders", () => {
  it("normalizes and selects primary, then secondary, then captured", () => {
    expect(selectWhatsAppPhone({ primary: "55 9876 5432", secondary: "81 1234 5678" })).toEqual({
      normalized: "+525598765432",
      source: "PRIMARY",
    });
    expect(selectWhatsAppPhone({ primary: "bad", secondary: "+52 81 1234 5678" })).toEqual({
      normalized: "+528112345678",
      source: "SECONDARY",
    });
    expect(selectWhatsAppPhone({ primary: "bad", secondary: "also bad", captured: "55-9876-5432" })).toEqual({
      normalized: "+525598765432",
      source: "CAPTURED",
    });
    expect(selectWhatsAppPhone({ primary: "123", secondary: null })).toBeNull();
  });

  it("builds the exact safe wa.me URL without an unencoded message", () => {
    const message = "Hola, Ana.\n\nVence hoy por $1,200.00.";
    const url = buildWhatsAppReminderUrl("+52 55 1234 5678", message);
    expect(url).toBe(`https://wa.me/525512345678?text=${encodeURIComponent(message)}`);
    expect(isSafeWhatsAppReminderUrl(url)).toBe(true);
    expect(isSafeWhatsAppReminderUrl("http://wa.me/525512345678?text=x")).toBe(false);
    expect(isSafeWhatsAppReminderUrl("https://example.com/525512345678")).toBe(false);
  });

  it("uses the original amount, insurer, policy suffix, and due-date wording", () => {
    const base = {
      clientName: "Ana Pérez",
      insurerName: "Aseguradora Demo",
      policyNumber: "POLIZA-123456",
      amount: 1200,
      currency: "MXN",
    };

    expect(buildReceiptDueMessage({ ...base, dueDate: "2026-08-31", now: "2026-08-31" })).toContain("vence hoy");
    expect(buildReceiptDueMessage({ ...base, dueDate: "2026-09-01", now: "2026-08-31" })).toContain("vence el");
    expect(buildReceiptDueMessage({ ...base, dueDate: "2026-08-30", now: "2026-08-31" })).toContain("venció el");

    const message = buildReceiptDueMessage({ ...base, dueDate: "2026-08-31", now: "2026-08-31" });
    expect(message).toContain("Aseguradora Demo");
    expect(message).toContain("••••3456");
    expect(message).toContain("$1,200");
    expect(message).not.toContain("POLIZA-123456");
    expect(message).not.toContain("recibo-");
  });
});
