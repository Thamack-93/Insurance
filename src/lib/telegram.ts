import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/logger";
import { writeActivityLog } from "@/lib/activity-log";
import {
  createNotificationEvent,
  ensureNotificationDefaultsForUser,
  markNotificationFailed,
  markNotificationSent,
  markNotificationSkipped,
  type NotificationEventRecord,
} from "@/lib/notification-foundation";
import {
  TELEGRAM_LINK_TOKEN_TTL_MINUTES,
  buildTelegramFallbackMessage,
  buildTelegramHelpMessage,
  buildTelegramLinkErrorMessage,
  buildTelegramLinkSuccessMessage,
  buildTelegramStartMessage,
  buildTelegramStatusMessage,
  generateTelegramLinkCode,
  hashTelegramLinkCode,
  normalizeTelegramLinkCode,
  parseTelegramCommand,
} from "@/lib/telegram-shared";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

type TelegramChat = {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
};

type TelegramMessage = {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date?: number;
  text?: string;
};

export type TelegramWebhookUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

export type TelegramLinkCodeResult =
  | {
      ok: true;
      code: string;
      expiresAt: string;
      message: string;
      redirectTo: string;
    }
  | {
      ok: false;
      error: string;
    };

export type TelegramActionResult =
  | {
      ok: true;
      message: string;
      redirectTo: string;
    }
  | {
      ok: false;
      error: string;
    };

export type TelegramSendResult =
  | {
      ok: true;
      messageId: number;
    }
  | {
      ok: false;
      error: string;
    };

export type TelegramWebhookProcessResult = {
  handled: boolean;
  chatId?: string;
  replyText?: string;
};

function getTelegramBotToken() {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
}

function getTelegramWebhookSecret() {
  return process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || null;
}

export function getTelegramWebhookUrl() {
  const baseUrl = process.env.APP_BASE_URL?.trim();
  if (!baseUrl) return null;
  try {
    return new URL("/api/integrations/telegram/webhook", baseUrl).toString();
  } catch {
    return null;
  }
}

function getTelegramLinkSecret() {
  const secret = process.env.SESSION_SECRET ?? process.env.AUTH_SECRET;
  if (secret && secret.length >= 16) {
    return secret;
  }
  return "policydesk-dev-secret-change-in-production-please-0123456789";
}

function normalizeChatId(chatId: string | number) {
  return String(chatId);
}

function formatTelegramNotificationText(title: string, body: string) {
  const text = `${title.trim()}\n\n${body.trim()}`.trim();
  if (text.length <= 3900) return text;
  return `${text.slice(0, 3899)}…`;
}

export function isTelegramWebhookSecretValid(headerValue: string | null) {
  const secret = getTelegramWebhookSecret();
  if (!secret || !headerValue || secret.length !== headerValue.length) return false;
  try {
    return timingSafeEqual(Buffer.from(secret), Buffer.from(headerValue));
  } catch {
    return false;
  }
}

async function getTelegramChannelByUserId(userId: string, client?: DbClient) {
  const db = client ?? getDb();
  return db.notificationChannel.findUnique({
    where: {
      userId_type: {
        userId,
        type: "TELEGRAM",
      },
    },
  });
}

async function getTelegramChannelByChatId(chatId: string, client?: DbClient) {
  const db = client ?? getDb();
  return db.notificationChannel.findFirst({
    where: {
      telegramChatId: chatId,
      type: "TELEGRAM",
    },
  });
}

export async function sendTelegramMessage(chatId: string, text: string): Promise<TelegramSendResult> {
  const token = getTelegramBotToken();
  if (!token) {
    return { ok: false, error: "TELEGRAM_BOT_TOKEN no está configurado." };
  }

  const message = text.trim();
  if (!message) {
    return { ok: false, error: "El mensaje está vacío." };
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message.length <= 3900 ? message : `${message.slice(0, 3899)}…`,
        disable_web_page_preview: true,
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; result?: { message_id?: number }; description?: string }
      | null;

    if (!response.ok || !payload?.ok) {
      return {
        ok: false,
        error: payload?.description ?? `Telegram respondió con estado ${response.status}.`,
      };
    }

    return {
      ok: true,
      messageId: payload.result?.message_id ?? 0,
    };
  } catch (error) {
    logError("telegram.sendMessage", error, { chatId });
    return {
      ok: false,
      error: "No se pudo enviar el mensaje a Telegram.",
    };
  }
}

