import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  buildTelegramHelpMessage,
  buildTelegramLinkErrorMessage,
  buildTelegramLinkSuccessMessage,
  buildTelegramPaymentDraftMessage,
  buildTelegramStartMessage,
  buildTelegramStatusMessage,
  generateTelegramLinkCode,
  hashTelegramLinkCode,
  normalizeTelegramLinkCode,
  parseTelegramCommand,
} from "./telegram-shared";
import {
  getTelegramWebhookUrl,
  syncTelegramWebhook,
  parseTelegramPaymentArgument,
  parseTelegramPaymentDateInput,
} from "./telegram";

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
    expect(parseTelegramCommand("/ayuda")).toEqual({ command: "ayuda", argument: null, raw: "/ayuda" });
    expect(parseTelegramCommand("/help@PolicyDeskBot")).toEqual({
      command: "help",
      argument: null,
      raw: "/help@PolicyDeskBot",
    });
    expect(parseTelegramCommand("/resumen")).toEqual({ command: "resumen", argument: null, raw: "/resumen" });
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
    expect(buildTelegramHelpMessage()).toContain("/buscar <texto>");
    expect(buildTelegramHelpMessage()).toContain("/resumen");
    expect(buildTelegramLinkSuccessMessage()).toContain("Chat vinculado");
    expect(buildTelegramLinkErrorMessage("Código inválido")).toContain("Código inválido");
    expect(
      buildTelegramPaymentDraftMessage({
        policyNumber: "940453041",
        receiptNumber: "1",
        originLabel: "Endoso 2",
        clientName: "Mariano Martinez Grayeb",
        amount: "$7,294.00",
        paymentMethod: "TRANSFER",
        paidDate: "12/06/2026",
      }),
    ).toContain("Origen: Endoso 2");
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

  it("builds the webhook url from an explicit base url", () => {
    expect(getTelegramWebhookUrl("https://example.com")).toBe(
      "https://example.com/api/integrations/telegram/webhook",
    );
  });

  it("syncs the webhook with Telegram using the current domain", async () => {
    const originalFetch = global.fetch;
    const originalBotToken = process.env.TELEGRAM_BOT_TOKEN;
    const originalWebhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    process.env.TELEGRAM_BOT_TOKEN = "bot-token";
    process.env.TELEGRAM_WEBHOOK_SECRET = "webhook-secret";
    global.fetch = fetchMock as typeof fetch;

    try {
      await expect(syncTelegramWebhook("https://example.com")).resolves.toMatchObject({
        ok: true,
        webhookUrl: "https://example.com/api/integrations/telegram/webhook",
      });
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.telegram.org/botbot-token/setWebhook",
        expect.objectContaining({
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            url: "https://example.com/api/integrations/telegram/webhook",
            secret_token: "webhook-secret",
            drop_pending_updates: false,
          }),
        }),
      );
    } finally {
      global.fetch = originalFetch;
      if (originalBotToken === undefined) {
        delete process.env.TELEGRAM_BOT_TOKEN;
      } else {
        process.env.TELEGRAM_BOT_TOKEN = originalBotToken;
      }
      if (originalWebhookSecret === undefined) {
        delete process.env.TELEGRAM_WEBHOOK_SECRET;
      } else {
        process.env.TELEGRAM_WEBHOOK_SECRET = originalWebhookSecret;
      }
    }
  });
});
