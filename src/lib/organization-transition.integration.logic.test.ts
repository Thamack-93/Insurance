import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { auditTenantFoundation, BOOTSTRAP_ORGANIZATION_ID, PROTECTED_TENANT_TABLES } from "@/lib/tenant-organization-foundation";

const execFileAsync = promisify(execFile);
const enabled = process.env.RESTORE_INTEGRATION === "1";

function databaseUrl(adminUrl: string, database: string) {
  const url = new URL(adminUrl);
  url.pathname = `/${database}`;
  url.searchParams.set("schema", "public");
  return url.toString();
}

async function migrate(url: string) {
  await execFileAsync("npx", ["prisma", "migrate", "deploy"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url, DATABASE_URL_UNPOOLED: "", NODE_ENV: "test" },
    maxBuffer: 4 * 1024 * 1024,
  });
}

async function createDatabase(adminUrl: string, name: string) {
  const pool = new Pool({ connectionString: adminUrl, max: 1 });
  try { await pool.query(`CREATE DATABASE "${name}"`); } finally { await pool.end(); }
}

async function dropDatabase(adminUrl: string, name: string) {
  const pool = new Pool({ connectionString: adminUrl, max: 1 });
  try { await pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); } finally { await pool.end(); }
}

async function seedLegacy(url: string, includeUnsupportedUser = false) {
  const pool = new Pool({ connectionString: url, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    await client.query(`INSERT INTO "User" (id,email,name,"passwordHash",role,active,"createdAt","updatedAt") VALUES
      ('legacy-admin','owner@example.test','Legacy Owner','fixture','ADMIN',true,now(),now()),
      ('legacy-agent','agent@example.test','Legacy Agent','fixture','AGENT',true,now(),now())`);
    if (includeUnsupportedUser) await client.query(`INSERT INTO "User" (id,email,name,"passwordHash",role,active,"createdAt","updatedAt") VALUES ('legacy-broken','broken@example.test','Broken','fixture','BROKEN',true,now(),now())`);
    await client.query(`INSERT INTO "Client" (id,"fullName",email,status,"createdAt","updatedAt") VALUES ('legacy-client','Legacy Client','legacy-client@example.test','ACTIVE',now(),now())`);
    await client.query(`INSERT INTO "Insurer" (id,name,status,"createdAt","updatedAt") VALUES ('legacy-insurer','Legacy Insurer','ACTIVE',now(),now())`);
    await client.query(`INSERT INTO "Policy" (id,"policyNumber","clientId","insurerId","policyType",status,"startDate","endDate","premiumAmount","paymentFrequency","createdAt","updatedAt") VALUES ('legacy-policy','LEGACY-001','legacy-client','legacy-insurer','AUTO','ACTIVE',now(),now() + interval '1 year',1000,'ANNUAL',now(),now())`);
    await client.query(`INSERT INTO "Receipt" (id,"receiptNumber","policyId","clientId","insurerId","periodStartDate","periodEndDate","dueDate",amount,status,"createdAt","updatedAt") VALUES ('legacy-receipt','LEGACY-R-001','legacy-policy','legacy-client','legacy-insurer',now(),now() + interval '1 month',now(),1000,'PENDING',now(),now())`);
    await client.query("SET LOCAL session_replication_role = origin");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function runBackfill(url: string, apply: boolean, owner = "owner@example.test") {
  const args = ["--import", "tsx", "scripts/backfill-organizations.ts", "--json"];
  if (apply) args.push("--apply");
  try {
    const result = await execFileAsync(process.execPath, args, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL_UNPOOLED: url,
        SCRIPT_TARGET_ENV: "test",
        LEGACY_ORGANIZATION_NAME: "Legacy Organization",
        LEGACY_ORGANIZATION_SLUG: "legacy-organization",
        LEGACY_ORGANIZATION_TIME_ZONE: "America/Mexico_City",
        LEGACY_ORGANIZATION_DEFAULT_CURRENCY: "MXN",
        LEGACY_ORGANIZATION_OWNER_EMAIL: owner,
      },
      maxBuffer: 4 * 1024 * 1024,
    });
    return JSON.parse(result.stdout) as { ok: boolean; result: { nullCounts: Record<string, number> } };
  } catch (error: unknown) {
    const value = error as { stderr?: string; message?: string };
    throw new Error(value.stderr ?? value.message ?? "backfill failed");
  }
}

async function scalar(url: string, sql: string, values: unknown[] = []) {
  const pool = new Pool({ connectionString: url, max: 1 });
  try { return await pool.query(sql, values); } finally { await pool.end(); }
}

describe.skipIf(!enabled)("organization transition executable backfill", () => {
  it("keeps preview read-only, applies idempotently, and enforces the singleton guards", async () => {
    const adminUrl = process.env.RESTORE_INTEGRATION_ADMIN_URL ?? process.env.DATABASE_URL;
    if (!adminUrl) throw new Error("RESTORE_INTEGRATION_ADMIN_URL or DATABASE_URL is required.");
    const name = `org_transition_${process.pid}_${Date.now()}`.replace(/[^a-z0-9_]/gi, "").toLowerCase();
    const url = databaseUrl(adminUrl, name);
    try {
      await createDatabase(adminUrl, name);
      await migrate(url);
      await seedLegacy(url);

      const preview = await runBackfill(url, false);
      expect(preview.ok).toBe(true);
      expect(preview.result.nullCounts.Client).toBe(1);
      expect((await scalar(url, `SELECT "status", "name" FROM "Organization" WHERE id = $1`, [BOOTSTRAP_ORGANIZATION_ID])).rows[0]).toMatchObject({ status: "BOOTSTRAP", name: "PolicyDesk Legacy Organization" });
      expect((await scalar(url, `SELECT "organizationId" FROM "Client" WHERE id = 'legacy-client'`)).rows[0].organizationId).toBeNull();
      expect((await scalar(url, `SELECT count(*)::int AS count FROM "OrganizationMembership"`)).rows[0].count).toBe(0);

      expect((await runBackfill(url, true)).ok).toBe(true);
      expect((await scalar(url, `SELECT "status", "slug" FROM "Organization" WHERE id = $1`, [BOOTSTRAP_ORGANIZATION_ID])).rows[0]).toMatchObject({ status: "ACTIVE", slug: "legacy-organization" });
      expect((await scalar(url, `SELECT count(*)::int AS count FROM "OrganizationMembership" WHERE role = 'OWNER' AND active`)).rows[0].count).toBe(1);
      expect((await scalar(url, `SELECT role, active FROM "OrganizationMembership" WHERE "userId" = 'legacy-agent'`)).rows[0]).toMatchObject({ role: "AGENT", active: true });
      for (const table of PROTECTED_TENANT_TABLES) expect((await scalar(url, `SELECT count(*)::int AS count FROM "${table}" WHERE "organizationId" IS NULL`)).rows[0].count).toBe(0);
      expect((await runBackfill(url, true)).ok).toBe(true);
      expect((await scalar(url, `SELECT count(*)::int AS count FROM "OrganizationMembership"`)).rows[0].count).toBe(2);

      const pool = new Pool({ connectionString: url, max: 1 });
      const client = await pool.connect();
      try {
        expect((await auditTenantFoundation(client)).ok).toBe(true);
        await client.query(`INSERT INTO "User" (id,email,name,"passwordHash",role,active,"createdAt","updatedAt") VALUES ('new-agent','new-agent@example.test','New Agent','fixture','AGENT',true,now(),now())`);
        expect((await client.query(`SELECT role, active FROM "OrganizationMembership" WHERE "userId" = 'new-agent'`)).rows[0]).toMatchObject({ role: "AGENT", active: true });
        await client.query(`UPDATE "User" SET role = 'ADMIN', active = false WHERE id = 'new-agent'`);
        expect((await client.query(`SELECT role, active FROM "OrganizationMembership" WHERE "userId" = 'new-agent'`)).rows[0]).toMatchObject({ role: "ADMIN", active: false });
        expect((await client.query(`SELECT count(*)::int AS count FROM "OrganizationMembership" WHERE "userId" = 'system-user-0000'`)).rows[0].count).toBe(0);
        await expect(client.query(`UPDATE "User" SET role = 'AGENT' WHERE id = 'legacy-admin'`)).rejects.toThrow(/POLICYDESK_OWNER_IMMUTABLE/);
        await expect(client.query(`DELETE FROM "User" WHERE id = 'legacy-admin'`)).rejects.toThrow(/POLICYDESK_OWNER_IMMUTABLE/);
        await expect(client.query(`INSERT INTO "Organization" (id,name,slug,status,"timeZone","defaultCurrency") VALUES ('second-org','Second','second-org','ACTIVE','Etc/GMT+6','MXN')`)).rejects.toThrow();
        await client.query(`INSERT INTO "Client" (id,"fullName",status,"createdAt","updatedAt") VALUES ('direct-client','Direct Client','ACTIVE',now(),now())`);
        expect((await client.query(`SELECT "organizationId" FROM "Client" WHERE id = 'direct-client'`)).rows[0].organizationId).toBe(BOOTSTRAP_ORGANIZATION_ID);
        await expect(client.query(`UPDATE "Client" SET "organizationId" = NULL WHERE id = 'direct-client'`)).rejects.toThrow(/POLICYDESK_ORGANIZATION_IMMUTABLE/);
      } finally { client.release(); await pool.end(); }

      // Exercise the distinct Prisma write mechanisms used by application code;
      // the database barrier must cover them even without a Prisma extension.
      const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
      try {
        await prisma.client.create({ data: { id: "prisma-create", organizationId: BOOTSTRAP_ORGANIZATION_ID, fullName: "Prisma create" } });
        await prisma.client.createMany({ data: [{ id: "prisma-many-1", organizationId: BOOTSTRAP_ORGANIZATION_ID, fullName: "Prisma many one" }, { id: "prisma-many-2", organizationId: BOOTSTRAP_ORGANIZATION_ID, fullName: "Prisma many two" }] });
        await prisma.client.upsert({ where: { id: "prisma-upsert" }, create: { id: "prisma-upsert", organizationId: BOOTSTRAP_ORGANIZATION_ID, fullName: "Prisma upsert" }, update: { fullName: "Prisma upsert changed" } });
        await prisma.client.create({ data: { id: "prisma-nested-client", organizationId: BOOTSTRAP_ORGANIZATION_ID, fullName: "Prisma nested client" } });
        await prisma.quote.create({ data: { id: "prisma-nested", organizationId: BOOTSTRAP_ORGANIZATION_ID, clientId: "prisma-nested-client", policyType: "AUTO", requestedDate: new Date() } });
        await prisma.$transaction(async (tx) => tx.client.create({ data: { id: "prisma-transaction", organizationId: BOOTSTRAP_ORGANIZATION_ID, fullName: "Prisma transaction" } }));
      } finally { await prisma.$disconnect(); }
      expect((await scalar(url, `SELECT count(*)::int AS count FROM "Client" WHERE id LIKE 'prisma-%' AND "organizationId" IS NULL`)).rows[0].count).toBe(0);
      expect((await scalar(url, `SELECT "organizationId" FROM "Quote" WHERE id = 'prisma-nested'`)).rows[0].organizationId).toBe(BOOTSTRAP_ORGANIZATION_ID);
    } finally { await dropDatabase(adminUrl, name); }
  }, 120_000);

  it("rejects invalid Owners and rolls all late failures back", async () => {
    const adminUrl = process.env.RESTORE_INTEGRATION_ADMIN_URL ?? process.env.DATABASE_URL;
    if (!adminUrl) throw new Error("RESTORE_INTEGRATION_ADMIN_URL or DATABASE_URL is required.");
    const name = `org_transition_fail_${process.pid}_${Date.now()}`.replace(/[^a-z0-9_]/gi, "").toLowerCase();
    const url = databaseUrl(adminUrl, name);
    try {
      await createDatabase(adminUrl, name);
      await migrate(url);
      await seedLegacy(url, true);
      await expect(runBackfill(url, true, "agent@example.test")).rejects.toThrow(/ADMIN activo/);
      await expect(runBackfill(url, true)).rejects.toThrow(/POLICYDESK_LEGACY_USER_ROLE_UNSUPPORTED/);
      expect((await scalar(url, `SELECT "status", name FROM "Organization" WHERE id = $1`, [BOOTSTRAP_ORGANIZATION_ID])).rows[0]).toMatchObject({ status: "BOOTSTRAP", name: "PolicyDesk Legacy Organization" });
      expect((await scalar(url, `SELECT count(*)::int AS count FROM "OrganizationMembership"`)).rows[0].count).toBe(0);
      expect((await scalar(url, `SELECT "organizationId" FROM "Client" WHERE id = 'legacy-client'`)).rows[0].organizationId).toBeNull();
    } finally { await dropDatabase(adminUrl, name); }
  }, 120_000);
});
