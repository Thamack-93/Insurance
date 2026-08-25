import "server-only";

import { getLatestVerifiedBackupArtifact } from "@/lib/backup-catalog";
import { getBackupScheduleStatus, TENANT_BACKUP_INTERVAL_DAYS } from "@/lib/backup-schedule";
import { requireOrganizationRole } from "@/lib/organization-context";

export type OrganizationBackupStatus = {
  organizationId: string;
  status: "HEALTHY" | "OVERDUE" | "UNAVAILABLE" | "NOT_CONFIGURED";
  latestCreatedAt: string | null;
  nextDueAt: string | null;
};

/**
 * Tenant-safe backup visibility. Owners can see that the platform backup
 * service is healthy, but never receive a global filename, download URL, or
 * backup contents. Physical snapshots remain a SUPERADMIN-only capability.
 */
export async function getOrganizationBackupStatus(): Promise<OrganizationBackupStatus> {
  const context = await requireOrganizationRole(["OWNER"]);
  try {
    const latest = await getLatestVerifiedBackupArtifact({ scope: "ORGANIZATION", organizationId: context.organizationId });
    const schedule = getBackupScheduleStatus(latest ? new Date(latest.createdAt) : null, new Date(), TENANT_BACKUP_INTERVAL_DAYS);
    return {
      organizationId: context.organizationId,
      status: !latest ? "NOT_CONFIGURED" : schedule.due ? "OVERDUE" : "HEALTHY",
      latestCreatedAt: latest?.createdAt ?? null,
      nextDueAt: schedule.nextDueAt.toISOString(),
    };
  } catch {
    return {
      organizationId: context.organizationId,
      status: "UNAVAILABLE",
      latestCreatedAt: null,
      nextDueAt: null,
    };
  }
}
