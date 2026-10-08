import { randomBytes, scryptSync } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import type { Prisma } from "../src/generated/prisma/client";
import { PrismaClient } from "../src/generated/prisma/client";
import { EXPECTED_TENANT_TRIGGERS } from "../src/lib/tenant-organization-foundation";
import { DEMO_SEED_VERSION, seedDemoBaseline, validateDemoBaseline } from "../src/lib/demo-seed";
import { assertDisposableCertificationTarget, certificationPurpose } from "./tenant-certification-target.mjs";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required.");
const certificationTarget = assertDisposableCertificationTarget(connectionString, process.env, certificationPurpose());
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
const PLATFORM_USER_ID = "tenant-platform-admin";

async function seedCustomerRecoveryCases(tx: Prisma.TransactionClient, organizationId: string) {
  const actor = PEDRO_USER_ID;
  const common = { organizationId, clientId: "tenant-client-pedro", insurerId: "tenant-insurer-b", createdById: actor, updatedById: actor };
  for (const suffix of ["expired", "renewal", "cancelled"] as const) {
    const data = {
      ...common, policyNumber: `SYNTHETIC-RECOVERY-${suffix}`, policyType: "AUTO", paymentFrequency: "ANNUAL",
      ...(suffix === "renewal" ? { insuredObject: "Synthetic Recovery 2022 Serie SYNTHETIC-VIN-0001", riskDetails: { version: 1, policyType: "AUTO", sourceText: "Synthetic risk statement retained for restore certification.", data: { vehicles: [{ make: "Synthetic", model: "Recovery", year: "2022", version: "", vin: "SYNTHETIC-VIN-0001", plates: "" }] } } } : {}),
      status: suffix === "cancelled" ? "CANCELLED" as const : suffix === "expired" ? "EXPIRED" as const : "ACTIVE" as const,
      startDate: new Date(suffix === "expired" ? "2025-01-01" : "2026-01-01"), endDate: new Date(suffix === "expired" ? "2025-12-31" : "2026-12-31"),
      premiumAmount: 1000, currency: "MXN", renewedFromPolicyId: suffix === "renewal" ? "tenant-recovery-policy-expired" : null,
      cancelledAt: suffix === "cancelled" ? new Date("2026-02-01") : null, cancellationReason: suffix === "cancelled" ? "NON_PAYMENT" : null,
    };
    await tx.policy.upsert({ where: { id: `tenant-recovery-policy-${suffix}` }, update: data, create: { id: `tenant-recovery-policy-${suffix}`, ...data } });
  }
  const insuredParty = { organizationId, policyId: "tenant-recovery-policy-renewal", fullName: "Synthetic Recovery Named Insured", isPrimary: true, sourceLabel: "RECOVERY_FIXTURE" };
  await tx.policyInsuredParty.upsert({ where: { id: "tenant-recovery-insured-party" }, update: insuredParty, create: { id: "tenant-recovery-insured-party", ...insuredParty } });
  const insuredAsset = { organizationId, policyId: "tenant-recovery-policy-renewal", assetType: "VEHICLE", description: "Synthetic recovery vehicle 2022", serialNumber: "SYNTHETIC-VIN-0001", isPrimary: true };
  await tx.policyInsuredAsset.upsert({ where: { id: "tenant-recovery-insured-asset" }, update: insuredAsset, create: { id: "tenant-recovery-insured-asset", ...insuredAsset } });
  for (const suffix of ["posted", "reversed", "cancelled"] as const) {
    const receiptId = `tenant-recovery-receipt-${suffix}`;
    const policyId = suffix === "cancelled" ? "tenant-recovery-policy-cancelled" : "tenant-recovery-policy-renewal";
    const data = {
      ...common, policyId, receiptNumber: `SYNTHETIC-RECOVERY-${suffix}`, amount: 1000, currency: "MXN",
      periodStartDate: new Date("2026-01-01"), periodEndDate: new Date("2026-12-31"), dueDate: new Date("2026-01-31"),
      status: suffix === "posted" ? "PAID" as const : suffix === "cancelled" ? "CANCELLED" as const : "PENDING" as const,
      paidDate: suffix === "posted" ? new Date("2026-01-15") : null, paymentMethod: suffix === "posted" ? "TRANSFER" : null,
      cancelledAt: suffix === "cancelled" ? new Date("2026-02-01") : null, cancellationReason: suffix === "cancelled" ? "NON_PAYMENT" : null,
    };
    await tx.receipt.upsert({ where: { id: receiptId }, update: data, create: { id: receiptId, ...data } });
    if (suffix !== "cancelled") {
      const payment = { organizationId, receiptId, policyId, clientId: common.clientId, amount: 1000, currency: "MXN", paidDate: new Date("2026-01-15"), paymentMethod: "TRANSFER", createdById: actor, updatedById: actor,
        status: suffix === "posted" ? "POSTED" as const : "REVERSED" as const, reversedAt: suffix === "reversed" ? new Date("2026-01-16") : null, reversalReason: suffix === "reversed" ? "Synthetic drill reversal" : null, reversedById: suffix === "reversed" ? actor : null };
      await tx.payment.upsert({ where: { id: `tenant-recovery-payment-${suffix}` }, update: payment, create: { id: `tenant-recovery-payment-${suffix}`, ...payment } });
    }
  }
  const task = { ...common, policyId: "tenant-recovery-policy-renewal", folio: "SYNTHETIC-RECOVERY-LEGACY", title: "Synthetic legacy restore task" };
  await tx.task.upsert({ where: { id: "tenant-recovery-task-legacy" }, update: task, create: { id: "tenant-recovery-task-legacy", ...task } });
  for (const legacy of [false, true]) {
    const data = { ...common, policyId: "tenant-recovery-policy-renewal", title: "Synthetic restore WorkItem", entityType: "Policy", entityId: "tenant-recovery-policy-renewal", sourceType: legacy ? "Task" : null, sourceId: legacy ? "tenant-recovery-task-legacy" : null, assignedToId: actor };
    await tx.workItem.upsert({ where: { id: `tenant-recovery-workitem-${legacy ? "legacy" : "canonical"}` }, update: data, create: { id: `tenant-recovery-workitem-${legacy ? "legacy" : "canonical"}`, ...data } });
  }
  const notification = { organizationId, type: "SYNTHETIC_RECOVERY", title: "Synthetic restore notification", body: "Local-only fixture", userId: actor, workItemId: "tenant-recovery-workitem-canonical", clientId: common.clientId, policyId: "tenant-recovery-policy-renewal", channelType: "IN_APP", status: "SENT", sentAt: new Date("2026-01-15") };
  await tx.notificationEvent.upsert({ where: { id: "tenant-recovery-notification" }, update: notification, create: { id: "tenant-recovery-notification", ...notification } });
}

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
  // Membership transfers below can temporarily leave the inherited legacy
  // organization without an owner. Suspend the final multi-org invariant
  // during fixture replacement, then restore it before the transaction ends.
  await tx.$executeRawUnsafe('DROP TRIGGER IF EXISTS "policydesk_owner_membership_invariant" ON "OrganizationMembership"');
  await tx.$executeRawUnsafe('DROP TRIGGER IF EXISTS "policydesk_owner_user_invariant" ON "User"');
  await tx.$executeRawUnsafe(`DROP INDEX IF EXISTS "Organization_transition_singleton_idx"`);
  await tx.$executeRawUnsafe(`DROP INDEX IF EXISTS "OrganizationMembership_transition_owner_idx"`);
}

