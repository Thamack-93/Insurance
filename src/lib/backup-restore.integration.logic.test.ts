import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { Pool } from "pg";
import { createBackupManifest, encryptBackupPayload } from "@/lib/backup-logic";
import { restoreVerifiedBackup } from "@/lib/backup-restore";
import { runBackupRestoreDrill } from "@/lib/backup-restore-drill";
import { runRestoreApplicationReads } from "@/lib/backup-restore-smoke";
import { createEmptyDrillReport, writeRestoreDrillReport } from "@/lib/backup-restore-report";
import { BOOTSTRAP_ORGANIZATION_ID, PROTECTED_TENANT_TABLES } from "@/lib/tenant-organization-foundation";

const execFileAsync = promisify(execFile);
const enabled = process.env.RESTORE_INTEGRATION === "1";
const KEY = Buffer.from("000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", "hex");

type SnapshotTable = { type: "table"; schema: string; name: string; columns: Array<{ name: string; postgresType: string; nullable: boolean }>; rows: Array<{ type: "row"; schema: string; table: string; data: Record<string, unknown> }> };

function connectionForDatabase(adminUrl: string, database: string) {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  url.searchParams.set("schema", "public");
  return url.toString();
}

async function runMigrations(databaseUrl: string) {
  await execFileAsync("npx", ["prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { PATH: process.env.PATH ?? "", DATABASE_URL: databaseUrl, DATABASE_URL_UNPOOLED: "", NODE_ENV: "test" },
    maxBuffer: 4 * 1024 * 1024,
  });
}

async function createDatabase(adminUrl: string, name: string) {
  const pool = new Pool({ connectionString: adminUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    client.release();
    await pool.end();
  }
}

async function dropDatabase(adminUrl: string, name: string) {
  const pool = new Pool({ connectionString: adminUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    client.release();
    await pool.end();
  }
}

async function seedFixture(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query(`INSERT INTO "User" (id,email,name,"passwordHash",role,active,"createdAt","updatedAt") VALUES ('drill-user','drill@example.test','Drill User','fixture', 'ADMIN', true, now(), now())`);
    await client.query(`INSERT INTO "Client" (id,"fullName",email,status,"createdAt","updatedAt") VALUES ('drill-client','Drill Client','drill-client@example.test','ACTIVE',now(),now())`);
    await client.query(`INSERT INTO "Insurer" (id,name,status,"createdAt","updatedAt") VALUES ('drill-insurer','Drill Insurer','ACTIVE',now(),now())`);
    await client.query(`INSERT INTO "Policy" (id,"policyNumber","clientId","insurerId","policyType",status,"startDate","endDate","premiumAmount","paymentFrequency","createdAt","updatedAt") VALUES ('drill-policy','DRILL-001','drill-client','drill-insurer','AUTO','ACTIVE',now(),now() + interval '1 year',1000,'ANNUAL',now(),now())`);
    await client.query(`INSERT INTO "Task" (id,folio,"title",status,priority,"startDate","createdAt","updatedAt") VALUES ('drill-task','DRILL-TASK','Drill task','OPEN','MEDIUM',now(),now(),now())`);
    await client.query(`INSERT INTO "Receipt" (id,"receiptNumber","policyId","clientId","insurerId","periodStartDate","periodEndDate","dueDate",amount,status,"createdAt","updatedAt") VALUES ('drill-receipt','DRILL-R-001','drill-policy','drill-client','drill-insurer',now(),now() + interval '1 month',now(),1000,'PAID',now(),now())`);
    await client.query(`INSERT INTO "Payment" (id,"receiptId","policyId","clientId",amount,status,"paidDate","createdAt","updatedAt") VALUES ('drill-payment','drill-receipt','drill-policy','drill-client',1000,'POSTED',now(),now(),now())`);
    await client.query(`INSERT INTO "WorkItem" (id,"sourceType","sourceId","workItemType",status,priority,title,"entityType","entityId","clientId","policyId","receiptId","startDate","createdAt","updatedAt") VALUES ('drill-workitem','Task','drill-task','TASK','OPEN','MEDIUM','Drill work item','Task','drill-task','drill-client','drill-policy','drill-receipt',now(),now(),now())`);
    await client.query(`INSERT INTO "Claim" (id,folio,"clientId","policyId","insurerId","claimType",status,"incidentDate","reportedDate","createdAt","updatedAt") VALUES ('drill-claim','DRILL-C-001','drill-client','drill-policy','drill-insurer','ACCIDENT','OPEN',now(),now(),now(),now())`);
    await client.query(`INSERT INTO "Commission" (id,"policyId","clientId","insurerId","expectedAmount","expectedDate","createdAt","updatedAt") VALUES ('drill-commission','drill-policy','drill-client','drill-insurer',100,now(),now(),now())`);
    await client.query(`INSERT INTO "ActivityLog" (id,"entityType","entityId",action,"userId","createdAt") VALUES ('drill-activity','Policy','drill-policy','DRILL','drill-user',now())`);
    await client.query(`INSERT INTO "NotificationChannel" (id,"userId",type,"createdAt","updatedAt") VALUES ('drill-channel','drill-user','TELEGRAM',now(),now())`);
    await client.query(`INSERT INTO "NotificationPreference" (id,"userId","eventType","channelType","createdAt","updatedAt") VALUES ('drill-preference','drill-user','DRILL','TELEGRAM',now(),now())`);
    await client.query(`INSERT INTO "NotificationEvent" (id,type,title,body,"userId","channelType","createdAt","updatedAt") VALUES ('drill-event','DRILL','Drill','Drill event','drill-user','TELEGRAM',now(),now())`);
    await client.query(`INSERT INTO "SystemSetting" (id,key,value,"createdAt","updatedAt") VALUES ('drill-setting','drill','true',now(),now())`);
    await client.query(`UPDATE "OrganizationMembership" SET role = 'OWNER' WHERE "organizationId" = $1 AND "userId" = 'drill-user'`, [BOOTSTRAP_ORGANIZATION_ID]);
    for (const table of PROTECTED_TENANT_TABLES) {
      await client.query(`UPDATE "${table}" SET "organizationId" = $1 WHERE "organizationId" IS NULL`, [BOOTSTRAP_ORGANIZATION_ID]);
    }
    await client.query(`UPDATE "Organization" SET status = 'ACTIVE' WHERE id = $1`, [BOOTSTRAP_ORGANIZATION_ID]);
  } finally {
    client.release();
    await pool.end();
  }
}

async function snapshotDatabase(databaseUrl: string): Promise<SnapshotTable[]> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    const tables = await client.query<{ table_schema: string; table_name: string }>(`SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`);
    const snapshot: SnapshotTable[] = [];
    for (const table of tables.rows) {
      const columnsResult = await client.query<{ column_name: string; udt_name: string; is_nullable: "YES" | "NO" }>(`SELECT column_name, udt_name, is_nullable FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position`, [table.table_schema, table.table_name]);
      const rowsResult = await client.query<Record<string, unknown>>(`SELECT * FROM "${table.table_name.replaceAll('"', '""')}"`);
      snapshot.push({
        type: "table",
        schema: table.table_schema,
        name: table.table_name,
        columns: columnsResult.rows.map((column) => ({ name: column.column_name, postgresType: column.udt_name, nullable: column.is_nullable === "YES" })),
        rows: rowsResult.rows.map((data) => ({ type: "row", schema: table.table_schema, table: table.table_name, data })),
      });
    }
    return snapshot;
  } finally {
    client.release();
    await pool.end();
  }
}

