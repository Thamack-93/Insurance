import { describe, expect, it } from "vitest";
import type { BackupManifest } from "@/lib/backup-logic";
import { assertRestorableGlobalBackup } from "@/lib/backup-restore-preflight";

const manifest = {
  format: "policydesk-postgres-ndjson",
  version: 1,
  scope: "PLATFORM",
  createdAt: "2026-09-12T12:00:00.000Z",
  completedAt: "2026-09-12T12:01:00.000Z",
  payload: { filename: "global.ndjson.gz.enc", pathname: "database-backups/global.ndjson.gz.enc", size: 1, sha256: "a".repeat(64) },
  encryption: { algorithm: "AES-256-GCM", keyVersion: "v1", iv: "AA==", authTagBytes: 16 },
  compression: "gzip",
  tables: [],
  totals: { tables: 0, rows: 0 },
  demoExclusion: { policy: "EXCLUDE_DEMO", organizationCount: 1, protectedRowsExcluded: 2 },
  manifestSha256: "b".repeat(64),
} as unknown as BackupManifest;

const catalogEntry = {
  status: "VERIFIED",
  scope: "PLATFORM",
  organizationId: null,
  pathname: manifest.payload.pathname,
};

describe("global restore preflight", () => {
  it("accepts a recent cataloged global backup with demo exclusion", () => {
    expect(assertRestorableGlobalBackup({
      manifest,
      catalogEntry,
      now: new Date("2026-09-14T12:00:00.000Z"),
    })).toMatchObject({ ok: true, ageMs: 172800000 });
  });

  it("rejects non-verified, tenant, stale and non-excluding backups", () => {
    expect(() => assertRestorableGlobalBackup({ manifest, catalogEntry: null })).toThrow(/catalogado/);
    expect(() => assertRestorableGlobalBackup({ manifest, catalogEntry: { ...catalogEntry, status: "BLOCKED" } })).toThrow(/VERIFIED/);
    expect(() => assertRestorableGlobalBackup({ manifest, catalogEntry: { ...catalogEntry, scope: "ORGANIZATION" } })).toThrow(/global/);
    expect(() => assertRestorableGlobalBackup({ manifest, catalogEntry, now: new Date("2026-09-21T12:00:01.000Z") })).toThrow(/siete días/);
    expect(() => assertRestorableGlobalBackup({ manifest: { ...manifest, demoExclusion: undefined }, catalogEntry })).toThrow(/EXCLUDE_DEMO/);
  });

  it("accepts a legacy format-1 global manifest without an explicit scope", () => {
    const legacyManifest = { ...manifest };
    delete legacyManifest.scope;
    expect(assertRestorableGlobalBackup({
      manifest: legacyManifest,
      catalogEntry,
      now: new Date("2026-09-14T12:00:00.000Z"),
    })).toMatchObject({ ok: true });
  });

  it("still rejects a missing scope on a non-format-1 manifest", () => {
    const missingScope = { ...manifest };
    delete missingScope.scope;
    expect(() => assertRestorableGlobalBackup({
      manifest: { ...missingScope, version: 2 } as unknown as BackupManifest,
      catalogEntry,
    })).toThrow(/scope PLATFORM/);
  });
});
