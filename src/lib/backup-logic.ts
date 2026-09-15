import {
  createCipheriv,
  createDecipheriv,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

export const BACKUP_FORMAT = "policydesk-postgres-ndjson";
export const BACKUP_FORMAT_VERSION = 1;
export const TENANT_BACKUP_FORMAT_VERSION = 2;
export const BACKUP_ALGORITHM = "AES-256-GCM";
export const BACKUP_COMPRESSION = "gzip";
export const BACKUP_AUTH_TAG_BYTES = 16;
export const BACKUP_IV_BYTES = 12;

const CONTAINER_MAGIC = Buffer.from("PDBKUP01", "ascii");
const MAX_HEADER_BYTES = 16 * 1024;

export type BackupEncryptionHeader = {
  algorithm: typeof BACKUP_ALGORITHM;
  compression: typeof BACKUP_COMPRESSION;
  contentType: "application/x-ndjson";
  format: typeof BACKUP_FORMAT;
  iv: string;
  keyVersion: string;
  version: typeof BACKUP_FORMAT_VERSION;
};

export type BackupScope = "ORGANIZATION" | "LEGACY_SINGLETON" | "PLATFORM";
export type BackupCapability = "COMPLETE" | "DATABASE_ONLY";
export type RestoreRunStatus = "PREVIEW" | "PREPARED" | "APPLYING" | "PASS" | "FAIL" | "RESTORING";

export type BackupManifest = {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_FORMAT_VERSION | typeof TENANT_BACKUP_FORMAT_VERSION;
  scope?: BackupScope;
  organization?: {
    id: string;
    name?: string;
    slug?: string;
  };
  capability?: BackupCapability;
  dependencies?: {
    userIds: string[];
    planIds?: string[];
  };
  schemaFingerprint?: string;
  createdAt: string;
  completedAt: string;
  payload: {
    filename: string;
    pathname: string;
    size: number;
    sha256: string;
  };
  encryption: {
    algorithm: typeof BACKUP_ALGORITHM;
    keyVersion: string;
    iv: string;
    authTagBytes: typeof BACKUP_AUTH_TAG_BYTES;
  };
  compression: typeof BACKUP_COMPRESSION;
  tables: Array<{ schema: string; name: string; rowCount: number }>;
  totals: { tables: number; rows: number };
  demoExclusion?: {
    policy: "EXCLUDE_DEMO";
    organizationCount: number;
    protectedRowsExcluded: number;
  };
  manifestSha256: string;
};

export type BackupManifestInput = Omit<BackupManifest, "manifestSha256">;

export type OrganizationBackupManifestV2 = Omit<BackupManifest, "version" | "scope" | "organization" | "capability" | "dependencies"> & {
  version: typeof TENANT_BACKUP_FORMAT_VERSION;
  scope: "ORGANIZATION";
  organization: { id: string; name?: string; slug?: string };
  capability: BackupCapability;
  dependencies: { userIds: string[]; planIds: string[] };
};

export type RetentionCandidate = {
  id: string;
  createdAt: Date;
};

export type RetentionSelection<T extends RetentionCandidate> = {
  keep: T[];
  remove: T[];
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown) {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(value: string | Buffer | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function hashesMatch(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function assertValidKeyVersion(keyVersion: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(keyVersion)) {
    throw new Error(
      "BACKUP_ENCRYPTION_KEY_VERSION must use 1-64 letters, numbers, dots, underscores, or dashes.",
    );
  }
  return keyVersion;
}

function parseBase64Key(value: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    throw new Error("Invalid base64 backup encryption key.");
  }
  return Buffer.from(value, "base64");
}

export function parseBackupEncryptionKey(input: string) {
  const value = input.trim();
  let key: Buffer;
  if (value.startsWith("hex:")) {
    const encoded = value.slice(4);
    if (!/^[a-f0-9]{64}$/i.test(encoded)) throw new Error("Invalid hex backup encryption key.");
    key = Buffer.from(encoded, "hex");
  } else if (value.startsWith("base64:")) {
    key = parseBase64Key(value.slice(7));
  } else if (/^[a-f0-9]{64}$/i.test(value)) {
    key = Buffer.from(value, "hex");
  } else {
    key = parseBase64Key(value);
  }
  if (key.length !== 32) {
    throw new Error("BACKUP_ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }
  return key;
}

export function createBackupContainerHeader(keyVersion: string, iv: Buffer) {
  assertValidKeyVersion(keyVersion);
  if (iv.length !== BACKUP_IV_BYTES) {
    throw new Error(`Backup IV must be ${BACKUP_IV_BYTES} bytes.`);
  }

  const header: BackupEncryptionHeader = {
    algorithm: BACKUP_ALGORITHM,
    compression: BACKUP_COMPRESSION,
    contentType: "application/x-ndjson",
    format: BACKUP_FORMAT,
    iv: iv.toString("base64"),
    keyVersion,
    version: BACKUP_FORMAT_VERSION,
  };
  const headerBytes = Buffer.from(canonicalJson(header), "utf8");
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(headerBytes.length);
  const prefix = Buffer.concat([CONTAINER_MAGIC, length, headerBytes]);
  return { header, prefix, authenticatedData: prefix };
}

export function parseBackupContainerHeader(container: Buffer) {
  const minimumSize = CONTAINER_MAGIC.length + 4 + BACKUP_AUTH_TAG_BYTES;
  if (container.length < minimumSize) throw new Error("Backup container is truncated.");
  if (!container.subarray(0, CONTAINER_MAGIC.length).equals(CONTAINER_MAGIC)) {
    throw new Error("Backup container has an invalid signature.");
  }

  const headerLength = container.readUInt32BE(CONTAINER_MAGIC.length);
  if (headerLength <= 0 || headerLength > MAX_HEADER_BYTES) {
    throw new Error("Backup container header length is invalid.");
  }
  const payloadOffset = CONTAINER_MAGIC.length + 4 + headerLength;
  if (container.length < payloadOffset + BACKUP_AUTH_TAG_BYTES) {
    throw new Error("Backup container is truncated.");
  }

  const prefix = container.subarray(0, payloadOffset);
  const parsed = JSON.parse(
    container.subarray(CONTAINER_MAGIC.length + 4, payloadOffset).toString("utf8"),
  ) as Partial<BackupEncryptionHeader>;
  if (
    parsed.algorithm !== BACKUP_ALGORITHM ||
    parsed.compression !== BACKUP_COMPRESSION ||
    parsed.contentType !== "application/x-ndjson" ||
    parsed.format !== BACKUP_FORMAT ||
    parsed.version !== BACKUP_FORMAT_VERSION ||
    typeof parsed.iv !== "string" ||
    typeof parsed.keyVersion !== "string"
  ) {
    throw new Error("Backup container header is not supported.");
  }
  assertValidKeyVersion(parsed.keyVersion);
  const iv = Buffer.from(parsed.iv, "base64");
  if (iv.length !== BACKUP_IV_BYTES) throw new Error("Backup container IV is invalid.");

  return {
    header: parsed as BackupEncryptionHeader,
    authenticatedData: prefix,
    ciphertext: container.subarray(payloadOffset, -BACKUP_AUTH_TAG_BYTES),
    authTag: container.subarray(-BACKUP_AUTH_TAG_BYTES),
  };
}

export function encryptBackupPayload(
  plaintext: Buffer | Uint8Array | string,
  key: Buffer,
  keyVersion: string,
  iv: Buffer,
) {
  if (key.length !== 32) throw new Error("Backup encryption key must be 32 bytes.");
  const { prefix, authenticatedData } = createBackupContainerHeader(keyVersion, iv);
  const cipher = createCipheriv("aes-256-gcm", key, iv, {
    authTagLength: BACKUP_AUTH_TAG_BYTES,
  });
  cipher.setAAD(authenticatedData);
  const ciphertext = Buffer.concat([cipher.update(gzipSync(plaintext)), cipher.final()]);
  return Buffer.concat([prefix, ciphertext, cipher.getAuthTag()]);
}

export function decryptBackupPayload(container: Buffer, key: Buffer) {
  if (key.length !== 32) throw new Error("Backup encryption key must be 32 bytes.");
  const parsed = parseBackupContainerHeader(container);
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parsed.header.iv, "base64"), {
    authTagLength: BACKUP_AUTH_TAG_BYTES,
  });
  decipher.setAAD(parsed.authenticatedData);
  decipher.setAuthTag(parsed.authTag);
  const compressed = Buffer.concat([
    decipher.update(parsed.ciphertext),
    decipher.final(),
  ]);
  return { header: parsed.header, plaintext: gunzipSync(compressed) };
}

export function createBackupManifest(input: BackupManifestInput): BackupManifest {
  return { ...input, manifestSha256: sha256Hex(canonicalJson(input)) };
}

export function verifyBackupManifest(value: unknown):
  | { valid: true; manifest: BackupManifest }
  | { valid: false; reason: string } {
  if (!value || typeof value !== "object") {
    return { valid: false, reason: "El manifiesto no es un objeto JSON." };
  }
  const manifest = value as Partial<BackupManifest>;
  if (
    manifest.format !== BACKUP_FORMAT ||
    (manifest.version !== BACKUP_FORMAT_VERSION && manifest.version !== TENANT_BACKUP_FORMAT_VERSION) ||
    typeof manifest.createdAt !== "string" ||
    typeof manifest.completedAt !== "string" ||
    manifest.compression !== BACKUP_COMPRESSION ||
    !manifest.payload ||
    typeof manifest.payload.filename !== "string" ||
    typeof manifest.payload.pathname !== "string" ||
    !Number.isSafeInteger(manifest.payload.size) ||
    typeof manifest.payload.sha256 !== "string" ||
    !manifest.encryption ||
    manifest.encryption.algorithm !== BACKUP_ALGORITHM ||
    typeof manifest.encryption.keyVersion !== "string" ||
    typeof manifest.encryption.iv !== "string" ||
    manifest.encryption.authTagBytes !== BACKUP_AUTH_TAG_BYTES ||
    !Array.isArray(manifest.tables) ||
    !manifest.totals ||
    !Number.isSafeInteger(manifest.totals.tables) ||
    !Number.isSafeInteger(manifest.totals.rows) ||
    typeof manifest.manifestSha256 !== "string"
  ) {
    return { valid: false, reason: "El manifiesto no tiene el formato esperado." };
  }
  if (manifest.capability !== undefined && manifest.capability !== "COMPLETE" && manifest.capability !== "DATABASE_ONLY") {
    return { valid: false, reason: "La capacidad del backup no es válida." };
  }
  if (manifest.version === TENANT_BACKUP_FORMAT_VERSION) {
    if (manifest.scope !== "ORGANIZATION" || !manifest.organization?.id) {
      return { valid: false, reason: "El manifiesto tenant no identifica su organización." };
    }
    if (manifest.capability !== "COMPLETE" && manifest.capability !== "DATABASE_ONLY") {
      return { valid: false, reason: "La capacidad del backup tenant no es válida." };
    }
    if (!manifest.dependencies || !Array.isArray(manifest.dependencies.userIds)) {
      return { valid: false, reason: "El manifiesto tenant no contiene dependencias globales." };
    }
    const hasBillingSubscriptions = manifest.tables.some((table) => table.schema === "public" && table.name === "OrganizationSubscription");
    if (hasBillingSubscriptions && !Array.isArray(manifest.dependencies.planIds)) {
      return { valid: false, reason: "El manifiesto tenant con billing no contiene dependencias de planes." };
    }
    if (manifest.dependencies.planIds !== undefined && manifest.dependencies.planIds.some((id) => typeof id !== "string" || id.length === 0)) {
      return { valid: false, reason: "Las dependencias de planes del manifiesto tenant no son válidas." };
    }
    if (typeof manifest.schemaFingerprint !== "string" || !/^[a-f0-9]{64}$/i.test(manifest.schemaFingerprint)) {
      return { valid: false, reason: "El manifiesto tenant no contiene fingerprint de schema." };
    }
  }
  const { manifestSha256, ...unsigned } = manifest as BackupManifest;
  if (!hashesMatch(manifestSha256, sha256Hex(canonicalJson(unsigned)))) {
    return { valid: false, reason: "El hash del manifiesto no coincide." };
  }
  return { valid: true, manifest: manifest as BackupManifest };
}

function utcDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(date: Date) {
  return Date.parse(`${utcDay(date)}T00:00:00.000Z`);
}

function startOfIsoWeek(date: Date) {
  const start = new Date(startOfUtcDay(date));
  const day = start.getUTCDay() || 7;
  start.setUTCDate(start.getUTCDate() - day + 1);
  return start.getTime();
}

function isoWeek(date: Date) {
  return new Date(startOfIsoWeek(date)).toISOString().slice(0, 10);
}

function utcMonth(date: Date) {
  return date.toISOString().slice(0, 7);
}

export function selectBackupRetention<T extends RetentionCandidate>(items: T[]): RetentionSelection<T> {
  const sorted = [...items].sort((left, right) => {
    const byDate = right.createdAt.getTime() - left.createdAt.getTime();
    return byDate || left.id.localeCompare(right.id);
  });
  const keepIds = new Set<string>();

  function selectDistinct(candidates: T[], limit: number, bucket: (date: Date) => string) {
    const seen = new Set<string>();
    const selected: T[] = [];
    for (const item of candidates) {
      const key = bucket(item.createdAt);
      if (seen.has(key)) continue;
      seen.add(key);
      selected.push(item);
      keepIds.add(item.id);
      if (selected.length === limit) break;
    }
    return selected;
  }

  const daily = selectDistinct(sorted, 4, utcDay);
  const dailyBoundary = daily.length
    ? startOfUtcDay(daily[daily.length - 1].createdAt)
    : Number.POSITIVE_INFINITY;
  const weekly = selectDistinct(
    sorted.filter(
      (item) => !keepIds.has(item.id) && item.createdAt.getTime() < dailyBoundary,
    ),
    2,
    isoWeek,
  );
  const weeklyBoundary = weekly.length
    ? startOfIsoWeek(weekly[weekly.length - 1].createdAt)
    : dailyBoundary;
  selectDistinct(
    sorted.filter(
      (item) => !keepIds.has(item.id) && item.createdAt.getTime() < weeklyBoundary,
    ),
    1,
    utcMonth,
  );

  return {
    keep: sorted.filter((item) => keepIds.has(item.id)),
    remove: sorted.filter((item) => !keepIds.has(item.id)),
  };
}
