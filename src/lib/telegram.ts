import { timingSafeEqual } from "node:crypto";
import { DEFAULT_TIMEZONE, daysUntil, formatDate } from "@/lib/dates";
import { businessAddDays, businessEndOfDay, businessStartOfDay, parseBusinessDateInput } from "@/lib/business-dates";
import { getOpenWorkItems } from "@/lib/list-queries";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/logger";
import { formatCurrency, toNumber } from "@/lib/money";
import { writeActivityLog } from "@/lib/activity-log";
import { assertOrganizationContextInTransaction, type OrganizationContext } from "@/lib/organization-context";
import { recordPayment } from "@/lib/payment-service";
import { buildPolicyPdfCapturePreviewFromText } from "@/lib/policy-pdf-capture-preview";
import { extractPdfTextFromBytes } from "@/lib/pdf-text-extraction";
import {
  createNotificationEvent,
  ensureNotificationDefaultsForUser,
  getLocalDateKey,
  markNotificationFailed,
  markNotificationSent,
  markNotificationSkipped,
  type NotificationChannelRecord,
  type NotificationEventRecord,
} from "@/lib/notification-foundation";
import {
  TELEGRAM_DIGEST_SECTION_LIMIT,
  TELEGRAM_LINK_TOKEN_TTL_MINUTES,
  TELEGRAM_QUERY_DEFAULT_DAYS,
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
  buildTelegramQualitasConfirmation,
  buildTelegramQualitasChannelPrompt,
  buildTelegramQualitasNoRecipientMessage,
  buildTelegramQualitasOutcomeMessage,
  buildTelegramQualitasPhonePrompt,
  buildTelegramQualitasPolicyPrompt,
  buildTelegramQualitasRecipientPrompt,
  buildTelegramQualitasSuccess,
  buildTelegramQualitasUnavailableMessage,
  buildTelegramStartMessage,
  buildTelegramStatusMessage,
  generateTelegramLinkCode,
  hashTelegramLinkCode,
  normalizeTelegramLinkCode,
  parseTelegramCommand,
  parseTelegramQueryDays,
} from "@/lib/telegram-shared";
import { globalSearch } from "@/lib/search";
import { getReceiptOriginLabel } from "@/lib/receipt-context";
import { isPaidWithinTolerance } from "@/lib/receipt-reconciliation";
import { normalizeMexicanPhone } from "@/lib/phone";
import { prepareWhatsAppReceiptReminderForContext } from "@/lib/whatsapp-reminder-service";
import { isSafeWhatsAppReminderUrl, selectWhatsAppPhone } from "@/lib/whatsapp-reminder";
import { ACTIVE_RENEWAL_POLICY_WHERE } from "@/lib/renewal-decisions";
import { shouldIncludeInRenewals } from "@/lib/renewals.logic";
import { checkDistributedRateLimit, securityFingerprint } from "@/lib/request-guards";
import {
  isQualitasInsurerName,
  isQualitasPaymentLinkEnabled,
  maskQualitasPhone,
  maskQualitasEmail,
  normalizeQualitasPhone,
  normalizeQualitasEmail,
  isQualitasClientRecipientEnabled,
  prepareQualitasPaymentLink,
  requestQualitasPaymentLink,
  type QualitasPaymentLinkOutcome,
  type QualitasPaymentLinkReason,
  type QualitasPaymentLinkResult,
  type QualitasPreparedPaymentLink,
  type QualitasPaymentLinkDeliveryMethod,
  type QualitasDeliveryRequest,
} from "@/lib/qualitas-payment-link";
import { OPEN_WORK_ITEM_STATUSES, countWorkItems } from "@/lib/work-queue";
import {
  birthdayAutomaticDedupeKey,
  buildBirthdayReminderMessage,
  getBirthdayRemindersForUser,
} from "@/lib/birthday-reminders";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

async function requireActiveTelegramOrganization(userId: string, db: DbClient): Promise<string> {
  const membership = await db.organizationMembership.findFirst({
    where: {
      userId,
      active: true,
      user: { active: true },
      organization: { status: "ACTIVE" },
    },
    select: { organizationId: true },
  });
  if (!membership) throw new Error("ORGANIZATION_ACCESS_DENIED");
  return membership.organizationId;
}
type TelegramReceiptItem = {
  id: string;
  receiptNumber: string;
  policyNumber: string;
  clientName: string;
  insurerName: string;
  originLabel: string;
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
type TelegramDigestCommissionItem = {
  id: string;
  clientName: string;
  policyNumber: string | null;
  insurerName: string;
  expectedDate: Date | null;
  amount: number;
  currency: string;
};
type TelegramListResult<T> = {
  total: number;
  items: T[];
};

type TelegramDigestMessagePart = {
  title: string;
  body: string;
  replyMarkup?: TelegramInlineKeyboardMarkup;
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
  caption?: string;
  document?: {
    file_id: string;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
  };
};

type TelegramInlineKeyboardButton = {
  text: string;
  callback_data: string;
} | {
  text: string;
  url: string;
};

type TelegramInlineKeyboardMarkup = {
  inline_keyboard: TelegramInlineKeyboardButton[][];
};

type TelegramCallbackQuery = {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
};

export type TelegramWebhookUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
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

export type TelegramCallbackResult =
  | { ok: true }
  | { ok: false; error: string };

export type TelegramWebhookProcessResult = {
  handled: boolean;
  chatId?: string;
  replyText?: string;
  draftId?: string;
  replyMarkup?: TelegramInlineKeyboardMarkup;
  callbackQueryId?: string;
  removeReplyMarkup?: boolean;
  callbackAnswerText?: string;
};

export type TelegramDailyDigestResult = {
  processed: number;
  sent: number;
  failed: number;
  parts: number;
};

export type TelegramBirthdayReminderResult = {
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
  birthdayCount: number;
};

export type TelegramDailyBirthdaysResult = {
  processed: number;
  sent: number;
  skipped: number;
  failed: number;
  birthdayCount: number;
};

export type TelegramWebhookSyncResult =
  | {
      ok: true;
      webhookUrl: string;
      message: string;
    }
  | {
      ok: false;
      error: string;
    };

type TelegramPaymentDraftState = {
  step:
    | "policyNumber"
    | "receiptNumber"
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

type TelegramQualitasPaymentLinkDraftState = {
  step: "policyNumber" | "recipient" | "channel" | "phone" | "ready";
  policyId?: string;
  policyNumber?: string;
  clientId?: string;
  clientName?: string;
  clientEmail?: string | null;
  clientPhone?: string | null;
  agentUserId?: string;
  agentEmail?: string | null;
  agentPhone?: string | null;
  recipient?: "CLIENT" | "AGENT";
  recipientEmail?: string;
  recipientPhone?: string;
  deliveryMethod?: QualitasPaymentLinkDeliveryMethod;
  destinationSource?: "PROFILE" | "MANUAL";
  originatingReceiptId?: string;
  originatingReceiptNumber?: string;
  originatingDueDate?: string;
  originatingAmount?: number;
  originatingCurrency?: string;
  correlationId?: string;
  submissionState?: "NOT_STARTED" | "STARTED" | "ACKNOWLEDGED";
};

type TelegramDraftState = {
  type: "PAYMENT_CAPTURE" | "POLICY_CAPTURE" | "QUALITAS_PAYMENT_LINK" | "WHATSAPP_RECEIPT_REMINDER";
  payment?: TelegramPaymentDraftState;
  policy?: TelegramPolicyDraftState;
  qualitas?: TelegramQualitasPaymentLinkDraftState;
  whatsappReminder?: TelegramWhatsAppReceiptReminderDraftState;
};

type TelegramWhatsAppReceiptReminderDraftState = {
  step: "receipt" | "phone" | "ready";
  receiptId?: string;
  policyNumber?: string;
  receiptNumber?: string;
  clientName?: string;
  capturedPhone?: string;
};

const TELEGRAM_DRAFT_TTL_MS = 2 * 60 * 60 * 1000;
const TELEGRAM_MESSAGE_LIMIT = 3900;
const TELEGRAM_COMMAND_RATE_LIMIT = {
  limit: 40,
  windowMs: 15 * 60 * 1000,
};
const TELEGRAM_DRAFT_CONTINUATION_RATE_LIMIT = {
  limit: 30,
  windowMs: 15 * 60 * 1000,
};

const TELEGRAM_QUALITAS_RATE_LIMITS = {
  user: { limit: 5, windowMs: 15 * 60 * 1000 },
  organization: { limit: 20, windowMs: 15 * 60 * 1000 },
  policy: { limit: 2, windowMs: 60 * 60 * 1000 },
};

function logQualitasTrace(input: {
  correlationId: string;
  organizationId: string;
  policyId: string;
  userId: string;
  providerStep: "entrypoint" | "policy_lookup" | "pagar_ahora" | "contact_form" | "final_submission";
  deliveryChannel: QualitasPaymentLinkDeliveryMethod;
  outcome: QualitasPaymentLinkOutcome;
  reason: QualitasPaymentLinkReason;
  durationMs: number;
}) {
  if (typeof console === "undefined") return;
  console.info("[qualitas.payment_link.trace]", JSON.stringify({
    event: "qualitas.payment_link.trace",
    correlationId: input.correlationId,
    organizationId: input.organizationId,
    policyId: input.policyId,
    userId: input.userId,
    providerStep: input.providerStep,
    deliveryChannel: input.deliveryChannel,
    outcome: input.outcome,
    reason: input.reason,
    durationMs: input.durationMs,
    timestamp: new Date().toISOString(),
  }));
}

const TELEGRAM_FETCH_TIMEOUT_MS = 8_000;
const TELEGRAM_DATE_FORMATTER = new Intl.DateTimeFormat("es-MX", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: DEFAULT_TIMEZONE,
});

function getTelegramBotToken() {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() || null;
}

function isTelegramPdfDocument(document?: {
  file_id: string;
  file_name?: string;
  mime_type?: string;
}) {
  if (!document) return false;
  if (document.mime_type === "application/pdf") return true;
  return document.file_name?.trim().toLowerCase().endsWith(".pdf") ?? false;
}

function getTelegramWebhookSecret() {
  return process.env.TELEGRAM_WEBHOOK_SECRET?.trim() || null;
}

function normalizeBaseUrlCandidate(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    return new URL(withScheme);
  } catch {
    return null;
  }
}

function isTelegramMutationsEnabled(channel?: {
  telegramMutationsEnabled?: boolean | null;
  isEnabled?: boolean | null;
  telegramChatId?: string | null;
}) {
  return Boolean(channel?.isEnabled && channel?.telegramChatId && channel.telegramMutationsEnabled);
}

function createFallbackTelegramChannelState(userId: string): NotificationChannelRecord {
  return {
    id: "",
    userId,
    type: "TELEGRAM",
    telegramChatId: null,
    isEnabled: false,
    telegramMutationsEnabled: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

export function getTelegramWebhookUrl() {
  const configuredBaseUrl = process.env.APP_BASE_URL?.trim();
  const resolvedBaseUrl =
    process.env.NODE_ENV === "production"
      ? configuredBaseUrl
        ? (() => {
            try {
              return new URL(configuredBaseUrl);
            } catch {
              return null;
            }
          })()
        : null
      : normalizeBaseUrlCandidate(configuredBaseUrl) ?? normalizeBaseUrlCandidate("http://localhost:3000");

  if (
    !resolvedBaseUrl ||
    !resolvedBaseUrl.hostname ||
    resolvedBaseUrl.username ||
    resolvedBaseUrl.password ||
    resolvedBaseUrl.search ||
    resolvedBaseUrl.hash ||
    resolvedBaseUrl.pathname !== "/" ||
    !["http:", "https:"].includes(resolvedBaseUrl.protocol) ||
    (process.env.NODE_ENV === "production" && resolvedBaseUrl.protocol !== "https:")
  ) {
    return null;
  }

  return new URL("/api/integrations/telegram/webhook", resolvedBaseUrl.origin).toString();
}

function getTelegramFileDownloadUrl(filePath: string) {
  const token = getTelegramBotToken();
  if (!token) return null;
  return `https://api.telegram.org/file/bot${token}/${filePath}`;
}

async function downloadTelegramPdfBytes(fileId: string) {
  const token = getTelegramBotToken();
  if (!token) {
    return { ok: false as const, error: "TELEGRAM_BOT_TOKEN no está configurado." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEGRAM_FETCH_TIMEOUT_MS);

  try {
    const fileResponse = await fetch(`https://api.telegram.org/bot${token}/getFile`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ file_id: fileId }),
      signal: controller.signal,
    });

    const filePayload = (await fileResponse.json().catch(() => null)) as
      | { ok?: boolean; result?: { file_path?: string }; description?: string }
      | null;

    if (!fileResponse.ok || !filePayload?.ok || !filePayload.result?.file_path) {
      return {
        ok: false as const,
        error: filePayload?.description ?? `Telegram respondió con estado ${fileResponse.status}.`,
      };
    }

    const downloadUrl = getTelegramFileDownloadUrl(filePayload.result.file_path);
    if (!downloadUrl) {
      return { ok: false as const, error: "No se pudo construir la URL de descarga del documento." };
    }

    const downloadResponse = await fetch(downloadUrl, { signal: controller.signal });
    if (!downloadResponse.ok) {
      return {
        ok: false as const,
        error: `No se pudo descargar el PDF desde Telegram (${downloadResponse.status}).`,
      };
    }

    const bytes = new Uint8Array(await downloadResponse.arrayBuffer());
    return { ok: true as const, bytes };
  } catch (error) {
    logError("telegram.downloadPdf", error, { fileId });
    return { ok: false as const, error: "No se pudo descargar el PDF desde Telegram." };
  } finally {
    clearTimeout(timeout);
  }
}

function getTelegramLinkSecret() {
  const secret = process.env.SESSION_SECRET ?? process.env.AUTH_SECRET;
  if (secret && secret.length >= 16) {
    return secret;
  }
  return "policydesk-dev-secret-change-in-production-please-0123456789";
}

