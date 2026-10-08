import { beforeEach, describe, expect, it, vi } from "vitest";
import { certificationFingerprint } from "../../scripts/tenant-certification-target.mjs";
import type { ParsedBackup } from "./backup-restore-validation";
import { PROTECTED_TENANT_TABLES } from "./tenant-organization-foundation";

const mocks = vi.hoisted(() => ({ query: vi.fn(), drift: vi.fn(), audit: vi.fn(), applicationCount: vi.fn() }));
vi.mock("pg", () => ({ Pool: class { query = mocks.query; connect = async () => ({ query: mocks.query, release: vi.fn() }); end = async () => undefined; } }));
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: class {} }));
vi.mock("@/generated/prisma/client", () => ({ PrismaClient: class {
  $disconnect = async () => undefined;
  $transaction = async (fn: (tx: unknown) => unknown) => fn({ $executeRaw: vi.fn(), ...Object.fromEntries(["client", "policy", "receipt", "payment", "workItem"].map(key => [key, { count: mocks.applicationCount, findMany: vi.fn() }])) });
} }));
vi.mock("@/lib/backup-restore", () => ({ checkTargetMigrationDrift: mocks.drift }));
vi.mock("../../scripts/check-multi-org-audit", () => ({ auditMultiOrganizationState: mocks.audit }));
import { assertRestoreCertificationConnections, certifyOrganizationRestore } from "./organization-restore-certification";

const sha = "a".repeat(40);
const sourceHost = "ep-source.c-7.us-east-1.aws.neon.tech";
const targetHost = "ep-target.c-7.us-east-1.aws.neon.tech";
const env = { NODE_ENV: "test" as const, VERCEL_ENV: "", TENANT_ISOLATION_TEST_DB: "1", PLAYWRIGHT_ENFORCE_DISPOSABLE_DB: "1", TENANT_ISOLATION_REMOTE_BRANCH: "1", TENANT_CERTIFICATION_REMOTE_BRANCH: "1", TENANT_CERTIFICATION_PURPOSE: "restore", TENANT_ISOLATION_RUN_ID: "run", TENANT_ISOLATION_DB_NAME: "neondb", CERTIFICATION_CANDIDATE_SHA: sha,
  TENANT_ISOLATION_BRANCH_ID: "br-source-test", TENANT_ISOLATION_BRANCH_NAME: `cert-stage3-${sha}`, TENANT_ISOLATION_NEON_HOST: sourceHost,
  TENANT_ISOLATION_FINGERPRINT: certificationFingerprint({ mode: "neon", runId: "run", database: "neondb", host: sourceHost, branchId: "br-source-test", branchName: `cert-stage3-${sha}` }),
  RESTORE_NEON_BRANCH_ID: "br-target-test", RESTORE_NEON_BRANCH: `restore-cert-stage3-${sha}`, RESTORE_NEON_HOST: targetHost,
  RESTORE_TARGET_FINGERPRINT: certificationFingerprint({ mode: "neon", runId: "run", database: "neondb", host: targetHost, branchId: "br-target-test", branchName: `restore-cert-stage3-${sha}` }),
};
const source = `postgresql://policydesk_app:fake@${sourceHost.replace(".", "-pooler.")}/neondb`;
const admin = `postgresql://owner:fake@${targetHost}/neondb`;
const runtime = `postgresql://policydesk_app:fake@${targetHost.replace(".", "-pooler.")}/neondb`;

