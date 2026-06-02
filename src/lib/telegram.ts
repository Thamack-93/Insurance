import { timingSafeEqual } from "node:crypto";
import { addDays, endOfDay, startOfDay } from "date-fns";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/logger";
import { formatCurrency, toNumber } from "@/lib/money";
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
  TELEGRAM_DIGEST_SECTION_LIMIT,
  TELEGRAM_LINK_TOKEN_TTL_MINUTES,
  TELEGRAM_QUERY_RESULT_LIMIT,
  buildTelegramFallbackMessage,
  buildTelegramHelpMessage,
  buildTelegramLinkedChatRequiredMessage,
  buildTelegramLinkErrorMessage,
  buildTelegramLinkSuccessMessage,
  buildTelegramStartMessage,
  buildTelegramStatusMessage,
  generateTelegramLinkCode,
  hashTelegramLinkCode,
  normalizeTelegramLinkCode,
  parseTelegramCommand,
  parseTelegramQueryDays,
} from "@/lib/telegram-shared";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;
type TelegramReceiptItem = {
  id: string;
  receiptNumber: string;
  policyNumber: string;
  clientName: string;
  insurerName: string;
  dueDate: Date;
  amount: number;
  balance: number;
  currency: string;
};
type TelegramRenewalItem = {
  id: string;
  policyNumber: string;
  clientName: string;
  insurerName: string;
  endDate: Date;
};
type TelegramListResult<T> = {
  total: number;
  items: T[];
};

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

export type TelegramDailyDigestResult = {
  processed: number;
  sent: number;
  failed: number;
};

const TELEGRAM_FETCH_TIMEOUT_MS = 8_000;
const TELEGRAM_DATE_FORMATTER = new Intl.DateTimeFormat("es-MX", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "America/Mexico_City",
});

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

function getAppBaseUrl() {
  const value = process.env.APP_BASE_URL?.trim();
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function buildPolicyDeskUrl(path: string) {
  const baseUrl = getAppBaseUrl();
  if (!baseUrl) return null;
  return new URL(path, baseUrl).toString();
}

function formatTelegramDate(date: Date) {
  return TELEGRAM_DATE_FORMATTER.format(date);
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEGRAM_FETCH_TIMEOUT_MS);

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
      signal: controller.signal,
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
  } finally {
    clearTimeout(timeout);
  }
}

async function getTelegramReceipts(input: {
  userId: string;
  to: Date;
  from?: Date;
  limit: number;
  client?: DbClient;
}): Promise<TelegramListResult<TelegramReceiptItem>> {
  const db = input.client ?? getDb();

  const where: Prisma.ReceiptWhereInput = {
    client: { portfolioOwnerId: input.userId },
    dueDate: {
      ...(input.from ? { gte: input.from } : {}),
      lte: input.to,
    },
    status: { in: ["PENDING", "OVERDUE"] },
  };

  const [total, rows] = await Promise.all([
    db.receipt.count({ where }),
    db.receipt.findMany({
      where,
      include: {
        client: { select: { fullName: true } },
        insurer: { select: { name: true } },
        policy: { select: { policyNumber: true } },
        payments: { select: { amount: true } },
      },
      orderBy: [{ dueDate: "asc" }, { receiptNumber: "asc" }],
      take: input.limit,
    }),
  ]);

  return {
    total,
    items: rows.map((row) => {
      const amount = toNumber(row.amount);
      const paidAmount = row.payments.reduce((sum, payment) => sum + toNumber(payment.amount), 0);
      return {
        id: row.id,
        receiptNumber: row.receiptNumber,
        policyNumber: row.policy.policyNumber,
        clientName: row.client.fullName,
        insurerName: row.insurer.name,
        dueDate: row.dueDate,
        amount,
        balance: Math.max(amount - paidAmount, 0),
        currency: row.currency,
      };
    }),
  };
}

async function getTelegramRenewals(input: {
  userId: string;
  from: Date;
  to: Date;
  limit: number;
  client?: DbClient;
}): Promise<TelegramListResult<TelegramRenewalItem>> {
  const db = input.client ?? getDb();

  const where: Prisma.PolicyWhereInput = {
    client: { portfolioOwnerId: input.userId },
    endDate: { gte: input.from, lte: input.to },
    status: "ACTIVE",
  };

  const [total, rows] = await Promise.all([
    db.policy.count({ where }),
    db.policy.findMany({
      where,
      include: {
        client: { select: { fullName: true } },
        insurer: { select: { name: true } },
      },
      orderBy: [{ endDate: "asc" }, { policyNumber: "asc" }],
      take: input.limit,
    }),
  ]);

  return {
    total,
    items: rows.map((row) => ({
      id: row.id,
      policyNumber: row.policyNumber,
      clientName: row.client.fullName,
      insurerName: row.insurer.name,
      endDate: row.endDate,
    })),
  };
}

function formatTelegramReceiptLine(item: TelegramReceiptItem) {
  return [
    `• ${item.receiptNumber} · ${item.clientName}`,
    `  Póliza ${item.policyNumber} · ${item.insurerName}`,
    `  Vence ${formatTelegramDate(item.dueDate)} · ${formatCurrency(item.amount, item.currency)} · saldo ${formatCurrency(item.balance, item.currency)}`,
  ].join("\n");
}

function formatTelegramRenewalLine(item: TelegramRenewalItem) {
  return [
    `• Póliza ${item.policyNumber} · ${item.clientName}`,
    `  ${item.insurerName} · vence ${formatTelegramDate(item.endDate)}`,
  ].join("\n");
}

