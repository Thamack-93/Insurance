import "dotenv/config";

import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { decryptBackupPayload, parseBackupContainerHeader, parseBackupEncryptionKey } from "../src/lib/backup-logic.ts";
import { createOrganizationDatabaseBackup, getBackupDownload, verifyStoredBackup } from "../src/lib/backup.ts";
import { parseBackupRecords } from "../src/lib/backup-restore-validation.ts";
import { restoreOrganizationBackup } from "../src/lib/organization-backup-restore.ts";

function arg(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

function has(name: string) {
  return process.argv.includes(`--${name}`);
}

function directDatabaseUrl() {
  const value = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL_DIRECT_REQUIRED");
  const parsed = new URL(value);
  if (/pooler/i.test(parsed.hostname)) throw new Error("TENANT_IMPORT_REQUIRES_DIRECT_DATABASE");
  return value;
}

function encryptionKey(keyVersion: string) {
  const active = process.env.BACKUP_ENCRYPTION_KEY_VERSION?.trim();
  const name = active === keyVersion
    ? "BACKUP_ENCRYPTION_KEY"
    : `BACKUP_ENCRYPTION_KEY_${keyVersion.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}`;
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`BACKUP_KEY_MISSING:${keyVersion}`);
  return parseBackupEncryptionKey(value);
}

async function readCertificate(path: string | undefined, organizationId: string, manifest: { payload: { sha256: string }; manifestSha256: string }) {
  if (!path) throw new Error("TENANT_IMPORT_CERTIFICATE_REQUIRED");
  const parsed = JSON.parse(await readFile(path, "utf8")) as { payloadSha256?: string; manifestSha256?: string; organizationId?: string };
  if (parsed.organizationId !== organizationId || parsed.payloadSha256 !== manifest.payload.sha256 || parsed.manifestSha256 !== manifest.manifestSha256) {
    throw new Error("TENANT_IMPORT_CERTIFICATE_MISMATCH");
  }
  return parsed;
}