async function restoreOwnerInvariant(tx: Prisma.TransactionClient) {
  await tx.$executeRawUnsafe(`
    DO $$
    BEGIN
      IF to_regprocedure('policydesk_guard_owner_membership()') IS NOT NULL THEN
        CREATE TRIGGER policydesk_owner_membership_invariant
          AFTER INSERT OR UPDATE OR DELETE ON "OrganizationMembership"
          FOR EACH ROW EXECUTE FUNCTION policydesk_guard_owner_membership();
      END IF;
      IF to_regprocedure('policydesk_guard_owner_user()') IS NOT NULL THEN
        CREATE TRIGGER policydesk_owner_user_invariant
          AFTER INSERT OR UPDATE OF "active", "role", "platformRole" ON "User"
          FOR EACH ROW EXECUTE FUNCTION policydesk_guard_owner_user();
      END IF;
    END
    $$;
  `);
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
    // A certification branch is cloned from the live singleton, so existing
    // tenant rows may still reference its users through the new composite
    // foreign keys. Demote inherited owners instead of deleting memberships;
    // the fixture can then add its deterministic owner without leaving those
    // cloned references orphaned before the RLS migration validates them.
    await tx.organizationMembership.updateMany({ where: { organizationId: orgA.id, role: "OWNER" }, data: { role: "AGENT", active: true } });
    const inheritedUserReferences = [
      ["Client", "portfolioOwnerId"], ["WorkItem", "assignedToId"],
      ["Client", "createdById"], ["Client", "updatedById"],
      ["Policy", "createdById"], ["Policy", "updatedById"], ["Policy", "renewalStageById"],
      ["Receipt", "createdById"], ["Receipt", "updatedById"],
      ["PolicyEndorsement", "createdById"], ["PolicyEndorsement", "updatedById"],
      ["Payment", "createdById"], ["Payment", "updatedById"], ["Payment", "reversedById"],
      ["Task", "createdById"], ["Task", "updatedById"], ["WorkItem", "createdById"], ["WorkItem", "updatedById"],
      ["Claim", "createdById"], ["Claim", "updatedById"], ["Quote", "createdById"], ["Quote", "updatedById"],
      ["Document", "createdById"], ["Document", "updatedById"], ["KnowledgeSource", "createdById"],
      ["LedgerImportBatch", "createdById"], ["LedgerImportBatch", "approvedById"], ["LedgerImportAction", "performedById"],
      ["TelegramLinkToken", "userId"], ["TelegramDraft", "userId"], ["MaintenanceRun", "createdById"],
      ["DataQualitySuppressionRule", "createdById"], ["DataQualitySuppressionRule", "reviewedById"],
    ] as const;
    const inheritedUserIds = new Set<string>();
    for (const [table, column] of inheritedUserReferences) {
      const rows = await tx.$queryRawUnsafe<Array<{ userId: string | null }>>(
        `SELECT DISTINCT "${column}" AS "userId" FROM "${table}" WHERE "organizationId" = $1 AND "${column}" IS NOT NULL`,
        orgA.id,
      );
      for (const row of rows) if (row.userId) inheritedUserIds.add(row.userId);
    }
    for (const userId of inheritedUserIds) {
      await tx.organizationMembership.upsert({
        where: { organizationId_userId: { organizationId: orgA.id, userId } },
        update: { role: "AGENT", active: true },
        create: { organizationId: orgA.id, userId, role: "AGENT", active: true },
      });
    }
    const inheritedPlatformMembers = await tx.organizationMembership.findMany({
      where: { organizationId: orgA.id, user: { platformRole: "SUPERADMIN" } },
      select: { userId: true },
    });
    for (const { userId } of inheritedPlatformMembers) {
      await tx.user.update({ where: { id: userId }, data: { platformRole: "NONE", active: true } });
    }
    const organizations = await tx.organization.findMany({ select: { id: true }, orderBy: { id: "asc" } });
    if (organizations.length !== 3 || organizations.some(({ id }) => ![LEGACY_ORGANIZATION_ID, PEDRO_ORGANIZATION_ID, DEMO_ORGANIZATION_ID].includes(id))) {
      throw new Error("Tenant isolation fixture refuses unexpected organizations in the disposable database.");
    }
    const users = [
      { id: "tenant-admin-a", email: "tenant-admin-a@policydesk.local", name: "Tenant Admin A", role: "ADMIN", org: orgA.id, membershipRole: "OWNER" },
      { id: "tenant-agent-a", email: "tenant-agent-a@policydesk.local", name: "Tenant Agent A", role: "AGENT", org: orgA.id, membershipRole: "AGENT" },
      { id: "tenant-admin-b", email: "tenant-admin-b@policydesk.local", name: "Tenant Admin B", role: "ADMIN", org: orgB.id, membershipRole: "ADMIN" },
      { id: "tenant-agent-b", email: "tenant-agent-b@policydesk.local", name: "Tenant Agent B", role: "AGENT", org: orgB.id, membershipRole: "AGENT" },
      { id: PEDRO_USER_ID, email: "tenant-owner-b@policydesk.local", name: "Tenant Owner B", role: "ADMIN", org: orgB.id, membershipRole: "OWNER" },
      { id: "tenant-demo-owner", email: "demo-owner@policydesk.local", name: "Demo Owner", role: "ADMIN", org: orgDemo.id, membershipRole: "OWNER" },
      { id: "tenant-demo-agent", email: "demo-agent@policydesk.local", name: "Demo Agent", role: "AGENT", org: orgDemo.id, membershipRole: "AGENT" },
      { id: PLATFORM_USER_ID, email: "tenant-platform-admin@policydesk.local", name: "Tenant Platform Admin", role: "ADMIN", org: null, membershipRole: null },
    ] as const;
    // The organization transition trigger validates the owner invariant on
    // every membership write. Seed owners first so a fresh certification
    // database never observes a transient organization without one.
    for (const item of [...users].sort((left, right) => Number(right.membershipRole === "OWNER") - Number(left.membershipRole === "OWNER"))) {
      await tx.user.upsert({
        where: { id: item.id },
        // Refresh the deterministic credential on every certification run so
        // a production clone with pre-existing fixture IDs cannot leave the
        // browser suite with stale passwords.
        update: { email: item.email, name: item.name, passwordHash: hash("tenant-fixture-password"), role: item.role, platformRole: item.id === PLATFORM_USER_ID ? "SUPERADMIN" : "NONE", active: true },
        create: { id: item.id, email: item.email, name: item.name, passwordHash: hash("tenant-fixture-password"), role: item.role, platformRole: item.id === PLATFORM_USER_ID ? "SUPERADMIN" : "NONE", active: true },
      });
      if (item.org && item.membershipRole) {
        await tx.organizationMembership.upsert({
          where: { organizationId_userId: { organizationId: item.org, userId: item.id } },
          update: { role: item.membershipRole, active: true },
          create: { organizationId: item.org, userId: item.id, role: item.membershipRole, active: true },
        });
      }
    }
    const activeLegacyOwners = await tx.organizationMembership.count({
      where: { organizationId: orgA.id, role: "OWNER", active: true, user: { active: true } },
    });
    if (activeLegacyOwners > 1) throw new Error("Tenant isolation fixture refuses multiple active legacy owners.");
    if (activeLegacyOwners === 0) {
      await tx.organizationMembership.upsert({
        where: { organizationId_userId: { organizationId: orgA.id, userId: "tenant-admin-a" } },
        update: { role: "OWNER", active: true },
        create: { organizationId: orgA.id, userId: "tenant-admin-a", role: "OWNER", active: true },
      });
    }
    // The DEMO organization gets only the versioned demo baseline below. A
    // generic overlap row here would skew its exact seed counts and make the
    // deterministic fixture fail before RLS certification begins.
    for (const [orgId, suffix, ownerId] of [[orgA.id, "A", "tenant-agent-a"], [orgB.id, "B", "tenant-agent-b"]] as const) {
      // Reruns on an already cutover branch must satisfy the same tenant
      // context that the application uses under forced RLS.
      await tx.$executeRaw`SELECT set_config('app.organization_id', ${orgId}, true)`;
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
    await tx.$executeRaw`SELECT set_config('app.organization_id', ${orgB.id}, true)`;
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
    await seedCustomerRecoveryCases(tx, orgB.id);
    await tx.$executeRaw`SELECT set_config('app.organization_id', ${orgDemo.id}, true)`;
    await tx.demoOrganizationState.upsert({
      where: { organizationId: orgDemo.id },
      update: { seedVersion: DEMO_SEED_VERSION, trialEndsAt: new Date("2099-01-01T00:00:00.000Z") },
      create: { organizationId: orgDemo.id, seedVersion: DEMO_SEED_VERSION, trialEndsAt: new Date("2099-01-01T00:00:00.000Z") },
    });
    for (const key of ["NORA", "IMPORTS", "EXPORTS", "DOCUMENTS", "EMAIL", "TELEGRAM", "WHATSAPP", "QUALITAS"]) {
      const enabled = ["EXPORTS", "DOCUMENTS"].includes(key);
      await tx.organizationCapability.upsert({
        where: { organizationId_key: { organizationId: orgDemo.id, key } },
        update: { enabled, limitValue: null, source: "DEMO_DEFAULT" },
        create: { organizationId: orgDemo.id, key, enabled, limitValue: null, source: "DEMO_DEFAULT" },
      });
    }
    await seedDemoBaseline(tx, orgDemo.id, "tenant-demo-owner");
    const demoSeedCounts = await validateDemoBaseline(tx, orgDemo.id);
    await restoreOwnerInvariant(tx);
    console.log(JSON.stringify({ ok: true, organizations: [orgA.id, orgB.id, orgDemo.id], users: users.map((user) => user.id), demoSeedCounts }));
  }, { maxWait: 20_000, timeout: 120_000 });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "fixture failed");
  process.exitCode = 1;
}).finally(async () => {
  await db.$disconnect();
});