describe("restore certification identity", () => {
  it("accepts independently identified SHA-bound source and target", () => { expect(assertRestoreCertificationConnections(source, admin, runtime, env).target.branchId).toBe("br-target-test"); });
  it("rejects privileged runtime, pooled admin, stale SHA and Preview", () => {
    expect(() => assertRestoreCertificationConnections(source, admin, runtime.replace("policydesk_app", "owner"), env)).toThrow("RESTORE_REQUIRES_POOLED_RESTRICTED_RUNTIME");
    expect(() => assertRestoreCertificationConnections(source, runtime, runtime, env)).toThrow("RESTORE_REQUIRES_DIRECT_ADMIN_CONNECTION");
    expect(() => assertRestoreCertificationConnections(source, admin, runtime, { ...env, CERTIFICATION_CANDIDATE_SHA: "b".repeat(40) })).toThrow("CANDIDATE_SHA_MISMATCH");
    expect(() => assertRestoreCertificationConnections(source, admin, runtime, { ...env, VERCEL_ENV: "preview" })).toThrow("REFUSES_VERCEL_ENVIRONMENT");
    expect(() => assertRestoreCertificationConnections(source, admin, runtime, { ...env, VERCEL_ENV: "production" })).toThrow("REFUSES_VERCEL_ENVIRONMENT");
    expect(() => assertRestoreCertificationConnections(source, admin, runtime, { ...env, RESTORE_NEON_BRANCH: "main" })).toThrow("BRANCH_NAME_INVALID");
  });
  it("rejects a source endpoint reused as destination", () => {
    const targetEnv = { ...env, RESTORE_NEON_HOST: sourceHost, RESTORE_TARGET_FINGERPRINT: certificationFingerprint({ mode: "neon", runId: "run", database: "neondb", host: sourceHost, branchId: env.RESTORE_NEON_BRANCH_ID, branchName: env.RESTORE_NEON_BRANCH }) };
    expect(() => assertRestoreCertificationConnections(source, admin.replace(targetHost, sourceHost), runtime.replace("ep-target", "ep-source"), targetEnv)).toThrow("RESTORE_TARGET_EQUALS_SOURCE");
  });
});

