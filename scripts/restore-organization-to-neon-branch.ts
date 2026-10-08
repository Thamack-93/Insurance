import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getBackupDownload, verifyStoredBackup } from "../src/lib/backup.ts";
import { decryptBackupPayload, parseBackupContainerHeader, parseBackupEncryptionKey } from "../src/lib/backup-logic.ts";
import { createOrganizationRestoreRun, finishOrganizationRestoreRun, getBackupArtifact } from "../src/lib/backup-catalog.ts";
import { applyCurrentMigrations, checkRestoreTargetConnection } from "../src/lib/backup-restore.ts";
import { assertTemporaryNeonRestoreTarget } from "../src/lib/backup-restore-guards.ts";
import { restoreOrganizationBackup } from "../src/lib/organization-backup-restore.ts";
import { parseBackupRecords } from "../src/lib/backup-restore-validation.ts";
import { assertRestoreCertificationConnections, certifyOrganizationRestore, verifyRestoreMarker } from "../src/lib/organization-restore-certification.ts";

async function readStream(stream: ReadableStream<Uint8Array>) {
  const chunks: Buffer[] = [];
  const reader = stream.getReader();
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      chunks.push(Buffer.from(next.value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

function argument(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length).trim() ?? "";
}

function encryptionKey(keyVersion: string) {
  const activeVersion = process.env.BACKUP_ENCRYPTION_KEY_VERSION?.trim();
  const versionedName = `BACKUP_ENCRYPTION_KEY_${keyVersion.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}`;
  const value = activeVersion === keyVersion ? process.env.BACKUP_ENCRYPTION_KEY : process.env[versionedName];
  if (!value?.trim()) throw new Error(`No existe una clave para la versión ${keyVersion}.`);
  return parseBackupEncryptionKey(value);
}

function fingerprint(value: string) {
  const url = new URL(value);
  return createHash("sha256").update(`${url.protocol}//${url.hostname}:${url.port || "default"}${url.pathname}`).digest("hex").slice(0, 16);
}

async function writeReport(report: Record<string, unknown>) {
  const directory = path.join(process.cwd(), "artifacts", "restore-drills");
  await mkdir(directory, { recursive: true });
  const filename = `${new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14)}-organization-restore.json`;
  const reportPath = path.join(directory, filename);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return reportPath;
}

async function writeCertificate(reportPath: string, certificate: Record<string, unknown>) {
  const certificatePath = reportPath.replace(/\.json$/, ".certificate.json");
  await writeFile(certificatePath, `${JSON.stringify(certificate, null, 2)}\n`, { mode: 0o600 });
  return certificatePath;
}

async function main() {
  const organizationId = argument("organization");
  const artifactId = argument("artifact");
  const apply = process.argv.includes("--apply");
  if (!organizationId || !artifactId) {
    throw new Error("Uso: npm run restore:organization:temp-neon -- --organization=<id> --artifact=<artifactId> [--apply]");
  }
  const actorUserId = process.env.RESTORE_ACTOR_USER_ID?.trim();
  const reason = process.env.RESTORE_REASON?.trim();
  if (!actorUserId || !reason || reason.length < 8) throw new Error("RESTORE_ACTOR_USER_ID y RESTORE_REASON (mínimo 8 caracteres) son obligatorios.");

  const target = assertTemporaryNeonRestoreTarget({
    sourceDatabaseUrl: process.env.DATABASE_URL,
    targetDatabaseUrl: process.env.RESTORE_DATABASE_URL,
    branchName: process.env.RESTORE_NEON_BRANCH,
    allowRestore: process.env.ALLOW_TEMPORARY_NEON_RESTORE,
    forbiddenDatabaseUrls: [process.env.DATABASE_ADMIN_URL, process.env.DIRECT_URL, process.env.DATABASE_URL_DIRECT, process.env.DATABASE_URL_POOLER, process.env.POOLER_URL, process.env.PRISMA_DIRECT_URL],
  });
  const candidateSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  if (candidateSha !== process.env.CERTIFICATION_CANDIDATE_SHA) throw new Error("RESTORE_CANDIDATE_SHA_MISMATCH");
  const runtimeUrl = process.env.RESTORE_RUNTIME_DATABASE_URL?.trim();
  if (!runtimeUrl) throw new Error("RESTORE_RUNTIME_DATABASE_URL_REQUIRED");
  const identities = assertRestoreCertificationConnections(target.source.toString(), target.target.toString(), runtimeUrl);
  await verifyRestoreMarker(process.env.DATABASE_ADMIN_URL ?? "", identities.source);
  await verifyRestoreMarker(target.target.toString(), identities.target);
  const artifact = await getBackupArtifact(artifactId);
  if (!artifact) throw new Error("No existe el artifactId solicitado.");
  if (artifact.status !== "VERIFIED") throw new Error("Solo puede restaurarse un artefacto VERIFIED.");
  if (artifact.organizationId !== organizationId || !["ORGANIZATION", "LEGACY_SINGLETON"].includes(artifact.scope)) {
    throw new Error("El artefacto no está atribuido a la organización solicitada.");
  }
  const run = await createOrganizationRestoreRun({
    organizationId,
    artifactId,
    actorUserId,
    reason,
    status: apply ? "APPLYING" : "PREVIEW",
    stage: "preflight",
    targetFingerprint: fingerprint(target.target.toString()),
  });

  const report: Record<string, unknown> = {
    restoreVersion: 2, status: apply ? "APPLYING" : "PREVIEW", candidateSha,
    organizationId, artifactId, runId: run.id, source: identities.source, target: identities.target,
    startedAt: new Date().toISOString(), transactionCommitted: false,
    appSmokeEnabled: process.env.RESTORE_DRILL_APP_SMOKE === "1",
  };
  try {
    const verification = await verifyStoredBackup(artifact.filename, artifact.pathname);
    if (!verification.valid) throw new Error(`Backup inválido: ${verification.reason}`);
    const download = await getBackupDownload(artifact.filename, artifact.pathname);
    if (download?.statusCode !== 200 || !download.stream) throw new Error("No se encontró el payload privado.");
    const container = await readStream(download.stream);
    const header = parseBackupContainerHeader(container).header;
    if (header.keyVersion !== verification.manifest.encryption.keyVersion) throw new Error("La versión de clave no coincide con el manifiesto.");
    const plaintext = decryptBackupPayload(container, encryptionKey(header.keyVersion)).plaintext;

    await checkRestoreTargetConnection(target.target.toString());
    const migrationResult = await applyCurrentMigrations(target.target.toString());
    Object.assign(report, {
      artifactSha256: verification.manifest.payload.sha256,
      manifestSha256: verification.manifest.manifestSha256,
      targetFingerprint: fingerprint(target.target.toString()),
      branch: target.branchName,
      migrationResult,
    });
    if (apply) {
      const result = await restoreOrganizationBackup({ targetDatabaseUrl: target.target.toString(), organizationId, plaintext, manifest: verification.manifest });
      report.result = result;
      report.transactionCommitted = true;
      report.certification = await certifyOrganizationRestore({ adminUrl: target.target.toString(), runtimeUrl, organizationId, tables: result.tables, parsedBackup: parseBackupRecords(plaintext) });
      report.status = "PASS";
    } else {
      report.preview = { formatVersion: verification.manifest.version, scope: verification.manifest.scope ?? artifact.scope, capability: verification.manifest.capability ?? artifact.capability, tables: verification.manifest.tables.length, rows: verification.manifest.totals.rows };
    }
    report.completedAt = new Date().toISOString();
    const reportPath = await writeReport(report);
    const reportFingerprint = createHash("sha256").update(JSON.stringify(report)).digest("hex");
    const certificatePath = apply ? await writeCertificate(reportPath, {
        certificateVersion: 2,
        status: "PASS",
        candidateSha,
        source: identities.source,
        target: identities.target,
        certification: report.certification,
        organizationId,
        artifactId,
        payloadSha256: verification.manifest.payload.sha256,
        manifestSha256: verification.manifest.manifestSha256,
        reportFingerprint,
        targetFingerprint: fingerprint(target.target.toString()),
      }) : null;
    await finishOrganizationRestoreRun({ id: run.id, status: report.status as "PASS" | "PREVIEW", stage: "complete", reportFingerprint });
    console.log(`${apply ? "Restore" : "Preview"} ${report.status}: ${reportPath}${certificatePath ? `\nCertificate: ${certificatePath}` : ""}`);
  } catch (error) {
    report.status = "FAIL";
    report.completedAt = new Date().toISOString();
    report.failureCode = error instanceof Error ? (error as { code?: string }).code ?? error.name : "RESTORE_FAILED";
    // A post-commit failure cannot undo committed data: record FAIL and leave
    // the disposable branch isolated. Never issue a PASS certificate here.
    const reportPath = await writeReport(report);
    await writeCertificate(reportPath, { certificateVersion: 2, status: "FAIL", candidateSha, organizationId, artifactId, source: identities.source, target: identities.target, transactionCommitted: report.transactionCommitted, failureCode: report.failureCode });
    console.error(`Restore FAIL: ${reportPath}`);
    await finishOrganizationRestoreRun({ id: run.id, status: "FAIL", stage: "restore", failureCode: error instanceof Error ? error.name : "RESTORE_FAILED" }).catch(() => undefined);
    throw error;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Falló el restore de organización.";
  console.error(message.replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, "postgresql://[redacted]"));
  process.exitCode = 1;
});
