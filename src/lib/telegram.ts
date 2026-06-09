import { timingSafeEqual } from "node:crypto";
import { addDays, endOfDay, startOfDay } from "date-fns";
import { DEFAULT_TIMEZONE } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/logger";
import { formatCurrency, toNumber } from "@/lib/money";
import { writeActivityLog } from "@/lib/activity-log";
import { recordPayment } from "@/lib/payment-service";
import {
  createNotificationEvent,
  ensureNotificationDefaultsForUser,
  getLocalDateKey,
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
  buildTelegramDraftCancelledMessage,
  buildTelegramDraftConfirmedMessage,
  buildTelegramHelpMessage,
  buildTelegramLinkedChatRequiredMessage,
  buildTelegramLinkErrorMessage,
  buildTelegramLinkSuccessMessage,
  buildTelegramPaymentDraftMessage,
  buildTelegramPolicyDraftMessage,
  buildTelegramStartMessage,
  buildTelegramStatusMessage,
  generateTelegramLinkCode,
  hashTelegramLinkCode,
  normalizeTelegramLinkCode,
  parseTelegramCommand,
  parseTelegramQueryDays,
} from "@/lib/telegram-shared";
import { checkRateLimit } from "@/lib/request-guards";
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

type TelegramPaymentDraftState = {
  step:
    | "policyNumber"
    | "receiptNumber"
    | "amount"
    | "paidDate"
    | "paymentMethod"
    | "ready";
  policyNumber?: string;
  receiptNumber?: string;
  amount?: number;
  paidDate?: string;
  paymentMethod?: string;
  reference?: string | null;
  receiptId?: string;
  policyId?: string;
  clientId?: string;
  insurerId?: string;
  clientName?: string;
  insurerName?: string;
  currency?: string;
  receiptResolvedAt?: string;
};

type TelegramPolicyDraftState = {
  step:
    | "policyNumber"
    | "clientName"
    | "insurerName"
    | "policyType"
    | "startDate"
    | "endDate"
    | "premiumAmount"
    | "paymentFrequency"
    | "ready";
  policyNumber?: string;
  clientName?: string;
  insurerName?: string;
  policyType?: string;
  startDate?: string;
  endDate?: string;
  premiumAmount?: number;
  paymentFrequency?: string;
  sourcePolicyNumber?: string | null;
};

type TelegramDraftState = {
  type: "PAYMENT_CAPTURE" | "POLICY_CAPTURE";
  payment?: TelegramPaymentDraftState;
  policy?: TelegramPolicyDraftState;
};

