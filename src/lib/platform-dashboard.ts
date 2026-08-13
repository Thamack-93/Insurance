import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";

export const PLATFORM_PAGE_SIZE = 25;
export const PLATFORM_MEMBER_PAGE_SIZE = 25;
export const PLATFORM_ACTIVITY_LIMIT = 50;

export type PlatformOrganizationStatus = "ACTIVE" | "SUSPENDED" | "BOOTSTRAP";
export type PlatformHealth = "NO_ACTIVE_OWNER" | "NO_ACTIVE_MEMBERS" | "INACTIVE_WITH_ACTIVE_MEMBERS";

export type PlatformSummary = {
  organizations: number;
  activeOrganizations: number;
  suspendedOrganizations: number;
  activeUsers: number;
  activeMemberships: number;
  activeOwners: number;
};

export type PlatformOrganizationRow = {
  id: string;
  name: string;
  slug: string;
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

const PLATFORM_STATUSES: readonly PlatformOrganizationStatus[] = ["ACTIVE", "SUSPENDED", "BOOTSTRAP"];

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
  status: string;
  timeZone: string;
  defaultCurrency: string;
  _count: { memberships: number; clients: number; policies: number };
};

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

function toOrganizationRow(organization: OrganizationBase, stats: MembershipStat | undefined): PlatformOrganizationRow {
  const activeMemberCount = stats?.activeMemberCount ?? 0;
  const activeOwnerCount = stats?.activeOwnerCount ?? 0;
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    status: organization.status,
    timeZone: organization.timeZone,
    defaultCurrency: organization.defaultCurrency,
    membershipCount: organization._count.memberships,
    activeMemberCount,
    activeOwnerCount,
    clientCount: organization._count.clients,
    policyCount: organization._count.policies,
    lastMemberLoginAt: stats?.lastMemberLoginAt ?? null,
    health: getPlatformHealth({ status: organization.status, activeMemberCount, activeOwnerCount }),
  };
}

async function getPlatformSummary(): Promise<PlatformSummary> {
  const db = getDb();
  const [organizations, activeOrganizations, suspendedOrganizations, activeMemberships, activeOwners, activeMemberIds] = await Promise.all([
    db.organization.count(),
    db.organization.count({ where: { status: "ACTIVE" } }),
    db.organization.count({ where: { status: "SUSPENDED" } }),
    db.organizationMembership.count({ where: { active: true } }),
    db.organizationMembership.count({ where: { active: true, role: "OWNER", user: { active: true } } }),
    db.organizationMembership.findMany({ where: { active: true, user: { active: true } }, select: { userId: true } }),
  ]);
  return { organizations, activeOrganizations, suspendedOrganizations, activeUsers: new Set(activeMemberIds.map(({ userId }) => userId)).size, activeMemberships, activeOwners };
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
        status: true,
        timeZone: true,
        defaultCurrency: true,
        _count: { select: { memberships: true, clients: true, policies: true } },
      },
      orderBy: { name: "asc" },
      skip: (safePage - 1) * PLATFORM_PAGE_SIZE,
      take: PLATFORM_PAGE_SIZE,
    }),
  ]);
  const stats = await membershipStats(organizations.map(({ id }) => id));
  return { summary, total, page: safePage, pageSize: PLATFORM_PAGE_SIZE, organizations: organizations.map((organization) => toOrganizationRow(organization, stats.get(organization.id))) };
}

export async function getPlatformOrganizationDetail(organizationId: string, { memberQuery, memberPage }: { memberQuery?: string; memberPage?: string } = {}): Promise<PlatformOrganizationDetail | null> {
  const db = getDb();
  const organization = await db.organization.findUnique({
    where: { id: organizationId },
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      timeZone: true,
      defaultCurrency: true,
      _count: { select: { memberships: true, clients: true, policies: true } },
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
    db.activityLog.findMany({
      where: { organizationId },
      select: { id: true, entityType: true, entityId: true, action: true, userId: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: PLATFORM_ACTIVITY_LIMIT,
    }),
  ]);
  const actorIds = [...new Set(activities.map(({ userId }) => userId))];
  const actors = actorIds.length === 0 ? [] : await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, email: true } });
  const actorById = new Map(actors.map((actor) => [actor.id, actor]));
  const stats = await membershipStats([organizationId]);
  return {
    organization: toOrganizationRow(organization, stats.get(organizationId)),
    membershipTotal,
    memberships: memberships.map((membership) => ({ id: membership.id, role: membership.role, active: membership.active, userId: membership.userId, userName: membership.user.name, userEmail: membership.user.email, userActive: membership.user.active, lastLoginAt: membership.user.lastLoginAt })),
    activities: activities.map((activity) => ({ id: activity.id, entityType: activity.entityType, entityId: activity.entityId, action: activity.action, userId: activity.userId, actorName: actorById.get(activity.userId)?.name ?? "Sistema/usuario eliminado", actorEmail: actorById.get(activity.userId)?.email ?? "", createdAt: activity.createdAt })),
  };
}
