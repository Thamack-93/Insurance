import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";

export const PLATFORM_PAGE_SIZE = 25;
export const PLATFORM_MEMBER_PAGE_SIZE = 25;
export const PLATFORM_ACTIVITY_LIMIT = 50;

export type PlatformOrganizationStatus = "ACTIVE" | "SUSPENDED" | "BOOTSTRAP" | "RESTORING";
export type PlatformHealth = "NO_ACTIVE_OWNER" | "NO_ACTIVE_MEMBERS" | "INACTIVE_WITH_ACTIVE_MEMBERS";

export type PlatformSummary = {
  organizations: number;
  activeOrganizations: number;
  suspendedOrganizations: number;
  activeUsers: number;
  activeMemberships: number;
  activeOwners: number;
  activePlatformAdmins: number;
};

export type PlatformOrganizationRow = {
  id: string;
  name: string;
  slug: string;
  kind: string;
  status: string;
  timeZone: string;
  defaultCurrency: string;
  membershipCount: number;
  activeMemberCount: number;
  activeOwnerCount: number;
  clientCount: number;
  policyCount: number;
  lastMemberLoginAt: Date | null;
  health: PlatformHealth[];
};

export type PlatformMembershipRow = {
  id: string;
  role: string;
  active: boolean;
  userId: string;
  userName: string;
  userEmail: string;
  userActive: boolean;
  lastLoginAt: Date | null;
};

export type PlatformActivityRow = {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  userId: string;
  actorName: string;
  actorEmail: string;
  createdAt: Date;
};

export type PlatformOrganizationDetail = {
  organization: PlatformOrganizationRow;
  memberships: PlatformMembershipRow[];
  membershipTotal: number;
  activities: PlatformActivityRow[];
};

export type PlatformOverview = {
  summary: PlatformSummary;
  organizations: PlatformOrganizationRow[];
  total: number;
  page: number;
  pageSize: number;
};

const PLATFORM_STATUSES: readonly PlatformOrganizationStatus[] = ["ACTIVE", "SUSPENDED", "BOOTSTRAP", "RESTORING"];

export function normalizePlatformPage(value: string | undefined): number {
  const parsed = Number(value ?? "1");
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return Math.min(parsed, 10_000);
}

export function normalizePlatformStatus(value: string | undefined): PlatformOrganizationStatus | undefined {
  return PLATFORM_STATUSES.includes(value as PlatformOrganizationStatus) ? value as PlatformOrganizationStatus : undefined;
}

export function getPlatformHealth({ status, activeMemberCount, activeOwnerCount }: Pick<PlatformOrganizationRow, "status" | "activeMemberCount" | "activeOwnerCount">): PlatformHealth[] {
  const health: PlatformHealth[] = [];
  if (activeOwnerCount === 0) health.push("NO_ACTIVE_OWNER");
  if (activeMemberCount === 0) health.push("NO_ACTIVE_MEMBERS");
  if (status !== "ACTIVE" && activeMemberCount > 0) health.push("INACTIVE_WITH_ACTIVE_MEMBERS");
  return health;
}

type OrganizationBase = {
  id: string;
  name: string;
  slug: string;
  kind: string;
  status: string;
  timeZone: string;
  defaultCurrency: string;
  _count: { memberships: number };
};

type TenantMetricStat = { organizationId: string; clientCount: bigint | number; policyCount: bigint | number };

async function tenantMetricStats(organizationIds: string[]): Promise<Map<string, { clientCount: number; policyCount: number }>> {
  if (organizationIds.length === 0) return new Map();
  const db = getDb();
  // Keep the compatible pre-cutover deployment working. Once FORCE RLS is
  // enabled, the flag is switched with the cutover and only the restricted
  // aggregate function is used.
  if (process.env.ENABLE_TENANT_RLS_CUTOVER !== "1") {
    const [clients, policies] = await Promise.all([
      db.client.groupBy({ by: ["organizationId"], where: { organizationId: { in: organizationIds } }, _count: { _all: true } }),
      db.policy.groupBy({ by: ["organizationId"], where: { organizationId: { in: organizationIds } }, _count: { _all: true } }),
    ]);
    const metrics = new Map<string, { clientCount: number; policyCount: number }>();
    for (const row of clients) if (row.organizationId) metrics.set(row.organizationId, { clientCount: row._count._all, policyCount: 0 });
    for (const row of policies) if (row.organizationId) metrics.set(row.organizationId, { clientCount: metrics.get(row.organizationId)?.clientCount ?? 0, policyCount: row._count._all });
    return metrics;
  }
  const rows = await db.$queryRaw<TenantMetricStat[]>`
    SELECT "organizationId" AS "organizationId", "clientCount", "policyCount"
    FROM policydesk_platform_tenant_metrics(${organizationIds}::text[])
  `;
  return new Map(rows.map((row) => [row.organizationId, { clientCount: Number(row.clientCount), policyCount: Number(row.policyCount) }]));
}

