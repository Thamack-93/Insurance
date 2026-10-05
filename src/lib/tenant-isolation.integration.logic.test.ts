import { describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("server-only", () => ({}));

import { getPlatformOrganizationDetail, getPlatformOverview } from "@/lib/platform-dashboard";
import { recordPayment } from "@/lib/payment-service";
import { assertOrganizationContextInTransaction, type OrganizationContext } from "@/lib/organization-context";

async function contextFor(db: PrismaClient, userId: string): Promise<OrganizationContext> {
  const membership = await db.organizationMembership.findUnique({ where: { userId }, include: { user: true, organization: true } });
  if (!membership || !membership.active || !membership.user.active || membership.organization.status !== "ACTIVE") throw new Error("TENANT_INTEGRATION_FIXTURE_CONTEXT_INVALID");
  return {
    userId: membership.userId, userEmail: membership.user.email, userName: membership.user.name,
    userRole: membership.user.role, platformRole: membership.user.platformRole,
    organizationId: membership.organizationId, organizationName: membership.organization.name,
    organizationSlug: membership.organization.slug, organizationStatus: membership.organization.status,
    membershipId: membership.id, membershipRole: membership.role as OrganizationContext["membershipRole"],
  };
}

const enabled = process.env.TENANT_ISOLATION_TEST_DB === "1" && process.env.PLAYWRIGHT_ENFORCE_DISPOSABLE_DB === "1";
const describeDisposable = enabled ? describe : describe.skip;

describeDisposable("tenant isolation disposable fixture", () => {
  it("contains legacy and Pedro organizations plus a membership-free superadmin", async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    try {
      const organizations = await db.organization.findMany({ where: { id: { in: ["org_legacy_singleton_0001", "org_pedro_gomez_0001", "org_demo_broker_0001"] } } });
      expect(organizations).toHaveLength(3);
      expect(organizations.find((organization) => organization.id === "org_pedro_gomez_0001")).toMatchObject({
        name: "Pedro Alfredo Gómez Lorenzo",
        slug: "pedro-alfredo-gomez-lorenzo",
        kind: "CUSTOMER",
        status: "ACTIVE",
      });
      expect(organizations.find((organization) => organization.id === "org_demo_broker_0001")?.kind).toBe("DEMO");
      const pedro = await db.user.findUnique({ where: { id: "tenant-pedro-gomez" }, include: { organizationMemberships: true } });
      expect(pedro?.email).toBe("tenant-owner-b@policydesk.local");
      expect(pedro?.organizationMemberships).toEqual([
        expect.objectContaining({ organizationId: "org_pedro_gomez_0001", role: "OWNER", active: true }),
      ]);
      const superadmin = await db.user.findUnique({ where: { id: "tenant-platform-admin" }, include: { organizationMemberships: true } });
      expect(superadmin?.email).toBe("tenant-platform-admin@policydesk.local");
      expect(superadmin?.platformRole).toBe("SUPERADMIN");
      expect(superadmin?.organizationMemberships).toHaveLength(0);
      const contextA = await contextFor(db, "tenant-admin-a");
      const contextB = await contextFor(db, "tenant-pedro-gomez");
      const clientsA = await db.$transaction(async (tx) => {
        await assertOrganizationContextInTransaction(tx, contextA, ["OWNER"]);
        return tx.client.findMany({ where: { organizationId: contextA.organizationId, id: { in: ["tenant-client-a", "tenant-client-b"] } }, select: { id: true, organizationId: true } });
      });
      const clientsB = await db.$transaction(async (tx) => {
        await assertOrganizationContextInTransaction(tx, contextB, ["OWNER"]);
        return tx.client.findMany({ where: { organizationId: contextB.organizationId, id: { in: ["tenant-client-a", "tenant-client-b", "tenant-client-pedro"] } }, select: { id: true, organizationId: true } });
      });
      expect(clientsA).toEqual([expect.objectContaining({ id: "tenant-client-a", organizationId: "org_legacy_singleton_0001" })]);
      expect(clientsB).toHaveLength(2);
      expect(clientsB).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "tenant-client-b", organizationId: "org_pedro_gomez_0001" }),
        expect.objectContaining({ id: "tenant-client-pedro", organizationId: "org_pedro_gomez_0001" }),
      ]));
    } finally {
      await db.$disconnect();
    }
  });

  it("proves scoped writes cannot cross organizations or portfolios", async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    try {
      const contextA = await contextFor(db, "tenant-admin-a");
      await db.$transaction(async (tx) => {
        await assertOrganizationContextInTransaction(tx, contextA, ["OWNER"]);
        const foreignUpdate = await tx.client.updateMany({
          where: { id: "tenant-client-b", organizationId: "org_legacy_singleton_0001", portfolioOwnerId: "tenant-agent-a" },
          data: { notes: "must not cross tenant" },
        });
        expect(foreignUpdate.count).toBe(0);
        const foreignOwnerUpdate = await tx.client.updateMany({
          where: { id: "tenant-client-a", organizationId: "org_legacy_singleton_0001", portfolioOwnerId: "tenant-agent-b" },
          data: { notes: "must not cross portfolio" },
        });
        expect(foreignOwnerUpdate.count).toBe(0);
        const created = await tx.client.create({ data: {
          id: "tenant-client-a-created", organizationId: contextA.organizationId, fullName: "Created only in A",
          type: "PERSON", status: "ACTIVE", portfolioOwnerId: "tenant-agent-a", createdById: "tenant-admin-a", updatedById: "tenant-admin-a",
        } });
        expect(created.organizationId).toBe(contextA.organizationId);
        await tx.client.delete({ where: { id: created.id } });
      });
    } finally {
      await db.$disconnect();
    }
  });

  it("keeps the master panel aggregates and activity tenant-scoped", async () => {
    const overview = await getPlatformOverview({});
    expect(overview.summary.organizations).toBe(3);
    const activeMemberships = await new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) }).organizationMembership.findMany({ where: { active: true, user: { active: true } }, select: { userId: true } });
    expect(overview.summary.activeUsers).toBe(new Set(activeMemberships.map(({ userId }) => userId)).size);
    expect(overview.organizations.map((organization) => organization.id)).toEqual(["org_pedro_gomez_0001", "org_demo_broker_0001", "org_legacy_singleton_0001"]);

    const pedro = await getPlatformOrganizationDetail("org_pedro_gomez_0001");
    expect(pedro?.organization.name).toBe("Pedro Alfredo Gómez Lorenzo");
    expect(pedro?.memberships.some((membership) => membership.userEmail === "tenant-owner-b@policydesk.local" && membership.role === "OWNER")).toBe(true);
    expect(pedro?.activities.every((activity) => activity.entityId !== "legacy-secret" && !("oldValue" in activity) && !("newValue" in activity))).toBe(true);
    expect(await getPlatformOrganizationDetail("does-not-exist")).toBeNull();
  });

  it("physically rejects a second membership for the same user", async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    try {
      await expect(
        db.organizationMembership.create({
          data: {
            organizationId: "org_pedro_gomez_0001",
            userId: "tenant-agent-a",
            role: "AGENT",
            active: true,
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });
      expect(await db.organizationMembership.count({ where: { userId: "tenant-agent-a" } })).toBe(1);
    } finally {
      await db.$disconnect();
    }
  });

  it("scopes payment evidence idempotency to the organization", async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    const contextA = await contextFor(db, "tenant-admin-a");
    const contextB = await contextFor(db, "tenant-pedro-gomez");
    try {
      let reachedDuplicate = false;
      await expect(db.$transaction(async (tx) => {
        await assertOrganizationContextInTransaction(tx, contextA, ["OWNER"]);
        await tx.payment.upsert({ where: { id: "tenant-payment-evidence-a" }, update: { sourceEvidenceKey: "overlap-evidence" }, create: { id: "tenant-payment-evidence-a", organizationId: contextA.organizationId, receiptId: "tenant-receipt-a", policyId: "tenant-policy-a", clientId: "tenant-client-a", amount: 1000, currency: "MXN", paidDate: new Date("2026-06-30"), paymentMethod: "TEST", sourceEvidenceKey: "overlap-evidence" } });
        await assertOrganizationContextInTransaction(tx, contextB, ["OWNER"]);
        await tx.payment.upsert({ where: { id: "tenant-payment-evidence-b" }, update: { sourceEvidenceKey: "overlap-evidence" }, create: { id: "tenant-payment-evidence-b", organizationId: contextB.organizationId, receiptId: "tenant-receipt-b", policyId: "tenant-policy-b", clientId: "tenant-client-b", amount: 1000, currency: "MXN", paidDate: new Date("2026-06-30"), paymentMethod: "TEST", sourceEvidenceKey: "overlap-evidence" } });
        await assertOrganizationContextInTransaction(tx, contextA, ["OWNER"]);
        reachedDuplicate = true;
        await tx.payment.create({ data: { organizationId: contextA.organizationId, receiptId: "tenant-receipt-a", policyId: "tenant-policy-a", clientId: "tenant-client-a", amount: 1000, currency: "MXN", paidDate: new Date("2026-07-01"), paymentMethod: "TEST", sourceEvidenceKey: "overlap-evidence" } });
      })).rejects.toMatchObject({ code: "P2002" });
      expect(reachedDuplicate).toBe(true);
    } finally {
      await db.$transaction(async (tx) => { await assertOrganizationContextInTransaction(tx, contextA, ["OWNER"]); await tx.payment.deleteMany({ where: { id: "tenant-payment-evidence-a", organizationId: contextA.organizationId } }); });
      await db.$transaction(async (tx) => { await assertOrganizationContextInTransaction(tx, contextB, ["OWNER"]); await tx.payment.deleteMany({ where: { id: "tenant-payment-evidence-b", organizationId: contextB.organizationId } }); });
      await db.$disconnect();
    }
  });

  it("fails closed when a payment targets another organization's receipt", async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    try {
      const contextA = await contextFor(db, "tenant-admin-a");
      await expect(db.$transaction(async (tx) => {
        await assertOrganizationContextInTransaction(tx, contextA, ["OWNER"]);
        return recordPayment({ organizationId: contextA.organizationId, receiptId: "tenant-receipt-b", amount: 1000, paidDate: new Date("2026-06-30"), paymentMethod: "TEST", sourceEvidenceKey: "cross-org-payment-must-fail", actorId: contextA.userId }, tx);
      })).rejects.toThrow("El recibo no existe o fue eliminado.");
      const visible = await db.$transaction(async (tx) => { await assertOrganizationContextInTransaction(tx, contextA, ["OWNER"]); return tx.payment.count({ where: { sourceEvidenceKey: "cross-org-payment-must-fail", organizationId: contextA.organizationId } }); });
      expect(visible).toBe(0);
    } finally {
      await db.$disconnect();
    }
  });
});
