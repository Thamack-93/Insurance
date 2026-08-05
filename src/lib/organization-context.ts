import "server-only";

import { getDb } from "@/lib/db";
import { AuthError, getSession, requireUser, setSessionCookie } from "@/lib/auth";
import { writeActivityLog } from "@/lib/activity-log";

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
  | { status: "selection-required"; options: OrganizationOption[] }
  | { status: "stale-selection"; options: OrganizationOption[] };

function isOrganizationRole(value: string): value is OrganizationRole {
  return (ORGANIZATION_ROLES as readonly string[]).includes(value);
}

async function activeMembershipOptions(userId: string): Promise<OrganizationOption[]> {
  const db = getDb();
  const memberships = await db.organizationMembership.findMany({
    where: {
      userId,
      active: true,
      organization: { status: "ACTIVE" },
    },
    select: {
      id: true,
      role: true,
      organization: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { organization: { name: "asc" } },
  });

  return memberships
    .filter((membership): membership is typeof membership & { role: OrganizationRole } => isOrganizationRole(membership.role))
    .map((membership) => ({
      id: membership.organization.id,
      name: membership.organization.name,
      slug: membership.organization.slug,
      role: membership.role,
    }));
}

export async function getOrganizationOptions(): Promise<OrganizationOption[]> {
  const user = await requireUser();
  return activeMembershipOptions(user.id);
}

export async function resolveOrganizationContext(): Promise<OrganizationContextResolution> {
  const session = await getSession();
  if (!session) return { status: "unauthenticated" };

  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof AuthError && error.status === 401) return { status: "unauthenticated" };
    throw error;
  }

  const options = await activeMembershipOptions(user.id);
  if (options.length === 0) return { status: "no-membership", options: [] };

  if (!session.organizationId) {
    if (options.length === 1) {
      return buildContext(user, options[0].id);
    }
    return { status: "selection-required", options };
  }

  const selected = options.find((option) => option.id === session.organizationId);
  if (!selected) return { status: "stale-selection", options };
  return buildContext(user, selected.id);
}

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
    const options = await activeMembershipOptions(user.id);
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
  if (resolution.status === "selection-required" || resolution.status === "stale-selection") {
    throw new AuthError("Selecciona una organización activa.", 409);
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

export async function selectOrganization(organizationId: string) {
  const user = await requireUser();
  const db = getDb();
  const membership = await db.organizationMembership.findFirst({
    where: {
      organizationId,
      userId: user.id,
      active: true,
      organization: { status: "ACTIVE" },
    },
    select: { id: true, organizationId: true, role: true },
  });

  if (!membership) throw new AuthError("No tienes acceso a esta organización.", 403);

  await setSessionCookie({
    userId: user.id,
    email: user.email,
    name: user.name,
    role: membership.role === "AGENT" ? "AGENT" : "ADMIN",
    platformRole: user.platformRole === "SUPERADMIN" ? "SUPERADMIN" : "NONE",
    organizationId: membership.organizationId,
  });

  await writeActivityLog({
    entityType: "OrganizationMembership",
    entityId: membership.id,
    action: "ORGANIZATION_SELECTED",
    userId: user.id,
    organizationId: membership.organizationId,
    newValue: { organizationId: membership.organizationId },
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
