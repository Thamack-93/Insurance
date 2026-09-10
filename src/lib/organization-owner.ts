import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { AuthError } from "@/lib/auth";
import { assertOrganizationContextInTransaction, requireOrganizationRole, withTenantTransaction } from "@/lib/organization-context";
import { writeActivityLog } from "@/lib/activity-log";

/**
 * Audited atomic owner transfer. The previous owner is demoted before the new
 * owner is promoted, so the partial unique owner invariant is never violated.
 */
export async function transferOrganizationOwner(newOwnerUserId: string, reason: string) {
  const context = await requireOrganizationRole(["OWNER", "ADMIN"]);
  if (!newOwnerUserId.trim() || !reason.trim()) throw new AuthError("OWNER_TRANSFER_INPUT_INVALID", 400);
  return withTenantTransaction(context, async (tx) => {
    await assertOrganizationContextInTransaction(tx, context, ["OWNER", "ADMIN"]);
    // The final database owner invariant rejects an intermediate zero-owner
    // state. The transfer flag is transaction-local and is cleared before the
    // workflow returns; the postcondition below is still checked in SQL.
    await tx.$executeRaw(Prisma.sql`SELECT set_config('app.owner_transfer', '1', true)`);
    const target = await tx.organizationMembership.findFirst({ where: { organizationId: context.organizationId, userId: newOwnerUserId, active: true }, select: { id: true, userId: true, role: true } });
    if (!target) throw new AuthError("OWNER_TRANSFER_TARGET_NOT_IN_ORGANIZATION", 400);
    const current = await tx.organizationMembership.findFirst({ where: { organizationId: context.organizationId, role: "OWNER", active: true }, select: { id: true, userId: true } });
    if (!current) throw new AuthError("ORGANIZATION_OWNER_MISSING", 409);
    if (current.userId === target.userId) return { organizationId: context.organizationId, ownerUserId: target.userId };
    await tx.organizationMembership.update({ where: { id: current.id }, data: { role: "ADMIN" } });
    await tx.user.update({ where: { id: current.userId }, data: { role: "ADMIN", sessionVersion: { increment: 1 } } });
    await tx.organizationMembership.update({ where: { id: target.id }, data: { role: "OWNER" } });
    await tx.user.update({ where: { id: target.userId }, data: { role: "ADMIN", sessionVersion: { increment: 1 } } });
    await tx.$executeRaw(Prisma.sql`SELECT set_config('app.owner_transfer', '0', true)`);
    const ownerCount = await tx.organizationMembership.count({
      where: { organizationId: context.organizationId, role: "OWNER", active: true, user: { active: true } },
    });
    if (ownerCount !== 1) throw new AuthError("ORGANIZATION_OWNER_INVARIANT_FAILED", 409);
    await writeActivityLog({ organizationId: context.organizationId, userId: context.userId, entityType: "OrganizationMembership", entityId: target.id, action: "TRANSFER_ORGANIZATION_OWNER", oldValue: { ownerUserId: current.userId }, newValue: { ownerUserId: target.userId, reason }, db: tx });
    return { organizationId: context.organizationId, ownerUserId: target.userId };
  });
}
