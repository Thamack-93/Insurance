import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BOOTSTRAP_ORGANIZATION_ID,
  EXPECTED_TENANT_TRIGGERS,
  PROTECTED_TENANT_TABLES,
  SYSTEM_USER_ID,
} from "./tenant-organization-foundation";

describe("tenant organization transition foundation", () => {
  it("keeps the deterministic singleton inventory explicit", () => {
    expect(BOOTSTRAP_ORGANIZATION_ID).toBe("org_legacy_singleton_0001");
    expect(SYSTEM_USER_ID).toBe("system-user-0000");
    expect(PROTECTED_TENANT_TABLES.length).toBeGreaterThan(30);
    expect(Object.keys(EXPECTED_TENANT_TRIGGERS)).toHaveLength(PROTECTED_TENANT_TABLES.length);
  });

  it("ships normal, inspectable SQL guards", () => {
    const migration = fs.readFileSync(path.join(process.cwd(), "prisma/migrations/20260803000000_organization_transition/migration.sql"), "utf8");
    expect(migration).toContain("org_legacy_singleton_0001");
    expect(migration).toContain("Organization_transition_singleton_idx");
    expect(migration).toContain("policydesk_assign_singleton_organization");
    expect(migration).not.toContain("session_replication_role");
    expect(migration).not.toMatch(/(?:ALTER|CREATE)\s+TRIGGER[^;]*ENABLE ALWAYS/i);
    expect(migration).toContain("POLICYDESK_ORGANIZATION_IMMUTABLE");
    expect(migration).toContain("User_transition_membership_sync");
  });
});
