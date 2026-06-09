import { NextRequest, NextResponse } from "next/server";
import { logError } from "@/lib/logger";
import { getRequestIp } from "@/lib/request-guards";
import { recordSecurityEvent, SECURITY_EVENT_TYPES } from "@/lib/security-events";
import {
  isTelegramWebhookSecretValid,
  processTelegramWebhookUpdate,
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
  if (!hasValidSecret(request)) {
    await recordSecurityEvent({
      alertType: SECURITY_EVENT_TYPES.invalidSecretTelegram,
      title: "Webhook de Telegram con secret inválido",
      description: "Se rechazó una petición al webhook de Telegram por firma inválida.",
      severity: "WARNING",
      entityType: "SecurityEvent",
      entityId: `telegram-webhook:invalid-secret:${getRequestIp(request)}`,
    });
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let update: TelegramWebhookUpdate;
  try {
    update = (await request.json()) as TelegramWebhookUpdate;
  } catch {
    await recordSecurityEvent({
      alertType: SECURITY_EVENT_TYPES.invalidPayload,
      title: "Webhook de Telegram con payload inválido",
      description: "Se rechazó un payload inválido antes de procesar el webhook.",
      severity: "WARNING",
      entityType: "SecurityEvent",
      entityId: `telegram-webhook:invalid-payload:${getRequestIp(request)}`,
    });
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  try {
    const result = await processTelegramWebhookUpdate(update);

    if (result.handled && result.replyText && result.chatId) {
      const reply = await sendTelegramMessage(result.chatId, result.replyText);
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
