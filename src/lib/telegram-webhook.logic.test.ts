import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createUpdate: vi.fn(),
  checkDistributedRateLimit: vi.fn(),
  processTelegramWebhookUpdate: vi.fn(),
  sendTelegramMessage: vi.fn(),
  isTelegramWebhookSecretValid: vi.fn(),
  recordSecurityEvent: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ getDb: () => ({ telegramWebhookUpdate: { create: mocks.createUpdate } }) }));
vi.mock("@/lib/request-guards", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/request-guards")>();
  return {
    ...actual,
    checkDistributedRateLimit: mocks.checkDistributedRateLimit,
    securityFingerprint: (value: string) => `fingerprint:${value}`,
  };
});
vi.mock("@/lib/api-security", () => ({
  rateLimitResponse: () => Response.json({ ok: false }, { status: 429 }),
}));
vi.mock("@/lib/security-events", () => ({
  recordSecurityEvent: mocks.recordSecurityEvent,
  SECURITY_EVENT_TYPES: { invalidSecretTelegram: "INVALID_SECRET", invalidPayload: "INVALID_PAYLOAD" },
}));
vi.mock("@/lib/logger", () => ({ logError: mocks.logError }));
vi.mock("@/lib/telegram", () => ({
  isTelegramWebhookSecretValid: mocks.isTelegramWebhookSecretValid,
  processTelegramWebhookUpdate: mocks.processTelegramWebhookUpdate,
  answerTelegramCallbackQuery: vi.fn(),
  removeTelegramInlineKeyboard: vi.fn(),
  sendTelegramMessage: mocks.sendTelegramMessage,
}));

import { NextRequest } from "next/server";
import { POST } from "../app/api/integrations/telegram/webhook/route";

function webhookRequest(update: unknown, secret = "test-webhook-secret") {
  return new NextRequest("https://policydesk.test/api/integrations/telegram/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": secret,
      "x-real-ip": "192.0.2.10",
    },
    body: JSON.stringify(update),
  });
}

describe("Telegram webhook contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PLATFORM_TELEGRAM_ENABLED;
    mocks.checkDistributedRateLimit.mockResolvedValue({ allowed: true, remaining: 59, retryAfterMs: 0, backend: "distributed" });
    mocks.isTelegramWebhookSecretValid.mockImplementation((secret: string | null) => secret === "test-webhook-secret");
    mocks.createUpdate.mockResolvedValue({ updateId: 7001 });
    mocks.processTelegramWebhookUpdate.mockResolvedValue({
      handled: true,
      chatId: "chat-test-42",
      replyText: "PolicyDesk está listo",
    });
    mocks.sendTelegramMessage.mockResolvedValue({ ok: true, messageId: 19 });
    mocks.recordSecurityEvent.mockResolvedValue(null);
  });

  it("accepts a valid update, records its idempotency key, and requests the expected reply", async () => {
    const update = { update_id: 7001, message: { text: "/start", chat: { id: 42 } } };

    const response = await POST(webhookRequest(update));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.createUpdate).toHaveBeenCalledWith({ data: { updateId: 7001 } });
    expect(mocks.processTelegramWebhookUpdate).toHaveBeenCalledWith(update);
    expect(mocks.sendTelegramMessage).toHaveBeenCalledWith("chat-test-42", "PolicyDesk está listo", undefined);
    expect(mocks.logError).not.toHaveBeenCalled();
  });

  it("does not process or reply to a duplicate update", async () => {
    mocks.createUpdate.mockRejectedValue({ code: "P2002" });

    const response = await POST(webhookRequest({ update_id: 7001 }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, duplicate: true });
    expect(mocks.processTelegramWebhookUpdate).not.toHaveBeenCalled();
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
  });

  it("rejects an invalid webhook secret before storing or processing the update", async () => {
    const response = await POST(webhookRequest({ update_id: 7002 }, "wrong-secret"));

    expect(response.status).toBe(401);
    expect(mocks.createUpdate).not.toHaveBeenCalled();
    expect(mocks.processTelegramWebhookUpdate).not.toHaveBeenCalled();
    expect(mocks.sendTelegramMessage).not.toHaveBeenCalled();
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.objectContaining({ alertType: "INVALID_SECRET" }));
  });
});
