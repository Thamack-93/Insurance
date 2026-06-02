import { DEFAULT_TIMEZONE } from "@/lib/dates";
import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
import { logError } from "@/lib/logger";
import type { NotificationChannelType, Priority } from "@/lib/domain-values";
import type {
  Prisma,
  PrismaClient,
} from "@/generated/prisma/client";

export const notificationEventCatalog = [
  {
    eventType: "TEST_MESSAGE",
    title: "Mensaje de prueba",
    description: "Verifica que el usuario reciba notificaciones cuando Telegram esté listo.",
    defaultEnabled: false,
    defaultMinPriority: "LOW",
  },
  {
    eventType: "DAILY_DIGEST",
    title: "Resumen diario",
    description: "Compacta la actividad del día para envío programado.",
    defaultEnabled: true,
    defaultMinPriority: "LOW",
  },
  {
    eventType: "URGENT_WORKITEM_ASSIGNED",
    title: "Pendiente urgente asignado",
    description: "Notifica pendientes urgentes o de alta prioridad.",
    defaultEnabled: true,
    defaultMinPriority: "HIGH",
  },
  {
    eventType: "CRITICAL_RENEWAL",
    title: "Renovación crítica",
    description: "Avisa cuando una renovación entra en ventana crítica.",
    defaultEnabled: true,
    defaultMinPriority: "HIGH",
  },
  {
    eventType: "OVERDUE_RECEIPT",
    title: "Recibo vencido",
    description: "Alerta sobre cobranza vencida o atrasada.",
    defaultEnabled: true,
    defaultMinPriority: "HIGH",
  },
] as const;

export type NotificationEventType = (typeof notificationEventCatalog)[number]["eventType"];