describe("restore post-commit certification", () => {
  const input = { adminUrl: admin, runtimeUrl: runtime, organizationId: "org-test", tables: ["Client", "Policy", "Receipt", "Payment", "WorkItem"].map(table => ({ table, rows: 0 })) };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.applicationCount.mockResolvedValue(0);
    mocks.audit.mockResolvedValue({ ok: true, issues: [], summary: {} });
    mocks.drift.mockResolvedValue({ ok: true });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("pg_roles")) return { rows: [{ current_user: "policydesk_app", rolsuper: false, rolbypassrls: false }] };
      if (sql.includes("pg_class")) return { rows: PROTECTED_TENANT_TABLES.map(relname => ({ relname, relrowsecurity: true, relforcerowsecurity: true })) };
      return { rows: [{ count: "0", foreign_count: "0" }] };
    });
  });
  it("returns evidence only after application reads, RLS, audit and drift", async () => { expect(await certifyOrganizationRestore(input)).toMatchObject({ isolation: "PASS", drift: { ok: true } }); expect(mocks.drift).toHaveBeenCalledWith(admin); });
  it("compares selected restored values to rows parsed from the decrypted backup", async () => {
    const make = (table: string, data: Record<string, unknown>) => ({ type: "row" as const, schema: "public", table, data });
    const parsedBackup = { rows: new Map([
      ["public.Policy", [make("Policy", { id: "tenant-recovery-policy-renewal", insuredObject: "Synthetic Recovery 2022 Serie SYNTHETIC-VIN-0001", riskDetails: { version: 1, policyType: "AUTO", sourceText: "retained source text", data: { vehicles: [{ make: "Synthetic", model: "Recovery", year: "2022", version: "", vin: "SYNTHETIC-VIN-0001", plates: "" }] } } })]],
      ["public.PolicyInsuredParty", [make("PolicyInsuredParty", { id: "tenant-recovery-insured-party", policyId: "tenant-recovery-policy-renewal", fullName: "Synthetic Recovery Named Insured", isPrimary: true, sourceLabel: "RECOVERY_FIXTURE" })]],
      ["public.PolicyInsuredAsset", [make("PolicyInsuredAsset", { id: "tenant-recovery-insured-asset", policyId: "tenant-recovery-policy-renewal", assetType: "VEHICLE", description: "Synthetic recovery vehicle 2022", serialNumber: "SYNTHETIC-VIN-0001", isPrimary: true })]],
    ]) } as ParsedBackup;
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("pg_roles")) return { rows: [{ current_user: "policydesk_app", rolsuper: false, rolbypassrls: false }] };
      if (sql.includes("pg_class")) return { rows: PROTECTED_TENANT_TABLES.map(relname => ({ relname, relrowsecurity: true, relforcerowsecurity: true })) };
      if (sql.includes('SELECT "id", "insuredObject"')) return { rows: [{ id: "tenant-recovery-policy-renewal", insuredObject: "Synthetic Recovery 2022 Serie SYNTHETIC-VIN-0001", riskDetails: { version: 1, policyType: "AUTO", sourceText: "retained source text", data: { vehicles: [{ make: "Synthetic", model: "Recovery", year: "2022", version: "", vin: "SYNTHETIC-VIN-0001", plates: "" }] } } }] };
      if (sql.includes('SELECT "id", "policyId", "fullName"')) return { rows: [{ id: "tenant-recovery-insured-party", policyId: "tenant-recovery-policy-renewal", fullName: "Synthetic Recovery Named Insured", isPrimary: true, sourceLabel: "RECOVERY_FIXTURE" }] };
      if (sql.includes('SELECT "id", "policyId", "assetType"')) return { rows: [{ id: "tenant-recovery-insured-asset", policyId: "tenant-recovery-policy-renewal", assetType: "VEHICLE", description: "Synthetic recovery vehicle 2022", serialNumber: "SYNTHETIC-VIN-0001", isPrimary: true }] };
      return { rows: [{ count: "0", foreign_count: "0" }] };
    });
    await expect(certifyOrganizationRestore({ ...input, parsedBackup })).resolves.toMatchObject({ isolation: "PASS" });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("pg_roles")) return { rows: [{ current_user: "policydesk_app", rolsuper: false, rolbypassrls: false }] };
      if (sql.includes("pg_class")) return { rows: PROTECTED_TENANT_TABLES.map(relname => ({ relname, relrowsecurity: true, relforcerowsecurity: true })) };
      if (sql.includes('SELECT "id", "insuredObject"')) return { rows: [{ id: "tenant-recovery-policy-renewal", insuredObject: "changed", riskDetails: { version: 1, policyType: "AUTO", sourceText: "retained source text", data: { vehicles: [{ make: "Synthetic", model: "Recovery", year: "2022", version: "", vin: "SYNTHETIC-VIN-0001", plates: "" }] } } }] };
      if (sql.includes('SELECT "id", "policyId", "fullName"')) return { rows: [{ id: "tenant-recovery-insured-party", policyId: "tenant-recovery-policy-renewal", fullName: "Synthetic Recovery Named Insured", isPrimary: true, sourceLabel: "RECOVERY_FIXTURE" }] };
      if (sql.includes('SELECT "id", "policyId", "assetType"')) return { rows: [{ id: "tenant-recovery-insured-asset", policyId: "tenant-recovery-policy-renewal", assetType: "VEHICLE", description: "Synthetic recovery vehicle 2022", serialNumber: "SYNTHETIC-VIN-0001", isPrimary: true }] };
      return { rows: [{ count: "0", foreign_count: "0" }] };
    });
    await expect(certifyOrganizationRestore({ ...input, parsedBackup })).rejects.toThrow("RESTORE_VALUE_PRESERVATION_FAILED:Policy:insuredObject");
  });
  it("rejects runtime count or application read mismatches", async () => {
    await expect(certifyOrganizationRestore({ ...input, tables: [{ table: "Client", rows: 1 }] })).rejects.toThrow("RESTORE_RUNTIME_COUNT");
    mocks.applicationCount.mockResolvedValue(1);
    await expect(certifyOrganizationRestore(input)).rejects.toThrow("RESTORE_APPLICATION_READ_MISMATCH");
  });
  it("rejects audit and drift failures without successful evidence", async () => {
    mocks.audit.mockResolvedValue({ ok: false });
    await expect(certifyOrganizationRestore(input)).rejects.toThrow("RESTORE_MULTI_ORG_AUDIT_FAILED");
    mocks.audit.mockResolvedValue({ ok: true }); mocks.drift.mockRejectedValue(new Error("PRISMA_DRIFT_FAILED"));
    await expect(certifyOrganizationRestore(input)).rejects.toThrow("PRISMA_DRIFT_FAILED");
  });
});
