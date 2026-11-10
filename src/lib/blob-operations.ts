import "server-only";

import { copy, list, put } from "@vercel/blob";
import { getDb } from "@/lib/db";

export const BLOB_OPERATION_DAILY_INTERACTIVE_BUDGET = 100;
export const BLOB_OPERATION_MONTHLY_INTERACTIVE_BUDGET = 1_200;
export const VERCEL_BLOB_MULTIPART_PART_SIZE_BYTES = 8 * 1024 * 1024;

export type BlobOperationCategory = "INTERACTIVE" | "CRITICAL" | "MAINTENANCE";
export type BlobOperationSource =
  | "nora.pdf.upload"
  | "nora.handoff.save"
  | "documents.upload"
  | "backups.dashboard.list"
  | "backups.rotation.list"
  | "backups.scheduled.create"
  | "backups.manual.create"
  | "backups.rekey"
  | "demo.organization.maintenance";
export type BlobAdvancedOperation = "put" | "list" | "copy" | "multipart_put";
type BlobPutBody = Parameters<typeof put>[1];

export class BlobOperationBudgetExceededError extends Error {
  readonly period: "DAY" | "MONTH";
  readonly used: number;
  readonly limit: number;

  constructor(input: { period: "DAY" | "MONTH"; used: number; limit: number }) {
    super("BLOB_OPERATION_BUDGET_EXCEEDED");
    this.name = "BlobOperationBudgetExceededError";
    this.period = input.period;
    this.used = input.used;
    this.limit = input.limit;
  }
}

function utcDayStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function utcMonthStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function utcRolling30DayStart(now: Date) {
  const start = utcDayStart(now);
  start.setUTCDate(start.getUTCDate() - 29);
  return start;
}

function logBudgetWarning(period: "DAY" | "MONTH", threshold: 70 | 90, used: number, limit: number) {
  console.warn("BLOB_OPERATION_BUDGET_WARNING", JSON.stringify({
    alert: `BLOB_OPERATION_BUDGET_${period}_${threshold}`,
    period,
    threshold,
    used,
    limit,
    timestamp: new Date().toISOString(),
  }));
}

function logTelemetryFailure(source: BlobOperationSource, operation: BlobAdvancedOperation, error: unknown) {
  console.error("BLOB_OPERATION_TELEMETRY_FAILED", JSON.stringify({
    source,
    operation,
    error: error instanceof Error ? error.name : "unknown",
    timestamp: new Date().toISOString(),
  }));
}

async function recordOrEnforce(input: Parameters<typeof recordBlobAdvancedOperation>[0]) {
  try {
    return await recordBlobAdvancedOperation(input);
  } catch (error) {
    if (input.category === "CRITICAL") {
      logTelemetryFailure(input.source, input.operation, error);
      return null;
    }
    throw error;
  }
}

