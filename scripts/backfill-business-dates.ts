import { createDb, closeDb, parseCliArgs } from "./_shared.ts";
import { businessStartOfDay } from "../src/lib/business-dates.ts";

type ChangeRecord = {
  table: string;
  id: string;
  field: string;
  from: string;
  to: string;
};

type TableSummary = {
  table: string;
  scanned: number;
  updated: number;
};

function normalizeDate(value: Date | null | undefined) {
  if (!value) return null;
  const normalized = businessStartOfDay(value);
  return normalized.getTime() === value.getTime() ? null : normalized;
}

async function normalizeRows<T extends { id: string } & Record<string, unknown>>(
  table: string,
  rows: T[],
  fields: Array<keyof T>,
  applyUpdate: (row: T, updates: Partial<T>) => Promise<void>,
) {
  const changes: ChangeRecord[] = [];
  let updated = 0;

  for (const row of rows) {
    const updates: Partial<T> = {};

    for (const field of fields) {
      const value = row[field];
      if (!(value instanceof Date) || Number.isNaN(value.getTime())) continue;

      const normalized = normalizeDate(value);
      if (!normalized) continue;

      updates[field] = normalized as T[keyof T];
      changes.push({
        table,
        id: String(row.id),
        field: String(field),
        from: value.toISOString(),
        to: normalized.toISOString(),
      });
    }

    if (Object.keys(updates).length > 0) {
      updated += 1;
      await applyUpdate(row, updates);
    }
  }

  return { updated, changes };
}

async function main() {
  const args = parseCliArgs();
  const apply = args.flags.apply === true || args.flags.apply === "true";
  const db = createDb();

  const summaries: TableSummary[] = [];
  const changes: ChangeRecord[] = [];

  try {
    const receipts = await db.receipt.findMany({
      select: { id: true, periodStartDate: true, periodEndDate: true, dueDate: true, paidDate: true },
    });
    const receiptResult = await normalizeRows(
      "Receipt",
      receipts,
      ["periodStartDate", "periodEndDate", "dueDate", "paidDate"],
      async (row, updates) => {
        if (apply) {
          await db.receipt.update({ where: { id: row.id }, data: updates });
        }
      },
    );
    summaries.push({ table: "Receipt", scanned: receipts.length, updated: receiptResult.updated });
    changes.push(...receiptResult.changes);

    const policies = await db.policy.findMany({
      select: { id: true, startDate: true, endDate: true },
    });
    const policyResult = await normalizeRows(
      "Policy",
      policies,
      ["startDate", "endDate"],
      async (row, updates) => {
        if (apply) {
          await db.policy.update({ where: { id: row.id }, data: updates });
        }
      },
    );
    summaries.push({ table: "Policy", scanned: policies.length, updated: policyResult.updated });
    changes.push(...policyResult.changes);

    const endorsements = await db.policyEndorsement.findMany({
      select: { id: true, startDate: true, endDate: true },
    });
    const endorsementResult = await normalizeRows(
      "PolicyEndorsement",
      endorsements,
      ["startDate", "endDate"],
      async (row, updates) => {
        if (apply) {
          await db.policyEndorsement.update({ where: { id: row.id }, data: updates });
        }
      },
    );
    summaries.push({ table: "PolicyEndorsement", scanned: endorsements.length, updated: endorsementResult.updated });
    changes.push(...endorsementResult.changes);

    const payments = await db.payment.findMany({
      select: { id: true, paidDate: true },
    });
    const paymentResult = await normalizeRows("Payment", payments, ["paidDate"], async (row, updates) => {
      if (apply) {
        await db.payment.update({ where: { id: row.id }, data: updates });
      }
    });
    summaries.push({ table: "Payment", scanned: payments.length, updated: paymentResult.updated });
    changes.push(...paymentResult.changes);

    const commissions = await db.commission.findMany({
      select: { id: true, expectedDate: true, paidDate: true },
    });
    const commissionResult = await normalizeRows(
      "Commission",
      commissions,
      ["expectedDate", "paidDate"],
      async (row, updates) => {
        if (apply) {
          await db.commission.update({ where: { id: row.id }, data: updates });
        }
      },
    );
    summaries.push({ table: "Commission", scanned: commissions.length, updated: commissionResult.updated });
    changes.push(...commissionResult.changes);

    const tasks = await db.task.findMany({
      select: { id: true, startDate: true, dueDate: true, closedDate: true },
    });
    const taskResult = await normalizeRows("Task", tasks, ["startDate", "dueDate", "closedDate"], async (row, updates) => {
      if (apply) {
        await db.task.update({ where: { id: row.id }, data: updates });
      }
    });
    summaries.push({ table: "Task", scanned: tasks.length, updated: taskResult.updated });
    changes.push(...taskResult.changes);

    const workItems = await db.workItem.findMany({
      select: { id: true, startDate: true, dueDate: true, closedDate: true, readAt: true },
    });
    const workItemResult = await normalizeRows(
      "WorkItem",
      workItems,
      ["startDate", "dueDate", "closedDate", "readAt"],
      async (row, updates) => {
        if (apply) {
          await db.workItem.update({ where: { id: row.id }, data: updates });
        }
      },
    );
    summaries.push({ table: "WorkItem", scanned: workItems.length, updated: workItemResult.updated });
    changes.push(...workItemResult.changes);

    const quotes = await db.quote.findMany({
      select: { id: true, requestedDate: true, sentDate: true, validUntil: true },
    });
    const quoteResult = await normalizeRows(
      "Quote",
      quotes,
      ["requestedDate", "sentDate", "validUntil"],
      async (row, updates) => {
        if (apply) {
          await db.quote.update({ where: { id: row.id }, data: updates });
        }
      },
    );
    summaries.push({ table: "Quote", scanned: quotes.length, updated: quoteResult.updated });
    changes.push(...quoteResult.changes);

    console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", summaries }, null, 2));
    if (!apply && changes.length > 0) {
      console.log(JSON.stringify({ sampleChanges: changes.slice(0, 50) }, null, 2));
    }
  } finally {
    await closeDb(db);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
