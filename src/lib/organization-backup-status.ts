import "server-only";

import { listBackups } from "@/lib/backup";
import { requireOrganizationRole } from "@/lib/organization-context";

export type OrganizationBackupStatus = {
  organizationId: string;
  status: "AVAILABLE" | "UNAVAILABLE" | "NOT_CONFIGURED";
  latestCreatedAt: string | null;
};

/**
 * Tenant-safe backup visibility. Owners can see that the platform backup
 * service is healthy, but never receive a global filename, download URL, or
 * backup contents. Physical snapshots remain a SUPERADMIN-only capability.
 */
export async function getOrganizationBackupStatus(): Promise<OrganizationBackupStatus> {
  const context = await requireOrganizationRole(["OWNER"]);
  try {
    const [latest] = await listBackups();
    return {
      organizationId: context.organizationId,
      status: latest ? "AVAILABLE" : "NOT_CONFIGURED",
      latestCreatedAt: latest?.createdAt.toISOString() ?? null,
    };
  } catch {
    return {
      organizationId: context.organizationId,
      status: "UNAVAILABLE",
      latestCreatedAt: null,
    };
  }
}