const TELEGRAM_DRAFT_TTL_MS = 2 * 60 * 60 * 1000;
const TELEGRAM_COMMAND_RATE_LIMIT = {
  limit: 40,
  windowMs: 15 * 60 * 1000,
};
const TELEGRAM_DRAFT_CONTINUATION_RATE_LIMIT = {
  limit: 30,
  windowMs: 15 * 60 * 1000,
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

function isTelegramMutationsEnabled(channel?: {
  telegramMutationsEnabled?: boolean | null;
  isEnabled?: boolean | null;
  telegramChatId?: string | null;
}) {
  return Boolean(channel?.isEnabled && channel?.telegramChatId && channel.telegramMutationsEnabled);
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

function toTelegramDraftState(payloadJson: string): TelegramDraftState | null {
  try {
    const parsed = JSON.parse(payloadJson) as TelegramDraftState;
    if (!parsed || (parsed.type !== "PAYMENT_CAPTURE" && parsed.type !== "POLICY_CAPTURE")) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function stringifyTelegramDraftState(state: TelegramDraftState) {
  return JSON.stringify(state);
}

function getTelegramPaymentPrompt(step: TelegramPaymentDraftState["step"]) {
  switch (step) {
    case "policyNumber":
      return "Escribe el número de póliza.";
    case "receiptNumber":
      return "Ahora escribe el número de recibo.";
    case "amount":
      return "Escribe el monto del pago.";
    case "paidDate":
      return "Escribe la fecha del pago en formato YYYY-MM-DD.";
    case "paymentMethod":
      return "Escribe el método de pago.";
    case "ready":
      return "Ya tengo el borrador. Responde /confirmar para registrar el pago o /cancelar para descartarlo.";
  }
}

function getTelegramPolicyPrompt(step: TelegramPolicyDraftState["step"]) {
  switch (step) {
    case "policyNumber":
      return "Escribe el número de póliza.";
    case "clientName":
      return "Escribe el nombre del cliente.";
    case "insurerName":
      return "Escribe la aseguradora.";
    case "policyType":
      return "Escribe el tipo de póliza.";
    case "startDate":
      return "Escribe la fecha de inicio en formato YYYY-MM-DD.";
    case "endDate":
      return "Escribe la fecha de fin en formato YYYY-MM-DD.";
    case "premiumAmount":
      return "Escribe la prima total.";
    case "paymentFrequency":
      return "Escribe la frecuencia de pago.";
    case "ready":
      return "Ya tengo el borrador. Responde /confirmar para guardar el borrador o /cancelar para descartarlo.";
  }
}

function getNextPaymentStep(state: TelegramPaymentDraftState): TelegramPaymentDraftState["step"] {
  if (!state.policyNumber) return "policyNumber";
  if (!state.receiptNumber) return "receiptNumber";
  if (state.amount == null) return "amount";
  if (!state.paidDate) return "paidDate";
  if (!state.paymentMethod) return "paymentMethod";
  return "ready";
}

function getNextPolicyStep(state: TelegramPolicyDraftState): TelegramPolicyDraftState["step"] {
  if (!state.policyNumber) return "policyNumber";
  if (!state.clientName) return "clientName";
  if (!state.insurerName) return "insurerName";
  if (!state.policyType) return "policyType";
  if (!state.startDate) return "startDate";
  if (!state.endDate) return "endDate";
  if (state.premiumAmount == null) return "premiumAmount";
  if (!state.paymentFrequency) return "paymentFrequency";
  return "ready";
}

function formatTelegramDate(date: Date) {
  return TELEGRAM_DATE_FORMATTER.format(date);
}

function formatTelegramNotificationText(title: string, body: string) {
  const text = `${title.trim()}\n\n${body.trim()}`.trim();
  if (text.length <= 3900) return text;
  return `${text.slice(0, 3899)}…`;
}

function getDigestDateKey(now: Date, timeZone: string | null | undefined) {
  return getLocalDateKey(now, timeZone ?? DEFAULT_TIMEZONE);
}

export async function markTelegramDigestAsSentForUser(
  userId: string,
  sentAt = new Date(),
  client?: DbClient,
) {
  const db = client ?? getDb();
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, timeZone: true },
    });
    if (!user) return null;

    const updated = await db.user.update({
      where: { id: userId },
      data: {
        telegramDigestLastSentAt: sentAt,
      },
      select: { id: true, telegramDigestLastSentAt: true },
    });

    return {
      ...updated,
      digestDateKey: getDigestDateKey(sentAt, user.timeZone),
    };
  } catch (error) {
    logError("telegram.markDigestSent", error, { userId });
    return null;
  }
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

function parseTelegramIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function getActiveTelegramDraftForChat(chatId: string, client?: DbClient) {
  const db = client ?? getDb();
  const channel = await getTelegramChannelByChatId(chatId, db);
  if (!channel?.isEnabled) {
    return { channel: null, draft: null };
  }

  const draft = await db.telegramDraft.findFirst({
    where: {
      userId: channel.userId,
      channelId: channel.id,
      status: "COLLECTING",
      expiresAt: { gt: new Date() },
    },
    orderBy: [{ createdAt: "desc" }],
  });

  return { channel, draft };
}

function extractTelegramKeyValuePayload(argument: string) {
  const payload: Record<string, string> = {};
  for (const token of argument.split(/\s+/).filter(Boolean)) {
    const [key, ...valueParts] = token.split("=");
    if (!key || valueParts.length === 0) continue;
    payload[key.toLowerCase()] = valueParts.join("=").trim();
  }
  return payload;
}

function buildPolicyDraftSummary(payload: Record<string, string>) {
  const parts = [
    payload.policynumber ? `Póliza ${payload.policynumber}` : null,
    payload.client ? `Cliente ${payload.client}` : null,
    payload.insurer ? `Aseguradora ${payload.insurer}` : null,
    payload.start ? `Inicio ${payload.start}` : null,
    payload.end ? `Fin ${payload.end}` : null,
    payload.premium ? `Prima ${payload.premium}` : null,
    payload.frequency ? `Frecuencia ${payload.frequency}` : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : "Borrador vacío para completar en PolicyDesk.";
}

function parseTelegramPaymentArgument(argument: string) {
  const parts = argument.split(/\s+/).filter(Boolean);
  const state: TelegramPaymentDraftState = { step: "policyNumber" };

  if (parts[0]) state.policyNumber = parts[0];
  if (parts[1]) state.receiptNumber = parts[1];
  if (parts[2]) {
    const amount = Number(parts[2].replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount <= 0) {
      return { ok: false as const, error: "El monto debe ser mayor a cero." };
    }
    state.amount = amount;
  }
  if (parts[3]) {
    const paidDate = parseTelegramIsoDate(parts[3]);
    if (!paidDate) {
      return { ok: false as const, error: "La fecha debe tener formato YYYY-MM-DD." };
    }
    state.paidDate = paidDate.toISOString().slice(0, 10);
  }
  if (parts[4]) state.paymentMethod = parts[4];
  if (parts.length > 5) state.reference = parts.slice(5).join(" ").trim() || null;

  state.step = getNextPaymentStep(state);

  return { ok: true as const, state };
}

function parseTelegramPolicyArgument(argument: string) {
  const payload = extractTelegramKeyValuePayload(argument);
  const state: TelegramPolicyDraftState = { step: "policyNumber" };

  const maybePolicyNumber = payload.policynumber ?? payload.policy ?? payload.policia ?? null;
  if (maybePolicyNumber) state.policyNumber = maybePolicyNumber;
  if (payload.client) state.clientName = payload.client;
  if (payload.insurer) state.insurerName = payload.insurer;
  if (payload.type) state.policyType = payload.type;
  if (payload.start) state.startDate = payload.start;
  if (payload.end) state.endDate = payload.end;
  if (payload.premium) {
    const premiumAmount = Number(payload.premium.replace(/,/g, ""));
    if (!Number.isFinite(premiumAmount) || premiumAmount <= 0) {
      return { ok: false as const, error: "La prima debe ser mayor a cero." };
    }
    state.premiumAmount = premiumAmount;
  }
  if (payload.frequency) state.paymentFrequency = payload.frequency;
  if (payload.sourcepolicy || payload.sourcepolicynumber) {
    state.sourcePolicyNumber = payload.sourcepolicy ?? payload.sourcepolicynumber;
  }

  state.step = getNextPolicyStep(state);
  return { ok: true as const, state };
}

async function getUserLinkedReceiptByPolicyAndNumber(
  userId: string,
  policyNumber: string,
  receiptNumber: string,
  client?: DbClient,
) {
  const db = client ?? getDb();
  const exact = await db.receipt.findFirst({
    where: {
      receiptNumber,
      policy: {
        policyNumber,
        client: { portfolioOwnerId: userId },
      },
    },
    include: {
      client: { select: { fullName: true } },
      policy: { select: { policyNumber: true } },
      insurer: { select: { name: true } },
    },
  });

  if (exact) return exact;

  const fuzzy = await db.receipt.findMany({
    where: {
      receiptNumber: { contains: receiptNumber },
      policy: {
        policyNumber,
        client: { portfolioOwnerId: userId },
      },
    },
    include: {
      client: { select: { fullName: true } },
      policy: { select: { policyNumber: true } },
      insurer: { select: { name: true } },
    },
    take: 2,
  });

  return fuzzy.length === 1 ? fuzzy[0] : null;
}

async function persistTelegramDraftState(input: {
  draftId: string;
  state: TelegramDraftState;
  client?: DbClient;
}) {
  const db = input.client ?? getDb();
  return db.telegramDraft.update({
    where: { id: input.draftId },
    data: {
      payloadJson: stringifyTelegramDraftState(input.state),
      updatedAt: new Date(),
    },
  });
}

function buildPaymentDraftStateFromInput(input: {
  policyNumber?: string;
  receiptNumber?: string;
  amount?: number;
  paidDate?: string;
  paymentMethod?: string;
  reference?: string | null;
}): TelegramPaymentDraftState {
  const state: TelegramPaymentDraftState = {
    step: "policyNumber",
    policyNumber: input.policyNumber?.trim() || undefined,
    receiptNumber: input.receiptNumber?.trim() || undefined,
    amount: input.amount,
    paidDate: input.paidDate,
    paymentMethod: input.paymentMethod?.trim() || undefined,
    reference: input.reference ?? null,
  };
  state.step = getNextPaymentStep(state);
  return state;
}

function buildPolicyDraftStateFromInput(input: Partial<TelegramPolicyDraftState>): TelegramPolicyDraftState {
  const state: TelegramPolicyDraftState = {
    step: "policyNumber",
    policyNumber: input.policyNumber?.trim() || undefined,
    clientName: input.clientName?.trim() || undefined,
    insurerName: input.insurerName?.trim() || undefined,
    policyType: input.policyType?.trim() || undefined,
    startDate: input.startDate?.trim() || undefined,
    endDate: input.endDate?.trim() || undefined,
    premiumAmount: input.premiumAmount,
    paymentFrequency: input.paymentFrequency?.trim() || undefined,
    sourcePolicyNumber: input.sourcePolicyNumber?.trim() || null,
  };
  state.step = getNextPolicyStep(state);
  return state;
}

function parseTelegramDraftState(payloadJson: string): TelegramDraftState | null {
  return toTelegramDraftState(payloadJson);
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

async function createTelegramPaymentDraft(input: {
  chatId: string;
  argument: string;
  client?: DbClient;
}) {
  const db = input.client ?? getDb();
  const channel = await getTelegramChannelByChatId(input.chatId, db);
  if (!channel?.isEnabled || !channel.telegramChatId) {
    return {
      ok: false as const,
      replyText: buildTelegramLinkedChatRequiredMessage(),
    };
  }

  const parsed = parseTelegramPaymentArgument(input.argument);
  if (!parsed.ok) {
    return {
      ok: false as const,
      replyText: parsed.error,
    };
  }

  const readyReceipt =
    parsed.state.step === "ready" && parsed.state.policyNumber && parsed.state.receiptNumber
      ? await getUserLinkedReceiptByPolicyAndNumber(
          channel.userId,
          parsed.state.policyNumber,
          parsed.state.receiptNumber,
          db,
        )
      : null;

  if (parsed.state.step === "ready" && !readyReceipt) {
    return {
      ok: false as const,
      replyText: "No encontré un recibo único para esa póliza y ese número. Revisa los datos e inténtalo de nuevo.",
    };
  }

  const draft = await db.$transaction(async (tx) => {
    await tx.telegramDraft.updateMany({
      where: {
        userId: channel.userId,
        channelId: channel.id,
        type: "PAYMENT_CAPTURE",
        status: "COLLECTING",
      },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
      },
    });

    const state: TelegramDraftState = {
      type: "PAYMENT_CAPTURE",
      payment: parsed.state.step === "ready" && readyReceipt
        ? {
            ...parsed.state,
            receiptId: readyReceipt.id,
            policyId: readyReceipt.policyId,
            clientId: readyReceipt.clientId,
            insurerId: readyReceipt.insurerId,
            clientName: readyReceipt.client.fullName,
            insurerName: readyReceipt.insurer.name,
            currency: readyReceipt.currency,
            receiptResolvedAt: new Date().toISOString(),
          }
        : parsed.state,
    };

    return tx.telegramDraft.create({
      data: {
        userId: channel.userId,
        channelId: channel.id,
        type: "PAYMENT_CAPTURE",
        status: "COLLECTING",
        payloadJson: stringifyTelegramDraftState(state),
        expiresAt: new Date(Date.now() + TELEGRAM_DRAFT_TTL_MS),
      },
      include: {
        channel: true,
        user: true,
      },
    });
  });

  if (parsed.state.step !== "ready") {
    return {
      ok: true as const,
      replyText: getTelegramPaymentPrompt(parsed.state.step),
      draftId: draft.id,
    };
  }

  const payload = {
    type: "PAYMENT_CAPTURE" as const,
    payment: {
      ...parsed.state,
      ...(readyReceipt
        ? {
            receiptId: readyReceipt.id,
            policyId: readyReceipt.policyId,
            clientId: readyReceipt.clientId,
            insurerId: readyReceipt.insurerId,
            clientName: readyReceipt.client.fullName,
            insurerName: readyReceipt.insurer.name,
            currency: readyReceipt.currency,
            receiptResolvedAt: new Date().toISOString(),
          }
        : {}),
    },
  };
  await persistTelegramDraftState({
    draftId: draft.id,
    state: payload,
    client: db,
  });

  const receipt = readyReceipt as NonNullable<typeof readyReceipt>;

  return {
    ok: true as const,
    replyText: buildTelegramPaymentDraftMessage({
      policyNumber: receipt.policy.policyNumber,
      receiptNumber: receipt.receiptNumber,
      clientName: receipt.client.fullName,
      amount: formatCurrency(parsed.state.amount ?? 0, receipt.currency),
      paymentMethod: parsed.state.paymentMethod ?? "",
      paidDate: formatTelegramDate(new Date(`${parsed.state.paidDate}T12:00:00.000Z`)),
      reference: parsed.state.reference,
    }),
    draftId: draft.id,
  };
}

async function createTelegramPolicyDraft(input: {
  chatId: string;
  argument: string;
  client?: DbClient;
}) {
  const db = input.client ?? getDb();
  const channel = await getTelegramChannelByChatId(input.chatId, db);
  if (!channel?.isEnabled || !channel.telegramChatId) {
    return {
      ok: false as const,
      replyText: buildTelegramLinkedChatRequiredMessage(),
    };
  }

  const parsed = parseTelegramPolicyArgument(input.argument);
  if (!parsed.ok) {
    return {
      ok: false as const,
      replyText: parsed.error,
    };
  }

  const draft = await db.$transaction(async (tx) => {
    await tx.telegramDraft.updateMany({
      where: {
        userId: channel.userId,
        channelId: channel.id,
        type: "POLICY_CAPTURE",
        status: "COLLECTING",
      },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
      },
    });

    const state: TelegramDraftState = {
      type: "POLICY_CAPTURE",
      policy: parsed.state,
    };

    return tx.telegramDraft.create({
      data: {
        userId: channel.userId,
        channelId: channel.id,
        type: "POLICY_CAPTURE",
        status: "COLLECTING",
        payloadJson: stringifyTelegramDraftState(state),
        expiresAt: new Date(Date.now() + TELEGRAM_DRAFT_TTL_MS),
      },
    });
  });

  const link = buildPolicyDeskUrl(`/policies/new?telegramDraft=${draft.id}`);
  return {
    ok: true as const,
    replyText:
      parsed.state.step === "ready"
        ? buildTelegramPolicyDraftMessage({
            policyNumber: parsed.state.policyNumber ?? null,
            summary: buildPolicyDraftSummary({
              policynumber: parsed.state.policyNumber ?? "",
              client: parsed.state.clientName ?? "",
              insurer: parsed.state.insurerName ?? "",
              type: parsed.state.policyType ?? "",
              start: parsed.state.startDate ?? "",
              end: parsed.state.endDate ?? "",
              premium: String(parsed.state.premiumAmount ?? ""),
              frequency: parsed.state.paymentFrequency ?? "",
            }),
            link,
          })
        : getTelegramPolicyPrompt(parsed.state.step),
    draftId: draft.id,
  };
}

async function confirmTelegramDraft(input: {
  chatId: string;
  client?: DbClient;
}) {
  const db = input.client ?? getDb();
  const { channel, draft } = await getActiveTelegramDraftForChat(input.chatId, db);
  if (!channel) {
    return {
      ok: false as const,
      replyText: buildTelegramLinkedChatRequiredMessage(),
    };
  }

  if (!draft) {
    return {
      ok: false as const,
      replyText: "No hay ningún borrador activo para confirmar.",
    };
  }

  const payload = parseTelegramDraftState(draft.payloadJson);
  if (!payload) {
    return {
      ok: false as const,
      replyText: "El borrador está dañado. Cancélalo y vuelve a intentarlo.",
    };
  }

  if (draft.type === "PAYMENT_CAPTURE") {
    if (!isTelegramMutationsEnabled(channel)) {
      return {
        ok: false as const,
        replyText:
          "Las mutaciones por Telegram están desactivadas. Completa el borrador y confírmalo desde PolicyDesk.",
      };
    }

    const state = payload.payment;
    if (!state || state.step !== "ready" || !state.policyNumber || !state.receiptNumber) {
      return {
        ok: false as const,
        replyText: "El borrador de pago todavía no está completo.",
      };
    }

    const receipt = await getUserLinkedReceiptByPolicyAndNumber(
      channel.userId,
      state.policyNumber,
      state.receiptNumber,
      db,
    );
    if (!receipt) {
      return {
        ok: false as const,
        replyText: "No encontré un recibo único para esa póliza y ese número.",
      };
    }

    try {
      const result = await recordPayment(
        {
          receiptId: receipt.id,
          amount: Number(state.amount),
          paidDate: new Date(`${state.paidDate}T12:00:00.000Z`),
          paymentMethod: state.paymentMethod ?? "",
          reference: state.reference ?? null,
          notes: "Pago capturado por Telegram.",
          actorId: channel.userId,
        },
        db,
      );

      await db.telegramDraft.update({
        where: { id: draft.id },
        data: {
          status: "CONFIRMED",
          confirmedAt: new Date(),
        },
      });

      await writeActivityLog({
        entityType: "TelegramDraft",
        entityId: draft.id,
        action: "TELEGRAM_PAYMENT_DRAFT_CONFIRMED",
        newValue: {
          receiptId: receipt.id,
          paymentId: result.payment.id,
          amount: state.amount,
          paidDate: state.paidDate,
        },
        userId: channel.userId,
        db,
      });

      return {
        ok: true as const,
        replyText: buildTelegramDraftConfirmedMessage("Pago"),
      };
    } catch (error) {
      logError("telegram.confirmPaymentDraft", error, { chatId: input.chatId, draftId: draft.id });
      return {
        ok: false as const,
        replyText: "No se pudo confirmar el pago del borrador.",
      };
    }
  }

  const policyState = payload.policy;
  if (!policyState || policyState.step !== "ready") {
    return {
      ok: false as const,
      replyText: "El borrador de póliza todavía no está completo.",
    };
  }

  await db.telegramDraft.update({
    where: { id: draft.id },
    data: {
      status: "CONFIRMED",
      confirmedAt: new Date(),
    },
  });

  await writeActivityLog({
    entityType: "TelegramDraft",
    entityId: draft.id,
    action: "TELEGRAM_POLICY_DRAFT_CONFIRMED",
    newValue: {
      payload: payload,
    },
    userId: channel.userId,
    db,
  });

  const link = buildPolicyDeskUrl(`/policies/new?telegramDraft=${draft.id}`);
  return {
    ok: true as const,
    replyText: [
      buildTelegramDraftConfirmedMessage("Póliza"),
      link ? `Abre este enlace para continuar en PolicyDesk: ${link}` : "Abre PolicyDesk para continuar la captura.",
    ].join("\n"),
  };
}

async function cancelTelegramDraft(input: {
  chatId: string;
  client?: DbClient;
}) {
  const db = input.client ?? getDb();
  const { channel, draft } = await getActiveTelegramDraftForChat(input.chatId, db);
  if (!channel) {
    return {
      ok: false as const,
      replyText: buildTelegramLinkedChatRequiredMessage(),
    };
  }

  if (!draft) {
    return {
      ok: false as const,
      replyText: "No hay ningún borrador activo para cancelar.",
    };
  }

  await db.telegramDraft.update({
    where: { id: draft.id },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
    },
  });

  await writeActivityLog({
    entityType: "TelegramDraft",
    entityId: draft.id,
    action: "TELEGRAM_DRAFT_CANCELLED",
    newValue: {
      type: draft.type,
    },
    userId: channel.userId,
    db,
  });

  return {
    ok: true as const,
    replyText: buildTelegramDraftCancelledMessage(draft.type === "PAYMENT_CAPTURE" ? "Pago" : "Póliza"),
  };
}

