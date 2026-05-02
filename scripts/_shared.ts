import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import * as XLSX from "xlsx";

import { PrismaClient } from "../src/generated/prisma/client.ts";
import { backupsDir, dataDir, databasePath, exportsDir } from "../src/lib/files.ts";

export { backupsDir, dataDir, databasePath, exportsDir };

export type CliArgs = {
  positionals: string[];
  flags: Record<string, string | boolean>;
};

export type QuerySummary = {
  count: number;
  total: number;
};

const defaultDatabaseUrl = `file:${databasePath}`;

export function createDb() {
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? defaultDatabaseUrl,
  });

  return new PrismaClient({ adapter });
}

export async function closeDb(db: PrismaClient) {
  await db.$disconnect();
}

export async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export async function ensureDataDirs() {
  await Promise.all([ensureDir(dataDir), ensureDir(backupsDir), ensureDir(exportsDir)]);
}

export function timestampForFile(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join("-");
}

export async function backupDatabase() {
  await ensureDir(backupsDir);

  try {
    await fs.access(databasePath);
  } catch {
    return null;
  }

  const target = path.join(backupsDir, `policydesk-${timestampForFile()}.sqlite`);
  await fs.copyFile(databasePath, target);
  return target;
}

export function parseCliArgs(argv = process.argv.slice(2)): CliArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (!token.startsWith("-")) {
      positionals.push(token);
      continue;
    }

    if (token.includes("=")) {
      const [rawKey, ...rest] = token.replace(/^--?/, "").split("=");
      flags[rawKey] = rest.join("=");
      continue;
    }

    const key = token.replace(/^--?/, "");
    const next = argv[index + 1];

    if (next && !next.startsWith("-")) {
      flags[key] = next;
      index += 1;
      continue;
    }

    flags[key] = true;
  }

  return { positionals, flags };
}

export function getFlag(args: CliArgs, name: string, fallback?: string) {
  const value = args.flags[name];
  if (typeof value === "string") return value;
  return fallback;
}

export function hasFlag(args: CliArgs, name: string) {
  return args.flags[name] === true || args.flags[name] === "true";
}

export function normalizeKey(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

export function compactText(value: unknown, maxLength = 120) {
  if (value === null || value === undefined) return "";
  const text = String(value).replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

export function safeJson(value: unknown, maxLength = 5000) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? String(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function toNumber(value: unknown) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  if (value && typeof value === "object" && "toNumber" in value) {
    return (value as { toNumber: () => number }).toNumber();
  }
  return 0;
}

export function formatMoney(amount: unknown, currency = "MXN") {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(toNumber(amount));
}

export function formatDateShort(date: Date | string | null | undefined) {
  if (!date) return "-";
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(date));
}

export function formatDateTime(date: Date | string | null | undefined) {
  if (!date) return "-";
  return new Intl.DateTimeFormat("es-MX", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

export function daysFromNow(date: Date | string) {
  const base = startOfDay(new Date());
  const target = startOfDay(new Date(date));
  return Math.round((target.getTime() - base.getTime()) / (24 * 60 * 60 * 1000));
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export async function writeCsv(filePath: string, rows: Record<string, unknown>[]) {
  await ensureDir(path.dirname(filePath));
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const csv = XLSX.utils.sheet_to_csv(worksheet);
  await fs.writeFile(filePath, csv, "utf8");
}

export async function writeXlsx(
  filePath: string,
  rows: Record<string, unknown>[],
  sheetName = "Datos",
) {
  await ensureDir(path.dirname(filePath));
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "buffer" });
  await fs.writeFile(filePath, buffer);
}

export async function readTabularInput(filePath: string) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".json") {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return parsed as Record<string, unknown>[];
    }
    if (parsed && typeof parsed === "object") {
      const container = parsed as { data?: unknown; rows?: unknown; items?: unknown };
      const candidate = container.data ?? container.rows ?? container.items;
      if (Array.isArray(candidate)) {
        return candidate as Record<string, unknown>[];
      }
    }

    throw new Error("El JSON debe ser un arreglo de registros o un objeto con data/rows/items.");
  }

  const workbook = XLSX.readFile(filePath, { cellDates: true });
  const firstSheet = workbook.SheetNames[0];

  if (!firstSheet) {
    return [];
  }

  const worksheet = workbook.Sheets[firstSheet];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: null });
  return rows;
}

export function pickValue(
  row: Record<string, unknown>,
  aliases: string[],
): string | number | Date | null | undefined {
  const normalized = new Map<string, unknown>();

  for (const [key, value] of Object.entries(row)) {
    normalized.set(normalizeKey(key), value);
  }

  for (const alias of aliases) {
    const value = normalized.get(normalizeKey(alias));
    if (value !== null && value !== undefined && value !== "") {
      return value as string | number | Date | null | undefined;
    }
  }

  return undefined;
}

export function toStringValue(value: unknown) {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  return text;
}

export function toNumberValue(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "number") return value;
  const numeric = Number(String(value).replace(/[$,\s]/g, ""));
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function toDateValue(value: unknown) {
  if (value === null || value === undefined || value === "") return undefined;
  if (value instanceof Date) return value;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function toBooleanValue(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "si", "sí", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n"].includes(normalized)) return false;
  }
  return undefined;
}

export function toEnumValue<T extends string>(value: unknown, allowed: readonly T[]) {
  if (value === null || value === undefined || value === "") return undefined;
  const text = String(value).trim().toUpperCase();
  return (allowed.includes(text as T) ? (text as T) : undefined);
}

export function summarizeTotals(items: Array<{ amount?: unknown }>) {
  return items.reduce((sum, item) => sum + toNumber(item.amount), 0);
}

export function summarizeByCurrency<T>(
  items: T[],
  getCurrency: (item: T) => string | undefined,
  getAmount: (item: T) => unknown = (item) =>
    (item as { amount?: unknown }).amount,
) {
  const totals = new Map<string, number>();

  for (const item of items) {
    const currency = getCurrency(item) ?? "MXN";
    totals.set(currency, (totals.get(currency) ?? 0) + toNumber(getAmount(item)));
  }

  return totals;
}

export function formatCurrencyBreakdown(
  totals: Map<string, number>,
  fallbackLabel = "Sin montos",
) {
  if (!totals.size) return fallbackLabel;

  return [...totals.entries()]
    .map(([currency, amount]) => `${currency}: ${formatMoney(amount, currency)}`)
    .join(" | ");
}

export function printTable(title: string, rows: Record<string, unknown>[]) {
  console.log("");
  console.log(title);
  if (!rows.length) {
    console.log("  Sin registros.");
    return;
  }

  console.table(rows);
}

export function sortByDateAsc<T extends { date?: Date | null }>(items: T[]) {
  return [...items].sort((left, right) => {
    const leftDate = left.date?.getTime() ?? Number.POSITIVE_INFINITY;
    const rightDate = right.date?.getTime() ?? Number.POSITIVE_INFINITY;
    return leftDate - rightDate;
  });
}
