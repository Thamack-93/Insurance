import "server-only";

import { cache } from "react";
import { getDb } from "@/lib/db";
import { AuthError, clearSessionCookie, getSession, requireUser, setSessionCookie } from "@/lib/auth";
import { writeActivityLog } from "@/lib/activity-log";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";

// Prisma's interactive transaction proxy does not expose a stable runtime
// type that helpers can use to distinguish it from the root client. Keep a
// process-local registry so activity/audit helpers can reuse the current
// transaction instead of opening a nested transaction on the same tenant.
type TenantTransactionRegistry = WeakSet<object>;
const transactionRegistryGlobal = globalThis as typeof globalThis & {
  __policydeskTenantTransactions?: TenantTransactionRegistry;
};
const tenantTransactionRegistry =
  transactionRegistryGlobal.__policydeskTenantTransactions ??= new WeakSet<object>();

export function isTenantTransactionClient(value: unknown): value is Prisma.TransactionClient {
  return typeof value === "object" && value !== null && tenantTransactionRegistry.has(value);
}

export function isApplicationPrismaClient(value: unknown): value is PrismaClient {
  return value === getDb();
}

export const ORGANIZATION_ROLES = ["OWNER", "ADMIN", "AGENT"] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export type OrganizationContext = {
  userId: string;
  userEmail: string;
  userName: string;
  userRole: string;
  platformRole: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  organizationStatus: string;
  membershipId: string;
  membershipRole: OrganizationRole;
};

export type OrganizationOption = {
  id: string;
  name: string;
  slug: string;
  role: OrganizationRole;
};

export type OrganizationContextResolution =
  | { status: "unauthenticated" }
  | { status: "ready"; context: OrganizationContext }
  | { status: "no-membership"; options: [] }
  | { status: "corrupt-memberships"; options: OrganizationOption[] }
  | { status: "stale-selection"; options: OrganizationOption[] };

function isOrganizationRole(value: string): value is OrganizationRole {
  return (ORGANIZATION_ROLES as readonly string[]).includes(value);
}

async function membershipState(userId: string) {
  const db = getDb();
  const memberships = await db.organizationMembership.findMany({
    where: { userId },
    select: {
      id: true,
      role: true,
      active: true,
      organization: { select: { id: true, name: true, slug: true, status: true } },
    },
    orderBy: { id: "asc" },
    take: 2,
  });

  const options = memberships
    .filter((membership): membership is typeof membership & { role: OrganizationRole } =>
      membership.active && membership.organization.status === "ACTIVE" && isOrganizationRole(membership.role),
    )
    .map((membership) => ({
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
      role: membership.role,
    }));

  return { memberships, options };
}

export async function getOrganizationOptions(): Promise<OrganizationOption[]> {
  const user = await requireUser();
  const state = await membershipState(user.id);
  if (state.memberships.length > 1) return [];
  return state.options;
}

export const resolveOrganizationContext = cache(async function resolveOrganizationContext(): Promise<OrganizationContextResolution> {
  const session = await getSession();
  if (!session) return { status: "unauthenticated" };

  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof AuthError && error.status === 401) return { status: "unauthenticated" };
    throw error;
  }

  const { memberships, options } = await membershipState(user.id);
  if (memberships.length > 1) return { status: "corrupt-memberships", options };
  if (options.length === 0) return { status: "no-membership", options: [] };

  if (!session.organizationId) {
    return buildContext(user, options[0].id);
  }

  const selected = options.find((option) => option.id === session.organizationId);
  if (!selected) return { status: "stale-selection", options };
  return buildContext(user, selected.id);
});

