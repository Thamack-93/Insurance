import { createHash, randomBytes, scryptSync } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Pool, type PoolClient } from "pg";
import { getBackupDownload, verifyStoredBackup } from "../src/lib/backup.ts";
import { decryptBackupPayload, parseBackupContainerHeader, parseBackupEncryptionKey, type BackupManifest } from "../src/lib/backup-logic.ts";
import {
  applyCurrentMigrations,
  checkTargetMigrationDrift,
  checkRestoreTargetConnection,
  restoreVerifiedBackup,
  RestoreStageError,
} from "../src/lib/backup-restore.ts";
import {
  runBackupRestoreDrill,
  type FixtureLifecycleResult,
  type PlaywrightSmokeResult,
} from "../src/lib/backup-restore-drill.ts";
import {
  createEmptyDrillReport,
  sanitizeRestoreDrillError,
  writeRestoreDrillReport,
} from "../src/lib/backup-restore-report.ts";
import { assertTemporaryNeonRestoreTarget } from "../src/lib/backup-restore-guards.ts";
import { validateRestoredFiles } from "../src/lib/backup-restore-files.ts";
import { assertRestorableGlobalBackup } from "../src/lib/backup-restore-preflight.ts";
import { getBackupArtifactByPathname } from "../src/lib/backup-catalog.ts";

const execFileAsync = promisify(execFile);

async function readStream(stream: ReadableStream<Uint8Array>) {
  const chunks: Buffer[] = [];
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

function targetFingerprint(value: string) {
  try {
    const url = new URL(value);
    return createHash("sha256").update(`${url.protocol}//${url.hostname}:${url.port || "default"}${url.pathname}`).digest("hex").slice(0, 16);
  } catch {
    return null;
  }
}

function getEncryptionKey(keyVersion: string) {
  const activeVersion = process.env.BACKUP_ENCRYPTION_KEY_VERSION?.trim();
  const versionedName = `BACKUP_ENCRYPTION_KEY_${keyVersion.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}`;
  const value = activeVersion === keyVersion ? process.env.BACKUP_ENCRYPTION_KEY : process.env[versionedName];
  if (!value?.trim()) throw new Error(`No existe una clave para la versión ${keyVersion}.`);
  return parseBackupEncryptionKey(value);
}

function childEnvironment(target: string, extra: Record<string, string> = {}) {
  return {
    PATH: process.env.PATH ?? "",
    DATABASE_URL: target,
    DATABASE_URL_UNPOOLED: "",
    NODE_ENV: process.env.NODE_ENV ?? "test",
    ...extra,
  };
}

async function runLegacyAudit(target: string) {
  let stdout = "";
  try {
    const result = await execFileAsync(process.execPath, ["--import", "tsx", "scripts/check-legacy-workitem-refs.ts", "--json", "--read-only"], {
      cwd: process.cwd(),
      env: childEnvironment(target),
      maxBuffer: 4 * 1024 * 1024,
    });
    stdout = result.stdout;
  } catch (error) {
    stdout = typeof (error as { stdout?: unknown }).stdout === "string" ? (error as { stdout: string }).stdout : "";
    if (!stdout) throw error;
  }
  try {
    const parsed = JSON.parse(stdout) as {
      status?: unknown;
      runtimeWrites?: unknown;
      staticReferences?: unknown;
      data?: Record<string, unknown> | null;
    };
    const data = parsed.data && typeof parsed.data === "object"
      ? Object.fromEntries(Object.entries(parsed.data).filter(([, value]) => typeof value === "number" || value === null))
      : null;
    return {
      status: parsed.status === "PASS" ? "PASS" : "FAIL",
      runtimeWriteCount: Array.isArray(parsed.runtimeWrites) ? parsed.runtimeWrites.length : 0,
      staticReferenceCount: Array.isArray(parsed.staticReferences) ? parsed.staticReferences.length : 0,
      data,
    };
  } catch {
    return { status: "FAIL", failureCode: "WORKITEM_AUDIT_FAILED", output: "La salida del auditor no fue JSON válido." };
  }
}

function fixturePasswordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
}

