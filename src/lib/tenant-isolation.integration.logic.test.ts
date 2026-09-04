import { describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

vi.mock("server-only", () => ({}));

import { getPlatformOrganizationDetail, getPlatformOverview } from "@/lib/platform-dashboard";
import { recordPayment } from "@/lib/payment-service";

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
      const clients = await db.client.findMany({ where: { id: { in: ["tenant-client-a", "tenant-client-b"] } }, select: { id: true, organizationId: true } });
      expect(new Set(clients.map((client) => client.organizationId))).toEqual(new Set(["org_legacy_singleton_0001", "org_pedro_gomez_0001"]));
      expect((await db.client.findUnique({ where: { id: "tenant-client-pedro" } }))?.organizationId).toBe("org_pedro_gomez_0001");
    } finally {
      await db.$disconnect();
    }
  });

  it("proves scoped writes cannot cross organizations or portfolios", async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    try {
      const foreignUpdate = await db.client.updateMany({
        where: { id: "tenant-client-b", organizationId: "org_legacy_singleton_0001", portfolioOwnerId: "tenant-agent-a" },
        data: { notes: "must not cross tenant" },
      });
      expect(foreignUpdate.count).toBe(0);

      const foreignOwnerUpdate = await db.client.updateMany({
        where: { id: "tenant-client-a", organizationId: "org_legacy_singleton_0001", portfolioOwnerId: "tenant-agent-b" },
        data: { notes: "must not cross portfolio" },
      });
      expect(foreignOwnerUpdate.count).toBe(0);

      const created = await db.client.create({
        data: {
          id: "tenant-client-a-created",
          organizationId: "org_legacy_singleton_0001",
          fullName: "Created only in A",
          type: "PERSON",
          status: "ACTIVE",
          portfolioOwnerId: "tenant-agent-a",
          createdById: "tenant-admin-a",
          updatedById: "tenant-admin-a",
        },
      });
      expect(created.organizationId).toBe("org_legacy_singleton_0001");
      await db.client.delete({ where: { id: created.id } });
    } finally {
      await db.$disconnect();
    }
  });

  it("keeps the master panel aggregates and activity tenant-scoped", async () => {
    const overview = await getPlatformOverview({});
    expect(overview.summary.organizations).toBe(3);
    expect(overview.summary.activeUsers).toBe(7);
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
    const ids = ["tenant-payment-evidence-a", "tenant-payment-evidence-b"];
    try {
      await db.payment.deleteMany({ where: { id: { in: ids } } });
      await db.payment.create({ data: { id: ids[0], organizationId: "org_legacy_singleton_0001", receiptId: "tenant-receipt-a", policyId: "tenant-policy-a", clientId: "tenant-client-a", amount: 1000, currency: "MXN", paidDate: new Date("2026-06-30"), paymentMethod: "TEST", sourceEvidenceKey: "overlap-evidence" } });
      await db.payment.create({ data: { id: ids[1], organizationId: "org_pedro_gomez_0001", receiptId: "tenant-receipt-b", policyId: "tenant-policy-b", clientId: "tenant-client-b", amount: 1000, currency: "MXN", paidDate: new Date("2026-06-30"), paymentMethod: "TEST", sourceEvidenceKey: "overlap-evidence" } });
      await expect(db.payment.create({ data: { organizationId: "org_legacy_singleton_0001", receiptId: "tenant-receipt-a", policyId: "tenant-policy-a", clientId: "tenant-client-a", amount: 1000, currency: "MXN", paidDate: new Date("2026-07-01"), paymentMethod: "TEST", sourceEvidenceKey: "overlap-evidence" } })).rejects.toMatchObject({ code: "P2002" });
    } finally {
      await db.payment.deleteMany({ where: { id: { in: ids } } });
      await db.$disconnect();
    }
  });

  it("fails closed when a payment targets another organization's receipt", async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    try {
      await expect(recordPayment({ organizationId: "org_legacy_singleton_0001", receiptId: "tenant-receipt-b", amount: 1000, paidDate: new Date("2026-06-30"), paymentMethod: "TEST", sourceEvidenceKey: "cross-org-payment-must-fail", actorId: "tenant-admin-a" }, db)).rejects.toThrow("El recibo no existe o fue eliminado.");
      expect(await db.payment.count({ where: { sourceEvidenceKey: "cross-org-payment-must-fail" } })).toBe(0);
    } finally {
      await db.$disconnect();
    }
  });
});
