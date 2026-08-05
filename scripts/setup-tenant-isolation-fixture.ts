import { randomBytes, scryptSync } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const connectionString = process.env.DATABASE_URL?.trim();
if (process.env.TENANT_ISOLATION_TEST_DB !== "1" || process.env.PLAYWRIGHT_ENFORCE_DISPOSABLE_DB !== "1") {
  throw new Error("Tenant isolation fixture requires TENANT_ISOLATION_TEST_DB=1 and PLAYWRIGHT_ENFORCE_DISPOSABLE_DB=1.");
}
if (process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview") {
  throw new Error("Tenant isolation fixture refuses Vercel environments.");
}
if (!connectionString) throw new Error("DATABASE_URL is required.");
const target = new URL(connectionString);
if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(target.hostname.toLowerCase())) {
  throw new Error("Tenant isolation fixture requires a local disposable PostgreSQL host.");
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const hash = (password: string) => {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
};

async function removeSingletonGuards() {
  const triggers = await db.$queryRawUnsafe<Array<{ table_name: string; trigger_name: string }>>(`
    SELECT c.relname AS table_name, t.tgname AS trigger_name
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal
      AND (t.tgname LIKE '%_transition_%' OR t.tgname LIKE 'Organization_transition_%' OR t.tgname LIKE 'User_transition_%')
  `);
  for (const trigger of triggers) {
    await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trigger.trigger_name.replaceAll('"', '""')}" ON "${trigger.table_name.replaceAll('"', '""')}"`);
  }
  await db.$executeRawUnsafe(`DROP INDEX IF EXISTS "Organization_transition_singleton_idx"`);
  await db.$executeRawUnsafe(`DROP INDEX IF EXISTS "OrganizationMembership_transition_owner_idx"`);
}

async function main() {
  await removeSingletonGuards();
  const orgA = await db.organization.upsert({
    where: { id: "org_test_a_0001" },
    update: { name: "Tenant Fixture A", slug: "tenant-fixture-a", status: "ACTIVE" },
    create: { id: "org_test_a_0001", name: "Tenant Fixture A", slug: "tenant-fixture-a", status: "ACTIVE", timeZone: "Etc/GMT+6", defaultCurrency: "MXN" },
  });
  const orgB = await db.organization.upsert({
    where: { id: "org_test_b_0001" },
    update: { name: "Tenant Fixture B", slug: "tenant-fixture-b", status: "ACTIVE" },
    create: { id: "org_test_b_0001", name: "Tenant Fixture B", slug: "tenant-fixture-b", status: "ACTIVE", timeZone: "Etc/GMT+6", defaultCurrency: "MXN" },
  });
  const users = [
    { id: "tenant-admin-a", email: "tenant-admin-a@policydesk.local", name: "Tenant Admin A", role: "ADMIN", org: orgA.id, membershipRole: "ADMIN" },
    { id: "tenant-agent-a", email: "tenant-agent-a@policydesk.local", name: "Tenant Agent A", role: "AGENT", org: orgA.id, membershipRole: "AGENT" },
    { id: "tenant-admin-b", email: "tenant-admin-b@policydesk.local", name: "Tenant Admin B", role: "ADMIN", org: orgB.id, membershipRole: "ADMIN" },
    { id: "tenant-agent-b", email: "tenant-agent-b@policydesk.local", name: "Tenant Agent B", role: "AGENT", org: orgB.id, membershipRole: "AGENT" },
    { id: "tenant-dual-user", email: "tenant-dual@policydesk.local", name: "Tenant Dual User", role: "AGENT", org: orgA.id, membershipRole: "AGENT" },
    { id: "tenant-superadmin", email: "tenant-superadmin@policydesk.local", name: "Tenant Superadmin", role: "ADMIN", org: null, membershipRole: null },
  ] as const;
  for (const item of users) {
    await db.user.upsert({
      where: { id: item.id },
      update: { email: item.email, name: item.name, role: item.role, platformRole: item.id === "tenant-superadmin" ? "SUPERADMIN" : "NONE", active: true },
      create: { id: item.id, email: item.email, name: item.name, passwordHash: hash("tenant-fixture-password"), role: item.role, platformRole: item.id === "tenant-superadmin" ? "SUPERADMIN" : "NONE", active: true },
    });
    if (item.org && item.membershipRole) {
      await db.organizationMembership.upsert({
        where: { organizationId_userId: { organizationId: item.org, userId: item.id } },
        update: { role: item.membershipRole, active: true },
        create: { organizationId: item.org, userId: item.id, role: item.membershipRole, active: true },
      });
    }
  }
  await db.organizationMembership.upsert({
    where: { organizationId_userId: { organizationId: orgB.id, userId: "tenant-dual-user" } },
    update: { role: "AGENT", active: true },
    create: { organizationId: orgB.id, userId: "tenant-dual-user", role: "AGENT", active: true },
  });
  await db.organizationMembership.upsert({
    where: { organizationId_userId: { organizationId: orgA.id, userId: "tenant-admin-a" } },
    update: { role: "OWNER", active: true },
    create: { organizationId: orgA.id, userId: "tenant-admin-a", role: "OWNER", active: true },
  });
  for (const [orgId, suffix, ownerId] of [[orgA.id, "A", "tenant-agent-a"], [orgB.id, "B", "tenant-agent-b"]] as const) {
    const insurer = await db.insurer.upsert({ where: { id: `tenant-insurer-${suffix.toLowerCase()}` }, update: { organizationId: orgId, name: `Fixture Insurer ${suffix}`, status: "ACTIVE" }, create: { id: `tenant-insurer-${suffix.toLowerCase()}`, organizationId: orgId, name: `Fixture Insurer ${suffix}`, status: "ACTIVE" } });
    const client = await db.client.upsert({ where: { id: `tenant-client-${suffix.toLowerCase()}` }, update: { organizationId: orgId, fullName: "Overlap Client", portfolioOwnerId: ownerId, status: "ACTIVE" }, create: { id: `tenant-client-${suffix.toLowerCase()}`, organizationId: orgId, fullName: "Overlap Client", type: "PERSON", status: "ACTIVE", portfolioOwnerId: ownerId, createdById: ownerId, updatedById: ownerId } });
    await db.policy.upsert({ where: { id: `tenant-policy-${suffix.toLowerCase()}` }, update: { organizationId: orgId, clientId: client.id, insurerId: insurer.id, policyNumber: `OVERLAP-${suffix}`, status: "ACTIVE" }, create: { id: `tenant-policy-${suffix.toLowerCase()}`, organizationId: orgId, clientId: client.id, insurerId: insurer.id, policyNumber: `OVERLAP-${suffix}`, policyType: "AUTO", status: "ACTIVE", paymentFrequency: "ANNUAL", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), premiumAmount: 1000, currency: "MXN" } });
  }
  console.log(JSON.stringify({ ok: true, organizations: [orgA.id, orgB.id], users: users.map((user) => user.id) }));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "fixture failed"); process.exitCode = 1; }).finally(async () => { await db.$disconnect(); });