async function createSmokeFixture(target: string) {
  const pool = new Pool({ connectionString: target, max: 1, application_name: "policydesk-restore-drill-fixture" });
  let client: PoolClient | undefined;
  const id = `restore-drill-${Date.now()}`;
  const email = `${id}@policydesk.local`;
  const agentId = `${id}-agent`;
  const agentEmail = `${agentId}@policydesk.local`;
  const password = randomBytes(24).toString("base64url");
  const agentPassword = randomBytes(24).toString("base64url");
  const clientId = `${id}-client`;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO "User" (id, email, name, "passwordHash", role, active, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, 'ADMIN', true, now(), now())`,
      [id, email, "Restore Drill Fixture", fixturePasswordHash(password)],
    );
    await client.query(
      `INSERT INTO "User" (id, email, name, "passwordHash", role, active, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, 'AGENT', true, now(), now())`,
      [agentId, agentEmail, "Restore Drill Agent", fixturePasswordHash(agentPassword)],
    );
    await client.query(
      `INSERT INTO "Client" (id, "fullName", status, "portfolioOwnerId", "createdAt", "updatedAt") VALUES ($1, $2, 'ACTIVE', $3, now(), now())`,
      [clientId, "Restore Drill Scoped Client", agentId],
    );
    await client.query("COMMIT");
    return { id, email, password, agentId, agentEmail, agentPassword, clientId };
  } catch (error) {
    await client?.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client?.release();
    await pool.end().catch(() => undefined);
  }
}

async function deleteSmokeFixture(target: string, fixture: { id: string; agentId: string; clientId: string }) {
  const pool = new Pool({ connectionString: target, max: 1, application_name: "policydesk-restore-drill-fixture-cleanup" });
  let client: PoolClient | undefined;
  let transactionStarted = false;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    transactionStarted = true;
    await client.query(`DELETE FROM "Client" WHERE id = $1`, [fixture.clientId]);
    await client.query(`DELETE FROM "User" WHERE id IN ($1, $2)`, [fixture.id, fixture.agentId]);
    const remaining = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM (
        SELECT id FROM "Client" WHERE id = $1
        UNION ALL
        SELECT id FROM "User" WHERE id IN ($2, $3)
      ) fixture_rows`,
      [fixture.clientId, fixture.id, fixture.agentId],
    );
    if (Number(remaining.rows[0]?.count ?? "0") !== 0) throw new Error("fixture_cleanup_not_verified");
    await client.query("COMMIT");
    transactionStarted = false;
  } finally {
    if (transactionStarted) await client?.query("ROLLBACK").catch(() => undefined);
    client?.release();
    await pool.end().catch(() => undefined);
  }
}

