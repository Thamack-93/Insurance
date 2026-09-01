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
  buildTelegramDailyDigestMessages,
} from "./telegram";
import {
  buildTelegramQualitasConfirmation,
  buildTelegramQualitasOutcomeMessage,
  buildTelegramQualitasRecipientPrompt,
  buildTelegramQualitasSuccess,
  buildTelegramQualitasUnavailableMessage,
} from "./telegram-shared";
import {
  isQualitasInsurerName,
  isQualitasPaymentLinkEnabled,
  isValidQualitasEmail,
  maskQualitasEmail,
  normalizeQualitasProviderOutcome,
  prepareQualitasPaymentLink,
  requestQualitasPaymentLink,
} from "./qualitas-payment-link";

describe("telegram.shared", () => {
  it("adds the collections action to the summary and uses a 30-day renewal window label", () => {
    const empty = { total: 0, items: [] };
    const messages = buildTelegramDailyDigestMessages({
      dayStart: new Date("2026-08-31T06:00:00.000Z"),
      timeZone: "America/Mexico_City",
      overdueReceipts: empty,
      todayReceipts: empty,
      upcomingReceipts: empty,
      upcomingRenewals: empty,
      pendingWorkItems: empty as never,
      commissions: empty,
    });

    expect(messages[0]?.body).toContain("Renovaciones 30 días: 0 pólizas");
    expect(messages[0]?.replyMarkup).toEqual({
      inline_keyboard: [[{ text: "Gestionar cobros", callback_data: "digest_manage_receipts" }]],
    });
    expect(messages.slice(1).every((message) => !message.replyMarkup)).toBe(true);
  });

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
    expect(parseTelegramCommand("/pagoqualitas 1234567890")).toEqual({
      command: "pagoqualitas",
      argument: "1234567890",
      raw: "/pagoqualitas 1234567890",
    });
    expect(parseTelegramCommand("/pagoqualitas@PolicyDeskBot 1234567890")).toMatchObject({
      command: "pagoqualitas",
      argument: "1234567890",
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
    expect(buildTelegramHelpMessage()).toContain("/buscar <texto>");
    expect(buildTelegramHelpMessage()).toContain("/resumen");
    expect(buildTelegramHelpMessage()).toContain("/pagoqualitas <póliza>");
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

  it("builds the Quálitas recipient and confirmation messages without exposing full emails", () => {
    const recipient = buildTelegramQualitasRecipientPrompt({
      clientEmail: "j***@correo.com",
      agentEmail: "p***@correo.com",
    });
    expect(recipient).toContain("Cliente: j***@correo.com");
    expect(recipient).toContain("Agente: p***@correo.com");
    expect(recipient).not.toContain("juan");

    expect(buildTelegramQualitasConfirmation({
      policyNumber: "1234567890",
      clientName: "Juan Pérez",
      recipientLabel: "Cliente",
      maskedEmail: "j***@correo.com",
    })).toContain("/confirmar");
    expect(buildTelegramQualitasSuccess({
      policyNumber: "1234567890",
      recipientLabel: "Agente",
      maskedEmail: "p***@correo.com",
    })).toContain("•••7890");
    expect(buildTelegramQualitasUnavailableMessage()).toMatch(/no está disponible/i);
    expect(buildTelegramQualitasOutcomeMessage("UNCERTAIN", "DUPLICATE_LINK_99991")).toContain("ya hay otra liga de pago en proceso");
    expect(buildTelegramQualitasOutcomeMessage("UNCERTAIN", "FINAL_RESPONSE_UNRECOGNIZED")).toContain("no reconoció el acuse");
    expect(buildTelegramQualitasOutcomeMessage("UNCERTAIN", "FINAL_TIMEOUT")).toContain("antes del límite");
    expect(buildTelegramQualitasOutcomeMessage("QUALITAS_FLOW_CHANGED", "FLOW_CHANGED")).toContain("portal de Quálitas cambió");
  });

  it("uses exact Quálitas insurer identity and validates recipient emails", () => {
    expect(isQualitasInsurerName("Quálitas Compañía de Seguros, S.A. de C.V.")).toBe(true);
    expect(isQualitasInsurerName("Qualitas")).toBe(true);
    expect(isQualitasInsurerName("Qualitas Brokerage")).toBe(false);
    expect(isValidQualitasEmail("agent@example.com")).toBe(true);
    expect(isValidQualitasEmail("not-an-email")).toBe(false);
    expect(maskQualitasEmail("pedro@example.com")).toBe("p***@example.com");
  });

  it("keeps the Quálitas feature flag fail-closed", () => {
    const original = process.env.QUALITAS_PAYMENT_LINK_ENABLED;
    try {
      for (const value of [undefined, "", "false", "1", "TRUE", "invalid"]) {
        if (value === undefined) delete process.env.QUALITAS_PAYMENT_LINK_ENABLED;
        else process.env.QUALITAS_PAYMENT_LINK_ENABLED = value;
        expect(isQualitasPaymentLinkEnabled()).toBe(false);
      }
      process.env.QUALITAS_PAYMENT_LINK_ENABLED = "true";
      expect(isQualitasPaymentLinkEnabled()).toBe(true);
    } finally {
      if (original === undefined) delete process.env.QUALITAS_PAYMENT_LINK_ENABLED;
      else process.env.QUALITAS_PAYMENT_LINK_ENABLED = original;
    }
  });

  it("normalizes provider outcomes and keeps the feature flag fail-closed", async () => {
    expect(normalizeQualitasProviderOutcome({ status: 404, bodyText: "policy not found" })).toBe("POLICY_NOT_FOUND");
    expect(normalizeQualitasProviderOutcome({ status: 429 })).toBe("PROVIDER_UNAVAILABLE");
    expect(normalizeQualitasProviderOutcome({ timedOut: true })).toBe("TIMEOUT_PRE_SUBMISSION");
    expect(normalizeQualitasProviderOutcome({ timedOut: true, finalSubmission: true })).toBe("UNCERTAIN_POST_SUBMISSION");
    expect(normalizeQualitasProviderOutcome({ redirectedToUnexpectedHost: true })).toBe("PROVIDER_FLOW_CHANGED");

    const prepared = await prepareQualitasPaymentLink({ policyNumber: "", deliveryChannel: "EMAIL", destination: "agent@example.com", correlationId: "test-correlation" });
    expect(prepared).toEqual({ outcome: "UNEXPECTED_RESPONSE", reason: "INVALID_INPUT" });
    expect(requestQualitasPaymentLink).toBeTypeOf("function");
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

  it("builds the webhook url only from APP_BASE_URL", () => {
    const originalBaseUrl = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = "https://example.com";
    try {
      expect(getTelegramWebhookUrl()).toBe("https://example.com/api/integrations/telegram/webhook");
    } finally {
      if (originalBaseUrl === undefined) delete process.env.APP_BASE_URL;
      else process.env.APP_BASE_URL = originalBaseUrl;
    }
  });

  it("rejects a missing or insecure Production APP_BASE_URL", () => {
    const originalBaseUrl = process.env.APP_BASE_URL;
    const originalNodeEnv = process.env.NODE_ENV;
    const mutableEnv = process.env as Record<string, string | undefined>;
    Object.assign(mutableEnv, { NODE_ENV: "production", APP_BASE_URL: "http://example.com" });
    try {
      expect(getTelegramWebhookUrl()).toBeNull();
      process.env.APP_BASE_URL = "https://example.com/untrusted-path";
      expect(getTelegramWebhookUrl()).toBeNull();
      delete process.env.APP_BASE_URL;
      expect(getTelegramWebhookUrl()).toBeNull();
    } finally {
      if (originalBaseUrl === undefined) delete process.env.APP_BASE_URL;
      else process.env.APP_BASE_URL = originalBaseUrl;
      if (originalNodeEnv === undefined) delete mutableEnv.NODE_ENV;
      else mutableEnv.NODE_ENV = originalNodeEnv;
    }
  });

  it("syncs the webhook with Telegram using the current domain", async () => {
    const originalFetch = global.fetch;
    const originalBotToken = process.env.TELEGRAM_BOT_TOKEN;
    const originalWebhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
    const originalBaseUrl = process.env.APP_BASE_URL;
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });

    process.env.TELEGRAM_BOT_TOKEN = "bot-token";
    process.env.TELEGRAM_WEBHOOK_SECRET = "webhook-secret";
    process.env.APP_BASE_URL = "https://example.com";
    global.fetch = fetchMock as typeof fetch;

    try {
      await expect(syncTelegramWebhook()).resolves.toMatchObject({
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
      if (originalBaseUrl === undefined) delete process.env.APP_BASE_URL;
      else process.env.APP_BASE_URL = originalBaseUrl;
    }
  });
});
