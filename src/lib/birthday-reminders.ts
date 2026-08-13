import { DEFAULT_TIMEZONE } from "@/lib/dates";
import { getLocalDateKey } from "@/lib/notification-foundation";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

const MONTH_NAMES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
] as const;

type CalendarParts = { year: number; month: number; day: number };

export type BirthdayReminderItem = {
  id: string;
  fullName: string;
  birthDate: Date;
  age: number;
};

export function getLocalCalendarParts(date: Date, timeZone = DEFAULT_TIMEZONE): CalendarParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  return {
    year: Number(parts.find((part) => part.type === "year")?.value ?? 1970),
    month: Number(parts.find((part) => part.type === "month")?.value ?? 1),
    day: Number(parts.find((part) => part.type === "day")?.value ?? 1),
  };
}

export function getDateOnlyCalendarParts(date: Date): CalendarParts {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

export function isBirthdayToday(birthDate: Date, now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const birthday = getDateOnlyCalendarParts(birthDate);
  const today = getLocalCalendarParts(now, timeZone);
  if (birthday.month === today.month && birthday.day === today.day) return true;

  return birthday.month === 2 && birthday.day === 29 && today.month === 2 && today.day === 28 && !isLeapYear(today.year);
}

export function calculateAge(birthDate: Date, now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const birthday = getDateOnlyCalendarParts(birthDate);
  const today = getLocalCalendarParts(now, timeZone);
  let age = today.year - birthday.year;
  const birthdayThisYear = birthday.month === 2 && birthday.day === 29 && !isLeapYear(today.year)
    ? { month: 2, day: 28 }
    : { month: birthday.month, day: birthday.day };

  if (today.month < birthdayThisYear.month || (today.month === birthdayThisYear.month && today.day < birthdayThisYear.day)) {
    age -= 1;
  }

  return Math.max(0, age);
}

export function formatBirthdayDate(birthDate: Date) {
  const { month, day } = getDateOnlyCalendarParts(birthDate);
  return `${day} de ${MONTH_NAMES[month - 1]}`;
}

export function buildBirthdayReminderMessage(items: BirthdayReminderItem[], now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const today = getLocalCalendarParts(now, timeZone);
  const dateLabel = `${today.day} de ${MONTH_NAMES[today.month - 1]}`;
  const lines = items.flatMap((item) => [
    `• ${item.fullName} cumple ${item.age} años`,
    `  Fecha de nacimiento: ${formatBirthdayDate(item.birthDate)}`,
  ]);

  return {
    title: "Cumpleaños de clientes",
    body: ["🎂 Cumpleaños de hoy", `Fecha: ${dateLabel}`, "", ...lines].join("\n"),
  };
}

export async function getBirthdayRemindersForUser(input: {
  organizationId: string;
  userId: string;
  now?: Date;
  timeZone?: string;
  client: DbClient;
}): Promise<BirthdayReminderItem[]> {
  const now = input.now ?? new Date();
  const timeZone = input.timeZone ?? DEFAULT_TIMEZONE;
  const rows = await input.client.client.findMany({
    where: {
      organizationId: input.organizationId,
      portfolioOwnerId: input.userId,
      type: "PERSON",
      status: "ACTIVE",
      birthDate: { not: null },
      policies: { some: { status: "ACTIVE" } },
    },
    select: {
      id: true,
      fullName: true,
      birthDate: true,
    },
    orderBy: [{ birthDate: "asc" }, { fullName: "asc" }],
  });

  return rows
    .filter((row): row is typeof row & { birthDate: Date } => Boolean(row.birthDate && isBirthdayToday(row.birthDate, now, timeZone)))
    .map((row) => ({
      id: row.id,
      fullName: row.fullName,
      birthDate: row.birthDate,
      age: calculateAge(row.birthDate, now, timeZone),
    }));
}

export function birthdayAutomaticDedupeKey(userId: string, now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  return `BIRTHDAY_REMINDER:AUTO:${userId}:${getLocalDateKey(now, timeZone)}`;
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