async function scalarCount(databaseUrl: string, table: string) {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const result = await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM "${table}"`);
    return result.rows[0]?.count ?? 0;
  } finally {
    await pool.end();
  }
}

async function tableCounts(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    const tables = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`,
    );
    const counts: Record<string, number> = {};
    for (const table of tables.rows) {
      const result = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM "${table.table_name.replaceAll('"', '""')}"`);
      counts[table.table_name] = Number(result.rows[0]?.count ?? "0");
    }
    return counts;
  } finally {
    client.release();
    await pool.end();
  }
}

function encodeSnapshot(snapshot: SnapshotTable[], mutate?: (snapshot: SnapshotTable[]) => void) {
  const copy = structuredClone(snapshot);
  mutate?.(copy);
  const lines: string[] = [JSON.stringify({ type: "backup", format: "policydesk-postgres-ndjson", version: 1, createdAt: new Date().toISOString(), database: { engine: "postgresql", serverVersion: "test" }, tableCount: copy.length })];
  let totalRows = 0;
  for (const table of copy) {
    lines.push(JSON.stringify({ ...table, rows: undefined }));
    for (const row of table.rows) lines.push(JSON.stringify(row, (_key, value) => Buffer.isBuffer(value) ? { type: "Buffer", data: [...value] } : value));
    lines.push(JSON.stringify({ type: "table_end", schema: table.schema, table: table.name, rowCount: table.rows.length }));
    totalRows += table.rows.length;
  }
  lines.push(JSON.stringify({ type: "end", tableCount: copy.length, rowCount: totalRows }));
  const plaintext = Buffer.from(`${lines.join("\n")}\n`);
  const encrypted = encryptBackupPayload(plaintext, KEY, "v1", Buffer.from("101112131415161718191a1b", "hex"));
  const tables = copy.map((table) => ({ schema: table.schema, name: table.name, rowCount: table.rows.length }));
  const filename = "policydesk-test.ndjson.gz.enc";
  const manifest = createBackupManifest({
    format: "policydesk-postgres-ndjson",
    version: 1,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    payload: { filename, pathname: `database-backups/${filename}`, size: encrypted.length, sha256: createHash("sha256").update(encrypted).digest("hex") },
    encryption: { algorithm: "AES-256-GCM", keyVersion: "v1", iv: Buffer.from("101112131415161718191a1b", "hex").toString("base64"), authTagBytes: 16 },
    compression: "gzip",
    tables,
    totals: { tables: tables.length, rows: totalRows },
  });
  return { plaintext, manifest };
}