function buildTelegramSection(input: {
  title: string;
  total: number;
  lines: string[];
  emptyText: string;
  path: string;
}) {
  const link = buildPolicyDeskUrl(input.path);
  return [
    `${input.title}: ${input.total}`,
    ...(input.lines.length > 0 ? input.lines : [input.emptyText]),
    ...(link ? [`Ver en PolicyDesk: ${link}`] : []),
  ].join("\n");
}

export async function buildTelegramReceiptsReply(userId: string, days: number, client?: DbClient) {
  const dayStart = startOfDay(new Date());
  const receipts = await getTelegramReceipts({
    userId,
    to: endOfDay(addDays(dayStart, days)),
    limit: TELEGRAM_QUERY_RESULT_LIMIT,
    client,
  });

  return buildTelegramSection({
    title: `Cobros vencidos y próximos (${days} días)`,
    total: receipts.total,
    lines: receipts.items.map(formatTelegramReceiptLine),
    emptyText: "No hay cobros pendientes en este rango.",
    path: "/receipts",
  });
}

export async function buildTelegramRenewalsReply(userId: string, days: number, client?: DbClient) {
  const dayStart = startOfDay(new Date());
  const renewals = await getTelegramRenewals({
    userId,
    from: dayStart,
    to: endOfDay(addDays(dayStart, days)),
    limit: TELEGRAM_QUERY_RESULT_LIMIT,
    client,
  });

  return buildTelegramSection({
    title: `Renovaciones próximas (${days} días)`,
    total: renewals.total,
    lines: renewals.items.map(formatTelegramRenewalLine),
    emptyText: "No hay renovaciones próximas en este rango.",
    path: "/renewals",
  });
}

export async function buildTelegramDailyDigest(userId: string, client?: DbClient) {
  const dayStart = startOfDay(new Date());
  const dayEnd = endOfDay(dayStart);
  const [overdueReceipts, todayReceipts, upcomingReceipts, upcomingRenewals] = await Promise.all([
    getTelegramReceipts({
      userId,
      to: new Date(dayStart.getTime() - 1),
      limit: TELEGRAM_DIGEST_SECTION_LIMIT,
      client,
    }),
    getTelegramReceipts({
      userId,
      from: dayStart,
      to: dayEnd,
      limit: TELEGRAM_DIGEST_SECTION_LIMIT,
      client,
    }),
    getTelegramReceipts({
      userId,
      from: addDays(dayStart, 1),
      to: endOfDay(addDays(dayStart, 14)),
      limit: TELEGRAM_DIGEST_SECTION_LIMIT,
      client,
    }),
    getTelegramRenewals({
      userId,
      from: dayStart,
      to: endOfDay(addDays(dayStart, 7)),
      limit: TELEGRAM_DIGEST_SECTION_LIMIT,
      client,
    }),
  ]);

  return [
    `Fecha: ${formatTelegramDate(dayStart)}`,
    "",
    buildTelegramSection({
      title: "Recibos vencidos",
      total: overdueReceipts.total,
      lines: overdueReceipts.items.map(formatTelegramReceiptLine),
      emptyText: "Sin recibos vencidos.",
      path: "/receipts",
    }),
    "",
    buildTelegramSection({
      title: "Recibos pendientes de hoy",
      total: todayReceipts.total,
      lines: todayReceipts.items.map(formatTelegramReceiptLine),
      emptyText: "Sin recibos pendientes para hoy.",
      path: "/receipts",
    }),
    "",
    buildTelegramSection({
      title: "Recibos próximos 14 días",
      total: upcomingReceipts.total,
      lines: upcomingReceipts.items.map(formatTelegramReceiptLine),
      emptyText: "Sin recibos próximos.",
      path: "/receipts",
    }),
    "",
    buildTelegramSection({
      title: "Renovaciones próximas 7 días",
      total: upcomingRenewals.total,
      lines: upcomingRenewals.items.map(formatTelegramRenewalLine),
      emptyText: "Sin renovaciones próximas.",
      path: "/renewals",
    }),
  ].join("\n");
}

export async function sendDailyTelegramDigests(client?: DbClient): Promise<TelegramDailyDigestResult> {
  const db = client ?? getDb();
  const channels = await db.notificationChannel.findMany({
    where: {
      type: "TELEGRAM",
      isEnabled: true,
      telegramChatId: { not: null },
      user: { active: true },
    },
    select: {
      userId: true,
      telegramChatId: true,
    },
  });

  const result: TelegramDailyDigestResult = {
    processed: channels.length,
    sent: 0,
    failed: 0,
  };

  for (const channel of channels) {
    if (!channel.telegramChatId) continue;
    try {
      const body = await buildTelegramDailyDigest(channel.userId, db);
      const event = await createAndDeliverTelegramNotificationEvent({
        type: "DAILY_DIGEST",
        title: "Resumen diario PolicyDesk",
        body,
        priority: "LOW",
        userId: channel.userId,
        force: true,
      });

      if (event?.status === "SENT") {
        result.sent += 1;
      } else {
        result.failed += 1;
      }
    } catch (error) {
      result.failed += 1;
      logError("telegram.sendDailyDigest", error, { userId: channel.userId });
    }
  }

  return result;
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
      case "recibos":
      case "renovaciones": {
        const channel = await getTelegramChannelByChatId(chatId);
        if (!channel?.isEnabled || !channel.telegramChatId) {
          return {
            handled: true,
            chatId,
            replyText: buildTelegramLinkedChatRequiredMessage(),
          };
        }

        const range = parseTelegramQueryDays(command.argument);
        if (!range.ok) {
          return {
            handled: true,
            chatId,
            replyText: range.error,
          };
        }

        const replyText =
          command.command === "recibos"
            ? await buildTelegramReceiptsReply(channel.userId, range.days)
            : await buildTelegramRenewalsReply(channel.userId, range.days);

        return {
          handled: true,
          chatId,
          replyText,
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