/** Records provider-counted work and atomically enforces the interactive reserve. */
export async function recordBlobAdvancedOperation(input: {
  source: BlobOperationSource;
  operation: BlobAdvancedOperation;
  advancedOperations: number;
  category?: BlobOperationCategory;
  now?: Date;
}) {
  const category = input.category ?? "INTERACTIVE";
  const amount = Math.max(1, Math.ceil(input.advancedOperations));
  const now = input.now ?? new Date();
  const dayStart = utcDayStart(now);
  const monthStart = utcMonthStart(now);
  const rolling30DayStart = utcRolling30DayStart(now);
  const db = getDb();

  const thresholds: Array<{ period: "DAY" | "MONTH"; threshold: 70 | 90; used: number; limit: number }> = [];
  await db.$transaction(async (tx) => {
    // Serialize budget checks across serverless instances before reading either
    // period total, so concurrent requests cannot all pass the same last slot.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('policydesk:blob-operation-budget'))`;

    const [day, month] = await Promise.all([
      tx.blobOperationUsage.aggregate({
        where: { periodKind: "DAY", periodStart: dayStart, category: { in: ["INTERACTIVE", "MAINTENANCE"] } },
        _sum: { advancedOperations: true },
      }),
      tx.blobOperationUsage.aggregate({
        // Vercel's usage window may not align to UTC calendar months. Sum the
        // current and prior 29 UTC day buckets so a month-boundary reset cannot
        // permit two full reserves inside one rolling usage window.
        where: { periodKind: "DAY", periodStart: { gte: rolling30DayStart }, category: { in: ["INTERACTIVE", "MAINTENANCE"] } },
        _sum: { advancedOperations: true },
      }),
    ]);
    const dayUsed = day._sum.advancedOperations ?? 0;
    const rolling30DayUsed = month._sum.advancedOperations ?? 0;
    if (category !== "CRITICAL") {
      if (dayUsed + amount > BLOB_OPERATION_DAILY_INTERACTIVE_BUDGET) {
        const error = new BlobOperationBudgetExceededError({ period: "DAY", used: dayUsed, limit: BLOB_OPERATION_DAILY_INTERACTIVE_BUDGET });
        console.error("BLOB_OPERATION_BUDGET_BLOCKED", JSON.stringify({ source: input.source, operation: input.operation, period: error.period, used: error.used, limit: error.limit }));
        throw error;
      }
      if (rolling30DayUsed + amount > BLOB_OPERATION_MONTHLY_INTERACTIVE_BUDGET) {
        const error = new BlobOperationBudgetExceededError({ period: "MONTH", used: rolling30DayUsed, limit: BLOB_OPERATION_MONTHLY_INTERACTIVE_BUDGET });
        console.error("BLOB_OPERATION_BUDGET_BLOCKED", JSON.stringify({ source: input.source, operation: input.operation, period: error.period, used: error.used, limit: error.limit }));
        throw error;
      }
    }

    for (const [periodKind, periodStart] of [["DAY", dayStart], ["MONTH", monthStart]] as const) {
      await tx.blobOperationUsage.upsert({
        where: { periodKind_periodStart_category_source_operation: { periodKind, periodStart, category, source: input.source, operation: input.operation } },
        create: { periodKind, periodStart, category, source: input.source, operation: input.operation, advancedOperations: amount },
        update: { advancedOperations: { increment: amount } },
      });
    }

    if (category !== "CRITICAL") {
      const nextDay = dayUsed + amount;
      const nextRolling30Days = rolling30DayUsed + amount;
      for (const [period, used, limit] of [
        ["DAY", nextDay, BLOB_OPERATION_DAILY_INTERACTIVE_BUDGET],
        ["MONTH", nextRolling30Days, BLOB_OPERATION_MONTHLY_INTERACTIVE_BUDGET],
      ] as const) {
        for (const threshold of [70, 90] as const) {
          if (used - amount < limit * threshold / 100 && used >= limit * threshold / 100) {
            thresholds.push({ period, threshold, used, limit });
          }
        }
      }
    }
  });

  for (const warning of thresholds) logBudgetWarning(warning.period, warning.threshold, warning.used, warning.limit);
  return { dayStart, monthStart };
}

export async function trackedBlobList<T extends Parameters<typeof list>[0]>(
  source: BlobOperationSource,
  options: T,
  category: BlobOperationCategory = "INTERACTIVE",
) {
  await recordOrEnforce({ source, operation: "list", advancedOperations: 1, category });
  return list(options);
}

export async function trackedBlobPut<T extends Parameters<typeof put>[2]>(input: {
  source: BlobOperationSource;
  pathname: string;
  body: BlobPutBody;
  options: T;
  category?: BlobOperationCategory;
  advancedOperations?: number;
  recordAfterSuccess?: boolean;
  successCost?: () => number;
  beforePut?: () => Promise<void>;
}) {
  const category = input.category ?? "INTERACTIVE";
  if (!input.recordAfterSuccess) {
    await recordOrEnforce({
      source: input.source,
      operation: input.options.multipart ? "multipart_put" : "put",
      advancedOperations: input.advancedOperations ?? 1,
      category,
    });
  }
  try {
    await input.beforePut?.();
    const blob = await put(input.pathname, input.body, input.options);
    if (input.recordAfterSuccess) {
      await recordOrEnforce({
        source: input.source,
        operation: input.options.multipart ? "multipart_put" : "put",
        advancedOperations: input.successCost?.() ?? input.advancedOperations ?? 1,
        category,
      });
    }
    return blob;
  } catch (error) {
    if (input.recordAfterSuccess) {
      await recordOrEnforce({
        source: input.source,
        operation: input.options.multipart ? "multipart_put" : "put",
        advancedOperations: input.advancedOperations ?? 3,
        category,
      }).catch(() => undefined);
    }
    throw error;
  }
}

export async function trackedBlobCopy(source: BlobOperationSource, ...args: Parameters<typeof copy>) {
  await recordOrEnforce({ source, operation: "copy", advancedOperations: 1 });
  return copy(...args);
}

export function multipartAdvancedOperationCount(sizeBytes: number) {
  return Math.ceil(sizeBytes / VERCEL_BLOB_MULTIPART_PART_SIZE_BYTES) + 2;
}
