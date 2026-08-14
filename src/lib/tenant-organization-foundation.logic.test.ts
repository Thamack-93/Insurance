import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BOOTSTRAP_ORGANIZATION_ID,
  EXPECTED_TENANT_TRIGGERS,
  OPTIONAL_ORGANIZATION_TABLES,
  PLATFORM_GLOBAL_TABLES,
  PROTECTED_TENANT_TABLES,
  SYSTEM_USER_ID,
} from "./tenant-organization-foundation";

describe("tenant organization transition foundation", () => {
  it("keeps the deterministic singleton inventory explicit", () => {
    expect(BOOTSTRAP_ORGANIZATION_ID).toBe("org_legacy_singleton_0001");
    expect(SYSTEM_USER_ID).toBe("system-user-0000");
    expect(PROTECTED_TENANT_TABLES.length).toBeGreaterThan(30);
    expect(Object.keys(EXPECTED_TENANT_TRIGGERS)).toHaveLength(PROTECTED_TENANT_TABLES.length);
    expect(OPTIONAL_ORGANIZATION_TABLES).toEqual(["SecurityEventAggregate"]);
    expect(PLATFORM_GLOBAL_TABLES).toEqual(expect.arrayContaining(["NotificationChannel", "TelegramWebhookUpdate"]));
  });

  it("ships normal, inspectable SQL guards", () => {
    const migration = fs.readFileSync(path.join(process.cwd(), "prisma/migrations/20260803000000_organization_transition/migration.sql"), "utf8");
    const additiveMigration = fs.readFileSync(path.join(process.cwd(), "prisma/migrations/20260813000000_nora_hybrid_agent/migration.sql"), "utf8");
    const allGuardSql = `${migration}\n${additiveMigration}`;
    expect(migration).toContain("org_legacy_singleton_0001");
    expect(migration).toContain("Organization_transition_singleton_idx");
    expect(migration).toContain("policydesk_assign_singleton_organization");
    expect(migration).not.toContain("session_replication_role");
    expect(allGuardSql).not.toMatch(/(?:ALTER|CREATE)\s+TRIGGER[^;]*ENABLE ALWAYS/i);
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