async function runAppSmoke(target: string) {
  const fixtureLifecycle: FixtureLifecycleResult = {
    enabled: true,
    created: false,
    cleanupAttempted: false,
    cleanupVerified: false,
    ok: false,
  };
  let fixture: Awaited<ReturnType<typeof createSmokeFixture>>;
  try {
    fixture = await createSmokeFixture(target);
    fixtureLifecycle.created = true;
  } catch {
    return {
      playwrightSmoke: {
        ok: false,
        failureCode: "FIXTURE_CREATION_FAILED",
        sanitizedError: sanitizeRestoreDrillError("No se pudo crear el fixture de smoke."),
      } satisfies PlaywrightSmokeResult,
      fixtureLifecycle,
    };
  }
  let playwrightSmoke: PlaywrightSmokeResult = { ok: true };
  try {
    await execFileAsync("npm", ["run", "build"], {
      cwd: process.cwd(),
      env: childEnvironment(target, {
        SESSION_SECRET: process.env.SESSION_SECRET ?? "restore-drill-session-secret-minimum-32-characters",
      }),
      maxBuffer: 4 * 1024 * 1024,
    });
    await execFileAsync("npm", ["run", "test:e2e", "--", "tests/e2e/restore-drill.spec.ts"], {
      cwd: process.cwd(),
      env: childEnvironment(target, {
        RESTORE_DRILL_APP_SMOKE: "1",
        RESTORE_DRILL_FIXTURE_EMAIL: fixture.email,
        RESTORE_DRILL_FIXTURE_PASSWORD: fixture.password,
        RESTORE_DRILL_AGENT_EMAIL: fixture.agentEmail,
        RESTORE_DRILL_AGENT_PASSWORD: fixture.agentPassword,
        SESSION_SECRET: process.env.SESSION_SECRET ?? "restore-drill-session-secret-minimum-32-characters",
        PLAYWRIGHT_USE_PRODUCTION_SERVER: "1",
        PLAYWRIGHT_BASE_URL: "http://127.0.0.1:4173",
        PLAYWRIGHT_HOST: "127.0.0.1",
        PORT: "4173",
      }),
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    playwrightSmoke = {
      ok: false,
      failureCode: "APP_SMOKE_FAILED",
      sanitizedError: sanitizeRestoreDrillError(error),
    };
  } finally {
    fixtureLifecycle.cleanupAttempted = true;
    try {
      await deleteSmokeFixture(target, fixture);
      fixtureLifecycle.cleanupVerified = true;
    } catch {
      playwrightSmoke = {
        ...playwrightSmoke,
        ok: false,
        failureCode: "FIXTURE_CLEANUP_FAILED",
        sanitizedError: sanitizeRestoreDrillError("No se pudo verificar la limpieza del fixture."),
      };
    }
  }
  fixtureLifecycle.ok = fixtureLifecycle.created && fixtureLifecycle.cleanupVerified;
  return { playwrightSmoke, fixtureLifecycle };
}

async function main() {
  const filename = process.argv[2]?.trim();
  if (!filename) throw new Error("Uso: npm run drill:backup:temp-neon -- <archivo.ndjson.gz.enc>");
  const startedAt = new Date();
  let targetUrl = "";
  let manifest: BackupManifest | null = null;
  try {
    let target: ReturnType<typeof assertTemporaryNeonRestoreTarget>;
    try {
      target = assertTemporaryNeonRestoreTarget({
        sourceDatabaseUrl: process.env.DATABASE_URL,
        targetDatabaseUrl: process.env.RESTORE_DATABASE_URL,
        branchName: process.env.RESTORE_NEON_BRANCH,
        allowRestore: process.env.ALLOW_TEMPORARY_NEON_RESTORE,
        forbiddenDatabaseUrls: [process.env.DIRECT_URL, process.env.DATABASE_URL_DIRECT, process.env.DATABASE_URL_POOLER, process.env.POOLER_URL, process.env.PRISMA_DIRECT_URL],
      });
    } catch (error) {
      throw new RestoreStageError("preflight", "El target no está autorizado para restore.", error, "TARGET_NOT_AUTHORIZED");
    }
    targetUrl = target.target.toString();
    let verification: Awaited<ReturnType<typeof verifyStoredBackup>>;
    try {
      verification = await verifyStoredBackup(filename);
    } catch (error) {
      throw new RestoreStageError("backup-verification", "No se pudo verificar el backup almacenado.", error, "BACKUP_VERIFICATION_FAILED");
    }
    if (!verification.valid) throw new RestoreStageError("backup-verification", verification.reason, undefined, "BACKUP_VERIFICATION_FAILED");
    const verifiedManifest = verification.manifest;
    manifest = verifiedManifest;
    let fileRecoveryRequired = true;
    try {
      const catalogEntry = await getBackupArtifactByPathname(verifiedManifest.payload.pathname);
      const preflight = assertRestorableGlobalBackup({ manifest: verifiedManifest, catalogEntry });
      fileRecoveryRequired = preflight.capability === "COMPLETE";
    } catch (error) {
      throw new RestoreStageError("backup-verification", "El backup no cumple los requisitos para un restore global.", error, "BACKUP_VERIFICATION_FAILED");
    }
    let plaintext: Buffer;
    try {
      const download = await getBackupDownload(filename);
      if (download?.statusCode !== 200 || !download.stream) throw new Error("No se encontró el backup privado.");
      const container = await readStream(download.stream);
      const header = parseBackupContainerHeader(container).header;
      if (header.keyVersion !== verifiedManifest.encryption.keyVersion) throw new Error("La versión de clave no coincide con el manifiesto.");
      plaintext = decryptBackupPayload(container, getEncryptionKey(header.keyVersion)).plaintext;
    } catch (error) {
      if (error instanceof RestoreStageError) throw error;
      throw new RestoreStageError("backup-verification", "El backup no pasó la verificación o descifrado.", error, "BACKUP_VERIFICATION_FAILED");
    }

    const report = await runBackupRestoreDrill({
      backupFilename: filename,
      targetDatabaseUrl: targetUrl,
      manifest: verifiedManifest,
      appSmokeEnabled: process.env.RESTORE_DRILL_APP_SMOKE === "1",
      fileRecoveryRequired,
      dependencies: {
        preflight: () => checkRestoreTargetConnection(targetUrl),
        applyMigrations: () => applyCurrentMigrations(targetUrl),
        restore: () => restoreVerifiedBackup({ targetDatabaseUrl: targetUrl, plaintext, manifest: verifiedManifest }),
        fileValidation: validateRestoredFiles,
        workItemAudit: () => runLegacyAudit(targetUrl),
        migrationDrift: () => checkTargetMigrationDrift(targetUrl),
        appSmoke: () => runAppSmoke(targetUrl),
        writeReport: async (currentReport) => {
          currentReport.sanitizedTargetFingerprint ??= targetFingerprint(targetUrl);
          currentReport.backupCreatedAt ??= verifiedManifest.createdAt;
          currentReport.backupPayloadSha256 ??= verifiedManifest.payload.sha256;
          currentReport.keyVersion ??= verifiedManifest.encryption.keyVersion;
          currentReport.manifestHash ??= verifiedManifest.manifestSha256;
          return writeRestoreDrillReport(currentReport);
        },
      },
      branchName: target.branchName,
    });
    if (report.finalStatus === "PASS") console.log(`Restore drill PASS. Reporte: artifacts/restore-drills/`);
    else {
      console.error(`Restore drill FAIL [${report.failureStage ?? "post-commit-smoke"}/${report.failureCode ?? "UNKNOWN"}]: ${report.sanitizedError ?? "Falló el drill."}`);
      process.exitCode = 1;
    }
  } catch (error) {
    const report = createEmptyDrillReport({
      backupFilename: filename,
      startedAt: startedAt.toISOString(),
      backupCreatedAt: manifest?.createdAt ?? null,
      backupPayloadSha256: manifest?.payload.sha256 ?? null,
      keyVersion: manifest?.encryption.keyVersion ?? null,
      manifestHash: manifest?.manifestSha256 ?? null,
      targetFingerprint: targetUrl ? targetFingerprint(targetUrl) : null,
    });
    report.failureStage = error instanceof RestoreStageError ? error.stage : "preflight";
    report.failureCode = error instanceof RestoreStageError ? error.code : "UNKNOWN";
    report.sanitizedError = sanitizeRestoreDrillError(error);
    const completedAt = new Date();
    report.completedAt = completedAt.toISOString();
    report.durationMs = completedAt.getTime() - startedAt.getTime();
    const reportPath = await writeRestoreDrillReport(report);
    console.error(`Restore drill FAIL [${report.failureStage}/${report.failureCode ?? "UNKNOWN"}]: ${report.sanitizedError}`);
    console.error(`Reporte: ${reportPath}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(sanitizeRestoreDrillError(error));
  process.exitCode = 1;
});
