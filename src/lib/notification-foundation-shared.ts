import { DEFAULT_TIMEZONE } from "@/lib/dates";
import type { Priority } from "@/lib/domain-values";

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