async function buildContext(user: Awaited<ReturnType<typeof requireUser>>, organizationId: string): Promise<OrganizationContextResolution> {
  const db = getDb();
  const membership = await db.organizationMembership.findFirst({
    where: {
      organizationId,
      userId: user.id,
      active: true,
      organization: { status: "ACTIVE" },
    },
    select: {
      id: true,
      role: true,
      organization: {
        select: { id: true, name: true, slug: true, status: true },
      },
    },
  });

  if (!membership || !isOrganizationRole(membership.role)) {
    const { memberships, options } = await membershipState(user.id);
    if (memberships.length > 1) return { status: "corrupt-memberships", options };
    return { status: "stale-selection", options };
  }

  return {
    status: "ready",
    context: {
      userId: user.id,
      userEmail: user.email,
      userName: user.name,
      userRole: user.role,
      platformRole: user.platformRole,
      organizationId: membership.organization.id,
      organizationName: membership.organization.name,
      organizationSlug: membership.organization.slug,
      organizationStatus: membership.organization.status,
      membershipId: membership.id,
      membershipRole: membership.role,
    },
  };
}

export async function requireOrganizationContext(): Promise<OrganizationContext> {
  const resolution = await resolveOrganizationContext();
  if (resolution.status === "ready") return resolution.context;
  if (resolution.status === "unauthenticated") throw new AuthError("Necesitas iniciar sesión.", 401);
  if (resolution.status === "stale-selection") {
    throw new AuthError("ORGANIZATION_CONTEXT_STALE", 409);
  }
  if (resolution.status === "corrupt-memberships") {
    throw new AuthError("POLICYDESK_MULTIPLE_ORGANIZATION_MEMBERSHIPS", 409);
  }
  throw new AuthError("No tienes una organización activa.", 403);
}

export async function requireOrganizationRole(allowedRoles: readonly OrganizationRole[]): Promise<OrganizationContext> {
  const context = await requireOrganizationContext();
  if (!allowedRoles.includes(context.membershipRole)) {
    throw new AuthError("No tienes permisos en esta organización.", 403);
  }
  return context;
}

export async function requireOrganizationRoleOrRedirect(allowedRoles: readonly OrganizationRole[]): Promise<OrganizationContext> {
  const { redirect } = await import("next/navigation");
  try {
    return await requireOrganizationRole(allowedRoles);
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.status === 401) {
        try { await clearSessionCookie(); } catch { /* best effort */ }
        redirect("/login");
      }
      if (error.status === 409) redirect("/organization/select");
      redirect("/today");
    }
    throw error;
  }
}

/**
 * Revalidates the live tenant boundary on the same transaction that performs a
 * mutation, closing the race between an authorization read and a concurrent
 * user, membership, or organization suspension.
 */
export async function assertOrganizationContextInTransaction(
  tx: Prisma.TransactionClient,
  context: OrganizationContext,
  allowedRoles: readonly OrganizationRole[] = ORGANIZATION_ROLES,
): Promise<void> {
  return validateOrganizationContextInTransaction(tx, context, allowedRoles, true);
}

