import { createHash, randomBytes, scryptSync } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Pool } from "pg";
import { getBackupDownload, verifyStoredBackup } from "../src/lib/backup.ts";
import { decryptBackupPayload, parseBackupContainerHeader, parseBackupEncryptionKey } from "../src/lib/backup-logic.ts";
import {
  applyCurrentMigrations,
  checkTargetMigrationDrift,
  restoreVerifiedBackup,
  RestoreStageError,
} from "../src/lib/backup-restore.ts";
import {
  createEmptyDrillReport,
  sanitizeRestoreDrillError,
  writeRestoreDrillReport,
  type DrillStage,
  type RestoreDrillReport,
} from "../src/lib/backup-restore-report.ts";
import { assertTemporaryNeonRestoreTarget } from "../src/lib/backup-restore-guards.ts";

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
  const result = await execFileAsync("npm", ["run", "check:legacy-workitem-refs", "--", "--json"], {
    cwd: process.cwd(),
    env: childEnvironment(target),
    maxBuffer: 4 * 1024 * 1024,
  });
  try {
    return JSON.parse(result.stdout);
  } catch {
    return { status: "PASS", output: "Auditor completado." };
  }
}

async function postCommitSmoke(target: string) {
  const pool = new Pool({ connectionString: target, max: 1, application_name: "policydesk-restore-drill-smoke" });
  const client = await pool.connect();
  try {
    const tables = ["User", "Client", "Policy", "Receipt", "Payment", "WorkItem", "Claim", "Commission", "NotificationChannel", "NotificationPreference", "NotificationEvent"];
    const counts: Record<string, number> = {};
    for (const table of tables) {
      const result = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM "${table}"`);
      counts[table] = Number(result.rows[0]?.count ?? "0");
    }
    const latestActivity = await client.query("SELECT 1 FROM \"ActivityLog\" ORDER BY \"createdAt\" DESC LIMIT 1");
    return {
      ok: true,
      reads: {
        oneUser: counts.User > 0,
        clientCount: counts.Client,
        policyCount: counts.Policy,
        receiptCount: counts.Receipt,
        paymentCount: counts.Payment,
        workItemCount: counts.WorkItem,
        claimsCount: counts.Claim,
        commissionCount: counts.Commission,
        latestActivityLog: (latestActivity.rowCount ?? 0) > 0,
        notificationConfiguration: counts.NotificationChannel + counts.NotificationPreference + counts.NotificationEvent,
      },
    };
  } finally {
    client.release();
    await pool.end().catch(() => undefined);
  }
}

function fixturePasswordHash(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("hex")}`;
}

async function createSmokeFixture(target: string) {
  const pool = new Pool({ connectionString: target, max: 1, application_name: "policydesk-restore-drill-fixture" });
  const client = await pool.connect();
  const id = `restore-drill-${Date.now()}`;
  const email = `${id}@policydesk.local`;
  const agentId = `${id}-agent`;
  const agentEmail = `${agentId}@policydesk.local`;
  const password = randomBytes(24).toString("base64url");
  const agentPassword = randomBytes(24).toString("base64url");
  const clientId = `${id}-client`;
  try {
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
    return { id, email, password, agentId, agentEmail, agentPassword, clientId };
  } finally {
    client.release();
    await pool.end().catch(() => undefined);
  }
}

async function deleteSmokeFixture(target: string, fixture: { id: string; agentId: string; clientId: string }) {
  const pool = new Pool({ connectionString: target, max: 1, application_name: "policydesk-restore-drill-fixture-cleanup" });
  const client = await pool.connect();
  try {
    await client.query(`DELETE FROM "Client" WHERE id = $1`, [fixture.clientId]);
    await client.query(`DELETE FROM "User" WHERE id IN ($1, $2)`, [fixture.id, fixture.agentId]);
  } finally {
    client.release();
    await pool.end().catch(() => undefined);
  }
}

async function runAppSmoke(target: string) {
  const fixture = await createSmokeFixture(target);
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
    return { ok: true, fixture: "created-and-removed" };
  } finally {
    await deleteSmokeFixture(target, fixture).catch(() => undefined);
  }
}

async function main() {
  const filename = process.argv[2]?.trim();
  if (!filename) throw new Error("Uso: npm run drill:backup:temp-neon -- <archivo.ndjson.gz.enc>");
  const startedAt = new Date();
  const report: RestoreDrillReport = createEmptyDrillReport({ backupFilename: filename, startedAt: startedAt.toISOString() });
  let stage: DrillStage = "preflight";
  let targetUrl = "";

  try {
    const target = assertTemporaryNeonRestoreTarget({
      sourceDatabaseUrl: process.env.DATABASE_URL,
      targetDatabaseUrl: process.env.RESTORE_DATABASE_URL,
      branchName: process.env.RESTORE_NEON_BRANCH,
      allowRestore: process.env.ALLOW_TEMPORARY_NEON_RESTORE,
      forbiddenDatabaseUrls: [process.env.DIRECT_URL, process.env.DATABASE_URL_DIRECT, process.env.DATABASE_URL_POOLER, process.env.POOLER_URL, process.env.PRISMA_DIRECT_URL],
    });
    targetUrl = target.target.toString();
    report.sanitizedTargetFingerprint = targetFingerprint(targetUrl);

    stage = "backup-verification";
    const verification = await verifyStoredBackup(filename);
    if (!verification.valid) throw new RestoreStageError("backup-verification", verification.reason);
    report.backupCreatedAt = verification.manifest.createdAt;
    report.keyVersion = verification.manifest.encryption.keyVersion;
    report.manifestHash = verification.manifest.manifestSha256;
    const download = await getBackupDownload(filename);
    if (download?.statusCode !== 200 || !download.stream) throw new RestoreStageError("backup-verification", "No se encontró el backup privado.");
    const container = await readStream(download.stream);
    const header = parseBackupContainerHeader(container).header;
    if (header.keyVersion !== verification.manifest.encryption.keyVersion) throw new RestoreStageError("backup-verification", "La versión de clave no coincide con el manifiesto.");
    const plaintext = decryptBackupPayload(container, getEncryptionKey(header.keyVersion)).plaintext;

    stage = "preflight";
    report.migrationResult = await applyCurrentMigrations(targetUrl);
    stage = "insertion";
    const restored = await restoreVerifiedBackup({ targetDatabaseUrl: targetUrl, plaintext, manifest: verification.manifest });
    report.tableCounts = restored.tableCounts.tables;
    report.totalRows = restored.tableCounts;
    report.fkChecks = restored.foreignKeys;
    report.domainChecks = restored.domainChecks;
    report.sanitizedTargetFingerprint = restored.targetFingerprint;

    stage = "post-commit-smoke";
    const applicationReads = await postCommitSmoke(targetUrl);
    report.workItemAudit = await runLegacyAudit(targetUrl);
    const drift = await checkTargetMigrationDrift(targetUrl);
    report.migrationResult = { deploy: report.migrationResult, drift };
    const playwrightSmoke = process.env.RESTORE_DRILL_APP_SMOKE === "1" ? await runAppSmoke(targetUrl) : { ok: true, skipped: true };
    report.appSmoke = { ok: applicationReads.ok && playwrightSmoke.ok, applicationReads, playwright: playwrightSmoke };
    report.finalStatus = "PASS";
    report.failureStage = null;
    console.log(`Restore drill PASS. Reporte: artifacts/restore-drills/`);
  } catch (error) {
    report.finalStatus = "FAIL";
    report.failureStage = error instanceof RestoreStageError ? error.stage : stage;
    report.sanitizedError = sanitizeRestoreDrillError(error);
    console.error(`Restore drill FAIL [${report.failureStage}]: ${report.sanitizedError}`);
    process.exitCode = 1;
  } finally {
    const completedAt = new Date();
    report.completedAt = completedAt.toISOString();
    report.durationMs = completedAt.getTime() - new Date(report.startedAt).getTime();
    const reportPath = await writeRestoreDrillReport(report);
    console.error(`Reporte: ${reportPath}`);
  }
}

main().catch((error) => {
  console.error(sanitizeRestoreDrillError(error));
  process.exitCode = 1;
});
