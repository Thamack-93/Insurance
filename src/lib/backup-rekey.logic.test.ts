import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const del = vi.hoisted(() => vi.fn());
const get = vi.hoisted(() => vi.fn());
const list = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());

vi.mock("@vercel/blob", () => ({ del, get, list, put }));

import {
  createBackupManifest,
  encryptBackupPayload,
} from "@/lib/backup-logic";
import { rekeyStoredBackup, verifyStoredBackup } from "@/lib/backup";

const SOURCE_KEY = Buffer.from(
  "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
  "hex",
);
const TARGET_KEY = Buffer.from(
  "f0e0d0c0b0a090807060504030201000112233445566778899aabbccddeeff00",
  "hex",
);
const SOURCE_FILENAME = "policydesk-20260701T010203000Z-0123456789ab-kv-v1.ndjson.gz.enc";
const SOURCE_PATHNAME = `database-backups/${SOURCE_FILENAME}`;

function response(content: Buffer) {
  return {
    statusCode: 200,
    stream: Readable.toWeb(Readable.from([content])) as ReadableStream<Uint8Array>,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("immutable backup rekey", () => {
  it("creates and verifies a separate copy without deleting or overwriting the source", async () => {
    const plaintext = Buffer.from('{"type":"backup"}\n{"type":"end"}\n');
    const sourceIv = Buffer.from("101112131415161718191a1b", "hex");
    const encryptedSource = encryptBackupPayload(plaintext, SOURCE_KEY, "v1", sourceIv);
    const sourceManifest = createBackupManifest({
      format: "policydesk-postgres-ndjson",
      version: 1,
      createdAt: "2026-07-01T01:02:03.000Z",
      completedAt: "2026-07-01T01:02:04.000Z",
      payload: {
        filename: SOURCE_FILENAME,
        pathname: SOURCE_PATHNAME,
        size: encryptedSource.length,
        sha256: createHash("sha256").update(encryptedSource).digest("hex"),
      },
      encryption: {
        algorithm: "AES-256-GCM",
        keyVersion: "v1",
        iv: sourceIv.toString("base64"),
        authTagBytes: 16,
      },
      compression: "gzip",
      tables: [],
      totals: { tables: 0, rows: 0 },
    });
    const stored = new Map<string, Buffer>([
      [SOURCE_PATHNAME, encryptedSource],
      [`${SOURCE_PATHNAME}.manifest.json`, Buffer.from(JSON.stringify(sourceManifest))],
    ]);
    get.mockImplementation(async (pathname: string) => {
      const content = stored.get(pathname);
      return content ? response(content) : { statusCode: 404 };
    });
    put.mockImplementation(async (pathname: string, content: Buffer | string) => {
      stored.set(pathname, Buffer.isBuffer(content) ? content : Buffer.from(content));
      return { pathname };
    });
    vi.stubEnv("BACKUP_ENCRYPTION_KEY", `hex:${SOURCE_KEY.toString("hex")}`);
    vi.stubEnv("BACKUP_ENCRYPTION_KEY_VERSION", "v1");
    vi.stubEnv("BACKUP_REKEY_ENABLED", "true");
    vi.stubEnv("BACKUP_REKEY_TARGET_KEY_VERSION", "v2");
    vi.stubEnv("BACKUP_ENCRYPTION_KEY_V2", `hex:${TARGET_KEY.toString("hex")}`);

    const copy = await rekeyStoredBackup(SOURCE_FILENAME, new Date("2026-07-22T12:00:00.000Z"));

    expect(copy.pathname).toMatch(/^database-backup-rekeys\//);
    expect(copy.manifest.encryption.keyVersion).toBe("v2");
    expect(copy.manifest.createdAt).toBe(sourceManifest.createdAt);
    expect(stored.get(SOURCE_PATHNAME)).toEqual(encryptedSource);
    expect(del).not.toHaveBeenCalled();
    expect(get.mock.calls.every(([, options]) => options?.access === "private" && options?.useCache === false)).toBe(true);
    await expect(verifyStoredBackup(copy.filename)).resolves.toMatchObject({ valid: true });
  });
});
