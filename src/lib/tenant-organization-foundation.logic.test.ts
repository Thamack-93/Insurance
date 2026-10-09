import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SINGLETON_CI_SKIPPED_MIGRATIONS } from "../../scripts/restore-certification-migrations.mjs";
import {
  BOOTSTRAP_ORGANIZATION_ID,
  CUTOVER_TRIGGER_REMOVAL_MIGRATION,
  EXPECTED_TENANT_TRIGGERS,
  OPTIONAL_ORGANIZATION_TABLES,
  PLATFORM_GLOBAL_TABLES,
  PROTECTED_TENANT_TABLES,
  SYSTEM_USER_ID,
  tenantTriggersForMigrationState,
} from "./tenant-organization-foundation";

describe("tenant organization transition foundation", () => {
  it("keeps the deterministic singleton inventory explicit", () => {
    expect(BOOTSTRAP_ORGANIZATION_ID).toBe("org_legacy_singleton_0001");
    expect(SYSTEM_USER_ID).toBe("system-user-0000");
    expect(PROTECTED_TENANT_TABLES.length).toBeGreaterThan(30);
    expect(Object.keys(EXPECTED_TENANT_TRIGGERS)).toHaveLength(PROTECTED_TENANT_TABLES.length);
    expect(tenantTriggersForMigrationState(false)).toHaveLength(PROTECTED_TENANT_TABLES.length);
    expect(tenantTriggersForMigrationState(true)).toHaveLength(PROTECTED_TENANT_TABLES.length - 3);
    const postCutoverTables = tenantTriggersForMigrationState(true).map(([table]) => table);
    expect(postCutoverTables).not.toContain("ClaimChecklistItem");
    expect(postCutoverTables).not.toContain("KnowledgeSource");
    expect(postCutoverTables).not.toContain("KnowledgeChunk");
    expect(OPTIONAL_ORGANIZATION_TABLES).toEqual(expect.arrayContaining([
      "SecurityEventAggregate",
      "BackupArtifact",
      "OrganizationRestoreRun",
      "OrganizationSubscription",
      "BillingCharge",
    ]));
    expect(PLATFORM_GLOBAL_TABLES).toEqual(expect.arrayContaining(["Plan", "NotificationChannel", "TelegramWebhookUpdate"]));
    expect(SINGLETON_CI_SKIPPED_MIGRATIONS.has(CUTOVER_TRIGGER_REMOVAL_MIGRATION)).toBe(true);
  });

  it("ships normal, inspectable SQL guards", () => {
    const migration = fs.readFileSync(path.join(process.cwd(), "prisma/migrations/20260803000000_organization_transition/migration.sql"), "utf8");
    const additiveMigration = fs.readFileSync(path.join(process.cwd(), "prisma/migrations/20260813000000_nora_hybrid_agent/migration.sql"), "utf8");
    const knowledgeMigration = fs.readFileSync(path.join(process.cwd(), "prisma/migrations/20260817000000_knowledge_base/migration.sql"), "utf8");
    const operationalMigration = fs.readFileSync(path.join(process.cwd(), "prisma/migrations/20260913000000_operational_followups_and_review_models/migration.sql"), "utf8");
    const optimizationMigration = fs.readFileSync(path.join(process.cwd(), "prisma/migrations/20260915000000_currency_rates_and_workitem_priority/migration.sql"), "utf8");
    const allGuardSql = `${migration}\n${additiveMigration}\n${knowledgeMigration}\n${operationalMigration}\n${optimizationMigration}`;
    expect(migration).toContain("org_legacy_singleton_0001");
    expect(migration).toContain("Organization_transition_singleton_idx");
    expect(migration).toContain("policydesk_assign_singleton_organization");
    expect(migration).not.toContain("session_replication_role");
    expect(allGuardSql).not.toMatch(/(?:ALTER|CREATE)\s+TRIGGER[^;]*ENABLE ALWAYS/i);
    const cutoverTriggerRemoval = fs.readFileSync(path.join(process.cwd(), "prisma/migrations/20261009010000_multi_org_drop_remaining_transition_triggers/migration.sql"), "utf8");
    expect(cutoverTriggerRemoval).toContain("POLICYDESK_TENANT_CUTOVER_REQUIRES_MAINTENANCE");
    expect(cutoverTriggerRemoval).toContain('WHERE "organizationId" IS NULL');
    expect(cutoverTriggerRemoval).toContain('DROP TRIGGER IF EXISTS "ClaimChecklistItem_transition_singleton_organization"');
    expect(migration).toContain("POLICYDESK_ORGANIZATION_IMMUTABLE");
    expect(migration).toContain("User_transition_membership_sync");
    expect(migration).toContain('CREATE INDEX "User_platformRole_idx"');
    expect(migration).not.toContain('NotificationChannel_transition_singleton_organization');
    expect(migration).not.toContain('SecurityEventAggregate_transition_singleton_organization');
    expect(migration).not.toContain('TelegramWebhookUpdate_transition_singleton_organization');
    for (const trigger of Object.values(EXPECTED_TENANT_TRIGGERS)) {
      expect(allGuardSql).toContain(`CREATE TRIGGER "${trigger}"`);
    }
  });

  it("fails closed before enforcing one membership per user", () => {
    const migration = fs.readFileSync(
      path.join(process.cwd(), "prisma/migrations/20260812000000_single_organization_membership/migration.sql"),
      "utf8",
    );
    expect(migration).toContain('GROUP BY "userId"');
    expect(migration).toContain("HAVING count(*) > 1");
    expect(migration).toContain("POLICYDESK_MULTIPLE_ORGANIZATION_MEMBERSHIPS");
    expect(migration).toContain('CREATE UNIQUE INDEX "OrganizationMembership_userId_key"');
    expect(migration).toContain('DROP INDEX IF EXISTS "OrganizationMembership_userId_idx"');
    expect(migration).not.toContain('DROP INDEX IF EXISTS "OrganizationMembership_organizationId_userId_key"');
  });
});
