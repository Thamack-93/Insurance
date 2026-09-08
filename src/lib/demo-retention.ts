import "server-only";

import { del } from "@vercel/blob";
import { getDb } from "@/lib/db";
import { withSystemOrganizationTransaction } from "@/lib/organization-context";
import { resetDemoOrganizationForSystem } from "@/lib/demo-organizations";

export const DEMO_PURGE_PREVENTIVE_HOURS = 47;
export const DEMO_PURGE_DEADLINE_HOURS = 48;
export const DEMO_PURGE_ALERT_MINUTES = 30;

const PURGE_PREVENTIVE_MS = DEMO_PURGE_PREVENTIVE_HOURS * 60 * 60 * 1000;
const PURGE_DEADLINE_MS = DEMO_PURGE_DEADLINE_HOURS * 60 * 60 * 1000;

function sanitizedFailureCode(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  const match = message.match(/\b[A-Z][A-Z0-9_]{2,}\b/);
  return match?.[0]?.slice(0, 80) ?? fallback;
}

/** Purges DEMO originals and derived Blob metadata with safe, idempotent retries. */
export async function purgeDemoUploadArtifacts(now = new Date(), organizationId?: string) {
  const db = getDb();
  // Enumerate organizations globally, then read and mutate protected upload
  // rows inside one explicit system-tenant transaction per organization. This
  // keeps forced RLS and the job boundary intact even for suspended DEMOs.
  const demoOrganizations = await db.organization.findMany({ where: { kind: "DEMO", ...(organizationId ? { id: organizationId } : {}) }, select: { id: true } });
  let filesPurged = 0;
  for (const organization of demoOrganizations) {
    let expired: Array<{ id: string; organizationId: string; blobPath: string; uploadedAt: Date; expiresAt: Date }> = [];
    try {
      expired = await withSystemOrganizationTransaction(organization.id, "demo file retention", (tx) => tx.demoUploadArtifact.findMany({
        where: {
          organizationId: organization.id,
          status: "ACTIVE",
          OR: [{ purgeAfterAt: { lte: now } }, { expiresAt: { lte: now } }],
        },
        select: { id: true, organizationId: true, blobPath: true, uploadedAt: true, expiresAt: true },
        orderBy: { purgeAfterAt: "asc" },
        take: 500,
      }));
    } catch {
      // A tenant may be transitioning state; the next retention tick retries
      // it without exposing a global protected-table query.
      continue;
    }
    for (const artifact of expired) {
    try {
      await withSystemOrganizationTransaction(artifact.organizationId, "demo file retention", async (tx) => {
        await tx.demoUploadArtifact.updateMany({ where: { id: artifact.id, status: "ACTIVE" }, data: { purgeAttempts: { increment: 1 }, lastPurgeAt: now } });
      });
      if (artifact.blobPath.startsWith("blob:")) await del(artifact.blobPath.slice("blob:".length));
      await withSystemOrganizationTransaction(artifact.organizationId, "demo file retention", async (tx) => {
        await tx.demoUploadArtifact.updateMany({ where: { id: artifact.id, status: "ACTIVE" }, data: { status: "PURGED", validationStatus: "PURGED", deletedAt: now, lastPurgeAt: now, blobDeleteConfirmedAt: now, purgeBreachAt: null, lastPurgeFailureCode: null } });
      });
      filesPurged++;
    } catch (error) {
      // Keep ACTIVE for a safe retry, but persist only a sanitized failure
      // code. Purge continues even for suspended or failed DEMO tenants.
      const failureCode = error instanceof Error && /BLOB|fetch|storage|timeout/i.test(error.message) ? "BLOB_DELETE_FAILED" : "PURGE_FAILED";
      await withSystemOrganizationTransaction(artifact.organizationId, "demo file retention", async (tx) => {
        const breach = now.getTime() >= artifact.expiresAt.getTime();
        await tx.demoUploadArtifact.updateMany({ where: { id: artifact.id, status: "ACTIVE" }, data: { lastPurgeFailureCode: failureCode, lastPurgeAt: now, purgeBreachAt: breach ? now : undefined } });
        if (now.getTime() >= artifact.uploadedAt.getTime() + (DEMO_PURGE_DEADLINE_HOURS * 60 - DEMO_PURGE_ALERT_MINUTES) * 60_000) {
          await tx.platformAuditLog.create({ data: { targetOrganizationId: artifact.organizationId, action: "DEMO_UPLOAD_PURGE_WARNING", reason: breach ? "original exceeded contractual retention deadline" : "preventive purge retry pending", metadataJson: JSON.stringify({ artifactId: artifact.id, failureCode }) } });
        }
      }).catch(() => undefined);
    }
    }
  }
  return filesPurged;
}