export async function syncTelegramWebhook(): Promise<TelegramWebhookSyncResult> {
  const token = getTelegramBotToken();
  const webhookUrl = getTelegramWebhookUrl();
  const secret = getTelegramWebhookSecret();

  if (!token) {
    return { ok: false, error: "TELEGRAM_BOT_TOKEN no está configurado." };
  }

  if (!webhookUrl) {
    return { ok: false, error: "No pude construir la URL del webhook de Telegram." };
  }

  if (!secret) {
    return { ok: false, error: "TELEGRAM_WEBHOOK_SECRET no está configurado." };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEGRAM_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: secret,
        drop_pending_updates: false,
      }),
      signal: controller.signal,
    });

    const payload = (await response.json().catch(() => null)) as
      | { ok?: boolean; description?: string }
      | null;

    if (!response.ok || !payload?.ok) {
      return {
        ok: false,
        error: payload?.description ?? `Telegram respondió con estado ${response.status}.`,
      };
    }

    return {
      ok: true,
      webhookUrl,
      message: "Webhook de Telegram sincronizado con el dominio actual.",
    };
  } catch (error) {
    logError("telegram.syncWebhook", error, { webhookUrl });
    return {
      ok: false,
      error: "No se pudo sincronizar el webhook de Telegram.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeChatId(chatId: string | number) {
  return String(chatId);
}

function getAppBaseUrl() {
  return (
    normalizeBaseUrlCandidate(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
    normalizeBaseUrlCandidate(process.env.APP_BASE_URL) ??
    normalizeBaseUrlCandidate(process.env.NEXT_PUBLIC_APP_URL) ??
    normalizeBaseUrlCandidate(process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ??
    (process.env.NODE_ENV !== "production" ? normalizeBaseUrlCandidate("http://localhost:3000") : null)
  );
}

function buildPolicyDeskUrl(path: string) {
  const baseUrl = getAppBaseUrl();
  if (!baseUrl) return null;
  return new URL(path, baseUrl).toString();
}

function toTelegramDraftState(payloadJson: string): TelegramDraftState | null {
  try {
    const parsed = JSON.parse(payloadJson) as TelegramDraftState;
    if (
      !parsed ||
      (parsed.type !== "PAYMENT_CAPTURE" &&
        parsed.type !== "POLICY_CAPTURE" &&
        parsed.type !== "QUALITAS_PAYMENT_LINK" &&
        parsed.type !== "WHATSAPP_RECEIPT_REMINDER")
    ) {
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
    case "paidDate":
      return "Escribe la fecha del pago. Puedes responder hoy o usar YYYY-MM-DD.";
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

function formatTelegramDate(date: Date, timeZone = DEFAULT_TIMEZONE) {
  if (timeZone === DEFAULT_TIMEZONE) return TELEGRAM_DATE_FORMATTER.format(date);
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone,
  }).format(date);
}

function formatTelegramPaymentDateLabel(paidDate: string) {
  return paidDate === getLocalDateKey(new Date())
    ? "hoy"
    : formatDate(parseBusinessDateInput(paidDate), "dd/MM/yyyy");
}

function formatTelegramNotificationText(title: string, body: string) {
  const text = `${title.trim()}\n\n${body.trim()}`.trim();
  if (text.length <= 3900) return text;
  return `${text.slice(0, 3899)}…`;
}

function getDigestDateKey(now: Date, timeZone: string | null | undefined) {
  return getLocalDateKey(now, timeZone ?? DEFAULT_TIMEZONE);
}

export async function markTelegramDigestAsAutoSentForUser(
  userId: string,
  sentAt = new Date(),
  timeZone = DEFAULT_TIMEZONE,
  client?: DbClient,
) {
  const db = client ?? getDb();
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) return null;

    const updated = await db.user.update({
      where: { id: userId },
      data: {
        telegramDigestLastAutoSentAt: sentAt,
      },
      select: { id: true, telegramDigestLastAutoSentAt: true },
    });

    return {
      ...updated,
      digestDateKey: getDigestDateKey(sentAt, timeZone),
    };
  } catch (error) {
    logError("telegram.markDigestAutoSent", error, { userId });
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

type ActiveTelegramIdentity = {
  channel: NonNullable<Awaited<ReturnType<typeof getTelegramChannelByChatId>>>;
  organizationId: string;
  membershipRole: string;
  context: OrganizationContext;
  user: { id: string; email: string; name: string; phone: string | null; active: boolean };
};

async function getActiveTelegramIdentityForChat(chatId: string, client?: DbClient): Promise<ActiveTelegramIdentity | null> {
  const db = client ?? getDb();
  const channel = await getTelegramChannelByChatId(chatId, db);
  if (!channel?.isEnabled || channel.telegramChatId !== chatId) return null;

  const memberships = await db.organizationMembership.findMany({
    where: { userId: channel.userId },
    select: {
      id: true,
      organizationId: true,
      role: true,
      active: true,
      organization: { select: { id: true, name: true, slug: true, status: true } },
      user: { select: { id: true, email: true, name: true, phone: true, active: true, role: true, platformRole: true } },
    },
    take: 2,
  });

  if (memberships.length !== 1) return null;
  const membership = memberships[0];
  if (!membership || !membership.active || membership.organization.status !== "ACTIVE" || !membership.user.active) {
    return null;
  }

  return {
    channel,
    organizationId: membership.organizationId,
    membershipRole: membership.role,
    context: {
      userId: membership.user.id,
      userEmail: membership.user.email,
      userName: membership.user.name,
      userRole: membership.user.role,
      platformRole: membership.user.platformRole,
      organizationId: membership.organization.id,
      organizationName: membership.organization.name,
      organizationSlug: membership.organization.slug,
      organizationStatus: membership.organization.status,
      membershipId: membership.id,
      membershipRole: membership.role as OrganizationContext["membershipRole"],
    },
    user: membership.user,
  };
}

function parseTelegramIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  return parseBusinessDateInput(value);
}

export function parseTelegramPaymentDateInput(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "hoy" || normalized === "today") {
    return getLocalDateKey(new Date());
  }

  const parsed = parseTelegramIsoDate(value);
  return parsed ? parsed.toISOString().slice(0, 10) : null;
}

async function getActiveTelegramDraftForChat(chatId: string, client?: DbClient) {
  const db = client ?? getDb();
  const channel = await getTelegramChannelByChatId(chatId, db);
  if (!channel?.isEnabled) {
    return { channel: null, draft: null };
  }
  const organizationId = await requireActiveTelegramOrganization(channel.userId, db);

  const draft = await db.telegramDraft.findFirst({
    where: {
      organizationId,
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

function buildTelegramPolicyDraftPayloadFromPreview(preview: {
  draft: {
    policyNumber: string;
    clientName: string;
    insurerName: string;
    policyType: string;
    serialNumber: string | null;
    startDate: string;
    endDate: string;
    paymentFrequency: string;
    paymentPlan: string | null;
    premiumAmount: number;
    currency: string;
    requestNumber: string | null;
    insuredObject: string | null;
    beneficiaryInfo: string | null;
    notes: string | null;
    sourcePolicyNumber: string | null;
  };
  suggestions: {
    clientId: string | null;
    insurerId: string | null;
    sourcePolicyId: string | null;
  };
  aiReview: {
    summary: string;
    warnings: string[];
    suggestions: string[];
    corrections: Array<{
      field: string;
      proposedValue: string;
      reason: string;
      confidence: "high" | "medium" | "low";
    }>;
  } | null;
}) {
  return {
    type: "POLICY_CAPTURE" as const,
    policy: {
      step: "ready" as const,
      policyNumber: preview.draft.policyNumber,
      clientName: preview.draft.clientName,
      insurerName: preview.draft.insurerName,
      policyType: preview.draft.policyType,
      startDate: preview.draft.startDate,
      endDate: preview.draft.endDate,
      premiumAmount: preview.draft.premiumAmount,
      paymentFrequency: preview.draft.paymentFrequency,
      sourcePolicyNumber: preview.draft.sourcePolicyNumber,
    },
    policynumber: preview.draft.policyNumber,
    client: preview.draft.clientName,
    insurer: preview.draft.insurerName,
    policytype: preview.draft.policyType,
    start: preview.draft.startDate,
    end: preview.draft.endDate,
    premium: preview.draft.premiumAmount,
    currency: preview.draft.currency,
    frequency: preview.draft.paymentFrequency,
    paymentplan: preview.draft.paymentPlan,
    object: preview.draft.insuredObject,
    beneficiary: preview.draft.beneficiaryInfo,
    notes: preview.draft.notes,
    sourcepolicy: preview.draft.sourcePolicyNumber,
    clientid: preview.suggestions.clientId,
    insurerid: preview.suggestions.insurerId,
    sourcepolicyid: preview.suggestions.sourcePolicyId,
    aiReview: preview.aiReview,
  };
}

export function parseTelegramPaymentArgument(argument: string) {
  const parts = argument.split(/\s+/).filter(Boolean);
  const state: TelegramPaymentDraftState = { step: "policyNumber" };

  if (parts[0]) state.policyNumber = parts[0];
  if (parts[1]) state.receiptNumber = parts[1];

  const rest = parts.slice(2);
  const firstToken = rest[0] ?? null;
  const secondToken = rest[1] ?? null;

  if (firstToken) {
    const firstDate = parseTelegramPaymentDateInput(firstToken);
    if (firstDate) {
      state.paidDate = firstDate;
      if (secondToken) {
        state.paymentMethod = secondToken;
      }
      if (rest.length > 2) {
        state.reference = rest.slice(2).join(" ").trim() || null;
      }
    } else {
      state.paymentMethod = firstToken;
      if (secondToken) {
        const secondDate = parseTelegramPaymentDateInput(secondToken);
        if (secondDate) {
          state.paidDate = secondDate;
          if (rest.length > 2) {
            state.reference = rest.slice(2).join(" ").trim() || null;
          }
        } else {
          state.reference = rest.slice(1).join(" ").trim() || null;
        }
      }
    }
  }

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
  const organizationId = await requireActiveTelegramOrganization(userId, db);
  const exact = await db.receipt.findFirst({
    where: {
      organizationId,
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
      endorsement: { select: { endorsementNumber: true } },
    },
  });

  if (exact) return exact;

  const fuzzy = await db.receipt.findMany({
    where: {
      organizationId,
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
      endorsement: { select: { endorsementNumber: true } },
    },
    take: 2,
  });

  return fuzzy.length === 1 ? fuzzy[0] : null;
}

async function persistTelegramDraftState(input: {
  organizationId: string;
  draftId: string;
  state: TelegramDraftState;
  client?: DbClient;
  context?: OrganizationContext;
}) {
  const db = input.client ?? getDb();
  if (input.context) {
    return db.$transaction(async (tx) => {
      await assertOrganizationContextInTransaction(tx, input.context!);
      return tx.telegramDraft.update({
        where: { id: input.draftId, organizationId: input.organizationId },
        data: {
          payloadJson: stringifyTelegramDraftState(input.state),
          updatedAt: new Date(),
        },
      });
    });
  }
  return db.telegramDraft.update({
    where: { id: input.draftId, organizationId: input.organizationId },
    data: {
      payloadJson: stringifyTelegramDraftState(input.state),
      updatedAt: new Date(),
    },
  });
}

async function updateQualitasDraftState(input: {
  db: DbClient;
  context: OrganizationContext;
  draftId: string;
  userId: string;
  channelId: string;
  state: TelegramDraftState;
}) {
  return input.db.$transaction(async (tx) => {
    await assertOrganizationContextInTransaction(tx, input.context);
    return tx.telegramDraft.updateMany({
      where: {
        id: input.draftId,
        organizationId: input.context.organizationId,
        userId: input.userId,
        channelId: input.channelId,
        type: "QUALITAS_PAYMENT_LINK",
        status: "COLLECTING",
      },
      data: { payloadJson: stringifyTelegramDraftState(input.state), updatedAt: new Date() },
    });
  });
}

function buildPaymentDraftStateFromInput(input: {
  policyNumber?: string;
  receiptNumber?: string;
  paidDate?: string;
  paymentMethod?: string;
  reference?: string | null;
}): TelegramPaymentDraftState {
  const state: TelegramPaymentDraftState = {
    step: "policyNumber",
    policyNumber: input.policyNumber?.trim() || undefined,
    receiptNumber: input.receiptNumber?.trim() || undefined,
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

export async function sendTelegramMessage(
  chatId: string,
  text: string,
  replyMarkup?: TelegramInlineKeyboardMarkup,
): Promise<TelegramSendResult> {
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
        ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
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

export async function answerTelegramCallbackQuery(
  callbackQueryId: string,
  text?: string,
): Promise<TelegramCallbackResult> {
  const token = getTelegramBotToken();
  if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN no está configurado." };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEGRAM_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, ...(text ? { text } : {}) }),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
    if (!response.ok || !payload?.ok) {
      return { ok: false, error: payload?.description ?? `Telegram respondió con estado ${response.status}.` };
    }
    return { ok: true };
  } catch (error) {
    logError("telegram.answerCallbackQuery", error, { callbackQueryId });
    return { ok: false, error: "No se pudo confirmar la selección en Telegram." };
  } finally {
    clearTimeout(timeout);
  }
}

export async function removeTelegramInlineKeyboard(
  chatId: string,
  messageId: number,
): Promise<TelegramCallbackResult> {
  const token = getTelegramBotToken();
  if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN no está configurado." };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEGRAM_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/editMessageReplyMarkup`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
    if (!response.ok || !payload?.ok) {
      return { ok: false, error: payload?.description ?? `Telegram respondió con estado ${response.status}.` };
    }
    return { ok: true };
  } catch (error) {
    logError("telegram.removeInlineKeyboard", error, { chatId, messageId });
    return { ok: false, error: "No se pudo actualizar el teclado de Telegram." };
  } finally {
    clearTimeout(timeout);
  }
}

async function getTelegramReceipts(input: {
  userId: string;
  to: Date;
  from?: Date;
  limit: number;
  skip?: number;
  client?: DbClient;
}): Promise<TelegramListResult<TelegramReceiptItem>> {
  const db = input.client ?? getDb();
  const organizationId = await requireActiveTelegramOrganization(input.userId, db);

  const where: Prisma.ReceiptWhereInput = {
    organizationId,
    client: { portfolioOwnerId: input.userId },
    dueDate: {
      ...(input.from ? { gte: input.from } : {}),
      lte: input.to,
    },
    status: { in: ["PENDING", "OVERDUE"] },
  };

  const rows = await db.receipt.findMany({
    where: {
      ...where,
      policy: { status: { not: "CANCELLED" } },
    },
    include: {
      client: { select: { fullName: true } },
      insurer: { select: { name: true } },
      policy: { select: { policyNumber: true, status: true } },
      endorsement: { select: { endorsementNumber: true } },
      payments: { where: { status: "POSTED" }, select: { amount: true } },
    },
    orderBy: [{ dueDate: "asc" }, { receiptSequence: { sort: "asc", nulls: "last" } }, { receiptNumber: "asc" }, { id: "asc" }],
  });

  const eligibleRows = rows.filter((row) => {
    const amount = toNumber(row.amount);
    const paidAmount = row.payments.reduce((sum, payment) => sum + toNumber(payment.amount), 0);
    return !isPaidWithinTolerance(amount, paidAmount);
  });
  const pagedRows = eligibleRows.slice(input.skip ?? 0, (input.skip ?? 0) + input.limit);

  return {
    total: eligibleRows.length,
    items: pagedRows.map((row) => {
      const amount = toNumber(row.amount);
      const paidAmount = row.payments.reduce((sum, payment) => sum + toNumber(payment.amount), 0);
      return {
        id: row.id,
        receiptNumber: row.receiptNumber,
        policyNumber: row.policy.policyNumber,
        clientName: row.client.fullName,
        insurerName: row.insurer.name,
        originLabel: getReceiptOriginLabel(row),
        dueDate: row.dueDate,
        amount,
        balance: isPaidWithinTolerance(amount, paidAmount) ? 0 : Math.max(amount - paidAmount, 0),
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
  skip?: number;
  client?: DbClient;
}): Promise<TelegramListResult<TelegramRenewalItem>> {
  const db = input.client ?? getDb();
  const organizationId = await requireActiveTelegramOrganization(input.userId, db);

  const where: Prisma.PolicyWhereInput = {
    organizationId,
    client: { portfolioOwnerId: input.userId },
    endDate: { gte: input.from, lte: input.to },
    ...ACTIVE_RENEWAL_POLICY_WHERE,
  };

  const rows = await db.policy.findMany({
    where,
    include: {
      client: { select: { fullName: true } },
      insurer: { select: { name: true } },
      receipts: {
        orderBy: [{ periodEndDate: "desc" }, { dueDate: "desc" }, { createdAt: "desc" }],
        take: 1,
        select: { status: true },
      },
    },
    orderBy: [{ endDate: "asc" }, { policyNumber: "asc" }],
  });

  const eligibleRows = rows.filter((row) =>
    shouldIncludeInRenewals(row.status, row.endDate, row.receipts[0]?.status ?? null),
  );
  const pagedRows = eligibleRows.slice(input.skip ?? 0, (input.skip ?? 0) + input.limit);

  return {
    total: eligibleRows.length,
    items: pagedRows.map((row) => ({
      id: row.id,
      policyNumber: row.policyNumber,
      clientName: row.client.fullName,
      insurerName: row.insurer.name,
      endDate: row.endDate,
    })),
  };
}

function formatTelegramReceiptLine(item: TelegramReceiptItem, timeZone = DEFAULT_TIMEZONE) {
  const diff = daysUntil(item.dueDate);
  const dueLabel =
    diff < 0
      ? `vencido hace ${Math.abs(diff)} días`
      : diff === 0
        ? "vence hoy"
        : `vence en ${diff} días`;
  const balanceLabel =
    item.balance <= 0
      ? "pagado"
      : item.balance >= item.amount
        ? `por cobrar ${formatCurrency(item.balance, item.currency)}`
        : `saldo ${formatCurrency(item.balance, item.currency)} de ${formatCurrency(item.amount, item.currency)}`;

  return [
    `• ${item.clientName} · Póliza ${item.policyNumber} · ${item.insurerName}`,
    `  Recibo ${item.receiptNumber} · ${formatTelegramDate(item.dueDate, timeZone)} · ${dueLabel} · ${balanceLabel}`,
  ].join("\n");
}

function formatTelegramRenewalLine(item: TelegramRenewalItem, timeZone = DEFAULT_TIMEZONE) {
  const diff = daysUntil(item.endDate);
  const renewalLabel =
    diff < 0
      ? `vencida hace ${Math.abs(diff)} días`
      : diff === 0
        ? "vence hoy"
        : `vence en ${diff} días`;

  return [
    `• ${item.clientName} · Póliza ${item.policyNumber} · ${item.insurerName}`,
    `  ${formatTelegramDate(item.endDate, timeZone)} · ${renewalLabel}`,
  ].join("\n");
}

function formatTelegramCommissionLine(item: TelegramDigestCommissionItem, timeZone = DEFAULT_TIMEZONE) {
  return `• ${item.clientName} · ${item.policyNumber ?? "Sin póliza"} · ${item.insurerName}\n  ${item.expectedDate ? formatTelegramDate(item.expectedDate, timeZone) : "Sin fecha"} · ${formatCurrency(item.amount, item.currency)}`;
}

function buildTelegramSection(input: {
  title: string;
  total: number;
  lines: string[];
  emptyText: string;
  page?: number;
  totalPages?: number;
}) {
  return [
    `${input.title}: ${input.total}${input.page && input.totalPages ? ` · página ${input.page}/${input.totalPages}` : ""}`,
    ...(input.lines.length > 0 ? input.lines : [input.emptyText]),
  ].join("\n");
}

function getTelegramTotalPages(total: number) {
  return Math.max(1, Math.ceil(total / TELEGRAM_QUERY_RESULT_LIMIT));
}

function parseTelegramPage(argument: string | null) {
  if (!argument) {
    return { ok: true as const, page: 1 };
  }

  const normalized = argument.trim();
  if (!/^\d+$/.test(normalized)) {
    return {
      ok: false as const,
      error: "Usa un número de página válido.",
    };
  }

  const page = Number(normalized);
  if (!Number.isSafeInteger(page) || page < 1) {
    return {
      ok: false as const,
      error: "Usa un número de página válido.",
    };
  }

  return { ok: true as const, page };
}

function parseTelegramDaysAndPage(argument: string | null, defaultDays: number) {
  if (!argument) {
    return { ok: true as const, days: defaultDays, page: 1 };
  }

  const tokens = argument.trim().split(/\s+/).filter(Boolean);
  const days = parseTelegramQueryDays(tokens[0] ?? null, defaultDays);
  if (!days.ok) return days;

  if (tokens.length <= 1) {
    return { ok: true as const, days: days.days, page: 1 };
  }

  const page = parseTelegramPage(tokens[1] ?? null);
  if (!page.ok) return page;

  return { ok: true as const, days: days.days, page: page.page };
}

function splitTelegramMessageLines(lines: string[], maxLength = TELEGRAM_MESSAGE_LIMIT) {
  const parts: string[] = [];
  let current: string[] = [];

  const pushCurrent = () => {
    if (current.length > 0) {
      parts.push(current.join("\n"));
      current = [];
    }
  };

  for (const line of lines) {
    const candidate = current.length > 0 ? [...current, line].join("\n") : line;
    if (candidate.length <= maxLength) {
      current.push(line);
      continue;
    }

    pushCurrent();

    if (line.length <= maxLength) {
      current = [line];
      continue;
    }

    let start = 0;
    while (start < line.length) {
      const chunk = line.slice(start, start + maxLength);
      if (chunk.length === maxLength && start + maxLength < line.length) {
        parts.push(chunk);
      } else {
        current = [chunk];
      }
      start += maxLength;
    }
  }

  pushCurrent();

  return parts.filter(Boolean);
}

function getTelegramSummaryLabel(total: number, suffix: string) {
  return total === 1 ? `1 ${suffix}` : `${total} ${suffix}s`;
}

function formatTelegramDigestSummary(input: {
  dayStart: Date;
  timeZone: string;
  overdueReceipts: TelegramListResult<TelegramReceiptItem>;
  todayReceipts: TelegramListResult<TelegramReceiptItem>;
  upcomingReceipts: TelegramListResult<TelegramReceiptItem>;
  upcomingRenewals: TelegramListResult<TelegramRenewalItem>;
  pendingWorkItems: TelegramListResult<Awaited<ReturnType<typeof getOpenWorkItems>>[number]>;
  commissions: TelegramListResult<TelegramDigestCommissionItem>;
}) {
  return [
    "Resumen diario PolicyDesk",
    `Fecha: ${formatTelegramDate(input.dayStart, input.timeZone)}`,
    "",
    `Vencidos: ${getTelegramSummaryLabel(input.overdueReceipts.total, "recibo")}`,
    `Hoy: ${getTelegramSummaryLabel(input.todayReceipts.total, "recibo")}`,
    `Próximos 14 días: ${getTelegramSummaryLabel(input.upcomingReceipts.total, "recibo")}`,
    `Renovaciones 30 días: ${getTelegramSummaryLabel(input.upcomingRenewals.total, "póliza")}`,
    `Pendientes atrasados: ${getTelegramSummaryLabel(input.pendingWorkItems.total, "tarea")}`,
    `Comisiones por revisar: ${getTelegramSummaryLabel(input.commissions.total, "comisión")}`,
  ].join("\n");
}

function formatTelegramDigestDetailLines(input: {
  timeZone: string;
  overdueReceipts: TelegramListResult<TelegramReceiptItem>;
  todayReceipts: TelegramListResult<TelegramReceiptItem>;
  upcomingReceipts: TelegramListResult<TelegramReceiptItem>;
  upcomingRenewals: TelegramListResult<TelegramRenewalItem>;
  pendingWorkItems: TelegramListResult<Awaited<ReturnType<typeof getOpenWorkItems>>[number]>;
  commissions: TelegramListResult<TelegramDigestCommissionItem>;
}) {
  const sections = [
    buildTelegramSection({
      title: "Recibos vencidos",
      total: input.overdueReceipts.total,
      lines: input.overdueReceipts.items.map((item) => formatTelegramReceiptLine(item, input.timeZone)),
      emptyText: "Sin recibos vencidos.",
    }),
    buildTelegramSection({
      title: "Recibos de hoy",
      total: input.todayReceipts.total,
      lines: input.todayReceipts.items.map((item) => formatTelegramReceiptLine(item, input.timeZone)),
      emptyText: "Sin recibos pendientes para hoy.",
    }),
    buildTelegramSection({
      title: "Recibos próximos 14 días",
      total: input.upcomingReceipts.total,
      lines: input.upcomingReceipts.items.map((item) => formatTelegramReceiptLine(item, input.timeZone)),
      emptyText: "Sin recibos próximos.",
    }),
    buildTelegramSection({
      title: "Renovaciones próximas 30 días",
      total: input.upcomingRenewals.total,
      lines: input.upcomingRenewals.items.map((item) => formatTelegramRenewalLine(item, input.timeZone)),
      emptyText: "Sin renovaciones próximas.",
    }),
    buildTelegramSection({
      title: "Pendientes atrasados",
      total: input.pendingWorkItems.total,
      lines: input.pendingWorkItems.items.map((item) => formatTelegramTaskLine(item)),
      emptyText: "Sin tareas atrasadas.",
    }),
    buildTelegramSection({
      title: "Comisiones por revisar",
      total: input.commissions.total,
      lines: input.commissions.items.map((item) => formatTelegramCommissionLine(item, input.timeZone)),
      emptyText: "Sin comisiones por revisar.",
    }),
  ];

  return sections;
}

export function buildTelegramDailyDigestMessages(input: {
  dayStart: Date;
  timeZone: string;
  overdueReceipts: TelegramListResult<TelegramReceiptItem>;
  todayReceipts: TelegramListResult<TelegramReceiptItem>;
  upcomingReceipts: TelegramListResult<TelegramReceiptItem>;
  upcomingRenewals: TelegramListResult<TelegramRenewalItem>;
  pendingWorkItems: TelegramListResult<Awaited<ReturnType<typeof getOpenWorkItems>>[number]>;
  commissions: TelegramListResult<TelegramDigestCommissionItem>;
}): TelegramDigestMessagePart[] {
  const summary = formatTelegramDigestSummary(input);
  const detailLines = formatTelegramDigestDetailLines(input).flatMap((block, index) =>
    index === 0 ? block.split("\n") : ["", ...block.split("\n")],
  );
  const detailMessages = splitTelegramMessageLines(detailLines);

  return [
    {
      title: "Resumen diario PolicyDesk",
      body: summary,
      replyMarkup: {
        inline_keyboard: [[{ text: "Gestionar cobros", callback_data: DIGEST_MANAGE_CALLBACK }]],
      },
    },
    ...detailMessages.map((body, index) => ({
      title: detailMessages.length > 1 ? `Resumen diario PolicyDesk · detalle ${index + 1}/${detailMessages.length}` : "Resumen diario PolicyDesk · detalle",
      body,
    })),
  ];
}

export async function buildTelegramReceiptsReply(userId: string, days: number, page = 1, client?: DbClient) {
  void client;
  const dayStart = businessStartOfDay(new Date());
  const receipts = await getTelegramReceipts({
    userId,
    to: businessEndOfDay(businessAddDays(dayStart, days)),
    limit: TELEGRAM_QUERY_RESULT_LIMIT,
    skip: (page - 1) * TELEGRAM_QUERY_RESULT_LIMIT,
    client,
  });

  return buildTelegramSection({
    title: `Cobros vencidos y próximos (${days} días)`,
    total: receipts.total,
    lines: receipts.items.map((item) => formatTelegramReceiptLine(item)),
    emptyText: "No hay cobros pendientes en este rango.",
    page,
    totalPages: getTelegramTotalPages(receipts.total),
  });
}

export async function buildTelegramRenewalsReply(userId: string, days: number, page = 1, client?: DbClient) {
  void client;
  const dayStart = businessStartOfDay(new Date());
  const renewals = await getTelegramRenewals({
    userId,
    from: dayStart,
    to: businessEndOfDay(businessAddDays(dayStart, days)),
    limit: TELEGRAM_QUERY_RESULT_LIMIT,
    skip: (page - 1) * TELEGRAM_QUERY_RESULT_LIMIT,
    client,
  });

  return buildTelegramSection({
    title: `Renovaciones próximas (${days} días)`,
    total: renewals.total,
    lines: renewals.items.map((item) => formatTelegramRenewalLine(item)),
    emptyText: "No hay renovaciones próximas en este rango.",
    page,
    totalPages: getTelegramTotalPages(renewals.total),
  });
}

function formatTelegramTaskLine(item: Awaited<ReturnType<typeof getOpenWorkItems>>[number]) {
  const dueLabel = item.dueDate
    ? (() => {
        const diff = daysUntil(item.dueDate as Date);
        if (diff < 0) return `vencida hace ${Math.abs(diff)} días`;
        if (diff === 0) return "vence hoy";
        return `vence en ${diff} días`;
      })()
    : "sin fecha límite";
  const context = [
    item.client?.fullName ? `Cliente ${item.client.fullName}` : null,
    item.policy ? `Póliza ${item.policy.policyNumber}` : null,
    item.insurer ? item.insurer.name : null,
  ].filter(Boolean);
  const link = buildPolicyDeskUrl(`/tasks/${item.id}`);

  return [
    `• ${item.title}`,
    context.length > 0 ? `  ${context.join(" · ")}` : null,
    `  ${dueLabel} · prioridad ${item.priority.toLowerCase()}${link ? ` · Abrir: ${link}` : ""}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function formatTelegramSearchResultLine(result: Awaited<ReturnType<typeof globalSearch>>[number]) {
  const labelMap: Record<Awaited<ReturnType<typeof globalSearch>>[number]["type"], string> = {
    client: "Cliente",
    policy: "Póliza",
    receipt: "Recibo",
    workItem: "Tarea",
    claim: "Siniestro",
    quote: "Cotización",
    insurer: "Aseguradora",
    document: "Documento",
  };
  const details = [result.subtitle, result.parentLabel, result.details?.[0]].filter(Boolean);
  const link = buildPolicyDeskUrl(result.href);

  return [
    `• ${result.title}${labelMap[result.type] ? ` · ${labelMap[result.type]}` : ""}`,
    details.length > 0 ? `  ${details.join(" · ")}` : null,
    link ? `  Abrir: ${link}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

function getTelegramQueryRangeFromNow(days: number) {
  const dayStart = businessStartOfDay(new Date());
  return {
    from: businessAddDays(dayStart, 1),
    to: businessEndOfDay(businessAddDays(dayStart, days)),
    dayStart,
  };
}

export async function buildTelegramOverdueReply(userId: string, page = 1, client?: DbClient) {
  const dayStart = businessStartOfDay(new Date());
  const receipts = await getTelegramReceipts({
    userId,
    to: new Date(dayStart.getTime() - 1),
    limit: TELEGRAM_QUERY_RESULT_LIMIT,
    skip: (page - 1) * TELEGRAM_QUERY_RESULT_LIMIT,
    client,
  });

  return buildTelegramSection({
    title: "Cobros vencidos",
    total: receipts.total,
    lines: receipts.items.map((item) => formatTelegramReceiptLine(item)),
    emptyText: "Sin cobros vencidos.",
    page,
    totalPages: getTelegramTotalPages(receipts.total),
  });
}

export async function buildTelegramTodayReply(userId: string, page = 1, client?: DbClient) {
  const dayStart = businessStartOfDay(new Date());
  const dayEnd = businessEndOfDay(dayStart);
  const receipts = await getTelegramReceipts({
    userId,
    from: dayStart,
    to: dayEnd,
    limit: TELEGRAM_QUERY_RESULT_LIMIT,
    skip: (page - 1) * TELEGRAM_QUERY_RESULT_LIMIT,
    client,
  });

  return buildTelegramSection({
    title: "Cobros de hoy",
    total: receipts.total,
    lines: receipts.items.map((item) => formatTelegramReceiptLine(item)),
    emptyText: "Sin cobros para hoy.",
    page,
    totalPages: getTelegramTotalPages(receipts.total),
  });
}

export async function buildTelegramUpcomingReceiptsReply(userId: string, days: number, page = 1, client?: DbClient) {
  const { from, to } = getTelegramQueryRangeFromNow(days);
  const receipts = await getTelegramReceipts({
    userId,
    from,
    to,
    limit: TELEGRAM_QUERY_RESULT_LIMIT,
    skip: (page - 1) * TELEGRAM_QUERY_RESULT_LIMIT,
    client,
  });

  return buildTelegramSection({
    title: `Cobros próximos (${days} días)`,
    total: receipts.total,
    lines: receipts.items.map((item) => formatTelegramReceiptLine(item)),
    emptyText: "Sin cobros próximos.",
    page,
    totalPages: getTelegramTotalPages(receipts.total),
  });
}

export async function buildTelegramTasksReply(userId: string, days: number, page = 1, client?: DbClient) {
  const db = client ?? getDb();
  const organizationId = await requireActiveTelegramOrganization(userId, db);
  const dayStart = businessStartOfDay(new Date());
  const to = businessEndOfDay(businessAddDays(dayStart, days));
  const [total, tasks] = await Promise.all([
    countWorkItems({
      workItemTypes: ["TASK"],
      statuses: OPEN_WORK_ITEM_STATUSES,
      from: dayStart,
      to,
      portfolioOwnerId: userId,
      organizationId,
    }),
    getOpenWorkItems({
      from: dayStart,
      to,
      limit: TELEGRAM_QUERY_RESULT_LIMIT,
      skip: (page - 1) * TELEGRAM_QUERY_RESULT_LIMIT,
      portfolioOwnerId: userId,
      organizationId,
    }),
  ]);

  return buildTelegramSection({
    title: `Tareas próximas (${days} días)`,
    total,
    lines: tasks.map(formatTelegramTaskLine),
    emptyText: "Sin tareas próximas.",
    page,
    totalPages: getTelegramTotalPages(total),
  });
}

export async function buildTelegramSearchReply(userId: string, query: string, client?: DbClient) {
  void client;
  const normalized = query.trim();
  if (!normalized) {
    return "Escribe /buscar <texto> para buscar clientes, pólizas, recibos, tareas o archivos.";
  }

  const results = await globalSearch(normalized, userId);
  if (results.length === 0) {
    return `No encontré resultados para "${normalized}".`;
  }

  return buildTelegramSection({
    title: `Resultados para "${normalized}"`,
    total: results.length,
    lines: results.slice(0, TELEGRAM_QUERY_RESULT_LIMIT).map(formatTelegramSearchResultLine),
    emptyText: "Sin resultados.",
  });
}

export async function buildTelegramDailyDigest(userId: string, client?: DbClient) {
  const parts = await buildTelegramDailyDigestMessagesByUser(userId, client);
  return parts.map((part) => part.body).join("\n\n");
}

function getTimeZoneDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  return {
    year: Number(parts.find((part) => part.type === "year")?.value ?? 1970),
    month: Number(parts.find((part) => part.type === "month")?.value ?? 1),
    day: Number(parts.find((part) => part.type === "day")?.value ?? 1),
  };
}

function startOfDayInTimeZone(date: Date, timeZone: string) {
  const parts = getTimeZoneDateParts(date, timeZone);
  const utcMidnight = Date.UTC(parts.year, parts.month - 1, parts.day);
  const probe = new Date(utcMidnight);
  const probeParts = new Intl.DateTimeFormat("en-GB", { timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(probe);
  const localAsUtc = Date.UTC(
    Number(probeParts.find((part) => part.type === "year")?.value ?? parts.year),
    Number(probeParts.find((part) => part.type === "month")?.value ?? parts.month) - 1,
    Number(probeParts.find((part) => part.type === "day")?.value ?? parts.day),
    Number(probeParts.find((part) => part.type === "hour")?.value ?? 0),
    Number(probeParts.find((part) => part.type === "minute")?.value ?? 0),
  );
  return new Date(utcMidnight - (localAsUtc - utcMidnight));
}

export async function buildTelegramDailyDigestMessagesByUser(userId: string, client?: DbClient, timeZone = DEFAULT_TIMEZONE) {
  const db = client ?? getDb();
  const organizationId = await requireActiveTelegramOrganization(userId, db);
  const dayStart = startOfDayInTimeZone(new Date(), timeZone);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
  const tomorrowStart = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const upcomingEnd = new Date(dayStart.getTime() + 14 * 24 * 60 * 60 * 1000 - 1);
  const renewalEnd = new Date(dayStart.getTime() + 30 * 24 * 60 * 60 * 1000 - 1);
  const [overdueReceipts, todayReceipts, upcomingReceipts, upcomingRenewals, pendingRows, commissionRows] = await Promise.all([
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
      from: tomorrowStart,
      to: upcomingEnd,
      limit: TELEGRAM_DIGEST_SECTION_LIMIT,
      client,
    }),
    getTelegramRenewals({
      userId,
      from: dayStart,
      to: renewalEnd,
      limit: TELEGRAM_DIGEST_SECTION_LIMIT,
      client,
    }),
    getOpenWorkItems({ organizationId, to: dayStart, limit: TELEGRAM_DIGEST_SECTION_LIMIT, portfolioOwnerId: userId }),
    db.commission.findMany({
      where: {
        organizationId,
        client: { portfolioOwnerId: userId },
        expectedDate: { gte: dayStart, lte: new Date(dayStart.getTime() + 30 * 24 * 60 * 60 * 1000) },
        status: { in: ["EXPECTED", "PENDING", "OVERDUE"] },
      },
      include: { client: { select: { fullName: true } }, policy: { select: { policyNumber: true } }, insurer: { select: { name: true } } },
      orderBy: [{ expectedDate: "asc" }, { id: "asc" }],
      take: TELEGRAM_DIGEST_SECTION_LIMIT,
    }),
  ]);

  const commissions: TelegramListResult<TelegramDigestCommissionItem> = {
    total: commissionRows.length,
    items: commissionRows.map((row) => ({
      id: row.id,
      clientName: row.client.fullName,
      policyNumber: row.policy?.policyNumber ?? null,
      insurerName: row.insurer.name,
      expectedDate: row.expectedDate,
      amount: toNumber(row.actualAmount ?? row.expectedAmount),
      currency: "MXN",
    })),
  };

  return buildTelegramDailyDigestMessages({
    dayStart,
    timeZone,
    overdueReceipts,
    todayReceipts,
    upcomingReceipts,
    upcomingRenewals,
    pendingWorkItems: { total: pendingRows.length, items: pendingRows },
    commissions,
  });
}

export async function sendTelegramDigestMessagesForUser(input: {
  userId: string;
  client?: DbClient;
  mode: "manual" | "automatic";
  timeZone?: string;
}) {
  const db = input.client ?? getDb();
  const organizationId = await requireActiveTelegramOrganization(input.userId, db);
  const timeZone = input.timeZone ?? DEFAULT_TIMEZONE;
  const parts = await buildTelegramDailyDigestMessagesByUser(input.userId, db, timeZone);
  let sent = 0;
  let failed = 0;

  for (const part of parts) {
    const event = await createAndDeliverTelegramNotificationEvent({
      organizationId,
      type: "DAILY_DIGEST",
      title: part.title,
      body: part.body,
      priority: "LOW",
      userId: input.userId,
      force: true,
      replyMarkup: part.replyMarkup,
    });

    if (event?.status === "SENT") {
      sent += 1;
    } else {
      failed += 1;
    }
  }

  if (input.mode === "automatic" && sent > 0 && failed === 0) {
    await markTelegramDigestAsAutoSentForUser(input.userId, new Date(), timeZone, db);
  }

  return {
    processed: parts.length,
    sent,
    failed,
    parts: parts.length,
  };
}

export async function sendTelegramBirthdayReminderForUser(input: {
  userId: string;
  mode: "manual" | "automatic";
  client?: DbClient;
  timeZone?: string;
  now?: Date;
}): Promise<TelegramBirthdayReminderResult> {
  const db = input.client ?? getDb();
  const organizationId = await requireActiveTelegramOrganization(input.userId, db);
  const timeZone = input.timeZone ?? DEFAULT_TIMEZONE;
  const now = input.now ?? new Date();
  const birthdays = await getBirthdayRemindersForUser({
    organizationId,
    userId: input.userId,
    client: db,
    timeZone,
    now,
  });

  if (birthdays.length === 0) {
    return { processed: 0, sent: 0, skipped: 0, failed: 0, birthdayCount: 0 };
  }

  const message = buildBirthdayReminderMessage(birthdays, now, timeZone);
  const event = await createAndDeliverTelegramNotificationEvent({
    organizationId,
    type: "BIRTHDAY_REMINDER",
    title: message.title,
    body: message.body,
    priority: "LOW",
    userId: input.userId,
    dedupeKey: input.mode === "automatic" ? birthdayAutomaticDedupeKey(input.userId, now, timeZone) : null,
    force: input.mode === "manual",
  });

  if (event?.status === "SENT") {
    return { processed: 1, sent: 1, skipped: 0, failed: 0, birthdayCount: birthdays.length };
  }
  if (event?.status === "SKIPPED") {
    return { processed: 1, sent: 0, skipped: 1, failed: 0, birthdayCount: birthdays.length };
  }
  return { processed: 1, sent: 0, skipped: 0, failed: 1, birthdayCount: birthdays.length };
}

export async function sendDailyTelegramBirthdays(client?: DbClient): Promise<TelegramDailyBirthdaysResult> {
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
      user: { select: { timeZone: true } },
    },
  });

  const result: TelegramDailyBirthdaysResult = {
    processed: channels.length,
    sent: 0,
    skipped: 0,
    failed: 0,
    birthdayCount: 0,
  };

  for (const channel of channels) {
    try {
      const reminder = await sendTelegramBirthdayReminderForUser({
        userId: channel.userId,
        client: db,
        mode: "automatic",
        timeZone: channel.user.timeZone || DEFAULT_TIMEZONE,
      });
      result.sent += reminder.sent;
      result.skipped += reminder.skipped;
      result.failed += reminder.failed;
      result.birthdayCount += reminder.birthdayCount;
    } catch (error) {
      result.failed += 1;
      logError("telegram.sendDailyBirthdays", error, { userId: channel.userId });
    }
  }

  return result;
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
  const organizationId = await requireActiveTelegramOrganization(channel.userId, db);

  const parsed = parseTelegramPaymentArgument(input.argument);

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
        organizationId,
        userId: channel.userId,
        channelId: channel.id,
        status: "COLLECTING",
      },
      data: {
        organizationId,
        status: "CANCELLED",
        cancelledAt: new Date(),
      },
    });

    const state: TelegramDraftState = {
      type: "PAYMENT_CAPTURE",
      payment: parsed.state.step === "ready" && readyReceipt
        ? {
            ...parsed.state,
            amount: toNumber(readyReceipt.amount),
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
        organizationId,
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
            amount: toNumber(readyReceipt.amount),
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
    organizationId,
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
      originLabel: getReceiptOriginLabel(receipt),
      clientName: receipt.client.fullName,
      amount: formatCurrency(toNumber(receipt.amount), receipt.currency),
      paymentMethod: parsed.state.paymentMethod ?? "",
      paidDate: formatTelegramPaymentDateLabel(parsed.state.paidDate ?? getLocalDateKey(new Date())),
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
  const organizationId = await requireActiveTelegramOrganization(channel.userId, db);

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
        organizationId,
        userId: channel.userId,
        channelId: channel.id,
        type: "POLICY_CAPTURE",
        status: "COLLECTING",
      },
      data: {
        organizationId,
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
        organizationId,
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

async function createTelegramPolicyDraftFromPdf(input: {
  chatId: string;
  document: NonNullable<TelegramMessage["document"]>;
  caption?: string | null;
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
  const organizationId = await requireActiveTelegramOrganization(channel.userId, db);

  if (!isTelegramPdfDocument(input.document)) {
    return {
      ok: false as const,
      replyText: "Solo puedo analizar archivos PDF de pólizas por Telegram.",
    };
  }

  if (input.document.file_size && input.document.file_size > 12 * 1024 * 1024) {
    return {
      ok: false as const,
      replyText: "El PDF es muy grande para revisarlo por Telegram. Sube la carátula en PolicyDesk para revisarla ahí.",
    };
  }

  const download = await downloadTelegramPdfBytes(input.document.file_id);
  if (!download.ok) {
    return {
      ok: false as const,
      replyText: download.error,
    };
  }

  let extractedText = "";
  try {
    const extracted = await extractPdfTextFromBytes(download.bytes);
    extractedText = extracted.text;
  } catch (error) {
    logError("telegram.extractPdfFromBytes", error, {
      chatId: input.chatId,
      fileName: input.document.file_name,
    });
  }

  if (!extractedText.trim()) {
    return {
      ok: true as const,
      replyText: [
        "Recibí el PDF, pero no pude extraer texto útil de ese archivo.",
        "Puede ser un escaneo o una imagen incrustada. Súbelo en PolicyDesk para revisarlo con más detalle.",
        buildPolicyDeskUrl("/policies/capture") ? `Abre aquí la revisión: ${buildPolicyDeskUrl("/policies/capture")}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  const user = await db.user.findUnique({
    where: { id: channel.userId },
    select: { id: true, role: true },
  });

  const preview = await buildPolicyPdfCapturePreviewFromText(
    extractedText,
    db,
    {
      organizationId,
      portfolioOwnerId: user?.id,
      user: user ? { id: user.id, role: "AGENT" } : null,
    },
  );

  const payload = buildTelegramPolicyDraftPayloadFromPreview(preview);
  const draft = await db.$transaction(async (tx) => {
    await tx.telegramDraft.updateMany({
      where: {
        organizationId,
        userId: channel.userId,
        channelId: channel.id,
        type: "POLICY_CAPTURE",
        status: "COLLECTING",
      },
      data: {
        organizationId,
        status: "CANCELLED",
        cancelledAt: new Date(),
      },
    });

    return tx.telegramDraft.create({
      data: {
        organizationId,
        userId: channel.userId,
        channelId: channel.id,
        type: "POLICY_CAPTURE",
        status: "COLLECTING",
        payloadJson: JSON.stringify(payload),
        expiresAt: new Date(Date.now() + TELEGRAM_DRAFT_TTL_MS),
      },
    });
  });

  const link = buildPolicyDeskUrl(`/policies/new?telegramDraft=${draft.id}`);
  const summary = buildPolicyDraftSummary({
    policynumber: preview.draft.policyNumber,
    client: preview.draft.clientName,
    insurer: preview.draft.insurerName,
    type: preview.draft.policyType,
    start: preview.draft.startDate,
    end: preview.draft.endDate,
    premium: String(preview.draft.premiumAmount),
    frequency: preview.draft.paymentFrequency,
  });
  const aiSummary = preview.aiReview?.summary?.trim();
  const aiWarnings = preview.aiReview?.warnings ?? [];
  const aiSuggestions = preview.aiReview?.suggestions ?? [];

  const replyParts = [
    "PDF recibido y analizado.",
    input.document.file_name ? `Archivo: ${input.document.file_name}` : null,
    summary,
    aiSummary ? `Revisión IA: ${aiSummary}` : null,
    aiWarnings.length > 0 ? `Observaciones IA: ${aiWarnings.slice(0, 3).join(" · ")}` : null,
    aiSuggestions.length > 0 ? `Sugerencias IA: ${aiSuggestions.slice(0, 3).join(" · ")}` : null,
    link ? `Abre este enlace para revisar y guardar en PolicyDesk: ${link}` : "Abre PolicyDesk para revisar y guardar la póliza.",
  ].filter(Boolean);

  return {
    ok: true as const,
    replyText: replyParts.join("\n"),
    draftId: draft.id,
  };
}

const QUALITAS_CLIENT_CALLBACK = "qualitas_recipient_client";
const QUALITAS_AGENT_CALLBACK = "qualitas_recipient_agent";
const QUALITAS_EMAIL_CALLBACK = "qualitas_channel_email";
const QUALITAS_WHATSAPP_CALLBACK = "qualitas_channel_whatsapp";
const DIGEST_MANAGE_CALLBACK = "digest_manage_receipts";
const DIGEST_PAGE_PREFIX = "digest_receipts_page:";
const DIGEST_RECEIPT_PREFIX = "digest_receipt:";
const DIGEST_PAYMENT_PREFIX = "digest_payment:";
const DIGEST_QUALITAS_PREFIX = "digest_qualitas:";
const DIGEST_WHATSAPP_PREFIX = "digest_whatsapp:";
const WHATSAPP_REMINDER_CONFIRM_CALLBACK = "whatsapp_reminder_confirm";
const WHATSAPP_REMINDER_CANCEL_CALLBACK = "whatsapp_reminder_cancel";

function buildQualitasRecipientMarkup(state: TelegramQualitasPaymentLinkDraftState): TelegramInlineKeyboardMarkup {
  const buttons: TelegramInlineKeyboardButton[] = [];
  if (isQualitasClientRecipientEnabled() && (state.clientEmail || state.clientPhone)) buttons.push({ text: "Cliente", callback_data: QUALITAS_CLIENT_CALLBACK });
  if (state.agentEmail || state.agentPhone) buttons.push({ text: "Agente", callback_data: QUALITAS_AGENT_CALLBACK });
  return { inline_keyboard: [buttons] };
}

function buildQualitasChannelMarkup(state: TelegramQualitasPaymentLinkDraftState): TelegramInlineKeyboardMarkup {
  const buttons: TelegramInlineKeyboardButton[] = [];
  if (state.recipientEmail) buttons.push({ text: "Correo", callback_data: QUALITAS_EMAIL_CALLBACK });
  if (state.recipientPhone || state.recipient === "CLIENT" && state.clientPhone || state.recipient === "AGENT") {
    buttons.push({ text: "WhatsApp", callback_data: QUALITAS_WHATSAPP_CALLBACK });
  }
  return { inline_keyboard: [buttons] };
}

function buildQualitasRecipientPrompt(state: TelegramQualitasPaymentLinkDraftState) {
  return buildTelegramQualitasRecipientPrompt({
    clientEmail: state.clientEmail ? maskQualitasEmail(state.clientEmail) : null,
    clientPhone: state.clientPhone ? maskQualitasPhone(state.clientPhone) : null,
    agentEmail: state.agentEmail ? maskQualitasEmail(state.agentEmail) : null,
  });
}

function buildQualitasChannelPrompt(state: TelegramQualitasPaymentLinkDraftState) {
  const availablePhone = state.recipientPhone ?? (state.recipient === "CLIENT" ? state.clientPhone : state.agentPhone ?? null);
  return buildTelegramQualitasChannelPrompt({
    recipientLabel: state.recipient === "AGENT" ? "Agente" : "Cliente",
    maskedEmail: state.recipientEmail ? maskQualitasEmail(state.recipientEmail) : null,
    maskedPhone: availablePhone ? maskQualitasPhone(availablePhone) : null,
  });
}

function digestCallbackValue(prefix: string, id: string) {
  const value = `${prefix}${id}`;
  return value.length <= 64 ? value : null;
}

function buildDigestReceiptSelectionMarkup(items: TelegramReceiptItem[], page: number, totalPages: number): TelegramInlineKeyboardMarkup {
  const rows: Array<Array<{ text: string; callback_data: string }>> = items.map((item) => [{
    text: `${item.clientName.slice(0, 22)} · ${item.receiptNumber}`,
    callback_data: digestCallbackValue(DIGEST_RECEIPT_PREFIX, item.id) ?? DIGEST_MANAGE_CALLBACK,
  }]);
  const navigation: Array<{ text: string; callback_data: string }> = [];
  if (page > 1) navigation.push({ text: "‹ Anteriores", callback_data: `${DIGEST_PAGE_PREFIX}${page - 1}` });
  if (page < totalPages) navigation.push({ text: "Siguientes ›", callback_data: `${DIGEST_PAGE_PREFIX}${page + 1}` });
  if (navigation.length > 0) rows.push(navigation);
  return { inline_keyboard: rows };
}

async function buildTelegramReceiptListMarkup(input: {
  userId: string;
  from?: Date;
  to: Date;
  page: number;
  client?: DbClient;
}) {
  const receipts = await getTelegramReceipts({
    userId: input.userId,
    from: input.from,
    to: input.to,
    limit: TELEGRAM_QUERY_RESULT_LIMIT,
    skip: (input.page - 1) * TELEGRAM_QUERY_RESULT_LIMIT,
    client: input.client,
  });
  return receipts.items.length > 0
    ? buildDigestReceiptSelectionMarkup(receipts.items, input.page, getTelegramTotalPages(receipts.total))
    : undefined;
}

function buildDigestReceiptActionMarkup(input: { receiptId: string; isQualitas: boolean; canRecordPayment: boolean; canPrepareWhatsApp: boolean }): TelegramInlineKeyboardMarkup | undefined {
  const row: TelegramInlineKeyboardButton[] = [];
  const paymentCallback = digestCallbackValue(DIGEST_PAYMENT_PREFIX, input.receiptId);
  const qualitasCallback = digestCallbackValue(DIGEST_QUALITAS_PREFIX, input.receiptId);
  const whatsappCallback = digestCallbackValue(DIGEST_WHATSAPP_PREFIX, input.receiptId);
  if (input.canRecordPayment && paymentCallback) row.push({ text: "Registrar pago", callback_data: paymentCallback });
  if (input.isQualitas && qualitasCallback) row.push({ text: "Solicitar liga Quálitas", callback_data: qualitasCallback });
  if (input.canPrepareWhatsApp && whatsappCallback) row.push({ text: "Avisar por WhatsApp", callback_data: whatsappCallback });
  return row.length > 0 ? { inline_keyboard: [row] } : undefined;
}

function maskTelegramPhone(value: string) {
  const normalized = normalizeMexicanPhone(value);
  return normalized ? `+52 ••••${normalized.slice(-4)}` : "teléfono capturado";
}

function buildTelegramWhatsAppPhonePrompt() {
  return [
    "Este recibo no tiene un teléfono mexicano válido.",
    "Escribe 10 dígitos o un número con +52.",
    "El número se guardará como teléfono principal y permanecerá visible en este chat privado.",
    "Después podrás confirmar con /confirmar o cancelar con /cancelar.",
  ].join("\n");
}

function buildTelegramWhatsAppConfirmation(state: TelegramWhatsAppReceiptReminderDraftState) {
  return [
    "Teléfono listo para el recordatorio de WhatsApp.",
    state.capturedPhone ? `Destino: ${maskTelegramPhone(state.capturedPhone)}` : "Destino: teléfono guardado del cliente",
    "Se guardará el teléfono capturado si aún no existe y se preparará un mensaje editable.",
    "Pulsa Guardar y abrir WhatsApp, o responde /confirmar.",
  ].join("\n");
}

function buildTelegramWhatsAppPreparedMessage() {
  return "Recordatorio preparado. No se ha enviado ningún mensaje; revisa el texto en WhatsApp antes de pulsar Enviar.";
}

function buildTelegramWhatsAppPreparedMarkup(url: string): TelegramInlineKeyboardMarkup {
  if (!isSafeWhatsAppReminderUrl(url)) throw new Error("La URL de WhatsApp no es segura.");
  return { inline_keyboard: [[{ text: "Abrir WhatsApp · mensaje aún no enviado", url }]] };
}

function buildQualitasConfirmation(state: TelegramQualitasPaymentLinkDraftState) {
  return buildTelegramQualitasConfirmation({
    policyNumber: state.policyNumber ?? "—",
    clientName: state.clientName ?? "—",
    recipientLabel: state.recipient === "AGENT" ? "Agente" : "Cliente",
    deliveryMethod: state.deliveryMethod,
    maskedEmail: state.recipientEmail ? maskQualitasEmail(state.recipientEmail) : undefined,
    maskedPhone: state.recipientPhone ? maskQualitasPhone(state.recipientPhone) : undefined,
    originatingReceiptNumber: state.originatingReceiptNumber,
    originatingDueDate: state.originatingDueDate,
    originatingAmount: state.originatingAmount,
    originatingCurrency: state.originatingCurrency,
  });
}

function normalizeTelegramRecipientText(value: string) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "cliente" || normalized === "client") return "CLIENT" as const;
  if (normalized === "agente" || normalized === "agent") return "AGENT" as const;
  return null;
}

async function findAuthorizedQualitasPolicy(input: {
  identity: ActiveTelegramIdentity;
  policyNumber?: string;
  policyId?: string;
  client?: DbClient;
}) {
  const db = input.client ?? getDb();
  const policy = await db.policy.findFirst({
    where: {
      organizationId: input.identity.organizationId,
      ...(input.policyId ? { id: input.policyId } : { policyNumber: input.policyNumber }),
      client: {
        organizationId: input.identity.organizationId,
        ...(input.identity.membershipRole === "AGENT" ? { portfolioOwnerId: input.identity.user.id } : {}),
      },
    },
    select: {
      id: true,
      policyNumber: true,
      clientId: true,
      insurerId: true,
      client: { select: { id: true, fullName: true, email: true, phone: true, organizationId: true } },
      insurer: { select: { id: true, name: true, organizationId: true } },
    },
  });

  if (
    !policy ||
    policy.client.organizationId !== input.identity.organizationId ||
    policy.insurer.organizationId !== input.identity.organizationId ||
    !isQualitasInsurerName(policy.insurer.name)
  ) {
    return null;
  }

  return policy;
}

function buildQualitasDraftState(input: {
  policy: NonNullable<Awaited<ReturnType<typeof findAuthorizedQualitasPolicy>>>;
  identity: ActiveTelegramIdentity;
  origin?: { id: string; receiptNumber: string; dueDate: Date; amount: number; currency: string };
}): TelegramQualitasPaymentLinkDraftState {
  const clientEmail = normalizeQualitasEmail(input.policy.client.email);
  const clientPhone = normalizeQualitasPhone(input.policy.client.phone);
  const agentEmail = normalizeQualitasEmail(input.identity.user.email);
  const agentPhone = normalizeQualitasPhone(input.identity.user.phone);
  return {
    step: "recipient",
    policyId: input.policy.id,
    policyNumber: input.policy.policyNumber,
    clientId: input.policy.client.id,
    clientName: input.policy.client.fullName,
    clientEmail,
    clientPhone,
    agentUserId: input.identity.user.id,
    agentEmail,
    agentPhone,
    originatingReceiptId: input.origin?.id,
    originatingReceiptNumber: input.origin?.receiptNumber,
    originatingDueDate: input.origin?.dueDate.toISOString(),
    originatingAmount: input.origin?.amount,
    originatingCurrency: input.origin?.currency,
    correlationId: crypto.randomUUID(),
    submissionState: "NOT_STARTED",
  };
}

async function createTelegramQualitasDraft(input: { chatId: string; argument: string; policyId?: string; receiptId?: string; client?: DbClient }) {
  const db = input.client ?? getDb();
  const identity = await getActiveTelegramIdentityForChat(input.chatId, db);
  if (!identity) {
    return { ok: false as const, replyText: buildTelegramLinkedChatRequiredMessage() };
  }
  if (!isQualitasPaymentLinkEnabled()) {
    return { ok: false as const, replyText: buildTelegramQualitasUnavailableMessage() };
  }
  if (!isTelegramMutationsEnabled(identity.channel)) {
    return {
      ok: false as const,
      replyText: "Los cambios reales por Telegram están desactivados. Actívalos en Configuración > Notificaciones para solicitar el enlace.",
    };
  }

  const normalizedArgument = input.argument.trim();
  const argumentParts = normalizedArgument.split(/\s+/).filter(Boolean);
  if (argumentParts.length > 1) {
    return { ok: false as const, replyText: "Usa /pagoqualitas <numero-poliza>." };
  }

  if (!normalizedArgument) {
    const draft = await db.$transaction(async (tx) => {
      await assertOrganizationContextInTransaction(tx, identity.context);
      await tx.telegramDraft.updateMany({
        where: {
          organizationId: identity.organizationId,
          userId: identity.user.id,
          channelId: identity.channel.id,
          status: "COLLECTING",
        },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      return tx.telegramDraft.create({
        data: {
          organizationId: identity.organizationId,
          userId: identity.user.id,
          channelId: identity.channel.id,
          type: "QUALITAS_PAYMENT_LINK",
          status: "COLLECTING",
          payloadJson: stringifyTelegramDraftState({
            type: "QUALITAS_PAYMENT_LINK",
            qualitas: { step: "policyNumber", correlationId: crypto.randomUUID(), submissionState: "NOT_STARTED" },
          }),
          expiresAt: new Date(Date.now() + TELEGRAM_DRAFT_TTL_MS),
        },
      });
    });
    return { ok: true as const, replyText: buildTelegramQualitasPolicyPrompt(), draftId: draft.id };
  }

  let origin: { id: string; receiptNumber: string; dueDate: Date; amount: number; currency: string } | undefined;
  if (input.receiptId) {
    const selectedReceipt = await getAuthorizedDigestReceipt(identity, input.receiptId, db);
    if (!selectedReceipt || (input.policyId && selectedReceipt.policy.id !== input.policyId)) {
      return { ok: false as const, replyText: "El recibo ya no está disponible." };
    }
    origin = { id: selectedReceipt.id, receiptNumber: selectedReceipt.receiptNumber, dueDate: selectedReceipt.dueDate, amount: toNumber(selectedReceipt.amount), currency: selectedReceipt.currency };
  }
  const policy = await findAuthorizedQualitasPolicy({ identity, ...(input.policyId ? { policyId: input.policyId } : { policyNumber: normalizedArgument }), client: db });
  if (!policy) {
    return { ok: false as const, replyText: "No encontré una póliza Quálitas autorizada en PolicyDesk." };
  }

  const state = buildQualitasDraftState({ policy, identity, origin });
  if (!state.agentEmail && !state.agentPhone && (!isQualitasClientRecipientEnabled() || (!state.clientEmail && !state.clientPhone))) {
    return { ok: false as const, replyText: buildTelegramQualitasNoRecipientMessage() };
  }

  const draft = await db.$transaction(async (tx) => {
    await assertOrganizationContextInTransaction(tx, identity.context);
    await tx.telegramDraft.updateMany({
      where: {
        organizationId: identity.organizationId,
        userId: identity.user.id,
        channelId: identity.channel.id,
        status: "COLLECTING",
      },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });
    return tx.telegramDraft.create({
      data: {
        organizationId: identity.organizationId,
        userId: identity.user.id,
        channelId: identity.channel.id,
        type: "QUALITAS_PAYMENT_LINK",
        status: "COLLECTING",
        payloadJson: stringifyTelegramDraftState({ type: "QUALITAS_PAYMENT_LINK", qualitas: state }),
        expiresAt: new Date(Date.now() + TELEGRAM_DRAFT_TTL_MS),
      },
    });
  });

  return {
    ok: true as const,
    replyText: buildQualitasRecipientPrompt(state),
    replyMarkup: buildQualitasRecipientMarkup(state),
    draftId: draft.id,
  };
}

async function continueTelegramQualitasDraftFromText(input: {
  chatId: string;
  text: string;
  draft: { id: string; organizationId: string | null; channelId: string | null; payloadJson: string };
  client?: DbClient;
}) {
  const db = input.client ?? getDb();
  const identity = await getActiveTelegramIdentityForChat(input.chatId, db);
  const payload = parseTelegramDraftState(input.draft.payloadJson);
  if (!identity || !payload?.qualitas || payload.type !== "QUALITAS_PAYMENT_LINK") return null;
  const state = payload.qualitas;

  if (state.step === "policyNumber") {
    const policy = await findAuthorizedQualitasPolicy({ identity, policyNumber: input.text.trim(), client: db });
    if (!policy) {
      return { handled: true as const, chatId: input.chatId, replyText: "No encontré una póliza Quálitas autorizada en PolicyDesk." };
    }
    const nextState = buildQualitasDraftState({ policy, identity });
    await persistTelegramDraftState({
      organizationId: identity.organizationId,
      draftId: input.draft.id,
      state: { type: "QUALITAS_PAYMENT_LINK", qualitas: nextState },
      client: db,
      context: identity.context,
    });
    if (!nextState.agentEmail && !nextState.agentPhone && (!isQualitasClientRecipientEnabled() || (!nextState.clientEmail && !nextState.clientPhone))) {
      return { handled: true as const, chatId: input.chatId, replyText: buildTelegramQualitasNoRecipientMessage() };
    }
    return {
      handled: true as const,
      chatId: input.chatId,
      replyText: buildQualitasRecipientPrompt(nextState),
      replyMarkup: buildQualitasRecipientMarkup(nextState),
    };
  }

  if (state.step === "ready") {
    return {
      handled: true as const,
      chatId: input.chatId,
      replyText: buildQualitasConfirmation(state),
    };
  }

  if (state.step === "channel") {
    const channel = input.text.trim().toLowerCase();
    if (channel === "correo" || channel === "email" || channel === "correo electrónico") {
      if (!state.recipientEmail) {
        return { handled: true as const, chatId: input.chatId, replyText: buildQualitasChannelPrompt(state), replyMarkup: buildQualitasChannelMarkup(state) };
      }
      const nextState: TelegramQualitasPaymentLinkDraftState = { ...state, step: "ready", deliveryMethod: "EMAIL", recipientPhone: undefined, destinationSource: "PROFILE" };
      await persistTelegramDraftState({ organizationId: identity.organizationId, draftId: input.draft.id, state: { type: "QUALITAS_PAYMENT_LINK", qualitas: nextState }, client: db, context: identity.context });
      return { handled: true as const, chatId: input.chatId, replyText: buildQualitasConfirmation(nextState) };
    }
    if (channel === "whatsapp" || channel === "wa") {
      const phone = state.recipientPhone ?? (state.recipient === "CLIENT" ? state.clientPhone : null);
      if (!phone) {
        if (state.recipient !== "AGENT") {
          return { handled: true as const, chatId: input.chatId, replyText: buildQualitasChannelPrompt(state), replyMarkup: buildQualitasChannelMarkup(state) };
        }
        const nextState = { ...state, step: "phone" as const, deliveryMethod: "WHATSAPP" as const, destinationSource: "MANUAL" as const };
        await persistTelegramDraftState({ organizationId: identity.organizationId, draftId: input.draft.id, state: { type: "QUALITAS_PAYMENT_LINK", qualitas: nextState }, client: db, context: identity.context });
        return { handled: true as const, chatId: input.chatId, replyText: buildTelegramQualitasPhonePrompt() };
      }
      const nextState: TelegramQualitasPaymentLinkDraftState = { ...state, step: "ready", deliveryMethod: "WHATSAPP", recipientPhone: phone, destinationSource: "PROFILE" };
      await persistTelegramDraftState({ organizationId: identity.organizationId, draftId: input.draft.id, state: { type: "QUALITAS_PAYMENT_LINK", qualitas: nextState }, client: db, context: identity.context });
      return { handled: true as const, chatId: input.chatId, replyText: buildQualitasConfirmation(nextState) };
    }
    return { handled: true as const, chatId: input.chatId, replyText: buildQualitasChannelPrompt(state), replyMarkup: buildQualitasChannelMarkup(state) };
  }

  if (state.step === "phone") {
    const phone = normalizeQualitasPhone(input.text);
    if (!phone) return { handled: true as const, chatId: input.chatId, replyText: buildTelegramQualitasPhonePrompt() };
    const nextState: TelegramQualitasPaymentLinkDraftState = { ...state, step: "ready", deliveryMethod: "WHATSAPP", recipientPhone: phone, destinationSource: "MANUAL" };
    await persistTelegramDraftState({ organizationId: identity.organizationId, draftId: input.draft.id, state: { type: "QUALITAS_PAYMENT_LINK", qualitas: nextState }, client: db, context: identity.context });
    return { handled: true as const, chatId: input.chatId, replyText: buildQualitasConfirmation(nextState) };
  }

  const recipient = normalizeTelegramRecipientText(input.text);
  if (recipient === "CLIENT" && !isQualitasClientRecipientEnabled()) {
    return { handled: true as const, chatId: input.chatId, replyText: buildQualitasRecipientPrompt(state), replyMarkup: buildQualitasRecipientMarkup(state) };
  }
  const recipientEmail = recipient
    ? state[recipient === "CLIENT" ? "clientEmail" : "agentEmail"]
    : null;
  const recipientPhone = recipient === "CLIENT" ? state.clientPhone : state.agentPhone ?? null;
  if (!recipient || (!recipientEmail && !recipientPhone)) {
    return {
      handled: true as const,
      chatId: input.chatId,
      replyText: buildQualitasRecipientPrompt(state),
      replyMarkup: buildQualitasRecipientMarkup(state),
    };
  }

  const nextState: TelegramQualitasPaymentLinkDraftState = {
    ...state,
    step: "channel",
    recipient,
    recipientEmail: recipientEmail ?? undefined,
    recipientPhone: recipientPhone ?? undefined,
    destinationSource: "PROFILE",
  };
  await persistTelegramDraftState({
    organizationId: identity.organizationId,
    draftId: input.draft.id,
    state: { type: "QUALITAS_PAYMENT_LINK", qualitas: nextState },
    client: db,
    context: identity.context,
  });
  return {
    handled: true as const,
    chatId: input.chatId,
    replyText: buildQualitasChannelPrompt(nextState),
    replyMarkup: buildQualitasChannelMarkup(nextState),
  };
}

async function getDigestReceiptSelection(userId: string, client?: DbClient) {
  const db = client ?? getDb();
  const dayStart = startOfDayInTimeZone(new Date(), DEFAULT_TIMEZONE);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000 - 1);
  const tomorrowStart = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
  const upcomingEnd = new Date(dayStart.getTime() + 14 * 24 * 60 * 60 * 1000 - 1);
  const [overdue, today, upcoming] = await Promise.all([
    getTelegramReceipts({ userId, to: new Date(dayStart.getTime() - 1), limit: TELEGRAM_DIGEST_SECTION_LIMIT, client: db }),
    getTelegramReceipts({ userId, from: dayStart, to: dayEnd, limit: TELEGRAM_DIGEST_SECTION_LIMIT, client: db }),
    getTelegramReceipts({ userId, from: tomorrowStart, to: upcomingEnd, limit: TELEGRAM_DIGEST_SECTION_LIMIT, client: db }),
  ]);
  const seen = new Set<string>();
  const items = [...overdue.items, ...today.items, ...upcoming.items].filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  return { items, totalPages: Math.max(1, Math.ceil(items.length / 10)) };
}

async function getAuthorizedDigestReceipt(identity: ActiveTelegramIdentity, receiptId: string, client?: DbClient) {
  const db = client ?? getDb();
  return db.receipt.findFirst({
    where: {
      id: receiptId,
      organizationId: identity.organizationId,
      status: { in: ["PENDING", "OVERDUE"] },
      policy: {
        organizationId: identity.organizationId,
        status: { not: "CANCELLED" },
        client: { organizationId: identity.organizationId },
      },
      client: {
        organizationId: identity.organizationId,
        ...(identity.membershipRole === "AGENT" ? { portfolioOwnerId: identity.user.id } : {}),
      },
      insurer: { organizationId: identity.organizationId },
    },
    include: {
      client: { select: { id: true, fullName: true, phone: true, secondaryPhone: true } },
      policy: { select: { id: true, policyNumber: true, clientId: true } },
      insurer: { select: { name: true } },
      payments: { where: { status: "POSTED" }, select: { id: true } },
    },
  });
}

async function createTelegramWhatsAppReminderDraft(input: {
  chatId: string;
  receiptId: string;
  client?: DbClient;
}) {
  const db = input.client ?? getDb();
  const identity = await getActiveTelegramIdentityForChat(input.chatId, db);
  if (!identity) return { ok: false as const, replyText: buildTelegramLinkedChatRequiredMessage() };
  if (!isTelegramMutationsEnabled(identity.channel)) {
    return {
      ok: false as const,
      replyText: "Los cambios reales por Telegram están desactivados. Actívalos en Configuración > Notificaciones para preparar el recordatorio.",
    };
  }

  const active = await getActiveTelegramDraftForChat(input.chatId, db);
  if (active.draft) {
    return {
      ok: false as const,
      replyText: "Ya tienes un borrador activo. Responde /confirmar o usa /cancelar antes de preparar otro recordatorio.",
    };
  }

  const receipt = await getAuthorizedDigestReceipt(identity, input.receiptId, db);
  if (!receipt || receipt.policy.clientId !== receipt.client.id || receipt.payments.length > 0) {
    return {
      ok: false as const,
      replyText: receipt?.payments.length ? "El recibo tiene un pago registrado; requiere revisión manual." : "El recibo ya no está disponible para un recordatorio.",
    };
  }

  const draft = await db.$transaction(async (tx) => {
    await assertOrganizationContextInTransaction(tx, identity.context);
    return tx.telegramDraft.create({
      data: {
        organizationId: identity.organizationId,
        userId: identity.user.id,
        channelId: identity.channel.id,
        type: "WHATSAPP_RECEIPT_REMINDER",
        status: "COLLECTING",
        payloadJson: stringifyTelegramDraftState({
          type: "WHATSAPP_RECEIPT_REMINDER",
          whatsappReminder: {
            step: "ready",
            receiptId: receipt.id,
            policyNumber: receipt.policy.policyNumber,
            receiptNumber: receipt.receiptNumber,
            clientName: receipt.client.fullName,
          },
        }),
        expiresAt: new Date(Date.now() + TELEGRAM_DRAFT_TTL_MS),
      },
    });
  });

  const selection = selectWhatsAppPhone({
    primary: receipt.client.phone,
    secondary: receipt.client.secondaryPhone,
  });
  if (!selection) {
    await persistTelegramDraftState({
      organizationId: identity.organizationId,
      draftId: draft.id,
      state: {
        type: "WHATSAPP_RECEIPT_REMINDER",
        whatsappReminder: {
          step: "phone",
          receiptId: receipt.id,
          policyNumber: receipt.policy.policyNumber,
          receiptNumber: receipt.receiptNumber,
          clientName: receipt.client.fullName,
        },
      },
      client: db,
      context: identity.context,
    });
    return { ok: true as const, replyText: buildTelegramWhatsAppPhonePrompt(), draftId: draft.id };
  }

  try {
    const result = await prepareWhatsAppReceiptReminderForContext({
      db,
      context: identity.context,
      receiptId: receipt.id,
      sourceChannel: "TELEGRAM",
      telegramDraftId: draft.id,
    });
    if (result.outcome !== "OPEN_WHATSAPP") throw new Error("El recibo requiere un teléfono para continuar.");
    return {
      ok: true as const,
      replyText: buildTelegramWhatsAppPreparedMessage(),
      replyMarkup: buildTelegramWhatsAppPreparedMarkup(result.url),
      draftId: draft.id,
      removeReplyMarkup: true,
    };
  } catch (error) {
    await db.$transaction(async (tx) => {
      await assertOrganizationContextInTransaction(tx, identity.context);
      await tx.telegramDraft.updateMany({
        where: { id: draft.id, organizationId: identity.organizationId, status: "COLLECTING" },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
    });
    return { ok: false as const, replyText: error instanceof Error ? error.message : "No se pudo preparar el recordatorio." };
  }
}

async function processTelegramWhatsAppReminderCallback(callback: TelegramCallbackQuery) {
  const chat = callback.message?.chat;
  if (!chat || chat.type !== "private" || callback.from.id !== chat.id || !callback.data) {
    return { handled: true as const, callbackQueryId: callback.id, callbackAnswerText: "Selección no válida." };
  }
  const db = getDb();
  const identity = await getActiveTelegramIdentityForChat(String(chat.id), db);
  if (!identity) return { handled: true as const, callbackQueryId: callback.id, callbackAnswerText: "Esta sesión de Telegram ya no está autorizada." };
  const active = await getActiveTelegramDraftForChat(String(chat.id), db);
  const payload = active.draft ? parseTelegramDraftState(active.draft.payloadJson) : null;
  if (!active.draft || active.draft.type !== "WHATSAPP_RECEIPT_REMINDER" || payload?.type !== "WHATSAPP_RECEIPT_REMINDER") {
    return { handled: true as const, callbackQueryId: callback.id, callbackAnswerText: "El recordatorio ya fue procesado o expiró." };
  }

  if (callback.data === WHATSAPP_REMINDER_CANCEL_CALLBACK) {
    await db.$transaction(async (tx) => {
      await assertOrganizationContextInTransaction(tx, identity.context);
      const updated = await tx.telegramDraft.updateMany({
        where: { id: active.draft!.id, organizationId: identity.organizationId, userId: identity.user.id, status: "COLLECTING", type: "WHATSAPP_RECEIPT_REMINDER" },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      if (updated.count !== 1) throw new Error("El recordatorio ya fue procesado o expiró.");
      await writeActivityLog({
        organizationId: identity.organizationId,
        entityType: "TelegramDraft",
        entityId: active.draft!.id,
        action: "TELEGRAM_DRAFT_CANCELLED",
        newValue: { type: "WHATSAPP_RECEIPT_REMINDER" },
        userId: identity.user.id,
        db: tx,
      });
    });
    return { handled: true as const, chatId: String(chat.id), callbackQueryId: callback.id, callbackAnswerText: "Recordatorio cancelado.", replyText: "Recordatorio cancelado.", removeReplyMarkup: true };
  }

  if (callback.data !== WHATSAPP_REMINDER_CONFIRM_CALLBACK) {
    return { handled: true as const, callbackQueryId: callback.id, callbackAnswerText: "Selección no válida." };
  }

  const result = await confirmTelegramWhatsAppReminder({
    chatId: String(chat.id),
    draft: active.draft,
    identity,
    channel: active.channel!,
    client: db,
  });
  return {
    handled: true as const,
    chatId: String(chat.id),
    callbackQueryId: callback.id,
    callbackAnswerText: result.ok ? "Recordatorio preparado." : "No se pudo preparar el recordatorio.",
    replyText: result.replyText,
    ...(("replyMarkup" in result && result.replyMarkup) ? { replyMarkup: result.replyMarkup } : {}),
    ...(("removeReplyMarkup" in result && result.removeReplyMarkup) ? { removeReplyMarkup: true } : {}),
  };
}

async function processTelegramDigestCallback(callback: TelegramCallbackQuery) {
  const chat = callback.message?.chat;
  if (!chat || chat.type !== "private" || callback.from.id !== chat.id || !callback.data) {
    return { handled: true as const, callbackQueryId: callback.id, callbackAnswerText: "Selección no válida." };
  }
  const db = getDb();
  const identity = await getActiveTelegramIdentityForChat(String(chat.id), db);
  if (!identity) return { handled: true as const, callbackQueryId: callback.id, callbackAnswerText: "Esta sesión de Telegram ya no está autorizada." };

  const data = callback.data;
  if (data === DIGEST_MANAGE_CALLBACK || data.startsWith(DIGEST_PAGE_PREFIX)) {
    const page = data === DIGEST_MANAGE_CALLBACK ? 1 : Number(data.slice(DIGEST_PAGE_PREFIX.length));
    if (!Number.isSafeInteger(page) || page < 1) return { handled: true as const, callbackQueryId: callback.id, callbackAnswerText: "Página no válida." };
    const selection = await getDigestReceiptSelection(identity.user.id, db);
    const currentPage = Math.min(page, selection.totalPages);
    const items = selection.items.slice((currentPage - 1) * 10, currentPage * 10);
    return {
      handled: true as const,
      chatId: String(chat.id),
      callbackQueryId: callback.id,
      callbackAnswerText: "Recibos actualizados.",
      replyText: items.length > 0 ? "Selecciona el recibo que quieres gestionar." : "No hay recibos abiertos en el rango del resumen.",
      replyMarkup: buildDigestReceiptSelectionMarkup(items, currentPage, selection.totalPages),
    };
  }

  const receiptId = [DIGEST_RECEIPT_PREFIX, DIGEST_PAYMENT_PREFIX, DIGEST_QUALITAS_PREFIX, DIGEST_WHATSAPP_PREFIX].find((prefix) => data.startsWith(prefix))
    ? data.slice(data.indexOf(":") + 1)
    : null;
  if (!receiptId) return { handled: false as const };
  const receipt = await getAuthorizedDigestReceipt(identity, receiptId, db);
  if (!receipt) return { handled: true as const, callbackQueryId: callback.id, callbackAnswerText: "El recibo ya no está disponible." };

  if (data.startsWith(DIGEST_RECEIPT_PREFIX)) {
    const actionMarkup = buildDigestReceiptActionMarkup({ receiptId: receipt.id, canRecordPayment: receipt.payments.length === 0, canPrepareWhatsApp: receipt.payments.length === 0, isQualitas: isQualitasInsurerName(receipt.insurer.name) && isQualitasPaymentLinkEnabled() });
    return {
      handled: true as const,
      chatId: String(chat.id),
      callbackQueryId: callback.id,
      callbackAnswerText: "Recibo seleccionado.",
      replyText: `Recibo ${receipt.receiptNumber}\n${receipt.client.fullName} · Póliza ${receipt.policy.policyNumber} · ${receipt.insurer.name}\n\nElige una acción.`,
      ...(actionMarkup ? { replyMarkup: actionMarkup } : { replyText: `Recibo ${receipt.receiptNumber}\nNo hay una acción disponible para este recibo en su estado actual.` }),
    };
  }

  if (data.startsWith(DIGEST_PAYMENT_PREFIX)) {
    if (!isTelegramMutationsEnabled(identity.channel)) {
      return { handled: true as const, callbackQueryId: callback.id, callbackAnswerText: "Las mutaciones de Telegram están desactivadas." };
    }
    const result = await createTelegramPaymentDraft({ chatId: String(chat.id), argument: `${receipt.policy.policyNumber} ${receipt.receiptNumber}`, client: db });
    return { handled: true as const, chatId: String(chat.id), callbackQueryId: callback.id, callbackAnswerText: "Borrador de pago preparado.", replyText: result.replyText };
  }

  if (data.startsWith(DIGEST_WHATSAPP_PREFIX)) {
    const result = await createTelegramWhatsAppReminderDraft({ chatId: String(chat.id), receiptId: receipt.id, client: db });
    return {
      handled: true as const,
      chatId: String(chat.id),
      callbackQueryId: callback.id,
      callbackAnswerText: result.ok ? "Recordatorio preparado." : "No se pudo preparar el recordatorio.",
      replyText: result.replyText,
      ...(result.replyMarkup ? { replyMarkup: result.replyMarkup } : {}),
      ...(result.removeReplyMarkup ? { removeReplyMarkup: true } : {}),
      ...(result.draftId ? { draftId: result.draftId } : {}),
    };
  }

  if (!isQualitasInsurerName(receipt.insurer.name) || !isQualitasPaymentLinkEnabled()) {
    return { handled: true as const, callbackQueryId: callback.id, callbackAnswerText: "La liga Quálitas no está disponible para este recibo." };
  }
  if (!isTelegramMutationsEnabled(identity.channel)) {
    return { handled: true as const, callbackQueryId: callback.id, callbackAnswerText: "Las mutaciones de Telegram están desactivadas." };
  }
  const result = await createTelegramQualitasDraft({ chatId: String(chat.id), argument: receipt.policy.policyNumber, policyId: receipt.policy.id, receiptId: receipt.id, client: db });
  return {
    handled: true as const,
    chatId: String(chat.id),
    callbackQueryId: callback.id,
    callbackAnswerText: "Solicitud preparada.",
    replyText: result.replyText,
    replyMarkup: result.replyMarkup,
  };
}

async function processTelegramQualitasCallback(callback: TelegramCallbackQuery, client?: DbClient) {
  const chat = callback.message?.chat;
  if (!chat || chat.type !== "private" || callback.from.id !== chat.id || !callback.data) {
    return { handled: true as const, callbackQueryId: callback.id, callbackAnswerText: "Selección no válida." };
  }
  const selectedChannel =
    callback.data === QUALITAS_EMAIL_CALLBACK ? "EMAIL" as const :
    callback.data === QUALITAS_WHATSAPP_CALLBACK ? "WHATSAPP" as const : null;
  const selectedRecipient =
    callback.data === QUALITAS_CLIENT_CALLBACK ? "CLIENT" as const :
    callback.data === QUALITAS_AGENT_CALLBACK ? "AGENT" as const : null;
  if (!selectedRecipient && !selectedChannel) {
    return { handled: true as const, callbackQueryId: callback.id, callbackAnswerText: "Selección no válida." };
  }

  const db = client ?? getDb();
  const identity = await getActiveTelegramIdentityForChat(String(chat.id), db);
  if (!identity) {
    return { handled: true as const, callbackQueryId: callback.id, callbackAnswerText: "Esta solicitud ya no está disponible." };
  }
  const draft = await db.telegramDraft.findFirst({
    where: {
      organizationId: identity.organizationId,
      userId: identity.user.id,
      channelId: identity.channel.id,
      type: "QUALITAS_PAYMENT_LINK",
      status: "COLLECTING",
      expiresAt: { gt: new Date() },
    },
    orderBy: [{ createdAt: "desc" }],
  });
  const payload = draft ? parseTelegramDraftState(draft.payloadJson) : null;
  const state = payload?.type === "QUALITAS_PAYMENT_LINK" && payload.qualitas
    ? payload.qualitas
    : null;
  if (!draft || !state || (selectedRecipient && state.step !== "recipient") || (selectedChannel && state.step !== "channel")) {
    return { handled: true as const, callbackQueryId: callback.id, callbackAnswerText: "La selección ya fue procesada o expiró." };
  }

  const policy = await findAuthorizedQualitasPolicy({ identity, policyId: state.policyId, client: db });
  if (!policy) {
    return { handled: true as const, callbackQueryId: callback.id, callbackAnswerText: "La póliza ya no está disponible." };
  }
  const currentState = {
    ...buildQualitasDraftState({ policy, identity }),
    originatingReceiptId: state.originatingReceiptId,
    originatingReceiptNumber: state.originatingReceiptNumber,
    originatingDueDate: state.originatingDueDate,
    originatingAmount: state.originatingAmount,
    originatingCurrency: state.originatingCurrency,
  };
  const activeRecipient = selectedRecipient ?? state.recipient;
  if (selectedRecipient === "CLIENT" && !isQualitasClientRecipientEnabled()) {
    return { handled: true as const, callbackQueryId: callback.id, callbackAnswerText: "Ese destinatario no está habilitado." };
  }
  const selectedEmail = activeRecipient === "CLIENT" ? currentState.clientEmail : currentState.agentEmail;
  const selectedPhone = activeRecipient === "CLIENT" ? currentState.clientPhone : currentState.agentPhone;
  if (selectedRecipient && !selectedEmail && !selectedPhone) {
    return { handled: true as const, callbackQueryId: callback.id, callbackAnswerText: "Ese destino ya no está disponible." };
  }

  if (selectedChannel) {
    if (!state.recipient) {
      return { handled: true as const, callbackQueryId: callback.id, callbackAnswerText: "La selección ya fue procesada o expiró." };
    }
    if (selectedChannel === "EMAIL" && !selectedEmail) {
      return { handled: true as const, callbackQueryId: callback.id, callbackAnswerText: "Ese correo ya no está disponible." };
    }
    if (selectedChannel === "WHATSAPP" && !selectedPhone) {
      if (activeRecipient !== "AGENT") {
        return { handled: true as const, callbackQueryId: callback.id, callbackAnswerText: "Ese destino ya no está disponible." };
      }
      const nextState: TelegramQualitasPaymentLinkDraftState = { ...state, step: "phone", deliveryMethod: "WHATSAPP", destinationSource: "MANUAL" };
      await persistTelegramDraftState({ organizationId: identity.organizationId, draftId: draft.id, state: { type: "QUALITAS_PAYMENT_LINK", qualitas: nextState }, client: db, context: identity.context });
      return {
        handled: true as const,
        chatId: String(chat.id),
        callbackQueryId: callback.id,
        callbackAnswerText: "Falta el teléfono.",
        replyText: buildTelegramQualitasPhonePrompt(),
        removeReplyMarkup: true,
      };
    }
    const nextState: TelegramQualitasPaymentLinkDraftState = {
      ...state,
      step: "ready",
      deliveryMethod: selectedChannel,
      recipientEmail: selectedChannel === "EMAIL" ? selectedEmail ?? undefined : undefined,
      recipientPhone: selectedChannel === "WHATSAPP" ? selectedPhone ?? state.recipientPhone : undefined,
      destinationSource: "PROFILE",
    };
    const updated = await updateQualitasDraftState({
      db,
      context: identity.context,
      draftId: draft.id,
      userId: identity.user.id,
      channelId: identity.channel.id,
      state: { type: "QUALITAS_PAYMENT_LINK", qualitas: nextState },
    });
    if (updated.count !== 1) {
      return { handled: true as const, callbackQueryId: callback.id, callbackAnswerText: "La selección ya fue procesada." };
    }
    return {
      handled: true as const,
      chatId: String(chat.id),
      callbackQueryId: callback.id,
      callbackAnswerText: "Canal seleccionado.",
      replyText: buildQualitasConfirmation(nextState),
      removeReplyMarkup: true,
    };
  }

  if (!selectedRecipient) {
    return { handled: true as const, callbackQueryId: callback.id, callbackAnswerText: "Selección no válida." };
  }
  const nextState: TelegramQualitasPaymentLinkDraftState = {
    ...currentState,
    step: "channel",
    recipient: selectedRecipient,
    recipientEmail: selectedEmail ?? undefined,
    recipientPhone: selectedPhone ?? undefined,
    destinationSource: "PROFILE",
  };
  const updated = await updateQualitasDraftState({
    db,
    context: identity.context,
    draftId: draft.id,
    userId: identity.user.id,
    channelId: identity.channel.id,
    state: { type: "QUALITAS_PAYMENT_LINK", qualitas: nextState },
  });
  if (updated.count !== 1) {
    return { handled: true as const, callbackQueryId: callback.id, callbackAnswerText: "La selección ya fue procesada." };
  }

  return {
    handled: true as const,
    chatId: String(chat.id),
    callbackQueryId: callback.id,
    callbackAnswerText: "Destinatario seleccionado.",
    replyText: buildQualitasChannelPrompt(nextState),
    replyMarkup: buildQualitasChannelMarkup(nextState),
    removeReplyMarkup: true,
  };
}

function isQualitasPreparedPaymentLink(
  value: QualitasPreparedPaymentLink | QualitasPaymentLinkResult,
): value is QualitasPreparedPaymentLink {
  return "transportReady" in value;
}

function qualitasAuditResult(outcome: QualitasPaymentLinkOutcome) {
  return outcome === "SUCCESS" ? "SUCCESS" : outcome === "ALREADY_IN_PROGRESS" ? "ALREADY_IN_PROGRESS" : outcome === "UNCERTAIN_POST_SUBMISSION" ? "UNCERTAIN" : "FAILED";
}

function qualitasSubmissionStateForOutcome(outcome: QualitasPaymentLinkOutcome) {
  if (outcome === "SUCCESS" || outcome === "ALREADY_IN_PROGRESS") return "ACKNOWLEDGED" as const;
  if (outcome === "UNCERTAIN_POST_SUBMISSION") return "STARTED" as const;
  return "NOT_STARTED" as const;
}

async function finalizeQualitasTelegramDraft(input: {
  draftId: string;
  organizationId: string;
  policyId: string;
  clientId: string;
  userId: string;
  recipient: "CLIENT" | "AGENT";
  deliveryMethod: QualitasPaymentLinkDeliveryMethod;
  outcome: QualitasPaymentLinkOutcome;
  reason: QualitasPaymentLinkReason;
  submissionState: "NOT_STARTED" | "STARTED" | "ACKNOWLEDGED";
  correlationId: string;
  destinationSource?: "PROFILE" | "MANUAL";
  originatingReceiptId?: string;
  context: OrganizationContext;
  db: DbClient;
}) {
  const status = input.outcome === "SUCCESS" ? "CONFIRMED" : input.outcome === "ALREADY_IN_PROGRESS" ? "ALREADY_IN_PROGRESS" : input.outcome === "UNCERTAIN_POST_SUBMISSION" ? "UNCERTAIN" : "FAILED";
  await input.db.$transaction(async (tx) => {
    await assertOrganizationContextInTransaction(tx, input.context);
    await tx.telegramDraft.update({
      where: { id: input.draftId, organizationId: input.organizationId },
      data: {
        status,
        payloadJson: JSON.stringify({
          type: "QUALITAS_PAYMENT_LINK",
          qualitas: {
            policyId: input.policyId,
            clientId: input.clientId,
            recipient: input.recipient,
            deliveryMethod: input.deliveryMethod,
            correlationId: input.correlationId,
            destinationSource: input.destinationSource,
            submissionState: input.submissionState,
            outcome: input.outcome,
            reason: input.reason,
          },
        }),
        ...(status === "CONFIRMED" ? { confirmedAt: new Date() } : {}),
      },
    });
    await writeActivityLog({
      organizationId: input.organizationId,
      entityType: "Policy",
      entityId: input.policyId,
      action: "QUALITAS_PAYMENT_LINK_REQUESTED",
      newValue: {
        draftId: input.draftId,
        clientId: input.clientId,
        receiptId: input.originatingReceiptId ?? null,
        recipientType: input.recipient,
        deliveryMethod: input.deliveryMethod,
        result: qualitasAuditResult(input.outcome),
        reason: input.reason,
      },
      userId: input.userId,
      db: tx,
    });
  });
}

async function confirmTelegramWhatsAppReminder(input: {
  chatId: string;
  draft: { id: string; organizationId: string | null; payloadJson: string };
  identity: ActiveTelegramIdentity;
  channel: NonNullable<Awaited<ReturnType<typeof getTelegramChannelByChatId>>>;
  client?: DbClient;
}) {
  const db = input.client ?? getDb();
  if (!isTelegramMutationsEnabled(input.channel)) {
    return { ok: false as const, replyText: "Las mutaciones de Telegram están desactivadas. Actívalas en Configuración > Notificaciones para preparar el recordatorio." };
  }
  const payload = parseTelegramDraftState(input.draft.payloadJson);
  const state = payload?.type === "WHATSAPP_RECEIPT_REMINDER" ? payload.whatsappReminder : null;
  if (!state?.receiptId || state.step !== "ready") {
    return { ok: false as const, replyText: "El recordatorio todavía no está completo. Escribe un teléfono o usa /cancelar." };
  }

  try {
    const result = await prepareWhatsAppReceiptReminderForContext({
      db,
      context: input.identity.context,
      receiptId: state.receiptId,
      capturedPhone: state.capturedPhone,
      sourceChannel: "TELEGRAM",
      telegramDraftId: input.draft.id,
    });
    if (result.outcome === "CAPTURE_PHONE") {
      return { ok: false as const, replyText: buildTelegramWhatsAppPhonePrompt() };
    }
    return {
      ok: true as const,
      replyText: buildTelegramWhatsAppPreparedMessage(),
      replyMarkup: buildTelegramWhatsAppPreparedMarkup(result.url),
      removeReplyMarkup: true,
    };
  } catch (error) {
    logError("telegram.confirmWhatsAppReminder", error, { draftRef: securityFingerprint(input.draft.id) });
    return { ok: false as const, replyText: error instanceof Error ? error.message : "No se pudo preparar el recordatorio." };
  }
}

async function confirmQualitasTelegramDraft(input: {
  chatId: string;
  draft: { id: string; organizationId: string | null; userId: string; channelId: string | null; payloadJson: string; expiresAt: Date };
  client?: DbClient;
}) {
  const startedAt = Date.now();
  const db = input.client ?? getDb();
  const identity = await getActiveTelegramIdentityForChat(input.chatId, db);
  const payload = parseTelegramDraftState(input.draft.payloadJson);
  const state = payload?.type === "QUALITAS_PAYMENT_LINK" && payload.qualitas
    ? payload.qualitas
    : null;
  if (
    !identity ||
    input.draft.organizationId !== identity.organizationId ||
    input.draft.userId !== identity.user.id ||
    input.draft.channelId !== identity.channel.id ||
    input.draft.expiresAt <= new Date() ||
    !state
  ) {
    return { ok: false as const, replyText: "No hay ningún borrador activo para confirmar." };
  }
  if (!isQualitasPaymentLinkEnabled()) {
    return { ok: false as const, replyText: buildTelegramQualitasUnavailableMessage() };
  }
  if (state?.recipient === "CLIENT" && !isQualitasClientRecipientEnabled()) {
    return { ok: false as const, replyText: buildTelegramQualitasUnavailableMessage() };
  }
  if (!isTelegramMutationsEnabled(identity.channel)) {
    return { ok: false as const, replyText: "Los cambios reales por Telegram están desactivados. Actívalos en Configuración > Notificaciones para solicitar el enlace." };
  }
  if (
    state.step !== "ready" ||
    !state.policyId ||
    !state.clientId ||
    !state.policyNumber ||
    !state.recipient ||
    !state.deliveryMethod ||
    (state.deliveryMethod === "EMAIL" && !state.recipientEmail) ||
    (state.deliveryMethod === "WHATSAPP" && !state.recipientPhone) ||
    state.submissionState !== "NOT_STARTED" ||
    !state.correlationId
  ) {
    return { ok: false as const, replyText: "La solicitud de enlace todavía no está completa." };
  }

  const policy = await findAuthorizedQualitasPolicy({ identity, policyId: state.policyId, client: db });
  const currentClientEmail = normalizeQualitasEmail(policy?.client.email);
  const currentAgentEmail = normalizeQualitasEmail(identity.user.email);
  const currentRecipientEmail = state.recipient === "CLIENT" ? currentClientEmail : currentAgentEmail;
  const currentAgentPhone = normalizeQualitasPhone(identity.user.phone);
  const currentRecipientPhone = state.recipient === "CLIENT" ? normalizeQualitasPhone(policy?.client.phone) : currentAgentPhone;
  const phoneMatches = state.destinationSource === "MANUAL"
    ? state.recipient === "AGENT" && normalizeQualitasPhone(state.recipientPhone) === state.recipientPhone
    : currentRecipientPhone === state.recipientPhone;
  if (
    !policy ||
    policy.client.id !== state.clientId ||
    policy.policyNumber !== state.policyNumber ||
    state.agentUserId !== identity.user.id ||
    (state.deliveryMethod === "EMAIL" && currentRecipientEmail !== state.recipientEmail) ||
    (state.deliveryMethod === "WHATSAPP" && !phoneMatches)
  ) {
    const refreshedState = policy
      ? { ...buildQualitasDraftState({ policy, identity }), step: "recipient" as const }
      : { ...state, step: "recipient" as const };
    await persistTelegramDraftState({
      organizationId: identity.organizationId,
      draftId: input.draft.id,
      state: { type: "QUALITAS_PAYMENT_LINK", qualitas: refreshedState },
      client: db,
    });
    return { ok: false as const, replyText: "El destino cambió desde que preparaste la solicitud.\nSelecciona nuevamente el destinatario y canal." };
  }

  const limits = await Promise.all([
    checkDistributedRateLimit(`telegram:qualitas:user:${securityFingerprint(identity.user.id)}`, { ...TELEGRAM_QUALITAS_RATE_LIMITS.user, requireDistributed: true }),
    checkDistributedRateLimit(`telegram:qualitas:organization:${securityFingerprint(identity.organizationId)}`, { ...TELEGRAM_QUALITAS_RATE_LIMITS.organization, requireDistributed: true }),
    checkDistributedRateLimit(`telegram:qualitas:policy:${securityFingerprint(state.policyId)}`, { ...TELEGRAM_QUALITAS_RATE_LIMITS.policy, requireDistributed: true }),
  ]);
  if (limits.some((limit) => !limit.allowed)) {
    return { ok: false as const, replyText: buildTelegramQualitasOutcomeMessage("RATE_LIMITED") };
  }

  const claimed = await db.$transaction(async (tx) => {
    await assertOrganizationContextInTransaction(tx, identity.context);
    return tx.telegramDraft.updateMany({
      where: {
        id: input.draft.id,
        organizationId: identity.organizationId,
        userId: identity.user.id,
        channelId: identity.channel.id,
        type: "QUALITAS_PAYMENT_LINK",
        status: "COLLECTING",
        expiresAt: { gt: new Date() },
      },
      data: { status: "PROCESSING", updatedAt: new Date(), payloadJson: JSON.stringify({ ...payload, qualitas: { ...state, submissionState: "NOT_STARTED" } }) },
    });
  });
  if (claimed.count !== 1) {
    return { ok: false as const, replyText: "Esta solicitud ya fue procesada o está siendo procesada." };
  }

  let providerResult: QualitasPaymentLinkResult = {
    outcome: "UNEXPECTED_RESPONSE",
    reason: "UNEXPECTED_RESPONSE",
  };
  let submissionStarted = false;
  try {
    const qualitasRequestOptions = {
      traceId: state.correlationId ?? securityFingerprint(input.draft.id),
      correlationId: state.correlationId ?? input.draft.id,
      onFinalSubmissionStarted: async () => {
        const updated = await db.$transaction(async (tx) => {
          await assertOrganizationContextInTransaction(tx, identity.context);
          return tx.telegramDraft.updateMany({
            where: {
              id: input.draft.id,
              organizationId: identity.organizationId,
              userId: identity.user.id,
              channelId: identity.channel.id,
              status: "PROCESSING",
            },
            data: { payloadJson: JSON.stringify({ ...payload, qualitas: { ...state, submissionState: "STARTED" } }), updatedAt: new Date() },
          });
        });
        if (updated.count !== 1) throw new Error("QUALITAS_DRAFT_START_CLAIM_FAILED");
        submissionStarted = true;
      },
    };
    const request: QualitasDeliveryRequest = {
      policyNumber: state.policyNumber,
      deliveryChannel: state.deliveryMethod,
      destination: state.deliveryMethod === "EMAIL" ? state.recipientEmail! : state.recipientPhone!,
      correlationId: state.correlationId ?? input.draft.id,
    };
    const prepared = await prepareQualitasPaymentLink(
      request,
      qualitasRequestOptions,
    );
    if (isQualitasPreparedPaymentLink(prepared)) {
      providerResult = await requestQualitasPaymentLink(prepared, qualitasRequestOptions);
    } else {
      providerResult = prepared;
    }
  } catch (error) {
    logError("telegram.confirmQualitasPaymentLink", error, { draftRef: securityFingerprint(input.draft.id) });
    providerResult = submissionStarted
      ? { outcome: "UNCERTAIN_POST_SUBMISSION", reason: "FINAL_TIMEOUT" }
      : { outcome: "UNEXPECTED_RESPONSE", reason: "UNEXPECTED_RESPONSE" };
  }

  const { outcome, reason } = providerResult;
  logQualitasTrace({
    correlationId: state.correlationId ?? input.draft.id,
    organizationId: identity.organizationId,
    policyId: state.policyId,
    userId: identity.user.id,
    providerStep: "final_submission",
    deliveryChannel: state.deliveryMethod,
    outcome,
    reason,
    durationMs: Date.now() - startedAt,
  });
  try {
    await finalizeQualitasTelegramDraft({
      draftId: input.draft.id,
      organizationId: identity.organizationId,
      policyId: state.policyId,
      clientId: state.clientId,
      userId: identity.user.id,
      recipient: state.recipient,
      deliveryMethod: state.deliveryMethod,
      outcome,
      reason,
      submissionState: qualitasSubmissionStateForOutcome(outcome),
      correlationId: state.correlationId ?? input.draft.id,
      destinationSource: state.destinationSource,
      originatingReceiptId: state.originatingReceiptId,
      context: identity.context,
      db,
    });
  } catch (error) {
    logError("telegram.finalizeQualitasPaymentLink", error, { draftRef: securityFingerprint(input.draft.id) });
    return { ok: false as const, replyText: buildTelegramQualitasOutcomeMessage("UNCERTAIN_POST_SUBMISSION") };
  }

  if (outcome === "SUCCESS") {
    return {
      ok: true as const,
      replyText: buildTelegramQualitasSuccess({
        policyNumber: state.policyNumber,
        recipientLabel: state.recipient === "AGENT" ? "Agente" : "Cliente",
        deliveryMethod: state.deliveryMethod,
        maskedEmail: state.recipientEmail ? maskQualitasEmail(state.recipientEmail) : undefined,
        maskedPhone: state.recipientPhone ? maskQualitasPhone(state.recipientPhone) : undefined,
      }),
    };
  }
  return { ok: false as const, replyText: buildTelegramQualitasOutcomeMessage(outcome, reason) };
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

  const identity = await getActiveTelegramIdentityForChat(input.chatId, db);
  if (!identity) {
    return { ok: false as const, replyText: "Esta sesión de Telegram ya no está autorizada." };
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

  if (payload.type === "WHATSAPP_RECEIPT_REMINDER") {
    const result = await confirmTelegramWhatsAppReminder({
      chatId: input.chatId,
      draft,
      identity,
      channel,
      client: db,
    });
    return result;
  }

  if (payload.type === "QUALITAS_PAYMENT_LINK") {
    return confirmQualitasTelegramDraft({ chatId: input.chatId, draft });
  }

  if (draft.type === "PAYMENT_CAPTURE") {
    if (!isTelegramMutationsEnabled(channel)) {
      return {
        ok: false as const,
        replyText:
          "Los cambios reales por Telegram están desactivados. Actívalos en Configuración > Notificaciones para registrar el pago aquí. Si no los activas, completa el pago en PolicyDesk.",
      };
    }

    const state = payload.payment;
    if (
      !state ||
      state.step !== "ready" ||
      !state.policyNumber ||
      !state.receiptNumber ||
      !state.paidDate ||
      !state.paymentMethod ||
      state.amount == null
    ) {
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
      await db.$transaction(async (tx) => {
        await assertOrganizationContextInTransaction(tx, identity.context);
        const permitted = await tx.receipt.findFirst({
          where: {
            id: receipt.id,
            organizationId: draft.organizationId!,
            status: { in: ["PENDING", "OVERDUE"] },
            ...(identity?.membershipRole === "AGENT" ? { client: { portfolioOwnerId: channel.userId } } : {}),
          },
          select: { id: true },
        });
        if (!permitted) throw new Error("El recibo ya no está disponible para registrar el pago.");
        const result = await recordPayment({
          organizationId: draft.organizationId!,
          receiptId: receipt.id,
          amount: Number(state.amount),
          paidDate: parseBusinessDateInput(state.paidDate ?? ""),
          paymentMethod: state.paymentMethod ?? "",
          reference: state.reference ?? null,
          notes: "Pago capturado por Telegram.",
          actorId: channel.userId,
        }, tx);
        await tx.telegramDraft.update({ where: { id: draft.id, organizationId: draft.organizationId! }, data: { status: "CONFIRMED", confirmedAt: new Date() } });
        await writeActivityLog({
          organizationId: draft.organizationId!, entityType: "TelegramDraft", entityId: draft.id,
          action: "TELEGRAM_PAYMENT_DRAFT_CONFIRMED",
          newValue: { receiptId: receipt.id, paymentId: result.payment.id, amount: state.amount, paidDate: state.paidDate },
          userId: channel.userId, db: tx,
        });
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
    where: { id: draft.id, organizationId: draft.organizationId! },
    data: {
      status: "CONFIRMED",
      confirmedAt: new Date(),
    },
  });

  await writeActivityLog({
    organizationId: draft.organizationId!,
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
    where: { id: draft.id, organizationId: draft.organizationId! },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
    },
  });

  await writeActivityLog({
    organizationId: draft.organizationId!,
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
    replyText: buildTelegramDraftCancelledMessage(
      draft.type === "PAYMENT_CAPTURE" ? "Pago" : draft.type === "QUALITAS_PAYMENT_LINK" ? "Solicitud Quálitas" : draft.type === "WHATSAPP_RECEIPT_REMINDER" ? "Recordatorio de WhatsApp" : "Póliza",
    ),
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

  if (payload.type === "WHATSAPP_RECEIPT_REMINDER") {
    const state = payload.whatsappReminder;
    if (!state) return { handled: true as const, chatId: input.chatId, replyText: "El borrador está dañado. Usa /cancelar y vuelve a intentarlo." };
    const identity = await getActiveTelegramIdentityForChat(input.chatId, db);
    if (!identity) return { handled: true as const, chatId: input.chatId, replyText: "Esta sesión de Telegram ya no está autorizada." };
    if (state.step === "phone") {
      const normalized = normalizeMexicanPhone(text);
      if (!normalized) {
        return { handled: true as const, chatId: input.chatId, replyText: "Escribe un teléfono mexicano válido de 10 dígitos o con +52." };
      }
      const nextState: TelegramWhatsAppReceiptReminderDraftState = { ...state, step: "ready", capturedPhone: normalized };
      await persistTelegramDraftState({
        organizationId: draft.organizationId!,
        draftId: draft.id,
        state: { type: "WHATSAPP_RECEIPT_REMINDER", whatsappReminder: nextState },
        client: db,
        context: identity.context,
      });
      return {
        handled: true as const,
        chatId: input.chatId,
        replyText: buildTelegramWhatsAppConfirmation(nextState),
        replyMarkup: {
          inline_keyboard: [[
            { text: "Guardar y abrir WhatsApp", callback_data: WHATSAPP_REMINDER_CONFIRM_CALLBACK },
            { text: "Cancelar", callback_data: WHATSAPP_REMINDER_CANCEL_CALLBACK },
          ]],
        },
      };
    }
    return {
      handled: true as const,
      chatId: input.chatId,
      replyText: buildTelegramWhatsAppConfirmation(state),
      replyMarkup: {
        inline_keyboard: [[
          { text: "Guardar y abrir WhatsApp", callback_data: WHATSAPP_REMINDER_CONFIRM_CALLBACK },
          { text: "Cancelar", callback_data: WHATSAPP_REMINDER_CANCEL_CALLBACK },
        ]],
      },
    };
  }

  if (payload.type === "QUALITAS_PAYMENT_LINK") {
    return continueTelegramQualitasDraftFromText({ chatId: input.chatId, text, draft, client: db });
  }

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
      case "paidDate": {
        const paidDate = parseTelegramPaymentDateInput(text);
        if (!paidDate) {
          return {
            handled: true as const,
            chatId: input.chatId,
            replyText: "La fecha debe ser hoy o tener formato YYYY-MM-DD. Intenta de nuevo.",
          };
        }
        state.paidDate = paidDate;
        state.step = getNextPaymentStep(state);
        break;
      }
      case "paymentMethod":
        state.paymentMethod = text;
        state.step = getNextPaymentStep(state);
        break;
      case "ready": {
        const readyReceipt =
          state.policyNumber && state.receiptNumber
            ? await getUserLinkedReceiptByPolicyAndNumber(channel.userId, state.policyNumber, state.receiptNumber, db)
            : null;
        return {
          handled: true as const,
          chatId: input.chatId,
          replyText: buildTelegramPaymentDraftMessage({
            policyNumber: readyReceipt?.policy.policyNumber ?? state.policyNumber ?? "—",
            receiptNumber: readyReceipt?.receiptNumber ?? state.receiptNumber ?? "—",
            originLabel: readyReceipt ? getReceiptOriginLabel(readyReceipt) : undefined,
            clientName: readyReceipt?.client.fullName ?? "—",
            amount: readyReceipt
              ? formatCurrency(toNumber(readyReceipt.amount), readyReceipt.currency)
              : formatCurrency(state.amount ?? 0, state.currency ?? "MXN"),
            paymentMethod: state.paymentMethod ?? "—",
            paidDate: state.paidDate ? formatTelegramPaymentDateLabel(state.paidDate) : "—",
            reference: state.reference,
          }),
        };
      }
    }

    const nextPayload: TelegramDraftState = {
      type: "PAYMENT_CAPTURE",
      payment: state,
    };
    await persistTelegramDraftState({ organizationId: draft.organizationId!, draftId: draft.id, state: nextPayload, client: db });

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
          amount: toNumber(receipt.amount),
          receiptId: receipt.id,
          policyId: receipt.policyId,
          clientId: receipt.clientId,
          insurerId: receipt.insurerId,
          clientName: receipt.client.fullName,
          insurerName: receipt.insurer.name,
          currency: receipt.currency,
          receiptResolvedAt: new Date().toISOString(),
          receiptNumber: receipt.receiptNumber,
          policyNumber: receipt.policy.policyNumber,
          paidDate: state.paidDate,
          paymentMethod: state.paymentMethod,
          reference: state.reference ?? null,
        },
      };
      await persistTelegramDraftState({ organizationId: draft.organizationId!, draftId: draft.id, state: confirmedPayload, client: db });

      return {
        handled: true as const,
        chatId: input.chatId,
        replyText: buildTelegramPaymentDraftMessage({
          policyNumber: receipt.policy.policyNumber,
          receiptNumber: receipt.receiptNumber,
          originLabel: getReceiptOriginLabel(receipt),
          clientName: receipt.client.fullName,
          amount: formatCurrency(toNumber(receipt.amount), receipt.currency),
          paymentMethod: state.paymentMethod ?? "",
          paidDate: formatTelegramPaymentDateLabel(state.paidDate ?? getLocalDateKey(new Date())),
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
  await persistTelegramDraftState({ organizationId: draft.organizationId!, draftId: draft.id, state: nextPayload, client: db });

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
          telegramDigestLastAutoSentAt: true,
        },
      },
    },
  });

  const result: TelegramDailyDigestResult = {
    processed: channels.length,
    sent: 0,
    failed: 0,
    parts: 0,
  };
  const now = new Date();

  for (const channel of channels) {
    if (!channel.telegramChatId) continue;
    const timeZone = channel.user.timeZone || DEFAULT_TIMEZONE;
    if (
      channel.user.telegramDigestLastAutoSentAt &&
      getLocalDateKey(channel.user.telegramDigestLastAutoSentAt, timeZone) === getLocalDateKey(now, timeZone)
    ) {
      continue;
    }
    try {
      const digestResult = await sendTelegramDigestMessagesForUser({
        userId: channel.userId,
        client: db,
        mode: "automatic",
        timeZone,
      });

      result.sent += digestResult.sent;
      result.failed += digestResult.failed;
      result.parts += digestResult.parts;

    } catch (error) {
      result.failed += 1;
      logError("telegram.sendDailyDigest", error, { userId: channel.userId });
    }
  }

  return result;
}

export async function createTelegramLinkCodeForUser(input: {
  organizationId: string;
  userId: string;
  actorId: string;
  client?: DbClient;
}): Promise<TelegramLinkCodeResult> {
  const db = input.client ?? getDb();

  try {
    const result = await db.$transaction(async (tx) => {
      await tx.telegramLinkToken.deleteMany({
        where: {
          organizationId: input.organizationId,
          userId: input.userId,
          usedAt: null,
        },
      });

      const code = generateTelegramLinkCode();
      const tokenHash = hashTelegramLinkCode(code, getTelegramLinkSecret());
      const expiresAt = new Date(Date.now() + TELEGRAM_LINK_TOKEN_TTL_MINUTES * 60 * 1000);

      const token = await tx.telegramLinkToken.create({
        data: {
          organizationId: input.organizationId,
          userId: input.userId,
          tokenHash,
          expiresAt,
        },
      });

      return {
        code,
        expiresAt: token.expiresAt.toISOString(),
        tokenId: token.id,
      };
    });

    try {
      await writeActivityLog({
        organizationId: input.organizationId,
        entityType: "TelegramLinkToken",
        entityId: result.tokenId,
        action: "TELEGRAM_LINK_CODE_GENERATED",
        newValue: {
          expiresAt: result.expiresAt,
        },
        userId: input.actorId,
      });
    } catch (auditError) {
      logError("telegram.createLinkCode.audit", auditError, {
        userId: input.userId,
        actorId: input.actorId,
      });
    }

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
  // TENANT_READ_SCOPE_GLOBAL_TOKEN: the random, hashed, single-use token is the
  // authorization locator; its persisted organizationId scopes every follow-up.
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

      if (!token.organizationId) throw new Error("ORGANIZATION_ACCESS_DENIED");
      await ensureNotificationDefaultsForUser(token.organizationId, token.userId, tx);

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
        where: { id: token.id, organizationId: token.organizationId! },
        data: {
          usedAt: new Date(),
        },
      });

      return {
        ok: true as const,
        userId: token.userId,
        organizationId: token.organizationId,
        channelId: channel.id,
        previousChannel,
      };
    });

    if (!result.ok) {
      return result;
    }

    try {
      await writeActivityLog({
        organizationId: result.organizationId,
        entityType: "NotificationChannel",
        entityId: result.channelId,
        action: result.previousChannel?.telegramChatId ? "TELEGRAM_RELINKED" : "TELEGRAM_LINKED",
        oldValue: result.previousChannel
          ? {
              telegramChatId: result.previousChannel.telegramChatId,
              isEnabled: result.previousChannel.isEnabled,
            }
          : null,
        newValue: {
          telegramChatId: chatId,
          isEnabled: true,
        },
        userId: result.userId,
      });
    } catch (auditError) {
      logError("telegram.connect.audit", auditError, { chatId, userId: result.userId });
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
  organizationId: string;
  userId: string;
  actorId: string;
  client?: DbClient;
}): Promise<TelegramActionResult> {
  const db = input.client ?? getDb();

  try {
    const result = await db.$transaction(async (tx) => {
      await ensureNotificationDefaultsForUser(input.organizationId, input.userId, tx);
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
          organizationId: input.organizationId,
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
  organizationId: string,
  replyMarkup?: TelegramInlineKeyboardMarkup,
  client?: DbClient,
): Promise<NotificationEventRecord | null> {
  const db = client ?? getDb();

  try {
    const event = await db.notificationEvent.findFirst({ where: { id: eventId, organizationId } });
    if (!event) return null;
    if (event.status === "SENT" || event.status === "FAILED" || event.status === "SKIPPED") {
      return event as NotificationEventRecord;
    }
    if (event.channelType !== "TELEGRAM") {
      return await markNotificationSkipped(event.id, event.organizationId!, "Canal no soportado.", db);
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
      return await markNotificationSkipped(event.id, event.organizationId!, "Telegram no está vinculado.", db);
    }

    const result = await sendTelegramMessage(
      channel.telegramChatId,
      formatTelegramNotificationText(event.title, event.body),
      channel.telegramMutationsEnabled ? replyMarkup : undefined,
    );

    if (!result.ok) {
      return await markNotificationFailed(event.id, event.organizationId!, result.error, db);
    }

    return await markNotificationSent(event.id, event.organizationId!, db);
  } catch (error) {
    logError("telegram.deliverNotificationEvent", error, { eventId });
    return null;
  }
}

export async function createAndDeliverTelegramNotificationEvent(input: {
  organizationId: string;
  type: string;
  title: string;
  body: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  userId: string;
  workItemId?: string | null;
  clientId?: string | null;
  policyId?: string | null;
  receiptId?: string | null;
  dedupeKey?: string | null;
  force?: boolean;
  replyMarkup?: TelegramInlineKeyboardMarkup;
}): Promise<NotificationEventRecord | null> {
  const event = await createNotificationEvent({
    organizationId: input.organizationId,
    type: input.type,
    title: input.title,
    body: input.body,
    priority: input.priority,
    userId: input.userId,
    workItemId: input.workItemId ?? null,
    clientId: input.clientId ?? null,
    policyId: input.policyId ?? null,
    receiptId: input.receiptId ?? null,
    dedupeKey: input.dedupeKey ?? null,
    channelType: "TELEGRAM",
    force: input.force,
  });

  if (!event || event.status !== "PENDING") {
    return event;
  }

  return deliverTelegramNotificationEvent(event.id, input.organizationId, input.replyMarkup);
}

export async function processTelegramWebhookUpdate(
  update: TelegramWebhookUpdate,
): Promise<TelegramWebhookProcessResult> {
  if (update.callback_query) {
    try {
      if (update.callback_query.data?.startsWith("digest_")) {
        return await processTelegramDigestCallback(update.callback_query);
      }
      if (update.callback_query.data?.startsWith("whatsapp_reminder_")) {
        return await processTelegramWhatsAppReminderCallback(update.callback_query);
      }
      return await processTelegramQualitasCallback(update.callback_query);
    } catch (error) {
      logError("telegram.processCallbackQuery", error, { updateId: update.update_id });
      return {
        handled: true,
        callbackQueryId: update.callback_query.id,
        callbackAnswerText: "No se pudo procesar esta selección.",
      };
    }
  }

  const message = update.message;
  if (!message?.text && !message?.document) {
    return { handled: false };
  }

  const chatId = normalizeChatId(message.chat.id);
  if (message.document) {
    if (message.chat.type !== "private") {
      return { handled: true, chatId };
    }

    const rateLimit = await checkDistributedRateLimit(`telegram:pdf:${securityFingerprint(`chat:${chatId}`)}`, {
      ...TELEGRAM_DRAFT_CONTINUATION_RATE_LIMIT,
      requireDistributed: true,
    });
    if (!rateLimit.allowed) {
      return {
        handled: true,
        chatId,
        replyText: "Demasiados intentos. Espera un momento e inténtalo de nuevo.",
      };
    }

    const result = await createTelegramPolicyDraftFromPdf({
      chatId,
      document: message.document,
      caption: message.caption ?? null,
    });

    return {
      handled: true,
      chatId,
      replyText: result.replyText,
      draftId: result.draftId,
    };
  }

  const text = message.text ?? "";
  const command = parseTelegramCommand(text);
  if (!command) {
    if (message.chat.type !== "private") {
      return { handled: true, chatId };
    }

    const rateLimit = await checkDistributedRateLimit(`telegram:draft:${securityFingerprint(`chat:${chatId}`)}`, {
      ...TELEGRAM_DRAFT_CONTINUATION_RATE_LIMIT,
      requireDistributed: true,
    });
    if (!rateLimit.allowed) {
      return {
        handled: true,
        chatId,
        replyText: "Demasiados intentos. Espera un momento e inténtalo de nuevo.",
      };
    }

    const continuation = await continueTelegramDraftFromMessage({
      chatId,
      text,
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

    const rateLimit = await checkDistributedRateLimit(`telegram:${securityFingerprint(`chat:${chatId}:${command.command}`)}`, {
      ...TELEGRAM_COMMAND_RATE_LIMIT,
      requireDistributed: true,
    });
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
      case "ayuda":
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
      case "resumen": {
        const channel = await getTelegramChannelByChatId(chatId);
        if (!channel?.isEnabled || !channel.telegramChatId) {
          return {
            handled: true,
            chatId,
            replyText: buildTelegramLinkedChatRequiredMessage(),
          };
        }

        await sendTelegramDigestMessagesForUser({
          userId: channel.userId,
          mode: "manual",
        });

        return { handled: true, chatId };
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
      case "recordar": {
        const channel = await getTelegramChannelByChatId(chatId);
        if (!channel?.isEnabled || !channel.telegramChatId) {
          return { handled: true, chatId, replyText: buildTelegramLinkedChatRequiredMessage() };
        }
        const parts = (command.argument ?? "").trim().split(/\s+/).filter(Boolean);
        if (parts.length === 0) {
          const selection = await getDigestReceiptSelection(channel.userId);
          return {
            handled: true,
            chatId,
            replyText: selection.items.length > 0 ? "Selecciona el recibo para preparar un recordatorio manual por WhatsApp." : "No hay recibos abiertos disponibles para un recordatorio.",
            ...(selection.items.length > 0 ? { replyMarkup: buildDigestReceiptSelectionMarkup(selection.items.slice(0, 10), 1, selection.totalPages) } : {}),
          };
        }
        if (parts.length !== 2) {
          return { handled: true, chatId, replyText: "Usa /recordar <numero-poliza> <numero-recibo>." };
        }
        const receipt = await getUserLinkedReceiptByPolicyAndNumber(channel.userId, parts[0]!, parts[1]!);
        if (!receipt) {
          return { handled: true, chatId, replyText: "No encontré un recibo único para esa póliza y ese número." };
        }
        const result = await createTelegramWhatsAppReminderDraft({ chatId, receiptId: receipt.id });
        return {
          handled: true,
          chatId,
          replyText: result.replyText,
          ...(("replyMarkup" in result && result.replyMarkup) ? { replyMarkup: result.replyMarkup } : {}),
          ...(("removeReplyMarkup" in result && result.removeReplyMarkup) ? { removeReplyMarkup: true } : {}),
          ...(result.draftId ? { draftId: result.draftId } : {}),
        };
      }
      case "pagoqualitas": {
        const result = await createTelegramQualitasDraft({
          chatId,
          argument: command.argument ?? "",
        });
        return {
          handled: true,
          chatId,
          replyText: result.replyText,
          replyMarkup: result.replyMarkup,
          draftId: result.draftId,
        };
      }
      case "vencidos": {
        const channel = await getTelegramChannelByChatId(chatId);
        if (!channel?.isEnabled || !channel.telegramChatId) {
          return {
            handled: true,
            chatId,
            replyText: buildTelegramLinkedChatRequiredMessage(),
          };
        }

        const range = parseTelegramPage(command.argument);
        if (!range.ok) {
          return {
            handled: true,
            chatId,
            replyText: range.error,
          };
        }

        const replyText = await buildTelegramOverdueReply(channel.userId, range.page);
        const dayStart = businessStartOfDay(new Date());
        const replyMarkup = await buildTelegramReceiptListMarkup({ userId: channel.userId, to: new Date(dayStart.getTime() - 1), page: range.page });
        return {
          handled: true,
          chatId,
          replyText,
          ...(replyMarkup ? { replyMarkup } : {}),
        };
      }
      case "hoy": {
        const channel = await getTelegramChannelByChatId(chatId);
        if (!channel?.isEnabled || !channel.telegramChatId) {
          return {
            handled: true,
            chatId,
            replyText: buildTelegramLinkedChatRequiredMessage(),
          };
        }

        const range = parseTelegramPage(command.argument);
        if (!range.ok) {
          return {
            handled: true,
            chatId,
            replyText: range.error,
          };
        }

        const replyText = await buildTelegramTodayReply(channel.userId, range.page);
        const dayStart = businessStartOfDay(new Date());
        const replyMarkup = await buildTelegramReceiptListMarkup({ userId: channel.userId, from: dayStart, to: businessEndOfDay(dayStart), page: range.page });
        return {
          handled: true,
          chatId,
          replyText,
          ...(replyMarkup ? { replyMarkup } : {}),
        };
      }
      case "proximos": {
        const channel = await getTelegramChannelByChatId(chatId);
        if (!channel?.isEnabled || !channel.telegramChatId) {
          return {
            handled: true,
            chatId,
            replyText: buildTelegramLinkedChatRequiredMessage(),
          };
        }

        const range = parseTelegramDaysAndPage(command.argument, 14);
        if (!range.ok) {
          return {
            handled: true,
            chatId,
            replyText: range.error,
          };
        }

        const replyText = await buildTelegramUpcomingReceiptsReply(channel.userId, range.days, range.page);
        const queryRange = getTelegramQueryRangeFromNow(range.days);
        const replyMarkup = await buildTelegramReceiptListMarkup({ userId: channel.userId, from: queryRange.from, to: queryRange.to, page: range.page });
        return {
          handled: true,
          chatId,
          replyText,
          ...(replyMarkup ? { replyMarkup } : {}),
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
        const response: TelegramWebhookProcessResult = {
          handled: true,
          chatId,
          replyText: result.replyText,
        };
        const resultWithMarkup = result as { replyMarkup?: TelegramInlineKeyboardMarkup; removeReplyMarkup?: boolean };
        if (resultWithMarkup.replyMarkup) response.replyMarkup = resultWithMarkup.replyMarkup;
        if (resultWithMarkup.removeReplyMarkup) response.removeReplyMarkup = true;
        return response;
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

        const range = parseTelegramDaysAndPage(command.argument, TELEGRAM_QUERY_DEFAULT_DAYS);
        if (!range.ok) {
          return {
            handled: true,
            chatId,
            replyText: range.error,
          };
        }

        const replyText =
          command.command === "recibos"
            ? await buildTelegramReceiptsReply(channel.userId, range.days, range.page)
            : await buildTelegramRenewalsReply(channel.userId, range.days, range.page);

        const dayStart = businessStartOfDay(new Date());
        const replyMarkup = command.command === "recibos"
          ? await buildTelegramReceiptListMarkup({ userId: channel.userId, to: businessEndOfDay(businessAddDays(dayStart, range.days)), page: range.page })
          : undefined;

        return {
          handled: true,
          chatId,
          replyText,
          ...(replyMarkup ? { replyMarkup } : {}),
        };
      }
      case "tareas": {
        const channel = await getTelegramChannelByChatId(chatId);
        if (!channel?.isEnabled || !channel.telegramChatId) {
          return {
            handled: true,
            chatId,
            replyText: buildTelegramLinkedChatRequiredMessage(),
          };
        }

        const range = parseTelegramDaysAndPage(command.argument, TELEGRAM_QUERY_DEFAULT_DAYS);
        if (!range.ok) {
          return {
            handled: true,
            chatId,
            replyText: range.error,
          };
        }

        return {
          handled: true,
          chatId,
          replyText: await buildTelegramTasksReply(channel.userId, range.days, range.page),
        };
      }
      case "buscar": {
        const channel = await getTelegramChannelByChatId(chatId);
        if (!channel?.isEnabled || !channel.telegramChatId) {
          return {
            handled: true,
            chatId,
            replyText: buildTelegramLinkedChatRequiredMessage(),
          };
        }

        if (!command.argument?.trim()) {
          return {
            handled: true,
            chatId,
            replyText: "Escribe /buscar <texto> para buscar clientes, pólizas, recibos, tareas o archivos.",
          };
        }

        return {
          handled: true,
          chatId,
          replyText: await buildTelegramSearchReply(channel.userId, command.argument),
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

export async function getTelegramChannelStateForUser(organizationId: string, userId: string, client?: DbClient) {
  const db = client ?? getDb();
  try {
    await ensureNotificationDefaultsForUser(organizationId, userId, db);
    return (await getTelegramChannelByUserId(userId, db)) ?? createFallbackTelegramChannelState(userId);
  } catch (error) {
    logError("telegram.getTelegramChannelStateForUser", error, { userId });
    return createFallbackTelegramChannelState(userId);
  }
}

export { TELEGRAM_LINK_TOKEN_TTL_MINUTES };
