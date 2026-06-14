import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildTelegramHelpMessage,
  buildTelegramLinkErrorMessage,
  buildTelegramLinkSuccessMessage,
  buildTelegramStartMessage,
  buildTelegramStatusMessage,
  generateTelegramLinkCode,
  hashTelegramLinkCode,
  normalizeTelegramLinkCode,
  parseTelegramCommand,
} from "./telegram-shared";
import { parseTelegramPaymentArgument, parseTelegramPaymentDateInput } from "./telegram";

describe("telegram.shared", () => {
  it("generates a readable hex link code", () => {
    const code = generateTelegramLinkCode();

    expect(code).toMatch(/^[A-F0-9]{12}$/);
  });

  it("normalizes manual link codes before hashing", () => {
    expect(normalizeTelegramLinkCode(" ab-cd 12 ")).toBe("ABCD12");
    expect(hashTelegramLinkCode("ab-cd 12", "secret")).toBe(hashTelegramLinkCode("ABCD12", "secret"));
  });

  it("parses Telegram commands with optional bot usernames", () => {
    expect(parseTelegramCommand("/start")).toEqual({ command: "start", argument: null, raw: "/start" });
    expect(parseTelegramCommand("/help@PolicyDeskBot")).toEqual({
      command: "help",
      argument: null,
      raw: "/help@PolicyDeskBot",
    });
    expect(parseTelegramCommand("/link ABCD12")).toEqual({
      command: "link",
      argument: "ABCD12",
      raw: "/link ABCD12",
    });
    expect(parseTelegramCommand("hello")).toBeNull();
  });

  it("builds concise user-facing replies", () => {
    expect(buildTelegramStartMessage()).toContain("/link CÓDIGO");
    expect(buildTelegramHelpMessage()).toContain("/status");
    expect(buildTelegramLinkSuccessMessage()).toContain("Chat vinculado");
    expect(buildTelegramLinkErrorMessage("Código inválido")).toContain("Código inválido");
    expect(buildTelegramStatusMessage(true)).toContain("vinculado");
    expect(buildTelegramStatusMessage(true, false)).toContain("deshabilitados");
    expect(buildTelegramStatusMessage(false)).toContain("todavía no está vinculado");
  });

  it("parses payment drafts without an amount and accepts hoy as the payment date", () => {
    expect(parseTelegramPaymentDateInput("hoy")).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    expect(parseTelegramPaymentArgument("POL-123 REC-456 hoy TRANSFER")).toMatchObject({
      ok: true,
      state: {
        policyNumber: "POL-123",
        receiptNumber: "REC-456",
        paidDate: expect.any(String),
        paymentMethod: "TRANSFER",
        step: "ready",
      },
    });
  });

  it("allows the payment method to come before the date", () => {
    expect(parseTelegramPaymentArgument("POL-123 REC-456 TRANSFER 2026-06-14")).toMatchObject({
      ok: true,
      state: {
        policyNumber: "POL-123",
        receiptNumber: "REC-456",
        paidDate: "2026-06-14",
        paymentMethod: "TRANSFER",
        step: "ready",
      },
    });
  });
});