async function validateOrganizationContextInTransaction(
  tx: Prisma.TransactionClient,
  context: OrganizationContext,
  allowedRoles: readonly OrganizationRole[],
  lock: boolean,
): Promise<void> {
  // Set the tenant GUC inside the same transaction as the authorization
  // revalidation. This makes legacy `db.$transaction` callers safe during the
  // RLS cutover as long as they invoke this guard before touching protected
  // models; the preferred API remains withTenantTransaction.
  await tx.$executeRaw(Prisma.sql`SELECT set_config('app.organization_id', ${context.organizationId}, true)`);
  try {
    const runtimeState = await tx.platformRuntimeState.findUnique({ where: { id: 1 }, select: { writeMode: true } });
    if (runtimeState && runtimeState.writeMode !== "OPEN") throw new AuthError("POLICYDESK_MAINTENANCE_MODE", 503);
  } catch (error) {
    // The additive migration is allowed to be absent only in legacy local
    // environments. Production must fail closed when its write-mode control
    // cannot be read.
    if (process.env.NODE_ENV === "production" || !(error instanceof Error && /does not exist|P2021|relation/i.test(error.message))) throw error;
  }
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT m."id"
      FROM "OrganizationMembership" m
      JOIN "User" u ON u."id" = m."userId"
      JOIN "Organization" o ON o."id" = m."organizationId"
     WHERE m."id" = ${context.membershipId}
       AND m."userId" = ${context.userId}
       AND m."organizationId" = ${context.organizationId}
       AND m."role" IN (${Prisma.join([...allowedRoles])})
       AND m."active"
       AND u."active"
       AND o."status" = 'ACTIVE'
     ${lock ? Prisma.sql`FOR UPDATE OF m, u, o` : Prisma.empty}
  `);
  if (!rows[0]) throw new AuthError("ORGANIZATION_ACCESS_DENIED", 403);
}

/**
 * Runs tenant work on one transaction-bound connection and establishes the
 * PostgreSQL RLS context before any application query executes. Direct
 * organization predicates remain required; this is the database second lock.
 */
export async function withOrganizationTransaction<T>(
  context: OrganizationContext,
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const db = getDb();
  return db.$transaction(async (tx) => {
    tenantTransactionRegistry.add(tx);
    await tx.$executeRaw(Prisma.sql`SELECT set_config('app.organization_id', ${context.organizationId}, true)`);
    // Read transactions still revalidate the live tenant boundary, but
    // do not serialize every concurrent page query behind the same membership
    // row. Mutations call assertOrganizationContextInTransaction explicitly
    // and retain the strong row locks required for the write boundary.
    await validateOrganizationContextInTransaction(tx, context, ORGANIZATION_ROLES, false);
    return callback(tx);
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    maxWait: 10_000,
    timeout: 15_000,
  });
}

/** Public naming from the multi-tenant DAL contract. */
export type TenantDb = Prisma.TransactionClient;
export const withTenantTransaction = withOrganizationTransaction;

/**
 * Tenant transaction for platform jobs. Callers must enumerate organizations
 * explicitly and pass one concrete id; there is deliberately no global
 * fallback. The organization row is locked before any tenant query runs.
 */
export async function withSystemOrganizationTransaction<T>(
  organizationId: string,
  reason: string,
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
  transactionOptions: { maxWait?: number; timeout?: number } = {},
): Promise<T> {
  if (!organizationId.trim()) throw new AuthError("ORGANIZATION_CONTEXT_REQUIRED", 400);
  if (!reason.trim()) throw new AuthError("SYSTEM_TENANT_REASON_REQUIRED", 400);
  const db = getDb();
  return db.$transaction(async (tx) => {
    // System tenant workflows can write activity inside the same transaction.
    // Register this client so writeActivityLog does not open a second
    // membership-backed transaction from a webhook or background job.
    tenantTransactionRegistry.add(tx);
    const rows = await tx.$queryRaw<Array<{ id: string; status: string; kind: string }>>(Prisma.sql`
      SELECT "id", "status", "kind"
        FROM "Organization"
       WHERE "id" = ${organizationId}
       FOR UPDATE
    `);
    const organization = rows[0];
    if (!organization) throw new AuthError("ORGANIZATION_NOT_FOUND", 404);
    const activeOrProvisioning = ["ACTIVE", "PROVISIONING"].includes(organization.status);
    // A sales-assisted DEMO may be completed while customer writes are
    // drained. Keep this exception bound to an already-created DEMO tenant in
    // PROVISIONING; it does not reopen tenant writes for active customers.
    const approvedDemoProvisioning =
      organization.kind === "DEMO" &&
      organization.status === "PROVISIONING" &&
      reason === "demo provision";
    const approvedDemoMaintenance = organization.kind === "DEMO" && ["demo file retention", "demo reset", "demo summary"].includes(reason);
    const approvedCapabilityRead = reason === "capability resolution";
    const approvedLifecycle = ["demo trial extend", "demo trial suspend", "organization suspend", "organization reactivate"].includes(reason);
    if (!activeOrProvisioning && !approvedDemoMaintenance && !approvedLifecycle && !approvedCapabilityRead) {
      throw new AuthError("ORGANIZATION_NOT_ACTIVE", 403);
    }
    const runtimeState = await tx.platformRuntimeState.findUnique({ where: { id: 1 }, select: { writeMode: true } }).catch((error) => {
      if (process.env.NODE_ENV !== "production" && error instanceof Error && /does not exist|P2021|relation/i.test(error.message)) return null;
      throw error;
    });
    const approvedDemoProvisioningDuringMaintenance =
      runtimeState?.writeMode === "MAINTENANCE" && approvedDemoProvisioning;
    if (runtimeState && runtimeState.writeMode !== "OPEN" && !approvedDemoProvisioningDuringMaintenance && !approvedDemoMaintenance && !approvedLifecycle && !approvedCapabilityRead) {
      throw new AuthError("POLICYDESK_MAINTENANCE_MODE", 503);
    }
    await tx.$executeRaw(Prisma.sql`SELECT set_config('app.organization_id', ${organizationId}, true)`);
    return callback(tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, ...transactionOptions });
}

export const withSystemTenantTransaction = withSystemOrganizationTransaction;

export async function selectOrganization(organizationId: string) {
  const user = await requireUser();
  const db = getDb();
  const memberships = await db.organizationMembership.findMany({
    where: {
      userId: user.id,
    },
    select: {
      id: true,
      organizationId: true,
      role: true,
      active: true,
      organization: { select: { status: true } },
    },
    orderBy: { id: "asc" },
    take: 2,
  });

  if (memberships.length > 1) throw new AuthError("POLICYDESK_MULTIPLE_ORGANIZATION_MEMBERSHIPS", 409);
  const membership = memberships[0];
  if (
    !membership ||
    membership.organizationId !== organizationId ||
    !membership.active ||
    membership.organization.status !== "ACTIVE" ||
    !isOrganizationRole(membership.role)
  ) {
    throw new AuthError("ORGANIZATION_CONTEXT_STALE", 409);
  }

  await withSystemOrganizationTransaction(membership.organizationId, "organization select", async (tx) => {
    await writeActivityLog({
      entityType: "OrganizationMembership",
      entityId: membership.id,
      action: "ORGANIZATION_SELECTED",
      userId: user.id,
      organizationId: membership.organizationId,
      newValue: { organizationId: membership.organizationId },
      db: tx,
    });
  });

  await setSessionCookie({
    userId: user.id,
    email: user.email,
    name: user.name,
    role: membership.role === "AGENT" ? "AGENT" : "ADMIN",
    platformRole: user.platformRole === "SUPERADMIN" ? "SUPERADMIN" : "NONE",
    organizationId: membership.organizationId,
    sessionVersion: user.sessionVersion,
    mustChangePassword: user.mustChangePassword,
  });
}

export async function clearSelectedOrganization() {
  const user = await requireUser();
  await setSessionCookie({
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role === "ADMIN" ? "ADMIN" : "AGENT",
    platformRole: user.platformRole === "SUPERADMIN" ? "SUPERADMIN" : "NONE",
    sessionVersion: user.sessionVersion,
    mustChangePassword: user.mustChangePassword,
  });
}

export function organizationClientWhere(context: OrganizationContext) {
  return { organizationId: context.organizationId } as const;
}

export function organizationPolicyWhere(context: OrganizationContext) {
  return {
    organizationId: context.organizationId,
    client: { organizationId: context.organizationId },
    insurer: { organizationId: context.organizationId },
  } as const;
}

export function portfolioOwnerIdForContext(context: OrganizationContext) {
  return context.membershipRole === "AGENT" ? context.userId : undefined;
}

export function assertSameOrganization(left: string | null | undefined, context: OrganizationContext): void {
  if (left !== context.organizationId) throw new AuthError("La relación no pertenece a esta organización.", 403);
}
