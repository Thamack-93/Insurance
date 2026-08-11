import { getBackupDownload, verifyStoredBackup } from "../src/lib/backup.ts";
import { decryptBackupPayload, parseBackupContainerHeader, parseBackupEncryptionKey } from "../src/lib/backup-logic.ts";
import {
  applyCurrentMigrations,
  checkRestoreTargetConnection,
  restoreVerifiedBackup,
  RestoreStageError,
} from "../src/lib/backup-restore.ts";
import { assertTemporaryNeonRestoreTarget } from "../src/lib/backup-restore-guards.ts";
import type { DeploymentEnvironment } from "../src/lib/deployment-db-safety.ts";

function restoreIdentityAuthorization() {
  const environment = process.env.RESTORE_EXPECTED_DATABASE_ENV?.trim().toLowerCase();
  const fingerprint = process.env.RESTORE_EXPECTED_DATABASE_FINGERPRINT?.trim().toLowerCase();
  if (!environment || !["preview", "development", "test"].includes(environment)) {
    throw new Error("RESTORE_EXPECTED_DATABASE_ENV debe autorizar explícitamente preview, development o test.");
  }
  if (!fingerprint || !/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw new Error("RESTORE_EXPECTED_DATABASE_FINGERPRINT debe contener el fingerprint saneado del target.");
  }
  return { expectedDatabaseEnvironment: environment as DeploymentEnvironment, expectedDatabaseFingerprint: fingerprint };
}

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

function getEncryptionKey(keyVersion: string) {
  const activeVersion = process.env.BACKUP_ENCRYPTION_KEY_VERSION?.trim();
  const versionedName = `BACKUP_ENCRYPTION_KEY_${keyVersion.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}`;
  const value = activeVersion === keyVersion ? process.env.BACKUP_ENCRYPTION_KEY : process.env[versionedName];
  if (!value?.trim()) throw new Error(`No existe una clave para la versión ${keyVersion}.`);
  return parseBackupEncryptionKey(value);
}

async function main() {
  const filename = process.argv[2]?.trim();
  if (!filename) throw new Error("Uso: npm run restore:backup:temp-neon -- <archivo.ndjson.gz.enc>");

  let target: ReturnType<typeof assertTemporaryNeonRestoreTarget>;
  try {
    target = assertTemporaryNeonRestoreTarget({
      sourceDatabaseUrl: process.env.DATABASE_URL,
      targetDatabaseUrl: process.env.RESTORE_DATABASE_URL,
      branchName: process.env.RESTORE_NEON_BRANCH,
      allowRestore: process.env.ALLOW_TEMPORARY_NEON_RESTORE,
      forbiddenDatabaseUrls: [
        process.env.DIRECT_URL,
        process.env.DATABASE_URL_DIRECT,
        process.env.DATABASE_URL_POOLER,
        process.env.POOLER_URL,
        process.env.PRISMA_DIRECT_URL,
      ],
    });
  } catch (error) {
    throw new RestoreStageError("preflight", error instanceof Error ? error.message : "Falló el preflight del target.", error, "TARGET_NOT_AUTHORIZED");
  }

  let verification: Awaited<ReturnType<typeof verifyStoredBackup>>;
  let plaintext: Buffer;
  try {
    verification = await verifyStoredBackup(filename);
    if (!verification.valid) throw new Error(`Backup inválido: ${verification.reason}`);
    const download = await getBackupDownload(filename);
    if (download?.statusCode !== 200 || !download.stream) throw new Error("No se encontró el backup privado.");
    const container = await readStream(download.stream);
    const header = parseBackupContainerHeader(container).header;
    if (header.keyVersion !== verification.manifest.encryption.keyVersion) {
      throw new Error("La versión de clave no coincide con el manifiesto.");
    }
    plaintext = decryptBackupPayload(container, getEncryptionKey(header.keyVersion)).plaintext;
  } catch (error) {
    if (error instanceof RestoreStageError) throw error;
    throw new RestoreStageError("backup-verification", "El backup no pasó la verificación o descifrado.", error, "BACKUP_VERIFICATION_FAILED");
  }
  await checkRestoreTargetConnection(target.target.toString());
  await applyCurrentMigrations(target.target.toString());
  const result = await restoreVerifiedBackup({
    targetDatabaseUrl: target.target.toString(),
    plaintext,
    manifest: verification.manifest,
    ...restoreIdentityAuthorization(),
  });
  console.log(`Restauración validada en ${target.branchName}: ${result.tableCounts.totalRows} filas restauradas.`);
}

main().catch((error) => {
  const stage = error instanceof RestoreStageError ? `[${error.stage}${error.code ? `/${error.code}` : ""}] ` : "";
  console.error(`${stage}${error instanceof Error ? error.message : "Falló la restauración."}`);
  process.exitCode = 1;
});
