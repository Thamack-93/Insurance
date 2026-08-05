import { describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const enabled = process.env.TENANT_ISOLATION_TEST_DB === "1" && process.env.PLAYWRIGHT_ENFORCE_DISPOSABLE_DB === "1";
const describeDisposable = enabled ? describe : describe.skip;

describeDisposable("tenant isolation disposable fixture", () => {
  it("contains two organizations and a membership-free superadmin", async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is required");
    const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    try {
      const organizations = await db.organization.findMany({ where: { id: { in: ["org_test_a_0001", "org_test_b_0001"] } } });
      expect(organizations).toHaveLength(2);
      const superadmin = await db.user.findUnique({ where: { id: "tenant-superadmin" }, include: { organizationMemberships: true } });
      expect(superadmin?.platformRole).toBe("SUPERADMIN");
      expect(superadmin?.organizationMemberships).toHaveLength(0);
      const clients = await db.client.findMany({ where: { id: { in: ["tenant-client-a", "tenant-client-b"] } }, select: { id: true, organizationId: true } });
      expect(new Set(clients.map((client) => client.organizationId))).toEqual(new Set(["org_test_a_0001", "org_test_b_0001"]));
    } finally {
      await db.$disconnect();
    }
  });
});
