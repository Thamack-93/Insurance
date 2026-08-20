import "dotenv/config";

import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { createDatabaseBackup, getBackupDownload, verifyStoredBackup } from "../src/lib/backup.ts";
import { decryptBackupPayload, parseBackupContainerHeader, parseBackupEncryptionKey } from "../src/lib/backup-logic.ts";
import { createOrganizationRestoreRun, finishOrganizationRestoreRun, getBackupArtifact, upsertBackupArtifact } from "../src/lib/backup-catalog.ts";
import { getDb } from "../src/lib/db.ts";
import { restoreOrganizationBackup } from "../src/lib/organization-backup-restore.ts";

function flag(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length).trim() ?? "";
}

function requireDirectUrl() {
  const value = process.env.DATABASE_URL_UNPOOLED?.trim();
  if (!value) throw new Error("DATABASE_URL_UNPOOLED es obligatorio para rollback productivo.");
  const url = new URL(value);
  if (/pooler/i.test(url.hostname)) throw new Error("El rollback productivo requiere conexión directa, no pooler.");
  return value;
}

function requireProductionGuard() {
  if (process.env.ALLOW_ORGANIZATION_PRODUCTION_ROLLBACK !== "1") throw new Error("ALLOW_ORGANIZATION_PRODUCTION_ROLLBACK=1 es obligatorio.");
  const actorUserId = process.env.ROLLBACK_ACTOR_USER_ID?.trim();
  const reason = process.env.ROLLBACK_REASON?.trim();
  if (!actorUserId || !reason || reason.length < 8) throw new Error("ROLLBACK_ACTOR_USER_ID y ROLLBACK_REASON (mínimo 8 caracteres) son obligatorios.");
  return { actorUserId, reason };
}

function confirmExact(organizationId: string, artifactId: string, sha256: string) {
  if (flag("confirm-organization") !== organizationId || flag("confirm-artifact") !== artifactId || flag("confirm-sha256").toLowerCase() !== sha256.toLowerCase()) {
    throw new Error("Confirma exactamente organizationId, artifactId y SHA-256 con --confirm-organization, --confirm-artifact y --confirm-sha256.");
  }
}

function keyFor(version: string) {
  const active = process.env.BACKUP_ENCRYPTION_KEY_VERSION?.trim();
  const variable = active === version ? process.env.BACKUP_ENCRYPTION_KEY : process.env[`BACKUP_ENCRYPTION_KEY_${version.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}`];
  if (!variable) throw new Error(`No existe una clave para ${version}.`);
  return parseBackupEncryptionKey(variable);
}

async function readPayload(artifact: NonNullable<Awaited<ReturnType<typeof getBackupArtifact>>>) {
  const verification = await verifyStoredBackup(artifact.filename, artifact.pathname);
  if (!verification.valid) throw new Error(`BACKUP_INVALID:${verification.reason}`);
  const download = await getBackupDownload(artifact.filename, artifact.pathname);
  if (download?.statusCode !== 200 || !download.stream) throw new Error("BACKUP_PAYLOAD_NOT_FOUND");
  const chunks: Buffer[] = [];
  const reader = download.stream.getReader();
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    chunks.push(Buffer.from(next.value));
  }
  const container = Buffer.concat(chunks);
  const header = parseBackupContainerHeader(container).header;
  return { verification, plaintext: decryptBackupPayload(container, keyFor(header.keyVersion)).plaintext };
}

async function targetFingerprint(value: string) {
  const url = new URL(value);
  return createHash("sha256").update(`${url.protocol}//${url.hostname}:${url.port || "default"}${url.pathname}`).digest("hex").slice(0, 16);
}