async function continueTelegramDraftFromMessage(input: {
  chatId: string;
  text: string;
  client?: DbClient;
}) {
  const db = input.client ?? getDb();
  const { channel, draft } = await getActiveTelegramDraftForChat(input.chatId, db);
  if (!channel) return null;
  if (!draft) return null;

  const payload = parseTelegramDraftState(draft.payloadJson);
  if (!payload) {
    return {
      handled: true as const,
      chatId: input.chatId,
      replyText: "El borrador está dañado. Cancélalo y vuelve a intentarlo.",
    };
  }

  const text = input.text.trim();
  if (!text) return null;

  if (payload.type === "PAYMENT_CAPTURE") {
    const state = buildPaymentDraftStateFromInput(payload.payment ?? {});
    switch (state.step) {
      case "policyNumber":
        state.policyNumber = text;
        state.step = getNextPaymentStep(state);
        break;
      case "receiptNumber":
        state.receiptNumber = text;
        state.step = getNextPaymentStep(state);
        break;
      case "amount": {
        const amount = Number(text.replace(/,/g, ""));
        if (!Number.isFinite(amount) || amount <= 0) {
          return {
            handled: true as const,
            chatId: input.chatId,
            replyText: "El monto debe ser mayor a cero. Intenta de nuevo.",
          };
        }
        state.amount = amount;
        state.step = getNextPaymentStep(state);
        break;
      }
      case "paidDate": {
        const paidDate = parseTelegramIsoDate(text);
        if (!paidDate) {
          return {
            handled: true as const,
            chatId: input.chatId,
            replyText: "La fecha debe tener formato YYYY-MM-DD. Intenta de nuevo.",
          };
        }
        state.paidDate = paidDate.toISOString().slice(0, 10);
        state.step = getNextPaymentStep(state);
        break;
      }
      case "paymentMethod":
        state.paymentMethod = text;
        state.step = getNextPaymentStep(state);
        break;
      case "ready":
        return {
          handled: true as const,
          chatId: input.chatId,
          replyText: buildTelegramPaymentDraftMessage({
            policyNumber: state.policyNumber ?? "—",
            receiptNumber: state.receiptNumber ?? "—",
            clientName: "—",
            amount: formatCurrency(state.amount ?? 0, "MXN"),
            paymentMethod: state.paymentMethod ?? "—",
            paidDate: state.paidDate ?? "—",
            reference: state.reference,
          }),
        };
    }

    const nextPayload: TelegramDraftState = {
      type: "PAYMENT_CAPTURE",
      payment: state,
    };
    await persistTelegramDraftState({ draftId: draft.id, state: nextPayload, client: db });

    if (state.step === "ready") {
      const receipt =
        state.policyNumber && state.receiptNumber
          ? await getUserLinkedReceiptByPolicyAndNumber(channel.userId, state.policyNumber, state.receiptNumber, db)
          : null;
      if (!receipt) {
        return {
          handled: true as const,
          chatId: input.chatId,
          replyText: "No encontré un recibo único para esa póliza y ese número. Revisa los datos o usa /cancelar para empezar de nuevo.",
        };
      }

      const confirmedPayload: TelegramDraftState = {
        type: "PAYMENT_CAPTURE",
        payment: {
          ...state,
          receiptNumber: receipt.receiptNumber,
          policyNumber: receipt.policy.policyNumber,
          amount: state.amount,
          paidDate: state.paidDate,
          paymentMethod: state.paymentMethod,
          reference: state.reference ?? null,
        },
      };
      await persistTelegramDraftState({ draftId: draft.id, state: confirmedPayload, client: db });

      return {
        handled: true as const,
        chatId: input.chatId,
        replyText: buildTelegramPaymentDraftMessage({
          policyNumber: receipt.policy.policyNumber,
          receiptNumber: receipt.receiptNumber,
          clientName: receipt.client.fullName,
          amount: formatCurrency(state.amount ?? 0, receipt.currency),
          paymentMethod: state.paymentMethod ?? "",
          paidDate: formatTelegramDate(new Date(`${state.paidDate}T12:00:00.000Z`)),
          reference: state.reference,
        }),
      };
    }

    return {
      handled: true as const,
      chatId: input.chatId,
      replyText: getTelegramPaymentPrompt(state.step),
    };
  }

  const state = buildPolicyDraftStateFromInput(payload.policy ?? {});
  switch (state.step) {
    case "policyNumber":
      state.policyNumber = text;
      break;
    case "clientName":
      state.clientName = text;
      break;
    case "insurerName":
      state.insurerName = text;
      break;
    case "policyType":
      state.policyType = text;
      break;
    case "startDate":
      if (!parseTelegramIsoDate(text)) {
        return {
          handled: true as const,
          chatId: input.chatId,
          replyText: "La fecha debe tener formato YYYY-MM-DD. Intenta de nuevo.",
        };
      }
      state.startDate = text;
      break;
    case "endDate":
      if (!parseTelegramIsoDate(text)) {
        return {
          handled: true as const,
          chatId: input.chatId,
          replyText: "La fecha debe tener formato YYYY-MM-DD. Intenta de nuevo.",
        };
      }
      state.endDate = text;
      break;
    case "premiumAmount": {
      const premiumAmount = Number(text.replace(/,/g, ""));
      if (!Number.isFinite(premiumAmount) || premiumAmount <= 0) {
        return {
          handled: true as const,
          chatId: input.chatId,
          replyText: "La prima debe ser mayor a cero. Intenta de nuevo.",
        };
      }
      state.premiumAmount = premiumAmount;
      break;
    }
    case "paymentFrequency":
      state.paymentFrequency = text;
      break;
    case "ready":
      return {
        handled: true as const,
        chatId: input.chatId,
        replyText: buildTelegramPolicyDraftMessage({
          policyNumber: state.policyNumber ?? null,
          summary: buildPolicyDraftSummary({
            policynumber: state.policyNumber ?? "",
            client: state.clientName ?? "",
            insurer: state.insurerName ?? "",
            type: state.policyType ?? "",
            start: state.startDate ?? "",
            end: state.endDate ?? "",
            premium: String(state.premiumAmount ?? ""),
            frequency: state.paymentFrequency ?? "",
          }),
          link: buildPolicyDeskUrl(`/policies/new?telegramDraft=${draft.id}`),
        }),
      };
  }

  state.step = getNextPolicyStep(state);
  const nextPayload: TelegramDraftState = {
    type: "POLICY_CAPTURE",
    policy: state,
  };
  await persistTelegramDraftState({ draftId: draft.id, state: nextPayload, client: db });

  if (state.step === "ready") {
    const link = buildPolicyDeskUrl(`/policies/new?telegramDraft=${draft.id}`);
    return {
      handled: true as const,
      chatId: input.chatId,
      replyText: buildTelegramPolicyDraftMessage({
        policyNumber: state.policyNumber ?? null,
        summary: buildPolicyDraftSummary({
          policynumber: state.policyNumber ?? "",
          client: state.clientName ?? "",
          insurer: state.insurerName ?? "",
          type: state.policyType ?? "",
          start: state.startDate ?? "",
          end: state.endDate ?? "",
          premium: String(state.premiumAmount ?? ""),
          frequency: state.paymentFrequency ?? "",
        }),
        link,
      }),
    };
  }

  return {
    handled: true as const,
    chatId: input.chatId,
    replyText: getTelegramPolicyPrompt(state.step),
  };
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
      user: {
        select: {
          timeZone: true,
          telegramDigestLastSentAt: true,
        },
      },
    },
  });

  const result: TelegramDailyDigestResult = {
    processed: channels.length,
    sent: 0,
    failed: 0,
  };
  const now = new Date();

  for (const channel of channels) {
    if (!channel.telegramChatId) continue;
    const timeZone = channel.user.timeZone ?? DEFAULT_TIMEZONE;
    if (
      channel.user.telegramDigestLastSentAt &&
      getLocalDateKey(channel.user.telegramDigestLastSentAt, timeZone) === getLocalDateKey(now, timeZone)
    ) {
      continue;
    }
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
        await markTelegramDigestAsSentForUser(channel.userId, now, db);
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
    if (message.chat.type !== "private") {
      return { handled: true, chatId };
    }

    const rateLimit = checkRateLimit(`telegram:draft:${chatId}`, TELEGRAM_DRAFT_CONTINUATION_RATE_LIMIT);
    if (!rateLimit.allowed) {
      return {
        handled: true,
        chatId,
        replyText: "Demasiados intentos. Espera un momento e inténtalo de nuevo.",
      };
    }

    const continuation = await continueTelegramDraftFromMessage({
      chatId,
      text: message.text,
    });
    return continuation ?? { handled: false };
  }

  try {
    if (message.chat.type !== "private") {
      return {
        handled: true,
        chatId,
      };
    }

    const rateLimit = checkRateLimit(`telegram:${chatId}:${command.command}`, TELEGRAM_COMMAND_RATE_LIMIT);
    if (!rateLimit.allowed) {
      return {
        handled: true,
        chatId,
        replyText: "Demasiados intentos. Espera un momento e inténtalo de nuevo.",
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
          replyText: buildTelegramStatusMessage(
            Boolean(channel?.isEnabled && channel.telegramChatId),
            Boolean(channel?.telegramMutationsEnabled),
          ),
        };
      }
      case "pago": {
        const result = await createTelegramPaymentDraft({
          chatId,
          argument: command.argument ?? "",
        });

        return {
          handled: true,
          chatId,
          replyText: result.replyText,
        };
      }
      case "poliza": {
        const result = await createTelegramPolicyDraft({
          chatId,
          argument: command.argument ?? "",
        });

        return {
          handled: true,
          chatId,
          replyText: result.replyText,
        };
      }
      case "confirmar": {
        const result = await confirmTelegramDraft({ chatId });
        return {
          handled: true,
          chatId,
          replyText: result.replyText,
        };
      }
      case "cancelar": {
        const result = await cancelTelegramDraft({ chatId });
        return {
          handled: true,
          chatId,
          replyText: result.replyText,
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