export async function runDemoRetention(now = new Date()) {
  const db = getDb();
  const filesPurged = await purgeDemoUploadArtifacts(now);
  const demoOrganizations = await db.organization.findMany({ where: { kind: "DEMO" }, select: { id: true, status: true, demoState: { select: { trialEndsAt: true, realDataResetAt: true, resetStatus: true, resetLeaseExpiresAt: true } } } });
  let resets = 0;
  let suspended = 0;
  let failures = 0;
  for (const organization of demoOrganizations) {
    const state = organization.demoState;
    if (!state) continue;
    const trialExpired = state.trialEndsAt <= now;
    // Suspension is applied before a coincident reset. The reset still runs
    // to purge real data, but its final ACTIVE transition is fenced below.
    if (trialExpired && organization.status === "ACTIVE") {
      await withSystemOrganizationTransaction(organization.id, "demo trial suspend", async (tx) => {
        await tx.organization.updateMany({ where: { id: organization.id, kind: "DEMO", status: "ACTIVE" }, data: { status: "SUSPENDED" } });
        const members = await tx.organizationMembership.findMany({ where: { organizationId: organization.id }, select: { userId: true } });
        const userIds = members.map(({ userId }) => userId);
        if (userIds.length > 0) {
          await tx.user.updateMany({ where: { id: { in: userIds } }, data: { sessionVersion: { increment: 1 } } });
          await tx.session.updateMany({ where: { userId: { in: userIds }, revokedAt: null }, data: { revokedAt: now } });
        }
        await tx.platformAuditLog.create({ data: { targetOrganizationId: organization.id, action: "DEMO_TRIAL_SUSPENDED", reason: "30-day trial expired" } });
      });
      suspended++;
    }
    const resetDeadline = state.realDataResetAt;
    const resetDue = resetDeadline && resetDeadline <= now;
    const staleReset = state.resetStatus === "RESETTING" && state.resetLeaseExpiresAt && state.resetLeaseExpiresAt <= now;
    if (resetDue && (state.resetStatus === "IDLE" || state.resetStatus === "FAILED" || staleReset)) {
      try {
        await resetDemoOrganizationForSystem(organization.id, `demo-retention-reset:${organization.id}:${resetDeadline?.toISOString() ?? now.toISOString()}`);
        resets++;
        if (trialExpired) {
          await withSystemOrganizationTransaction(organization.id, "demo trial suspend", async (tx) => {
            await tx.organization.updateMany({ where: { id: organization.id, kind: "DEMO" }, data: { status: "SUSPENDED" } });
          });
        }
      } catch (error) {
        failures++;
        await withSystemOrganizationTransaction(organization.id, "demo reset", async (tx) => {
          await tx.organization.update({ where: { id: organization.id }, data: { status: "SUSPENDED" } });
          await tx.demoOrganizationState.update({ where: { organizationId: organization.id }, data: { resetStatus: "FAILED", resetFailure: sanitizedFailureCode(error, "RESET_FAILED") } });
        }).catch(() => undefined);
      }
    }
  }
  return { filesPurged, resets, suspended, failures };
}

export function demoUploadRetentionDeadline(uploadedAt: Date) {
  return {
    purgeAfterAt: new Date(uploadedAt.getTime() + PURGE_PREVENTIVE_MS),
    expiresAt: new Date(uploadedAt.getTime() + PURGE_DEADLINE_MS),
  };
}
