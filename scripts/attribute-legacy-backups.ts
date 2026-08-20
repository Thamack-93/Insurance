import "dotenv/config";

import { getBackupDownload, listBackups, listRekeyedBackups, verifyStoredBackup } from "../src/lib/backup.ts";
import {
  decryptBackupPayload,
  parseBackupContainerHeader,
  parseBackupEncryptionKey,
} from "../src/lib/backup-logic.ts";
import { parseBackupRecords } from "../src/lib/backup-restore-validation.ts";
import { PROTECTED_TENANT_TABLES } from "../src/lib/tenant-organization-foundation.ts";
import { getDb } from "../src/lib/db.ts";
import { upsertBackupArtifact } from "../src/lib/backup-catalog.ts";

function parseArgs() {
  const apply = process.argv.includes("--apply");
  const organizationArgument = process.argv.find((value) => value.startsWith("--organization="));
  return { apply, organizationId: organizationArgument?.slice("--organization=".length) };
}

async function readStream(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
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

function encryptionKey(keyVersion: string) {
  const activeVersion = process.env.BACKUP_ENCRYPTION_KEY_VERSION?.trim();
  const variable = keyVersion === activeVersion
    ? "BACKUP_ENCRYPTION_KEY"
    : `BACKUP_ENCRYPTION_KEY_${keyVersion.replace(/[^A-Za-z0-9]/g, "_").toUpperCase()}`;
  const value = process.env[variable]?.trim();
  if (!value) throw new Error(`Falta la clave para la versión ${keyVersion}.`);
  return parseBackupEncryptionKey(value);
}

async function classifyLegacyBackup(entry: Awaited<ReturnType<typeof listBackups>>[number], organizationId: string) {
  const verification = await verifyStoredBackup(entry.filename, entry.pathname);
  if (!verification.valid) return { ok: false as const, reason: verification.reason, verification };
  const payload = await getBackupDownload(entry.filename, entry.pathname);
  if (payload?.statusCode !== 200 || !payload.stream) return { ok: false as const, reason: "No se encontró el payload privado." };
  const encrypted = await readStream(payload.stream);
  const parsedContainer = parseBackupContainerHeader(encrypted);
  const decrypted = decryptBackupPayload(encrypted, encryptionKey(parsedContainer.header.keyVersion));
  const records = parseBackupRecords(decrypted.plaintext);

  const organizationRows = records.rows.get("public.Organization") ?? [];
  if (organizationRows.length > 1 || (organizationRows[0] && organizationRows[0].data.id !== organizationId)) {
    return { ok: false as const, reason: "El backup contiene más de una organización o una organización distinta." };
  }
  const tenantTables = [...records.tables.values()].filter((table) => PROTECTED_TENANT_TABLES.includes(table.name as never));
  const tablesWithOrganizationColumn = tenantTables.filter((table) => table.columns.some((column) => column.name === "organizationId"));
  if (tablesWithOrganizationColumn.length > 0 && tablesWithOrganizationColumn.length !== tenantTables.length) {
    return { ok: false as const, reason: "El backup contiene una transición parcial de organizationId." };
  }
  for (const table of tenantTables) {
    for (const row of records.rows.get(`${table.schema}.${table.name}`) ?? []) {
      const value = row.data.organizationId;
      if (value !== undefined && value !== null && value !== organizationId) {
        return { ok: false as const, reason: `La tabla ${table.name} contiene otra organización.` };
      }
    }
  }
  const capability = (records.rows.get("public.Document")?.length ?? 0) === 0 ? "COMPLETE" as const : "DATABASE_ONLY" as const;
  return {
    ok: true as const,
    verification,
    capability,
    reason: organizationRows.length === 0 ? "Legado singleton sin tablas de organización." : "Singleton con organización coincidente.",
  };
}

async function main() {
  const { apply, organizationId: requestedOrganizationId } = parseArgs();
  const db = getDb();
  const organizations = await db.organization.findMany({ select: { id: true, name: true, slug: true }, orderBy: { id: "asc" } });
  if (organizations.length !== 1) throw new Error("La atribución legacy requiere exactamente una organización.");
  const organization = organizations[0];
  if (requestedOrganizationId && requestedOrganizationId !== organization.id) throw new Error("La organización indicada no coincide con la organización única actual.");

  const entries = [
    ...(await listBackups()),
    ...(await listRekeyedBackups()),
  ];
  const results = [];
  for (const entry of entries) {
    const classified = await classifyLegacyBackup(entry, organization.id);
    results.push({
      filename: entry.filename,
      pathname: entry.pathname,
      storage: entry.storage ?? "original",
      organizationId: organization.id,
      status: classified.ok ? "READY" : "BLOCKED",
      reason: classified.reason,
    });
    if (apply && classified.ok) {
      await upsertBackupArtifact({
        entry,
        scope: "LEGACY_SINGLETON",
        organizationId: organization.id,
        status: "VERIFIED",
        capability: classified.capability,
        manifest: classified.verification.manifest,
      });
    }
  }
  if (results.some((result) => result.status === "BLOCKED")) {
    console.error(JSON.stringify({ ok: false, mode: apply ? "apply" : "preview", organization, results }, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({ ok: true, mode: apply ? "apply" : "preview", organization, count: results.length, results }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Legacy backup attribution failed.");
  process.exitCode = 1;
});
