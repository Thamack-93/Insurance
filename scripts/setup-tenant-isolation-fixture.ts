import { randomBytes, scryptSync } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { Prisma } from "../src/generated/prisma/client";
import { PrismaClient } from "../src/generated/prisma/client";
import { EXPECTED_TENANT_TRIGGERS } from "../src/lib/tenant-organization-foundation";
import { assertDisposableCertificationTarget } from "./tenant-certification-target.mjs";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required.");
const certificationTarget = assertDisposableCertificationTarget(connectionString);
const runId = certificationTarget.runId;
const expectedDatabase = certificationTarget.database;
const configuredFingerprint = certificationTarget.fingerprint;
const canonicalHost = certificationTarget.host;

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const hash = (password: string) => {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
};

const LEGACY_ORGANIZATION_ID = "org_legacy_singleton_0001";
const PEDRO_ORGANIZATION_ID = "org_pedro_gomez_0001";
const DEMO_ORGANIZATION_ID = "org_demo_broker_0001";
const PEDRO_USER_ID = "tenant-pedro-gomez";

async function validateMarker() {
  const marker = await db.$queryRaw<Array<{ run_id: string; database_name: string; host: string; fingerprint: string }>>`
    SELECT run_id, database_name, host, fingerprint
    FROM "__policydesk_tenant_isolation_run"
    WHERE run_id = ${runId}
    LIMIT 1
  `;
  const row = marker[0];
  if (!row || row.database_name !== expectedDatabase || row.host !== canonicalHost || row.fingerprint !== configuredFingerprint) {
    throw new Error("Tenant isolation fixture marker is missing or invalid.");
  }
}

const singletonGuards: Array<[string, string]> = [
  ...Object.entries(EXPECTED_TENANT_TRIGGERS),
  ["Organization", "Organization_transition_delete_guard"],
  ["Organization", "Organization_transition_truncate_guard"],
  ["OrganizationMembership", "OrganizationMembership_transition_guard"],
  ["User", "User_transition_membership_sync"],
  ["User", "User_transition_owner_delete_guard"],
];

async function removeSingletonGuards(tx: Prisma.TransactionClient) {
  for (const [table, trigger] of singletonGuards) {
    await tx.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trigger}" ON "${table}"`);
  }
  await tx.$executeRawUnsafe(`DROP INDEX IF EXISTS "Organization_transition_singleton_idx"`);
  await tx.$executeRawUnsafe(`DROP INDEX IF EXISTS "OrganizationMembership_transition_owner_idx"`);
}