export async function createTelegramLinkCodeForUser(input: {
  userId: string;
  actorId: string;
  client?: DbClient;
}): Promise<TelegramLinkCodeResult> {
  const db = input.client ?? getDb();

  try {
    const result = await db.$transaction(async (tx) => {
      await ensureNotificationDefaultsForUser(input.userId, tx);
      await tx.telegramLinkToken.deleteMany({
        where: {
          userId: input.userId,
          usedAt: null,
        },
      });

      const code = generateTelegramLinkCode();
      const tokenHash = hashTelegramLinkCode(code, getTelegramLinkSecret());
      const expiresAt = new Date(Date.now() + TELEGRAM_LINK_TOKEN_TTL_MINUTES * 60 * 1000);

      const token = await tx.telegramLinkToken.create({
        data: {
          userId: input.userId,
          tokenHash,
          expiresAt,
        },
      });

      await writeActivityLog(
        {
          entityType: "TelegramLinkToken",
          entityId: token.id,
          action: "TELEGRAM_LINK_CODE_GENERATED",
          newValue: {
            expiresAt: token.expiresAt,
          },
          userId: input.actorId,
          db: tx,
        },
      );

      return {
        code,
        expiresAt: token.expiresAt.toISOString(),
        tokenId: token.id,
      };
    });

    return {
      ok: true,
      code: result.code,
      expiresAt: result.expiresAt,
      message: "Código de enlace generado. Envíalo por Telegram antes de que expire.",
      redirectTo: "/settings/notifications",
    };
  } catch (error) {
    logError("telegram.createLinkCode", error, { userId: input.userId, actorId: input.actorId });
    return {
      ok: false,
      error: "No se pudo generar el código de enlace.",
    };
  }
}