async function main() {
  const filename = arg("filename") ?? process.argv[2]?.trim();
  const mode = arg("mode") as "create" | "replace" | undefined;
  const organizationId = arg("organization-id");
  const reason = arg("reason")?.trim();
  const operator = arg("operator")?.trim();
  const dryRun = has("dry-run");
  const apply = has("apply");
  if (!filename || !mode || !organizationId || (!dryRun && !apply) || (dryRun && apply)) {
    throw new Error("Uso: npm run import:organization:production -- --filename <backup> --organization-id <id> --mode create|replace --reason <motivo> --operator <userId> --dry-run|--apply [--certificate <json>]");
  }
  if (!reason || reason.length < 8) throw new Error("TENANT_IMPORT_REASON_REQUIRED");
  if (!operator) throw new Error("TENANT_IMPORT_OPERATOR_REQUIRED");
  if (apply && process.env.ALLOW_TENANT_PRODUCTION_IMPORT !== "1") throw new Error("ALLOW_TENANT_PRODUCTION_IMPORT=1 es obligatorio para aplicar.");
  const verification = await verifyStoredBackup(filename);
  if (!verification.valid) throw new Error(`BACKUP_INVALID:${verification.reason}`);
  const manifest = verification.manifest;
  if (manifest.scope !== "ORGANIZATION" || manifest.version !== 2 || manifest.organization?.id !== organizationId) {
    throw new Error("TENANT_IMPORT_MANIFEST_MISMATCH");
  }
  if (manifest.capability === "DATABASE_ONLY") throw new Error("TENANT_IMPORT_REQUIRES_COMPLETE_PACKAGE");
  if (apply) await readCertificate(arg("certificate"), organizationId, manifest);
  const download = await getBackupDownload(filename, manifest.payload.pathname);
  if (download?.statusCode !== 200 || !download.stream) throw new Error("BACKUP_PAYLOAD_NOT_FOUND");
  const chunks: Buffer[] = [];
  const reader = download.stream.getReader();
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(Buffer.from(next.value));
  }
  const encrypted = Buffer.concat(chunks);
  const header = parseBackupContainerHeader(encrypted).header;
  const plaintext = decryptBackupPayload(encrypted, encryptionKey(header.keyVersion)).plaintext;
  const parsed = parseBackupRecords(plaintext);
  const users = (parsed.rows.get("public.User") ?? []).map((row) => row.data);
  const memberships = (parsed.rows.get("public.OrganizationMembership") ?? []).map((row) => row.data);
  const pool = new Pool({ connectionString: directDatabaseUrl(), max: 1, application_name: "policydesk-organization-import" });
  const client = await pool.connect();
  try {
    const target = await client.query<{ id: string; slug: string; status: string }>(`SELECT "id", "slug", "status" FROM "Organization" WHERE "id" = $1 OR "slug" = $2`, [organizationId, (parsed.rows.get("public.Organization")?.[0]?.data.slug as string | undefined) ?? ""]);
    if (mode === "create" && target.rows.length > 0) throw new Error("TENANT_IMPORT_ORGANIZATION_OR_SLUG_EXISTS");
    if (mode === "replace" && (!target.rows.some((row) => row.id === organizationId) || target.rows.find((row) => row.id === organizationId)?.status !== "SUSPENDED")) throw new Error("TENANT_IMPORT_REPLACE_REQUIRES_SUSPENDED_ORGANIZATION");
    const emails = users.map((user) => String(user.email).toLowerCase());
    if (emails.length > 0) {
      const conflicts = await client.query<{ email: string; organizationId: string | null }>(`SELECT lower(u."email") AS email, m."organizationId" FROM "User" u LEFT JOIN "OrganizationMembership" m ON m."userId" = u."id" WHERE lower(u."email") = ANY($1::text[])`, [emails]);
      const outside = conflicts.rows.filter((row) => row.organizationId && row.organizationId !== organizationId);
      if (outside.length > 0) throw new Error(`TENANT_IMPORT_EMAIL_CONFLICT:${outside.length}`);
    }
    const actor = await client.query<{ id: string }>(`SELECT "id" FROM "User" WHERE "id" = $1 AND "platformRole" = 'SUPERADMIN' AND "active"`, [operator]);
    if (!actor.rows[0]) throw new Error("TENANT_IMPORT_OPERATOR_NOT_ACTIVE_SUPERADMIN");
  } finally {
    client.release();
    await pool.end();
  }

  if (dryRun) {
    console.log(JSON.stringify({ ok: true, mode, organizationId, filename, payloadSha256: manifest.payload.sha256, manifestSha256: manifest.manifestSha256, users: users.length, memberships: memberships.length, message: "Preflight únicamente; no se modificó la base." }, null, 2));
    return;
  }
  const safetyBackup = mode === "replace" ? await createOrganizationDatabaseBackup(organizationId) : null;
  const result = await restoreOrganizationBackup({ targetDatabaseUrl: directDatabaseUrl(), organizationId, plaintext, manifest, mode });
  const auditPool = new Pool({ connectionString: directDatabaseUrl(), max: 1, application_name: "policydesk-organization-import-audit" });
  const auditClient = await auditPool.connect();
  let auditRunId: string | null = null;
  try {
    const artifactId = `ba_${randomUUID().replaceAll("-", "")}`;
    const runId = `orr_${randomUUID().replaceAll("-", "")}`;
    auditRunId = runId;
    await auditClient.query("BEGIN");
    await auditClient.query(`INSERT INTO "BackupArtifact" ("id", "scope", "organizationId", "filename", "pathname", "size", "createdAt", "manifestAvailable", "formatVersion", "keyVersion", "payloadSha256", "manifestSha256", "status", "capability", "updatedAt") VALUES ($1, 'ORGANIZATION', $2, $3, $4, $5, $6, true, $7, $8, $9, $10, 'IMPORTED', $11, $6)`, [artifactId, organizationId, filename, manifest.payload.pathname, verification.size, new Date(manifest.createdAt), manifest.version, manifest.encryption.keyVersion, manifest.payload.sha256, manifest.manifestSha256, manifest.capability ?? "DATABASE_ONLY"]);
    await auditClient.query(`INSERT INTO "OrganizationRestoreRun" ("id", "organizationId", "artifactId", "actorUserId", "reason", "status", "stage", "targetFingerprint", "startedAt", "completedAt", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, 'PASS', 'complete', 'production', $6, $6, $6, $6)`, [runId, organizationId, artifactId, operator, reason, new Date()]);
    await auditClient.query("COMMIT");
  } catch (error) {
    await auditClient.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    auditClient.release();
    await auditPool.end();
  }
  console.log(JSON.stringify({ ok: true, mode, organizationId, filename, reason, operator, safetyBackup: safetyBackup?.filename ?? null, auditRunId, result }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "TENANT_IMPORT_FAILED");
  process.exitCode = 1;
});
