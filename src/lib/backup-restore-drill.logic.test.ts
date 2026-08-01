import { describe, expect, it } from "vitest";
import { runBackupRestoreDrill } from "@/lib/backup-restore-drill";

const manifest = {
  format: "policydesk-postgres-ndjson",
  version: 1,
  createdAt: "2026-07-30T00:00:00.000Z",
  completedAt: "2026-07-30T00:01:00.000Z",
  payload: { filename: "fixture.ndjson.gz.enc", pathname: "fixture", size: 1, sha256: "a".repeat(64) },
  encryption: { algorithm: "AES-256-GCM", keyVersion: "v1", iv: "AA==", authTagBytes: 16 },
  compression: "gzip",
  tables: [],
  totals: { tables: 0, rows: 0 },
  manifestSha256: "b".repeat(64),
} as never;

const restored = {
  targetFingerprint: "target-fingerprint",
  tableCounts: { tables: {}, totalRows: 2, manifestTotalRows: 2, skippedRows: 0 },
  foreignKeys: [],
  domainChecks: [],
  sequences: [],
} as never;

function deps(overrides: Partial<Parameters<typeof runBackupRestoreDrill>[0]["dependencies"]> = {}) {
  const reports: unknown[] = [];
  return {
    reports,
    dependencies: {
      applyMigrations: async () => ({ ok: true }),
      restore: async () => restored,
      applicationReads: async () => ({ ok: true, checks: [{ name: "connection", ok: true }], counts: {} }),
      workItemAudit: async () => ({ status: "PASS" }),
      migrationDrift: async () => ({ ok: true }),
      writeReport: async (report: unknown) => {
        reports.push(report);
        return "report.json";
      },
      ...overrides,
    },
  };
}

describe("backup restore drill orchestration", () => {
  it("writes a PASS report only after integrity, reads, auditor and drift pass", async () => {
    const { dependencies, reports } = deps();
    let preflightCalled = false;
    dependencies.preflight = async () => {
      preflightCalled = true;
    };
    const report = await runBackupRestoreDrill({
      backupFilename: "fixture.ndjson.gz.enc",
      targetDatabaseUrl: "postgresql://target/db",
      manifest,
      appSmokeEnabled: false,
      dependencies,
    });
    expect(report.finalStatus).toBe("PASS");
    expect(preflightCalled).toBe(true);
    expect(report.totalRows).toBe(2);
    expect(report.restoreIntegrity).toBeTruthy();
    expect(report.applicationReads).toMatchObject({ ok: true });
    expect(report.playwrightSmoke).toMatchObject({ ok: true, skipped: true });
    expect(reports).toHaveLength(1);
  });

  it("classifies failed application reads and still writes a sanitized report", async () => {
    const { dependencies, reports } = deps({
      applicationReads: async () => ({ ok: false, checks: [{ name: "connection", ok: false, detail: "query_failed" }], counts: {} }),
    });
    const report = await runBackupRestoreDrill({
      backupFilename: "fixture.ndjson.gz.enc",
      targetDatabaseUrl: "postgresql://user:secret@target/db",
      manifest,
      appSmokeEnabled: false,
      dependencies,
    });
    expect(report.finalStatus).toBe("FAIL");
    expect(report.failureCode).toBe("APPLICATION_READ_FAILED");
    expect(report.sanitizedError).not.toContain("secret");
    expect(reports).toHaveLength(1);
  });

  it("does not report success when fixture cleanup fails", async () => {
    const { dependencies } = deps({
      appSmoke: async () => ({
        playwrightSmoke: { ok: true },
        fixtureLifecycle: { enabled: true, created: true, cleanupAttempted: true, cleanupVerified: false, ok: false },
      }),
    });
    const report = await runBackupRestoreDrill({
      backupFilename: "fixture.ndjson.gz.enc",
      targetDatabaseUrl: "postgresql://target/db",
      manifest,
      appSmokeEnabled: true,
      dependencies,
    });
    expect(report.finalStatus).toBe("FAIL");
    expect(report.failureCode).toBe("FIXTURE_CLEANUP_FAILED");
  });
});