export async function connectTelegramChannelFromCode(input: {
  code: string;
  chatId: string | number;
  chatType: string;
  client?: DbClient;
}): Promise<TelegramActionResult> {
  const db = input.client ?? getDb();
  const chatId = normalizeChatId(input.chatId);
  const normalizedCode = normalizeTelegramLinkCode(input.code);

  if (!normalizedCode) {
    return { ok: false, error: "Código de enlace no válido." };
  }

  if (input.chatType !== "private") {
    return {
      ok: false,
      error: "Debes vincular Telegram desde un chat privado.",
    };
  }

  try {
    const result = await db.$transaction(async (tx) => {
      const tokenHash = hashTelegramLinkCode(normalizedCode, getTelegramLinkSecret());
      const token = await tx.telegramLinkToken.findFirst({
        where: {
          tokenHash,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
      });

      if (!token) {
        return {
          ok: false as const,
          error: "Código inválido o vencido.",
        };
      }

      await ensureNotificationDefaultsForUser(token.userId, tx);

      const conflictingChannel = await tx.notificationChannel.findFirst({
        where: {
          type: "TELEGRAM",
          telegramChatId: chatId,
          userId: { not: token.userId },
        },
      });

      if (conflictingChannel) {
        return {
          ok: false as const,
          error: "Este chat ya está vinculado a otra cuenta de PolicyDesk.",
        };
      }

      const previousChannel = await getTelegramChannelByUserId(token.userId, tx);
      const channel = await tx.notificationChannel.upsert({
        where: {
          userId_type: {
            userId: token.userId,
            type: "TELEGRAM",
          },
        },
        update: {
          telegramChatId: chatId,
          isEnabled: true,
        },
        create: {
          userId: token.userId,
          type: "TELEGRAM",
          telegramChatId: chatId,
          isEnabled: true,
        },
      });

      await tx.telegramLinkToken.update({
        where: { id: token.id },
        data: {
          usedAt: new Date(),
        },
      });

      await writeActivityLog(
        {
          entityType: "NotificationChannel",
          entityId: channel.id,
          action: previousChannel?.telegramChatId
            ? "TELEGRAM_RELINKED"
            : "TELEGRAM_LINKED",
          oldValue: previousChannel
            ? {
                telegramChatId: previousChannel.telegramChatId,
                isEnabled: previousChannel.isEnabled,
              }
            : null,
          newValue: {
            telegramChatId: chatId,
            isEnabled: true,
          },
          userId: token.userId,
          db: tx,
        },
      );

      return {
        ok: true as const,
        userId: token.userId,
        channelId: channel.id,
      };
    });

    if (!result.ok) {
      return result;
    }

    return {
      ok: true,
      message: buildTelegramLinkSuccessMessage(),
      redirectTo: "/settings/notifications",
    };
  } catch (error) {
    logError("telegram.connect", error, { chatId });
    return {
      ok: false,
      error: "No se pudo vincular este chat.",
    };
  }
}

export async function disconnectTelegramChannelForUser(input: {
  userId: string;
  actorId: string;
  client?: DbClient;
}): Promise<TelegramActionResult> {
  const db = input.client ?? getDb();

  try {
    const result = await db.$transaction(async (tx) => {
      await ensureNotificationDefaultsForUser(input.userId, tx);
      const current = await getTelegramChannelByUserId(input.userId, tx);
      if (!current || (!current.isEnabled && !current.telegramChatId)) {
        return {
          ok: true as const,
          message: "Telegram ya estaba desconectado.",
        };
      }

      const updated = await tx.notificationChannel.update({
        where: {
          userId_type: {
            userId: input.userId,
            type: "TELEGRAM",
          },
        },
        data: {
          isEnabled: false,
          telegramChatId: null,
        },
      });

      await writeActivityLog(
        {
          entityType: "NotificationChannel",
          entityId: updated.id,
          action: "TELEGRAM_DISCONNECTED",
          oldValue: {
            telegramChatId: current.telegramChatId,
            isEnabled: current.isEnabled,
          },
          newValue: {
            telegramChatId: null,
            isEnabled: false,
          },
          userId: input.actorId,
          db: tx,
        },
      );

      return {
        ok: true as const,
        message: "Telegram desconectado.",
      };
    });

    return {
      ok: true,
      message: result.message,
      redirectTo: "/settings/notifications",
    };
  } catch (error) {
    logError("telegram.disconnect", error, { userId: input.userId, actorId: input.actorId });
    return {
      ok: false,
      error: "No se pudo desconectar Telegram.",
    };
  }
}

export async function deliverTelegramNotificationEvent(
  eventId: string,
  client?: DbClient,
): Promise<NotificationEventRecord | null> {
  const db = client ?? getDb();

  try {
    const event = await db.notificationEvent.findUnique({ where: { id: eventId } });
    if (!event) return null;
    if (event.status === "SENT" || event.status === "FAILED" || event.status === "SKIPPED") {
      return event as NotificationEventRecord;
    }
    if (event.channelType !== "TELEGRAM") {
      return await markNotificationSkipped(event.id, "Canal no soportado.", db);
    }

    const channel = await db.notificationChannel.findUnique({
      where: {
        userId_type: {
          userId: event.userId,
          type: "TELEGRAM",
        },
      },
    });

    if (!channel || !channel.isEnabled || !channel.telegramChatId) {
      return await markNotificationSkipped(event.id, "Telegram no está vinculado.", db);
    }

    const result = await sendTelegramMessage(
      channel.telegramChatId,
      formatTelegramNotificationText(event.title, event.body),
    );

    if (!result.ok) {
      return await markNotificationFailed(event.id, result.error, db);
    }

    return await markNotificationSent(event.id, db);
  } catch (error) {
    logError("telegram.deliverNotificationEvent", error, { eventId });
    return null;
  }
}

export async function createAndDeliverTelegramNotificationEvent(input: {
  type: string;
  title: string;
  body: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  userId: string;
  workItemId?: string | null;
  clientId?: string | null;
  policyId?: string | null;
  receiptId?: string | null;
  force?: boolean;
}): Promise<NotificationEventRecord | null> {
  const event = await createNotificationEvent({
    type: input.type,
    title: input.title,
    body: input.body,
    priority: input.priority,
    userId: input.userId,
    workItemId: input.workItemId ?? null,
    clientId: input.clientId ?? null,
    policyId: input.policyId ?? null,
    receiptId: input.receiptId ?? null,
    channelType: "TELEGRAM",
    force: input.force,
  });

  if (!event || event.status !== "PENDING") {
    return event;
  }

  return deliverTelegramNotificationEvent(event.id);
}

export async function processTelegramWebhookUpdate(
  update: TelegramWebhookUpdate,
): Promise<TelegramWebhookProcessResult> {
  const message = update.message;
  if (!message?.text) {
    return { handled: false };
  }

  const chatId = normalizeChatId(message.chat.id);
  const command = parseTelegramCommand(message.text);
  if (!command) {
    return { handled: false };
  }

  try {
    if (message.chat.type !== "private") {
      return {
        handled: true,
        chatId,
      };
    }

    switch (command.command) {
      case "start":
        return { handled: true, chatId, replyText: buildTelegramStartMessage() };
      case "help":
        return { handled: true, chatId, replyText: buildTelegramHelpMessage() };
      case "status": {
        const channel = await getTelegramChannelByChatId(chatId);
        return {
          handled: true,
          chatId,
          replyText: buildTelegramStatusMessage(Boolean(channel?.isEnabled && channel.telegramChatId)),
        };
      }
      case "link": {
        if (!command.argument) {
          return {
            handled: true,
            chatId,
            replyText: buildTelegramLinkErrorMessage("No enviaste ningún código de enlace."),
          };
        }

        const result = await connectTelegramChannelFromCode({
          code: command.argument,
          chatId,
          chatType: message.chat.type,
        });

        if (!result.ok) {
          return {
            handled: true,
            chatId,
            replyText: buildTelegramLinkErrorMessage(result.error),
          };
        }

        return {
          handled: true,
          chatId,
          replyText: buildTelegramLinkSuccessMessage(),
        };
      }
      default:
        return { handled: true, chatId, replyText: buildTelegramFallbackMessage() };
    }
  } catch (error) {
    logError("telegram.processWebhookUpdate", error, { updateId: update.update_id });
    return {
      handled: true,
      chatId,
      replyText: "No se pudo procesar este comando ahora mismo.",
    };
  }
}

export async function getTelegramChannelStateForUser(userId: string, client?: DbClient) {
  const db = client ?? getDb();
  await ensureNotificationDefaultsForUser(userId, db);
  return getTelegramChannelByUserId(userId, db);
}

export { TELEGRAM_LINK_TOKEN_TTL_MINUTES };