export type NotificationChannelRecord = {
  id: string;
  userId: string;
  type: string;
  telegramChatId: string | null;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type NotificationPreferenceRecord = {
  id: string;
  userId: string;
  eventType: string;
  channelType: string;
  enabled: boolean;
  minPriority: string;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type NotificationPreferencesSnapshot = {
  channel: NotificationChannelRecord;
  preferences: NotificationPreferenceRecord[];
};

export type NotificationEventRecord = {
  id: string;
  type: string;
  title: string;
  body: string;
  priority: string;
  userId: string;
  workItemId: string | null;
  clientId: string | null;
  policyId: string | null;
  receiptId: string | null;
  channelType: string;
  status: string;
  sentAt: Date | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type NotificationPreferenceInput = {
  eventType: string;
  enabled: boolean;
  minPriority: Priority;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
};

type DbClient = PrismaClient | Prisma.TransactionClient;

const PRIORITY_RANK: Record<Priority, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  URGENT: 4,
};

function normalizeTime(value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (!/^\d{2}:\d{2}$/.test(trimmed)) return null;
  const [hoursText, minutesText] = trimmed.split(":");
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function getMinutesInTimeZone(date: Date, timeZone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);

  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}

export function getNotificationEventMeta(eventType: string) {
  return notificationEventCatalog.find((item) => item.eventType === eventType) ?? null;
}

export function isNotificationEventType(value: string): value is NotificationEventType {
  return notificationEventCatalog.some((item) => item.eventType === value);
}

export function comparePriority(priority: Priority, minPriority: Priority) {
  return PRIORITY_RANK[priority] - PRIORITY_RANK[minPriority];
}

export function isWithinQuietHours(
  now: Date,
  quietHoursStart?: string | null,
  quietHoursEnd?: string | null,
  timeZone = DEFAULT_TIMEZONE,
) {
  const start = normalizeTime(quietHoursStart);
  const end = normalizeTime(quietHoursEnd);
  if (!start || !end || start === end) return false;

  const currentMinutes = getMinutesInTimeZone(now, timeZone);
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  const startMinutes = startHour * 60 + startMinute;
  const endMinutes = endHour * 60 + endMinute;

  if (startMinutes < endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  return currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

export function shouldNotifyFromState(input: {
  priority: Priority;
  minPriority: Priority;
  channelEnabled: boolean;
  preferenceEnabled: boolean;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
  now?: Date;
  timeZone?: string;
}) {
  if (!input.channelEnabled || !input.preferenceEnabled) return false;
  if (comparePriority(input.priority, input.minPriority) < 0) return false;
  if (isWithinQuietHours(input.now ?? new Date(), input.quietHoursStart, input.quietHoursEnd, input.timeZone)) {
    return false;
  }
  return true;
}

function toChannelRecord(row: {
  id: string;
  userId: string;
  type: string;
  telegramChatId: string | null;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}): NotificationChannelRecord {
  return row as NotificationChannelRecord;
}

function toPreferenceRecord(row: {
  id: string;
  userId: string;
  eventType: string;
  channelType: string;
  enabled: boolean;
  minPriority: string;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  createdAt: Date;
  updatedAt: Date;
}): NotificationPreferenceRecord {
  return row as NotificationPreferenceRecord;
}

function toEventRecord(row: {
  id: string;
  type: string;
  title: string;
  body: string;
  priority: string;
  userId: string;
  workItemId: string | null;
  clientId: string | null;
  policyId: string | null;
  receiptId: string | null;
  channelType: string;
  status: string;
  sentAt: Date | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}): NotificationEventRecord {
  return row as NotificationEventRecord;
}

export async function ensureNotificationDefaultsForUser(userId: string, client?: DbClient) {
  const db = client ?? getDb();

  await db.notificationChannel.upsert({
    where: {
      userId_type: {
        userId,
        type: "TELEGRAM",
      },
    },
    update: {},
    create: {
      userId,
      type: "TELEGRAM",
      isEnabled: false,
      telegramChatId: null,
    },
  });

  await db.notificationPreference.createMany({
    data: notificationEventCatalog.map((item) => ({
      userId,
      eventType: item.eventType,
      channelType: "TELEGRAM",
      enabled: item.defaultEnabled,
      minPriority: item.defaultMinPriority,
      quietHoursStart: null,
      quietHoursEnd: null,
    })),
    skipDuplicates: true,
  });
}

export async function getNotificationPreferencesForUser(
  userId: string,
  client?: DbClient,
): Promise<NotificationPreferencesSnapshot> {
  const db = client ?? getDb();
  try {
    await ensureNotificationDefaultsForUser(userId, db);

    const [channel, preferences] = await Promise.all([
      db.notificationChannel.findUnique({
        where: {
          userId_type: {
            userId,
            type: "TELEGRAM",
          },
        },
      }),
      db.notificationPreference.findMany({
        where: { userId, channelType: "TELEGRAM" },
        orderBy: [{ eventType: "asc" }],
      }),
    ]);

    return {
      channel: toChannelRecord(channel ?? {
        id: "",
        userId,
        type: "TELEGRAM",
        telegramChatId: null,
        isEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      preferences: preferences.map(toPreferenceRecord),
    };
  } catch (error) {
    logError("notification-foundation.getNotificationPreferencesForUser", error, { userId });
    return {
      channel: {
        id: "",
        userId,
        type: "TELEGRAM",
        telegramChatId: null,
        isEnabled: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      preferences: [],
    };
  }
}

export async function shouldNotifyUser(input: {
  userId: string;
  eventType: string;
  priority: Priority;
  channelType?: NotificationChannelType;
  now?: Date;
  client?: DbClient;
}) {
  const channelType = input.channelType ?? "TELEGRAM";
  const snapshot = await getNotificationPreferencesForUser(input.userId, input.client);
  const db = input.client ?? getDb();
  const user = await db.user.findUnique({
    where: { id: input.userId },
    select: { timeZone: true },
  });
  const preference = snapshot.preferences.find(
    (row) => row.eventType === input.eventType && row.channelType === channelType,
  );

  if (!preference) return false;

  return shouldNotifyFromState({
    priority: input.priority,
    minPriority: preference.minPriority as Priority,
    channelEnabled:
      snapshot.channel.type === channelType &&
      snapshot.channel.isEnabled &&
      Boolean(snapshot.channel.telegramChatId),
    preferenceEnabled: preference.enabled,
    quietHoursStart: preference.quietHoursStart,
    quietHoursEnd: preference.quietHoursEnd,
    now: input.now,
    timeZone: user?.timeZone ?? DEFAULT_TIMEZONE,
  });
}

export async function createNotificationEvent(
  input: {
    type: string;
    title: string;
    body: string;
    priority: Priority;
    userId: string;
    channelType?: NotificationChannelType;
    force?: boolean;
    workItemId?: string | null;
    clientId?: string | null;
    policyId?: string | null;
    receiptId?: string | null;
  },
  client?: DbClient,
) {
  const db = client ?? getDb();
  const channelType = input.channelType ?? "TELEGRAM";
  const shouldSend = input.force
    ? true
    : await shouldNotifyUser({
        userId: input.userId,
        eventType: input.type,
        priority: input.priority,
        channelType,
        client: db,
      });

  try {
    const event = await db.notificationEvent.create({
      data: {
        type: input.type,
        title: input.title,
        body: input.body,
        priority: input.priority,
        userId: input.userId,
        workItemId: input.workItemId ?? null,
        clientId: input.clientId ?? null,
        policyId: input.policyId ?? null,
        receiptId: input.receiptId ?? null,
        channelType,
        status: shouldSend ? "PENDING" : "SKIPPED",
        error: shouldSend ? null : "Notification skipped by preferences or channel state.",
      },
    });
    return toEventRecord(event);
  } catch (error) {
    logError("notification-foundation.createNotificationEvent", error, {
      userId: input.userId,
      type: input.type,
    });
    return null;
  }
}

export async function markNotificationSent(id: string, client?: DbClient) {
  const db = client ?? getDb();
  try {
    const event = await db.notificationEvent.update({
      where: { id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        error: null,
      },
    });
    return toEventRecord(event);
  } catch (error) {
    logError("notification-foundation.markNotificationSent", error, { id });
    return null;
  }
}

export async function markNotificationFailed(id: string, errorMessage: string, client?: DbClient) {
  const db = client ?? getDb();
  try {
    const event = await db.notificationEvent.update({
      where: { id },
      data: {
        status: "FAILED",
        error: errorMessage,
      },
    });
    return toEventRecord(event);
  } catch (error) {
    logError("notification-foundation.markNotificationFailed", error, { id });
    return null;
  }
}

export async function markNotificationSkipped(id: string, reason?: string, client?: DbClient) {
  const db = client ?? getDb();
  try {
    const event = await db.notificationEvent.update({
      where: { id },
      data: {
        status: "SKIPPED",
        error: reason ?? null,
      },
    });
    return toEventRecord(event);
  } catch (error) {
    logError("notification-foundation.markNotificationSkipped", error, { id });
    return null;
  }
}

export async function updateNotificationPreferences(input: {
  userId: string;
  preferences: NotificationPreferenceInput[];
  actorId: string;
  client?: DbClient;
}) {
  const db = input.client ?? getDb();
  const cleanPreferences = input.preferences.filter((item) => isNotificationEventType(item.eventType));

  try {
    await ensureNotificationDefaultsForUser(input.userId, db);

    const existing = await db.notificationPreference.findMany({
      where: {
        userId: input.userId,
        channelType: "TELEGRAM",
      },
    });
    const existingByKey = new Map<string, NotificationPreferenceRecord>(
      existing.map((row) => [`${row.channelType}:${row.eventType}`, toPreferenceRecord(row)]),
    );

    const result = await db.$transaction(async (tx) => {
      const updatedRows: NotificationPreferenceRecord[] = [];

      for (const preference of cleanPreferences) {
        const quietHoursStart = normalizeTime(preference.quietHoursStart);
        const quietHoursEnd = normalizeTime(preference.quietHoursEnd);
        const key = `TELEGRAM:${preference.eventType}`;
        const previous = existingByKey.get(key);

        const updated = await tx.notificationPreference.upsert({
          where: {
            userId_eventType_channelType: {
              userId: input.userId,
              eventType: preference.eventType,
              channelType: "TELEGRAM",
            },
          },
          update: {
            enabled: preference.enabled,
            minPriority: preference.minPriority,
            quietHoursStart,
            quietHoursEnd,
          },
          create: {
            userId: input.userId,
            eventType: preference.eventType,
            channelType: "TELEGRAM",
            enabled: preference.enabled,
            minPriority: preference.minPriority,
            quietHoursStart,
            quietHoursEnd,
          },
        });

        updatedRows.push(toPreferenceRecord(updated));

        const changed =
          !previous ||
          previous.enabled !== preference.enabled ||
          previous.minPriority !== preference.minPriority ||
          normalizeTime(previous.quietHoursStart) !== quietHoursStart ||
          normalizeTime(previous.quietHoursEnd) !== quietHoursEnd;

        if (changed) {
          await writeActivityLog(
            {
              entityType: "NotificationPreference",
              entityId: `${input.userId}:${preference.eventType}:TELEGRAM`,
              action: previous ? "NOTIFICATION_PREFERENCE_UPDATED" : "NOTIFICATION_PREFERENCE_CREATED",
              oldValue: previous
                ? {
                    enabled: previous.enabled,
                    minPriority: previous.minPriority,
                    quietHoursStart: previous.quietHoursStart,
                    quietHoursEnd: previous.quietHoursEnd,
                  }
                : null,
              newValue: {
                enabled: preference.enabled,
                minPriority: preference.minPriority,
                quietHoursStart,
                quietHoursEnd,
              },
              userId: input.actorId,
              db: tx,
            },
          );
        }
      }

      return updatedRows;
    });

    return result;
  } catch (error) {
    logError("notification-foundation.updateNotificationPreferences", error, {
      userId: input.userId,
      actorId: input.actorId,
    });
    return null;
  }
}