async function report(value: Record<string, unknown>) {
  const directory = path.join(process.cwd(), "artifacts", "restore-drills");
  await mkdir(directory, { recursive: true });
  const name = `${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}-rollback-organization.json`;
  const output = path.join(directory, name);
  await writeFile(output, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  return output;
}

async function setOrganizationStatus(databaseUrl: string, organizationId: string, status: string) {
  const pool = new Pool({ connectionString: databaseUrl, max: 1, application_name: "policydesk-organization-rollback" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`policydesk-organization-rollback:${organizationId}`]);
    const current = await client.query<{ status: string }>(`SELECT "status" FROM "Organization" WHERE "id" = $1 FOR UPDATE`, [organizationId]);
    if (!current.rows[0]) throw new Error("ORGANIZATION_NOT_FOUND");
    if (status === "RESTORING" && current.rows[0].status !== "ACTIVE") throw new Error(`ORGANIZATION_NOT_ACTIVE:${current.rows[0].status}`);
    if (status === "ACTIVE" && current.rows[0].status !== "RESTORING") throw new Error(`ORGANIZATION_NOT_RESTORING:${current.rows[0].status}`);
    await client.query(`UPDATE "Organization" SET "status" = $2, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $1`, [organizationId, status]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function main() {
  const command = process.argv[2] ?? "preview";
  const organizationId = flag("organization");
  const artifactId = flag("artifact");
  if (!organizationId || !artifactId) throw new Error("Uso: npm run rollback:organization -- preview|prepare|apply|resume|recover-emergency|reopen --organization=<id> --artifact=<artifactId>");
  const artifact = await getBackupArtifact(artifactId);
  if (!artifact || artifact.organizationId !== organizationId || !["ORGANIZATION", "LEGACY_SINGLETON"].includes(artifact.scope)) throw new Error("El artefacto no corresponde a la organización.");
  const { verification, plaintext } = await readPayload(artifact);
  const sha256 = verification.manifest.payload.sha256;

  if (command === "preview") {
    const output = await report({ status: "PREVIEW", organizationId, artifactId, artifactSha256: sha256, manifestSha256: verification.manifest.manifestSha256, capability: verification.manifest.capability ?? artifact.capability, rows: verification.manifest.totals.rows });
    console.log(output);
    return;
  }

  const databaseUrl = requireDirectUrl();
  const { actorUserId, reason } = requireProductionGuard();
  confirmExact(organizationId, artifactId, sha256);
  const fingerprint = await targetFingerprint(databaseUrl);
  if (command === "prepare") {
    const emergency = await createDatabaseBackup(new Date(), { emergency: true });
    const emergencyVerification = await verifyStoredBackup(emergency.filename, emergency.pathname);
    if (!emergencyVerification.valid) throw new Error("EMERGENCY_BACKUP_NOT_VERIFIED");
    const emergencyArtifact = await upsertBackupArtifact({ entry: emergency, scope: "PLATFORM", status: "VERIFIED", capability: "COMPLETE", manifest: emergency.manifest });
    const run = await createOrganizationRestoreRun({ organizationId, artifactId, emergencyBackupId: emergencyArtifact.id, actorUserId, reason, status: "PREPARED", stage: "prepared", targetFingerprint: fingerprint });
    try {
      await setOrganizationStatus(databaseUrl, organizationId, "RESTORING");
    } catch (error) {
      await finishOrganizationRestoreRun({ id: run.id, status: "FAIL", stage: "prepare", failureCode: "PREPARE_FAILED" }).catch(() => undefined);
      throw error;
    }
    console.log(JSON.stringify({ status: "PREPARED", runId: run.id, emergencyArtifactId: emergencyArtifact.id, artifactSha256: sha256 }, null, 2));
    return;
  }

  const db = getDb();
  const runId = flag("run");
  if (!runId) throw new Error("--run=<restoreRunId> es obligatorio.");
  const run = await db.organizationRestoreRun.findUnique({ where: { id: runId } });
  if (!run || run.organizationId !== organizationId || run.artifactId !== artifactId) throw new Error("El restoreRun no corresponde al artifact y organización.");
  if (command === "apply") {
    const temporaryReportPath = process.env.RESTORE_TEMP_REPORT?.trim();
    if (!temporaryReportPath) throw new Error("RESTORE_TEMP_REPORT con resultado PASS es obligatorio.");
    const temporaryReport = JSON.parse(await readFile(temporaryReportPath, "utf8")) as { status?: string; organizationId?: string; artifactSha256?: string };
    if (temporaryReport.status !== "PASS" || temporaryReport.organizationId !== organizationId || temporaryReport.artifactSha256 !== sha256) throw new Error("El reporte temporal PASS no coincide con el artefacto.");
    await db.organizationRestoreRun.update({ where: { id: run.id }, data: { status: "APPLYING", stage: "apply" } });
    try {
      const result = await restoreOrganizationBackup({ targetDatabaseUrl: databaseUrl, organizationId, plaintext, manifest: verification.manifest, mode: "replace", allowRestoring: true });
      await finishOrganizationRestoreRun({ id: run.id, status: "PASS", stage: "post-restore" });
      console.log(JSON.stringify({ status: "PASS", runId, result, next: "reopen" }, null, 2));
    } catch (error) {
      await finishOrganizationRestoreRun({ id: run.id, status: "FAIL", stage: "apply", failureCode: "ROLLBACK_FAILED" }).catch(() => undefined);
      throw error;
    }
    return;
  }
  if (command === "reopen" || command === "resume") {
    if (run.status !== "PASS" && command === "reopen") throw new Error("Solo se puede reabrir después de un restore PASS.");
    await setOrganizationStatus(databaseUrl, organizationId, "ACTIVE");
    console.log(JSON.stringify({ status: "ACTIVE", runId }, null, 2));
    return;
  }
  if (command === "recover-emergency") throw new Error("RECOVER_EMERGENCY_REQUIRES_A_SEPARATE_TEMPORARY_RESTORE_DRILL; no se ejecuta una restauración global implícita en producción.");
  throw new Error(`Comando no soportado: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "ORGANIZATION_ROLLBACK_FAILED");
  process.exitCode = 1;
});