describe.skipIf(!enabled)("disposable PostgreSQL backup restore", () => {
  it("restores a full fixture and rolls back invalid variants", async () => {
    const adminUrl = process.env.RESTORE_INTEGRATION_ADMIN_URL ?? process.env.DATABASE_URL;
    if (!adminUrl) throw new Error("RESTORE_INTEGRATION_ADMIN_URL or DATABASE_URL is required.");
    const suffix = `${process.pid}_${Date.now()}`.replace(/[^0-9_]/g, "");
    const sourceName = `restore_source_${suffix}`;
    const targetName = `restore_target_${suffix}`;
    const sourceUrl = connectionForDatabase(adminUrl, sourceName);
    const targetUrl = connectionForDatabase(adminUrl, targetName);
    try {
      await createDatabase(adminUrl, sourceName);
      await createDatabase(adminUrl, targetName);
      await runMigrations(sourceUrl);
      await runMigrations(targetUrl);
      await seedFixture(sourceUrl);
      const snapshot = await snapshotDatabase(sourceUrl);
      const valid = encodeSnapshot(snapshot);
      const restored = await restoreVerifiedBackup({ targetDatabaseUrl: targetUrl, plaintext: valid.plaintext, manifest: valid.manifest });
      expect(restored.tableCounts.totalRows).toBeGreaterThan(0);
      expect(restored.triggerMode).toBe("session_replication_role");
      const orchestrationReport = await runBackupRestoreDrill({
        backupFilename: valid.manifest.payload.filename,
        targetDatabaseUrl: targetUrl,
        manifest: valid.manifest,
        appSmokeEnabled: false,
        dependencies: {
          applyMigrations: async () => ({ ok: true, synthetic: true }),
          restore: async () => restored,
          applicationReads: runRestoreApplicationReads,
          workItemAudit: async () => ({ status: "PASS", synthetic: true }),
          migrationDrift: async () => ({ ok: true, synthetic: true }),
          writeReport: async () => "synthetic-report.json",
        },
      });
      expect(orchestrationReport.finalStatus).toBe("PASS");
      expect(orchestrationReport.applicationReads).toMatchObject({ ok: true });
      const guardPool = new Pool({ connectionString: targetUrl, max: 1 });
      const guardClient = await guardPool.connect();
      try {
        await expect(guardClient.query(`INSERT INTO "Organization" (id,name,slug,status,"timeZone","defaultCurrency","createdAt","updatedAt") VALUES ('org-second','Second','second','ACTIVE','Etc/GMT+6','MXN',now(),now())`)).rejects.toThrow();
        await expect(guardClient.query(`DELETE FROM "Organization" WHERE id = $1`, [BOOTSTRAP_ORGANIZATION_ID])).rejects.toThrow(/POLICYDESK_BOOTSTRAP_ORGANIZATION_IMMUTABLE/);
        await expect(guardClient.query(`TRUNCATE "Organization" CASCADE`)).rejects.toThrow(/POLICYDESK_BOOTSTRAP_ORGANIZATION_IMMUTABLE/);
        await guardClient.query(`INSERT INTO "Client" (id,"fullName",status,"createdAt","updatedAt") VALUES ('guard-client','Guard Client','ACTIVE',now(),now())`);
        expect((await guardClient.query(`SELECT "organizationId" FROM "Client" WHERE id = 'guard-client'`)).rows[0].organizationId).toBe(BOOTSTRAP_ORGANIZATION_ID);
        await expect(guardClient.query(`UPDATE "Client" SET "organizationId" = 'wrong-org' WHERE id = 'guard-client'`)).rejects.toThrow(/POLICYDESK_ORGANIZATION/);
        await expect(guardClient.query(`UPDATE "Client" SET "organizationId" = NULL WHERE id = 'guard-client'`)).rejects.toThrow(/POLICYDESK_ORGANIZATION_IMMUTABLE/);
        await guardClient.query(`DELETE FROM "Client" WHERE id = 'guard-client'`);
        await guardClient.query("BEGIN");
        await guardClient.query("SET LOCAL session_replication_role = replica");
        await guardClient.query(`INSERT INTO "Client" (id,"fullName",status,"createdAt","updatedAt") VALUES ('replica-client','Replica Client','ACTIVE',now(),now())`);
        await guardClient.query("SET LOCAL session_replication_role = origin");
        expect((await guardClient.query(`SELECT "organizationId" FROM "Client" WHERE id = 'replica-client'`)).rows[0].organizationId).toBeNull();
        await guardClient.query("ROLLBACK");
      } finally {
        guardClient.release();
        await guardPool.end();
      }
      const report = createEmptyDrillReport({
        backupFilename: valid.manifest.payload.filename,
        startedAt: valid.manifest.createdAt,
        backupCreatedAt: valid.manifest.createdAt,
        keyVersion: valid.manifest.encryption.keyVersion,
        manifestHash: valid.manifest.manifestSha256,
        targetFingerprint: "integration-disposable",
      });
      report.finalStatus = "PASS";
      report.completedAt = new Date().toISOString();
      report.durationMs = Date.parse(report.completedAt) - Date.parse(report.startedAt);
      report.tableCounts = restored.tableCounts.tables;
      report.totalRows = restored.tableCounts.totalRows;
      report.fkChecks = restored.foreignKeys;
      report.domainChecks = restored.domainChecks;
      report.restoreIntegrity = {
        ok: true,
        targetFingerprint: restored.targetFingerprint,
        tableCounts: restored.tableCounts,
        foreignKeys: restored.foreignKeys,
        domainChecks: restored.domainChecks,
        sequences: restored.sequences,
      };
      report.applicationReads = orchestrationReport.applicationReads;
      report.workItemAudit = orchestrationReport.workItemAudit;
      report.migrationResult = orchestrationReport.migrationResult;
      report.playwrightSmoke = orchestrationReport.playwrightSmoke;
      report.fixtureLifecycle = orchestrationReport.fixtureLifecycle;
      await writeRestoreDrillReport(report);
      const sourceCountsBefore = await tableCounts(sourceUrl);
      const sourceCountBefore = await scalarCount(sourceUrl, "Payment");
      expect(sourceCountBefore).toBe(1);

      const orphan = encodeSnapshot(snapshot, (copy) => {
        copy.find((table) => table.name === "Payment")!.rows[0].data.receiptId = "missing-receipt";
      });
      await expect(restoreVerifiedBackup({ targetDatabaseUrl: targetUrl, plaintext: orphan.plaintext, manifest: orphan.manifest })).rejects.toThrow(/huérfanos|integridad/i);
      const targetCountAfterOrphan = await scalarCount(targetUrl, "Payment");
      expect(targetCountAfterOrphan).toBe(1);

      const mismatch = encodeSnapshot(snapshot);
      mismatch.manifest.tables.find((table) => table.name === "Payment")!.rowCount += 1;
      const { manifestSha256: _manifestHash, ...mismatchUnsigned } = mismatch.manifest;
      void _manifestHash;
      mismatch.manifest = createBackupManifest(mismatchUnsigned);
      await expect(restoreVerifiedBackup({ targetDatabaseUrl: targetUrl, plaintext: mismatch.plaintext, manifest: mismatch.manifest })).rejects.toThrow(/conteo/i);
      expect(await scalarCount(targetUrl, "Payment")).toBe(1);

      const duplicate = encodeSnapshot(snapshot, (copy) => {
        const payment = copy.find((table) => table.name === "Payment")!;
        payment.rows.push({ ...payment.rows[0], data: { ...payment.rows[0].data, id: "drill-payment-duplicate" } });
      });
      await expect(restoreVerifiedBackup({ targetDatabaseUrl: targetUrl, plaintext: duplicate.plaintext, manifest: duplicate.manifest })).rejects.toThrow(/duplicate|posted_payment|recibo/i);
      expect(await scalarCount(targetUrl, "Payment")).toBe(1);

      const inconsistentMembership = encodeSnapshot(snapshot, (copy) => {
        copy.find((table) => table.name === "OrganizationMembership")!.rows[0].data.active = false;
      });
      await expect(restoreVerifiedBackup({ targetDatabaseUrl: targetUrl, plaintext: inconsistentMembership.plaintext, manifest: inconsistentMembership.manifest })).rejects.toThrow(/Owner|membership|tenant/i);
      expect(await scalarCount(targetUrl, "Payment")).toBe(1);
      expect(await tableCounts(sourceUrl)).toEqual(sourceCountsBefore);
      const sourceCountAfter = await scalarCount(sourceUrl, "Payment");
      expect(sourceCountAfter).toBe(sourceCountBefore);
    } finally {
      await dropDatabase(adminUrl, sourceName).catch(() => undefined);
      await dropDatabase(adminUrl, targetName).catch(() => undefined);
    }
  }, 180_000);
});