async function main() {
  await validateMarker();
  await db.$transaction(async (tx) => {
    await removeSingletonGuards(tx);
    const orgA = await tx.organization.upsert({
      where: { id: LEGACY_ORGANIZATION_ID },
      update: { name: "PolicyDesk Legacy Organization", slug: "legacy-organization", kind: "LEGACY", status: "ACTIVE" },
      create: { id: LEGACY_ORGANIZATION_ID, name: "PolicyDesk Legacy Organization", slug: "legacy-organization", kind: "LEGACY", status: "ACTIVE", timeZone: "Etc/GMT+6", defaultCurrency: "MXN" },
    });
    const orgB = await tx.organization.upsert({
      where: { id: PEDRO_ORGANIZATION_ID },
      update: { name: "Pedro Alfredo Gómez Lorenzo", slug: "pedro-alfredo-gomez-lorenzo", kind: "CUSTOMER", status: "ACTIVE" },
      create: { id: PEDRO_ORGANIZATION_ID, name: "Pedro Alfredo Gómez Lorenzo", slug: "pedro-alfredo-gomez-lorenzo", kind: "CUSTOMER", status: "ACTIVE", timeZone: "Etc/GMT+6", defaultCurrency: "MXN" },
    });
    const orgDemo = await tx.organization.upsert({
      where: { id: DEMO_ORGANIZATION_ID },
      update: { name: "PolicyDesk Demo Broker", slug: "demo-broker", kind: "DEMO", status: "ACTIVE" },
      create: { id: DEMO_ORGANIZATION_ID, name: "PolicyDesk Demo Broker", slug: "demo-broker", kind: "DEMO", status: "ACTIVE", timeZone: "America/Mexico_City", defaultCurrency: "MXN" },
    });
    const organizations = await tx.organization.findMany({ select: { id: true }, orderBy: { id: "asc" } });
    if (organizations.length !== 3 || organizations.some(({ id }) => ![LEGACY_ORGANIZATION_ID, PEDRO_ORGANIZATION_ID, DEMO_ORGANIZATION_ID].includes(id))) {
      throw new Error("Tenant isolation fixture refuses unexpected organizations in the disposable database.");
    }
    const users = [
      { id: "tenant-admin-a", email: "tenant-admin-a@policydesk.local", name: "Tenant Admin A", role: "ADMIN", org: orgA.id, membershipRole: "ADMIN" },
      { id: "tenant-agent-a", email: "tenant-agent-a@policydesk.local", name: "Tenant Agent A", role: "AGENT", org: orgA.id, membershipRole: "AGENT" },
      { id: "tenant-admin-b", email: "tenant-admin-b@policydesk.local", name: "Tenant Admin B", role: "ADMIN", org: orgB.id, membershipRole: "ADMIN" },
      { id: "tenant-agent-b", email: "tenant-agent-b@policydesk.local", name: "Tenant Agent B", role: "AGENT", org: orgB.id, membershipRole: "AGENT" },
      { id: PEDRO_USER_ID, email: "pedroagl93@gmail.com", name: "Pedro Alfredo Gómez Lorenzo", role: "ADMIN", org: orgB.id, membershipRole: "OWNER" },
      { id: "tenant-demo-owner", email: "demo-owner@policydesk.local", name: "Demo Owner", role: "ADMIN", org: orgDemo.id, membershipRole: "OWNER" },
      { id: "tenant-demo-agent", email: "demo-agent@policydesk.local", name: "Demo Agent", role: "AGENT", org: orgDemo.id, membershipRole: "AGENT" },
      { id: "platform_admin_demo_0001", email: "admin@policydesk.local", name: "Admin Demo", role: "ADMIN", org: null, membershipRole: null },
    ] as const;
    for (const item of users) {
      await tx.user.upsert({
        where: { id: item.id },
        update: { email: item.email, name: item.name, role: item.role, platformRole: item.id === "platform_admin_demo_0001" ? "SUPERADMIN" : "NONE", active: true },
        create: { id: item.id, email: item.email, name: item.name, passwordHash: hash("tenant-fixture-password"), role: item.role, platformRole: item.id === "platform_admin_demo_0001" ? "SUPERADMIN" : "NONE", active: true },
      });
      if (item.org && item.membershipRole) {
        await tx.organizationMembership.upsert({
          where: { organizationId_userId: { organizationId: item.org, userId: item.id } },
          update: { role: item.membershipRole, active: true },
          create: { organizationId: item.org, userId: item.id, role: item.membershipRole, active: true },
        });
      }
    }
    await tx.organizationMembership.upsert({
      where: { organizationId_userId: { organizationId: orgA.id, userId: "tenant-admin-a" } },
      update: { role: "OWNER", active: true },
      create: { organizationId: orgA.id, userId: "tenant-admin-a", role: "OWNER", active: true },
    });
    for (const [orgId, suffix, ownerId] of [[orgA.id, "A", "tenant-agent-a"], [orgB.id, "B", "tenant-agent-b"], [orgDemo.id, "C", "tenant-demo-agent"]] as const) {
      const insurer = await tx.insurer.upsert({
        where: { id: `tenant-insurer-${suffix.toLowerCase()}` },
        update: { organizationId: orgId, name: `Fixture Insurer ${suffix}`, status: "ACTIVE" },
        create: { id: `tenant-insurer-${suffix.toLowerCase()}`, organizationId: orgId, name: `Fixture Insurer ${suffix}`, status: "ACTIVE" },
      });
      const client = await tx.client.upsert({
        where: { id: `tenant-client-${suffix.toLowerCase()}` },
        update: { organizationId: orgId, fullName: "Overlap Client", portfolioOwnerId: ownerId, status: "ACTIVE" },
        create: { id: `tenant-client-${suffix.toLowerCase()}`, organizationId: orgId, fullName: "Overlap Client", type: "PERSON", status: "ACTIVE", portfolioOwnerId: ownerId, createdById: ownerId, updatedById: ownerId },
      });
      const policy = await tx.policy.upsert({
        where: { id: `tenant-policy-${suffix.toLowerCase()}` },
        update: { organizationId: orgId, clientId: client.id, insurerId: insurer.id, policyNumber: `OVERLAP-${suffix}`, status: "ACTIVE" },
        create: { id: `tenant-policy-${suffix.toLowerCase()}`, organizationId: orgId, clientId: client.id, insurerId: insurer.id, policyNumber: `OVERLAP-${suffix}`, policyType: "AUTO", status: "ACTIVE", paymentFrequency: "ANNUAL", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), premiumAmount: 1000, currency: "MXN" },
      });
      await tx.receipt.upsert({
        where: { id: `tenant-receipt-${suffix.toLowerCase()}` },
        update: { organizationId: orgId, policyId: policy.id, clientId: client.id, insurerId: insurer.id, status: "PENDING", paidDate: null, paymentMethod: null },
        create: {
          id: `tenant-receipt-${suffix.toLowerCase()}`,
          organizationId: orgId,
          receiptNumber: "OVERLAP-RECEIPT",
          policyId: policy.id,
          clientId: client.id,
          insurerId: insurer.id,
          periodStartDate: new Date("2026-01-01"),
          periodEndDate: new Date("2026-12-31"),
          dueDate: new Date("2026-06-30"),
          amount: 1000,
          currency: "MXN",
          status: "PENDING",
          createdById: ownerId,
          updatedById: ownerId,
        },
      });
    }
    const pedroClient = await tx.client.upsert({
      where: { id: "tenant-client-pedro" },
      update: {
        organizationId: orgB.id,
        fullName: "Pedro Client Private",
        portfolioOwnerId: PEDRO_USER_ID,
        createdById: PEDRO_USER_ID,
        updatedById: PEDRO_USER_ID,
        status: "ACTIVE",
      },
      create: {
        id: "tenant-client-pedro",
        organizationId: orgB.id,
        fullName: "Pedro Client Private",
        type: "PERSON",
        status: "ACTIVE",
        portfolioOwnerId: PEDRO_USER_ID,
        createdById: PEDRO_USER_ID,
        updatedById: PEDRO_USER_ID,
      },
    });
    await tx.policy.upsert({
      where: { id: "tenant-policy-pedro" },
      update: {
        organizationId: orgB.id,
        clientId: pedroClient.id,
        insurerId: "tenant-insurer-b",
        policyNumber: "PEDRO-PRIVATE-001",
        status: "ACTIVE",
      },
      create: {
        id: "tenant-policy-pedro",
        organizationId: orgB.id,
        clientId: pedroClient.id,
        insurerId: "tenant-insurer-b",
        policyNumber: "PEDRO-PRIVATE-001",
        policyType: "AUTO",
        status: "ACTIVE",
        paymentFrequency: "ANNUAL",
        startDate: new Date("2026-01-01"),
        endDate: new Date("2026-12-31"),
        premiumAmount: 1500,
        currency: "MXN",
      },
    });
    console.log(JSON.stringify({ ok: true, organizations: [orgA.id, orgB.id, orgDemo.id], users: users.map((user) => user.id) }));
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "fixture failed");
  process.exitCode = 1;
}).finally(async () => {
  await db.$disconnect();
});