type MembershipStat = {
  organizationId: string;
  activeMemberCount: number;
  activeOwnerCount: number;
  lastMemberLoginAt: Date | null;
};

async function membershipStats(organizationIds: string[]): Promise<Map<string, MembershipStat>> {
  if (organizationIds.length === 0) return new Map();
  const db = getDb();
  const memberships = await db.organizationMembership.findMany({
    where: { organizationId: { in: organizationIds }, active: true },
    select: {
      organizationId: true,
      role: true,
      user: { select: { active: true, lastLoginAt: true } },
    },
  });
  const stats = new Map<string, MembershipStat>();
  for (const membership of memberships) {
    const current = stats.get(membership.organizationId) ?? {
      organizationId: membership.organizationId,
      activeMemberCount: 0,
      activeOwnerCount: 0,
      lastMemberLoginAt: null,
    };
    if (membership.user.active) {
      current.activeMemberCount += 1;
      if (membership.role === "OWNER") current.activeOwnerCount += 1;
      if (membership.user.lastLoginAt && (!current.lastMemberLoginAt || membership.user.lastLoginAt > current.lastMemberLoginAt)) {
        current.lastMemberLoginAt = membership.user.lastLoginAt;
      }
    }
    stats.set(membership.organizationId, current);
  }
  return stats;
}

function toOrganizationRow(organization: OrganizationBase, stats: MembershipStat | undefined, metrics?: { clientCount: number; policyCount: number }): PlatformOrganizationRow {
  const activeMemberCount = stats?.activeMemberCount ?? 0;
  const activeOwnerCount = stats?.activeOwnerCount ?? 0;
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    kind: organization.kind,
    status: organization.status,
    timeZone: organization.timeZone,
    defaultCurrency: organization.defaultCurrency,
    membershipCount: organization._count.memberships,
    activeMemberCount,
    activeOwnerCount,
    clientCount: metrics?.clientCount ?? 0,
    policyCount: metrics?.policyCount ?? 0,
    lastMemberLoginAt: stats?.lastMemberLoginAt ?? null,
    health: getPlatformHealth({ status: organization.status, activeMemberCount, activeOwnerCount }),
  };
}

async function getPlatformSummary(): Promise<PlatformSummary> {
  const db = getDb();
  const [organizations, activeOrganizations, suspendedOrganizations, activeMemberships, activeOwners, activePlatformAdmins, activeMemberIds] = await Promise.all([
    db.organization.count(),
    db.organization.count({ where: { status: "ACTIVE" } }),
    db.organization.count({ where: { status: "SUSPENDED" } }),
    db.organizationMembership.count({ where: { active: true } }),
    db.organizationMembership.count({ where: { active: true, role: "OWNER", user: { active: true } } }),
    db.user.count({ where: { active: true, platformRole: "SUPERADMIN" } }),
    db.organizationMembership.findMany({ where: { active: true, user: { active: true } }, select: { userId: true } }),
  ]);
  return { organizations, activeOrganizations, suspendedOrganizations, activeUsers: new Set(activeMemberIds.map(({ userId }) => userId)).size, activeMemberships, activeOwners, activePlatformAdmins };
}

