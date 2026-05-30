import { DEFAULT_TIMEZONE } from "@/lib/dates";
import type { NotificationChannelType, NotificationEventStatus, Priority } from "@/generated/prisma/client";

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
  type: NotificationChannelType;
  telegramChatId: string | null;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type NotificationPreferenceRecord = {
  id: string;
  userId: string;
  eventType: string;
  channelType: NotificationChannelType;
  enabled: boolean;
  minPriority: Priority;
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
  priority: Priority;
  userId: string;
  workItemId: string | null;
  clientId: string | null;
  policyId: string | null;
  receiptId: string | null;
  channelType: NotificationChannelType;
  status: NotificationEventStatus;
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
