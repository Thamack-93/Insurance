import { NextRequest, NextResponse } from "next/server";
import { logError } from "@/lib/logger";
import { getDb } from "@/lib/db";
import { checkDistributedRateLimit, getRequestIp, readJsonBody, securityFingerprint } from "@/lib/request-guards";
import { rateLimitResponse } from "@/lib/api-security";
import { recordSecurityEvent, SECURITY_EVENT_TYPES } from "@/lib/security-events";
import {
  isTelegramWebhookSecretValid,
  processTelegramWebhookUpdate,
  answerTelegramCallbackQuery,
  removeTelegramInlineKeyboard,
  sendTelegramMessage,
  type TelegramWebhookUpdate,
} from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasValidSecret(request: NextRequest) {
  return isTelegramWebhookSecretValid(request.headers.get("x-telegram-bot-api-secret-token"));
}

export async function GET() {
  return NextResponse.json(
    { ok: false, error: "Method not allowed" },
    {
      status: 405,
      headers: {
        Allow: "POST",
      },
    },
  );
}

export async function POST(request: NextRequest) {
  const ipFingerprint = securityFingerprint(`ip:${getRequestIp(request)}`);
  const rateLimit = await checkDistributedRateLimit(`telegram:webhook:${ipFingerprint}`, {
    limit: 60,
    windowMs: 60 * 1000,
    requireDistributed: true,
  });
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit, "Demasiadas peticiones al webhook.");

  if (!hasValidSecret(request)) {
    await recordSecurityEvent({
      alertType: SECURITY_EVENT_TYPES.invalidSecretTelegram,
      title: "Webhook de Telegram con secret inválido",
      description: "Se rechazó una petición al webhook de Telegram por firma inválida.",
      severity: "WARNING",
      entityType: "SecurityEvent",
      entityId: `telegram-webhook:invalid-secret:${ipFingerprint}`,
      fingerprint: `telegram-invalid-secret:${ipFingerprint}`,
    });
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let update: TelegramWebhookUpdate;
  try {
    update = await readJsonBody<TelegramWebhookUpdate>(request, 256 * 1024);
  } catch {
    await recordSecurityEvent({
      alertType: SECURITY_EVENT_TYPES.invalidPayload,
      title: "Webhook de Telegram con payload inválido",
      description: "Se rechazó un payload inválido antes de procesar el webhook.",
      severity: "WARNING",
      entityType: "SecurityEvent",
      entityId: `telegram-webhook:invalid-payload:${ipFingerprint}`,
      fingerprint: `telegram-invalid-payload:${ipFingerprint}`,
    });
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  try {
    if (!Number.isInteger(update.update_id) || update.update_id < 0) {
      return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
    }

    const db = getDb();
    try {
      await db.telegramWebhookUpdate.create({ data: { updateId: update.update_id } });
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        return NextResponse.json({ ok: true, duplicate: true });
      }
      throw error;
    }

    const result = await processTelegramWebhookUpdate(update);

    if (result.callbackQueryId) {
      const callbackReply = await answerTelegramCallbackQuery(result.callbackQueryId, result.callbackAnswerText);
      if (!callbackReply.ok) {
        logError("api.integrations.telegram.webhook.callback", new Error(callbackReply.error), {
          callbackQueryId: result.callbackQueryId,
        });
      }
    }

    if (result.removeReplyMarkup && result.chatId && update.callback_query?.message?.message_id) {
      const keyboardReply = await removeTelegramInlineKeyboard(
        result.chatId,
        update.callback_query.message.message_id,
      );
      if (!keyboardReply.ok) {
        logError("api.integrations.telegram.webhook.keyboard", new Error(keyboardReply.error), {
          chatId: result.chatId,
        });
      }
    }

    if (result.handled && result.replyText && result.chatId) {
      const reply = await sendTelegramMessage(result.chatId, result.replyText, result.replyMarkup);
      if (!reply.ok) {
        logError("api.integrations.telegram.webhook.reply", new Error(reply.error), {
          chatId: result.chatId,
        });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("api.integrations.telegram.webhook", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
