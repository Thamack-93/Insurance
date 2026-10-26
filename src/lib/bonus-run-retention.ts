import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { writeActivityLog } from "@/lib/activity-log";
import { listOrganizationIdsForBonusRunRetention, withSystemOrganizationTransaction } from "@/lib/organization-context";

// TODO(data-retention): Review this initial five-day retention period after
// the bonus testing cycle. This intentionally covers every BonusRun status.
export const BONUS_RUN_RETENTION_DAYS = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 250;
const MAX_RUNS_PER_JOB = 5_000;

type PurgeBatch = { purged: number; moreExpired: boolean };

async function saveRetentionStatus(organizationId: string, data: {
  status: "COMPLETED" | "PARTIAL" | "FAILED";
  startedAt: Date;
  completedAt: Date;
  purged: number;
  failedOrganizations: number;
  moreExpired: boolean;
  durationMs: number;
}) {
  return withSystemOrganizationTransaction(organizationId, "bonus run retention", async (tx) => {
    // Keep one operational status row per organization; this is not a history
    // or a financial record, and avoids unbounded growth from the daily cron.
    await tx.maintenanceRun.deleteMany({ where: { organizationId, type: "BONUS_RUN_RETENTION" } });
    return tx.maintenanceRun.create({
      data: {
        organizationId,
        type: "BONUS_RUN_RETENTION",
        status: data.status,
        startedAt: data.startedAt,
        completedAt: data.completedAt,
        summaryJson: JSON.stringify({
          purged: data.purged,
          failedOrganizations: data.failedOrganizations,
          moreExpired: data.moreExpired,
          durationMs: data.durationMs,
          retentionDays: BONUS_RUN_RETENTION_DAYS,
          failureCode: data.status === "FAILED" ? "BONUS_RETENTION_ORGANIZATION_FAILED" : null,
        }),
      },
    });
  }, { timeout: 60_000 });
}

async function purgeOrganizationBatch(organizationId: string, cutoff: Date, now: Date): Promise<PurgeBatch> {
  return withSystemOrganizationTransaction(organizationId, "bonus run retention", async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id"
        FROM "BonusRun"
       WHERE "organizationId" = ${organizationId}
         AND "updatedAt" <= ${cutoff}
       ORDER BY "updatedAt" ASC, "id" ASC
       LIMIT ${BATCH_SIZE}
       FOR UPDATE SKIP LOCKED
    `);
    const ids = locked.map(({ id }) => id);
    if (!ids.length) return { purged: 0, moreExpired: false };

    const runs = await tx.bonusRun.findMany({
      where: { organizationId, id: { in: ids }, updatedAt: { lte: cutoff } },
      select: {
        id: true,
        status: true,
        updatedAt: true,
      },
    });

    for (const run of runs) {
      await writeActivityLog({
        organizationId,
        entityType: "BonusRun",
        entityId: run.id,
        action: "BONUS_RUN_AUTO_PURGED",
        oldValue: { status: run.status, lastUpdatedAt: run.updatedAt.toISOString() },
        newValue: { deletedAt: now.toISOString(), retentionDays: BONUS_RUN_RETENTION_DAYS },
        db: tx,
      });
    }

    const deleted = await tx.bonusRun.deleteMany({
      where: { organizationId, id: { in: runs.map(({ id }) => id) }, updatedAt: { lte: cutoff } },
    });
    return { purged: deleted.count, moreExpired: ids.length === BATCH_SIZE };
  }, { timeout: 60_000 });
}

/** Deletes all tenant bonus runs after five days from their last update. */
export async function purgeExpiredBonusRuns(now = new Date()) {
  const startedAt = now;
  const timerStarted = Date.now();
  const cutoff = new Date(now.getTime() - BONUS_RUN_RETENTION_DAYS * DAY_MS);
  // Organization is the only global inventory read. Protected BonusRun reads
  // and writes are performed with one explicit tenant id in each transaction.
  const organizations = await listOrganizationIdsForBonusRunRetention();
  let purged = 0;
  let failedOrganizations = 0;
  let moreExpired = false;
  let organizationsProcessed = 0;
  const errors: Array<{ organizationId: string; code: string }> = [];

  for (const organization of organizations) {
    let continueBatches = true;
    let organizationFailed = false;
    let organizationPurged = 0;
    let organizationMoreExpired = false;
    try {
      while (continueBatches && purged < MAX_RUNS_PER_JOB) {
        const batch = await purgeOrganizationBatch(organization.id, cutoff, now);
        purged += batch.purged;
        organizationPurged += batch.purged;
        continueBatches = batch.moreExpired && batch.purged > 0;
      }
      if (purged >= MAX_RUNS_PER_JOB) {
        moreExpired = true;
        organizationMoreExpired = true;
      }
    } catch {
      failedOrganizations++;
      organizationFailed = true;
      errors.push({ organizationId: organization.id, code: "ORGANIZATION_PURGE_FAILED" });
    }
    try {
      organizationsProcessed++;
      await saveRetentionStatus(organization.id, {
        status: organizationFailed ? "FAILED" : organizationMoreExpired ? "PARTIAL" : "COMPLETED",
        startedAt,
        completedAt: new Date(),
        purged: organizationPurged,
        failedOrganizations: organizationFailed ? 1 : 0,
        moreExpired: organizationMoreExpired,
        durationMs: Date.now() - timerStarted,
      });
    } catch {
      failedOrganizations++;
      errors.push({ organizationId: organization.id, code: "STATUS_RECORD_FAILED" });
    }
    if (purged >= MAX_RUNS_PER_JOB) break;
  }

  return {
    purged,
    failedOrganizations,
    moreExpired,
    errors,
    retentionDays: BONUS_RUN_RETENTION_DAYS,
    organizationsProcessed,
    startedAt: startedAt.toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - timerStarted,
  };
}
