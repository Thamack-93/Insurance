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
] as const;

export type NotificationEventType = (typeof notificationEventCatalog)[number]["eventType"];

export type NotificationChannelRecord = {
  id: string;
  userId: string;
  type: string;
  telegramChatId: string | null;
  isEnabled: boolean;
  telegramMutationsEnabled: boolean;
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
};

type DbClient = PrismaClient | Prisma.TransactionClient;

const PRIORITY_RANK: Record<Priority, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  URGENT: 4,
};

function getDatePartsInTimeZone(date: Date, timeZone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);

  const year = Number(parts.find((part) => part.type === "year")?.value ?? 1970);
  const month = Number(parts.find((part) => part.type === "month")?.value ?? 1);
  const day = Number(parts.find((part) => part.type === "day")?.value ?? 1);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return { year, month, day, hour, minute };
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

export function getLocalDateKey(now: Date, timeZone = DEFAULT_TIMEZONE) {
  const parts = getDatePartsInTimeZone(now, timeZone);
  return [
    String(parts.year).padStart(4, "0"),
    String(parts.month).padStart(2, "0"),
    String(parts.day).padStart(2, "0"),
  ].join("-");
}

export function getLocalHour(now: Date, timeZone = DEFAULT_TIMEZONE) {
  return getDatePartsInTimeZone(now, timeZone).hour;
}

export function isDigestHourDue(now: Date, digestHour: number, timeZone = DEFAULT_TIMEZONE) {
  if (!Number.isInteger(digestHour) || digestHour < 0 || digestHour > 23) return false;
  return getLocalHour(now, timeZone) === digestHour;
}

export function shouldNotifyFromState(input: {
  priority: Priority;
  minPriority: Priority;
  channelEnabled: boolean;
  preferenceEnabled: boolean;
}) {
  if (!input.channelEnabled || !input.preferenceEnabled) return false;
  if (comparePriority(input.priority, input.minPriority) < 0) return false;
  return true;
}

function toChannelRecord(row: {
  id: string;
  userId: string;
  type: string;
  telegramChatId: string | null;
  isEnabled: boolean;
  telegramMutationsEnabled: boolean;
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
        telegramMutationsEnabled: false,
      },
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
        telegramMutationsEnabled: false,
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
        telegramMutationsEnabled: false,
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
  client?: DbClient;
}) {
  const channelType = input.channelType ?? "TELEGRAM";
  const snapshot = await getNotificationPreferencesForUser(input.userId, input.client);
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
          },
          create: {
            userId: input.userId,
            eventType: preference.eventType,
            channelType: "TELEGRAM",
            enabled: preference.enabled,
            minPriority: preference.minPriority,
          },
        });

        updatedRows.push(toPreferenceRecord(updated));

        const changed =
          !previous ||
          previous.enabled !== preference.enabled ||
          previous.minPriority !== preference.minPriority;

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
                  }
                : null,
              newValue: {
                enabled: preference.enabled,
                minPriority: preference.minPriority,
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
