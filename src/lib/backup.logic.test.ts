import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBackupManifest,
  decryptBackupPayload,
  encryptBackupPayload,
  parseBackupEncryptionKey,
  selectBackupRetention,
  verifyBackupManifest,
  TENANT_BACKUP_FORMAT_VERSION,
} from "@/lib/backup-logic";
import {
  formatBackupPreflightError,
  getBackupPreflightStatus,
  getBackupRekeyStatus,
} from "@/lib/backup";

const KEY = Buffer.from(
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
  "hex",
);
const IV = Buffer.from("101112131415161718191a1b", "hex");

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("backup encryption", () => {
  it("encrypts deterministically with a fixed IV and authenticates the payload", () => {
    const plaintext = Buffer.from('{"type":"backup"}\n{"type":"end"}\n');
    const first = encryptBackupPayload(plaintext, KEY, "v7", IV);
    const second = encryptBackupPayload(plaintext, KEY, "v7", IV);

    expect(first.equals(second)).toBe(true);
    const decrypted = decryptBackupPayload(first, KEY);
    expect(decrypted.header.keyVersion).toBe("v7");
    expect(decrypted.plaintext.equals(plaintext)).toBe(true);

    const tampered = Buffer.from(first);
    tampered[tampered.length - 20] ^= 1;
    expect(() => decryptBackupPayload(tampered, KEY)).toThrow();
  });

  it("accepts explicit hex and base64 256-bit keys", () => {
    expect(parseBackupEncryptionKey(`hex:${KEY.toString("hex")}`)).toEqual(KEY);
    expect(parseBackupEncryptionKey(`base64:${KEY.toString("base64")}`)).toEqual(KEY);
    expect(() => parseBackupEncryptionKey(Buffer.alloc(31).toString("base64"))).toThrow(
      "exactly 32 bytes",
    );
  });
});

describe("backup manifest", () => {
  it("hashes canonical content and detects changes", () => {
    const manifest = createBackupManifest({
      format: "policydesk-postgres-ndjson",
      version: 1,
      createdAt: "2026-07-04T10:00:00.000Z",
      completedAt: "2026-07-04T10:00:01.000Z",
      payload: {
        filename: "backup.ndjson.gz.enc",
        pathname: "database-backups/backup.ndjson.gz.enc",
        size: 123,
        sha256: "a".repeat(64),
      },
      encryption: {
        algorithm: "AES-256-GCM",
        keyVersion: "v1",
        iv: IV.toString("base64"),
        authTagBytes: 16,
      },
      compression: "gzip",
      tables: [{ schema: "public", name: "User", rowCount: 2 }],
      totals: { tables: 1, rows: 2 },
    });

    expect(verifyBackupManifest(manifest).valid).toBe(true);
    const changed = structuredClone(manifest);
    changed.totals.rows = 3;
    expect(verifyBackupManifest(changed)).toEqual({
      valid: false,
      reason: "El hash del manifiesto no coincide.",
    });
  });

  it("rejects an unknown capability before restore classification", () => {
    const manifest = createBackupManifest({
      format: "policydesk-postgres-ndjson",
      version: 1,
      capability: "NOT_A_CAPABILITY" as never,
      createdAt: "2026-07-04T10:00:00.000Z",
      completedAt: "2026-07-04T10:00:01.000Z",
      payload: { filename: "backup.ndjson.gz.enc", pathname: "database-backups/backup.ndjson.gz.enc", size: 1, sha256: "a".repeat(64) },
      encryption: { algorithm: "AES-256-GCM", keyVersion: "v1", iv: IV.toString("base64"), authTagBytes: 16 },
      compression: "gzip",
      tables: [{ schema: "public", name: "User", rowCount: 0 }],
      totals: { tables: 1, rows: 0 },
    });
    expect(verifyBackupManifest(manifest)).toMatchObject({ valid: false, reason: expect.stringContaining("capacidad") });
  });

  it("requires tenant attribution and dependencies for v2", () => {
    const manifest = createBackupManifest({
      format: "policydesk-postgres-ndjson",
      version: TENANT_BACKUP_FORMAT_VERSION as typeof TENANT_BACKUP_FORMAT_VERSION,
      scope: "ORGANIZATION",
      organization: { id: "org-pedro", name: "Pedro" },
      capability: "COMPLETE",
      dependencies: { userIds: ["usr-owner"] },
      schemaFingerprint: "c".repeat(64),
      createdAt: "2026-07-04T10:00:00.000Z",
      completedAt: "2026-07-04T10:00:01.000Z",
      payload: { filename: "tenant.ndjson.gz.enc", pathname: "organization-backups/org-pedro/tenant.ndjson.gz.enc", size: 1, sha256: "b".repeat(64) },
      encryption: { algorithm: "AES-256-GCM", keyVersion: "v1", iv: IV.toString("base64"), authTagBytes: 16 },
      compression: "gzip",
      tables: [{ schema: "public", name: "Client", rowCount: 1 }],
      totals: { tables: 1, rows: 1 },
    });
    expect(verifyBackupManifest(manifest)).toMatchObject({ valid: true });
    const invalid = structuredClone(manifest);
    delete invalid.dependencies;
    expect(verifyBackupManifest(invalid)).toMatchObject({ valid: false });
  });

  it("requires global plan dependencies when a tenant backup contains billing", () => {
    const input = {
      format: "policydesk-postgres-ndjson" as const,
      version: TENANT_BACKUP_FORMAT_VERSION as typeof TENANT_BACKUP_FORMAT_VERSION,
      scope: "ORGANIZATION" as const,
      organization: { id: "org-pedro", name: "Pedro" },
      capability: "COMPLETE" as const,
      schemaFingerprint: "c".repeat(64),
      createdAt: "2026-07-04T10:00:00.000Z",
      completedAt: "2026-07-04T10:00:01.000Z",
      payload: { filename: "tenant.ndjson.gz.enc", pathname: "organization-backups/org-pedro/tenant.ndjson.gz.enc", size: 1, sha256: "b".repeat(64) },
      encryption: { algorithm: "AES-256-GCM" as const, keyVersion: "v1", iv: IV.toString("base64"), authTagBytes: 16 as const },
      compression: "gzip" as const,
      tables: [{ schema: "public", name: "OrganizationSubscription", rowCount: 1 }],
      totals: { tables: 1, rows: 1 },
    };
    const missing = createBackupManifest({ ...input, dependencies: { userIds: ["usr-owner"] } });
    expect(verifyBackupManifest(missing)).toMatchObject({ valid: false, reason: expect.stringContaining("planes") });
    const valid = createBackupManifest({ ...input, dependencies: { userIds: ["usr-owner"], planIds: ["plan-pro"] } });
    expect(verifyBackupManifest(valid)).toMatchObject({ valid: true });
  });
});