export async function getPlatformOverview({ query, status, page }: { query?: string; status?: string; page?: string }): Promise<PlatformOverview> {
  const db = getDb();
  const safePage = normalizePlatformPage(page);
  const normalizedQuery = query?.trim().slice(0, 120);
  const normalizedStatus = normalizePlatformStatus(status);
  const where: Prisma.OrganizationWhereInput = {
    ...(normalizedStatus ? { status: normalizedStatus } : {}),
    ...(normalizedQuery ? { OR: [{ name: { contains: normalizedQuery, mode: "insensitive" } }, { slug: { contains: normalizedQuery, mode: "insensitive" } }] } : {}),
  };
  const [summary, total, organizations] = await Promise.all([
    getPlatformSummary(),
    db.organization.count({ where }),
    db.organization.findMany({
      where,
      select: {
        id: true,
        name: true,
        slug: true,
        kind: true,
        status: true,
        timeZone: true,
        defaultCurrency: true,
        _count: { select: { memberships: true } },
      },
      orderBy: { name: "asc" },
      skip: (safePage - 1) * PLATFORM_PAGE_SIZE,
      take: PLATFORM_PAGE_SIZE,
    }),
  ]);
  const organizationIds = organizations.map(({ id }) => id);
  const [stats, metrics] = await Promise.all([membershipStats(organizationIds), tenantMetricStats(organizationIds)]);
  return { summary, total, page: safePage, pageSize: PLATFORM_PAGE_SIZE, organizations: organizations.map((organization) => toOrganizationRow(organization, stats.get(organization.id), metrics.get(organization.id))) };
}

export async function getPlatformOrganizationDetail(organizationId: string, { memberQuery, memberPage }: { memberQuery?: string; memberPage?: string } = {}): Promise<PlatformOrganizationDetail | null> {
  const db = getDb();
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      slug: true,
      kind: true,
      status: true,
      timeZone: true,
      defaultCurrency: true,
      _count: { select: { memberships: true } },
    },
  });
  if (!organization) return null;

  const safeMemberPage = normalizePlatformPage(memberPage);
  const normalizedMemberQuery = memberQuery?.trim().slice(0, 120);
  const memberWhere: Prisma.OrganizationMembershipWhereInput = {
    organizationId,
    ...(normalizedMemberQuery ? { user: { OR: [{ name: { contains: normalizedMemberQuery, mode: "insensitive" } }, { email: { contains: normalizedMemberQuery, mode: "insensitive" } }] } } : {}),
  };
  const [membershipTotal, memberships, activities] = await Promise.all([
    db.organizationMembership.count({ where: memberWhere }),
    db.organizationMembership.findMany({
      where: memberWhere,
      select: { id: true, role: true, active: true, userId: true, user: { select: { name: true, email: true, active: true, lastLoginAt: true } } },
      orderBy: { createdAt: "asc" },
      skip: (safeMemberPage - 1) * PLATFORM_MEMBER_PAGE_SIZE,
      take: PLATFORM_MEMBER_PAGE_SIZE,
    }),
    db.platformAuditLog.findMany({
      where: { targetOrganizationId: organizationId },
      select: { id: true, action: true, targetUserId: true, actorUserId: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PLATFORM_ACTIVITY_LIMIT,
    }),
  ]);
  const actorIds = [...new Set(activities.map(({ actorUserId }) => actorUserId).filter((id): id is string => Boolean(id)))];
  const actors = actorIds.length === 0 ? [] : await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } });
  const actorById = new Map(actors.map((actor) => [actor.id, actor]));
  const [stats, metrics] = await Promise.all([membershipStats([organizationId]), tenantMetricStats([organizationId])]);
  return {
    organization: toOrganizationRow(organization, stats.get(organizationId), metrics.get(organizationId)),
    membershipTotal,
    memberships: memberships.map((membership) => ({ id: membership.id, role: membership.role, active: membership.active, userId: membership.userId, userName: membership.user.name, userEmail: membership.user.email, userActive: membership.user.active, lastLoginAt: membership.user.lastLoginAt })),
    activities: activities.map((activity) => ({ id: activity.id, entityType: "PlatformAuditLog", entityId: activity.targetUserId ?? organizationId, action: activity.action, userId: activity.actorUserId ?? "system", actorName: activity.actorUserId ? actorById.get(activity.actorUserId)?.name ?? "Sistema/usuario eliminado" : "Sistema", actorEmail: activity.actorUserId ? actorById.get(activity.actorUserId)?.email ?? "" : "", createdAt: activity.createdAt })),
  };
}