describe("backup retention", () => {
  it("keeps four daily, two older weekly, and one older monthly snapshots", () => {
    const candidates = [
      ["d0-new", "2026-07-04T20:00:00.000Z"],
      ["d0-old", "2026-07-04T08:00:00.000Z"],
      ["d1", "2026-07-03T08:00:00.000Z"],
      ["d2", "2026-07-02T08:00:00.000Z"],
      ["d3", "2026-07-01T08:00:00.000Z"],
      ["w1-new", "2026-06-20T08:00:00.000Z"],
      ["w1-old", "2026-06-18T08:00:00.000Z"],
      ["w2", "2026-06-10T08:00:00.000Z"],
      ["m1-new", "2026-05-15T08:00:00.000Z"],
      ["m1-old", "2026-05-01T08:00:00.000Z"],
      ["expired", "2026-04-01T08:00:00.000Z"],
    ].map(([id, createdAt]) => ({ id, createdAt: new Date(createdAt) }));

    const selection = selectBackupRetention(candidates);
    expect(selection.keep.map((item) => item.id)).toEqual([
      "d0-new",
      "d1",
      "d2",
      "d3",
      "w1-new",
      "w2",
      "m1-new",
    ]);
    expect(selection.remove.map((item) => item.id)).toEqual([
      "d0-old",
      "w1-old",
      "m1-old",
      "expired",
    ]);
  });
});

describe("backup preflight", () => {
  it("reports missing secure configuration", () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("BACKUP_ENCRYPTION_KEY", "");
    vi.stubEnv("BACKUP_ENCRYPTION_KEY_VERSION", "");

    const status = getBackupPreflightStatus();

    expect(status.ready).toBe(false);
    expect(status.checks.every((check) => !check.ok)).toBe(true);
    expect(formatBackupPreflightError(status)).toContain("Vercel Blob");
    expect(formatBackupPreflightError(status)).toContain("Postgres");
  });

  it("accepts a valid backup configuration", () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "blob-token");
    vi.stubEnv("DATABASE_URL", "postgresql://localhost:5432/policydesk");
    vi.stubEnv("BACKUP_ENCRYPTION_KEY", `hex:${KEY.toString("hex")}`);
    vi.stubEnv("BACKUP_ENCRYPTION_KEY_VERSION", "v1");

    const status = getBackupPreflightStatus();

    expect(status.ready).toBe(true);
    expect(status.checks.every((check) => check.ok)).toBe(true);
  });
});

describe("backup key migration preflight", () => {
  it("requires an explicit enabled flag and a distinct versioned target key", () => {
    vi.stubEnv("BACKUP_ENCRYPTION_KEY_VERSION", "v1");
    vi.stubEnv("BACKUP_REKEY_ENABLED", "true");
    vi.stubEnv("BACKUP_REKEY_TARGET_KEY_VERSION", "v2");
    vi.stubEnv("BACKUP_ENCRYPTION_KEY_V2", `hex:${KEY.toString("hex")}`);

    expect(getBackupRekeyStatus()).toMatchObject({ ready: true, targetKeyVersion: "v2" });

    vi.stubEnv("BACKUP_REKEY_TARGET_KEY_VERSION", "v1");
    expect(getBackupRekeyStatus()).toMatchObject({ ready: false });
  });

  it("stays disabled unless explicitly enabled", () => {
    vi.stubEnv("BACKUP_REKEY_ENABLED", "false");
    expect(getBackupRekeyStatus()).toMatchObject({ ready: false });
  });
});
