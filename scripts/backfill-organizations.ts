import "dotenv/config";

import { Pool, type PoolClient } from "pg";
import {
  auditTenantFoundation,
  BACKFILL_LOCK_KEY,
  BOOTSTRAP_ORGANIZATION_ID,
  PROTECTED_TENANT_TABLES,
  SYSTEM_USER_ID,
} from "../src/lib/tenant-organization-foundation.ts";

type Inputs = {
  name: string;
  slug: string;
  timeZone: string;
  currency: string;
  ownerEmail: string;
};

function parseArgs() {
  const args = new Set(process.argv.slice(2));
  return { apply: args.has("--apply"), json: args.has("--json") };
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta la variable ${name}.`);
  return value;
}

function inputs(): Inputs {
  const value = {
    name: requiredEnv("LEGACY_ORGANIZATION_NAME"),
    slug: requiredEnv("LEGACY_ORGANIZATION_SLUG"),
    timeZone: requiredEnv("LEGACY_ORGANIZATION_TIME_ZONE"),
    currency: requiredEnv("LEGACY_ORGANIZATION_DEFAULT_CURRENCY"),
    ownerEmail: requiredEnv("LEGACY_ORGANIZATION_OWNER_EMAIL").toLowerCase(),
  };
  if (value.name.length > 120) throw new Error("POLICYDESK_ORGANIZATION_NAME_INVALID");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug) || value.slug.length < 3 || value.slug.length > 63) throw new Error("POLICYDESK_ORGANIZATION_SLUG_INVALID");
  if (!/^[A-Z]{3}$/.test(value.currency)) throw new Error("POLICYDESK_ORGANIZATION_CURRENCY_INVALID");
  try { Intl.DateTimeFormat("en-US", { timeZone: value.timeZone }).format(); }
  catch { throw new Error("POLICYDESK_ORGANIZATION_TIME_ZONE_INVALID"); }
  return value;
}

function connectionString() {
  const value = process.env.DATABASE_URL_UNPOOLED?.trim();
  if (!value) throw new Error("El backfill requiere DATABASE_URL_UNPOOLED para una conexión administrativa directa.");
  const url = new URL(value);
  if (/pooler/i.test(url.hostname)) throw new Error("El backfill rechaza una conexión pooled/PgBouncer.");
  return value;
}

function productionGuard() {
  if (process.env.ALLOW_ORGANIZATION_BACKFILL_PRODUCTION === "1") return;
  const labels = [process.env.NODE_ENV, process.env.VERCEL_ENV, process.env.APP_ENV, process.env.DATABASE_ENV, process.env.SCRIPT_TARGET_ENV, process.env.DATABASE_URL_UNPOOLED].filter(Boolean).join(" ");
  if (!/(development|dev|test|preview|staging|temporary|temp)/i.test(labels) || /(production|prod)/i.test(labels)) {
    throw new Error("Backfill rechazado fuera de un entorno explícitamente no productivo. Define ALLOW_ORGANIZATION_BACKFILL_PRODUCTION=1 solo con autorización.");
  }
}

async function counts(client: PoolClient) {
  const result: Record<string, number> = {};
  for (const table of PROTECTED_TENANT_TABLES) {
    const row = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM "${table}" WHERE "organizationId" IS NULL`);
    result[table] = Number(row.rows[0]?.count ?? 0);
  }
  return result;
}

async function run(client: PoolClient, input: Inputs, apply: boolean) {
  const lockClause = apply ? " FOR UPDATE" : "";
  const organization = await client.query<{ id: string; name: string; slug: string; status: string }>(`SELECT "id","name","slug","status" FROM "Organization" WHERE "id" = $1${lockClause}`, [BOOTSTRAP_ORGANIZATION_ID]);
  if (organization.rowCount !== 1) throw new Error("POLICYDESK_ORGANIZATION_NOT_BOOTSTRAPPED");
  const owner = await client.query<{ id: string; email: string; role: string; active: boolean }>(`SELECT "id","email","role","active" FROM "User" WHERE lower("email") = $1 AND "id" <> $2${lockClause}`, [input.ownerEmail, SYSTEM_USER_ID]);
  if (owner.rowCount !== 1) throw new Error("El email del Owner debe identificar exactamente un usuario no técnico.");
  if (owner.rows[0].role !== "ADMIN" || !owner.rows[0].active) throw new Error("El Owner seleccionado debe ser un ADMIN activo; no se modifica User.role en este backfill.");

  const existingOwner = await client.query<{ id: string; userId: string; active: boolean }>(`SELECT "id","userId","active" FROM "OrganizationMembership" WHERE "organizationId" = $1 AND "role" = 'OWNER'${lockClause}`, [BOOTSTRAP_ORGANIZATION_ID]);
  if (existingOwner.rows.some((row) => row.userId !== owner.rows[0].id)) throw new Error("POLICYDESK_MULTIPLE_OWNERS");

  const nullCounts = await counts(client);
  if (!apply) return { organization: organization.rows[0], owner: owner.rows[0], nullCounts };

  await client.query(`UPDATE "Organization" SET "name" = $2, "slug" = $3, "timeZone" = $4, "defaultCurrency" = $5, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $1`, [BOOTSTRAP_ORGANIZATION_ID, input.name, input.slug, input.timeZone, input.currency]);
  const users = await client.query<{ id: string; role: string; active: boolean }>(`SELECT "id","role","active" FROM "User" WHERE "id" <> $1 ORDER BY "id"`, [SYSTEM_USER_ID]);
  for (const user of users.rows) {
    if (user.role !== "ADMIN" && user.role !== "AGENT") throw new Error("POLICYDESK_LEGACY_USER_ROLE_UNSUPPORTED");
    const membershipRole = user.id === owner.rows[0].id ? "OWNER" : user.role;
    await client.query(`INSERT INTO "OrganizationMembership" ("id","organizationId","userId","role","active") VALUES ($1,$2,$3,$4,$5) ON CONFLICT ("organizationId","userId") DO UPDATE SET "role" = EXCLUDED."role", "active" = EXCLUDED."active", "updatedAt" = CURRENT_TIMESTAMP`, [`om_${user.id}`, BOOTSTRAP_ORGANIZATION_ID, user.id, membershipRole, user.active]);
  }
  for (const table of PROTECTED_TENANT_TABLES) {
    await client.query(`UPDATE "${table}" SET "organizationId" = $1 WHERE "organizationId" IS NULL`, [BOOTSTRAP_ORGANIZATION_ID]);
  }
  let audit = await auditTenantFoundation(client, { requireActive: false });
  if (!audit.ok) throw new Error(`Backfill validation failed: ${audit.issues.join("; ")}`);
  await client.query(`UPDATE "Organization" SET "status" = 'ACTIVE', "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $1`, [BOOTSTRAP_ORGANIZATION_ID]);
  audit = await auditTenantFoundation(client, { requireActive: true });
  if (!audit.ok) throw new Error(`Final tenant audit failed: ${audit.issues.join("; ")}`);
  return { organization: { ...organization.rows[0], name: input.name, slug: input.slug, status: "ACTIVE" }, owner: owner.rows[0], nullCounts, audit: audit.summary };
}

async function main() {
  const { apply, json } = parseArgs();
  const input = inputs();
  if (apply) productionGuard();
  const pool = new Pool({ connectionString: connectionString(), max: 1 });
  const client = await pool.connect();
  try {
    await client.query(apply ? "BEGIN ISOLATION LEVEL SERIALIZABLE" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    if (apply) {
      await client.query("SET LOCAL lock_timeout = '30s'");
      await client.query("SET LOCAL statement_timeout = '5min'");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [BACKFILL_LOCK_KEY]);
    }
    const result = await run(client, input, apply);
    await client.query("COMMIT");
    const payload = { mode: apply ? "apply" : "preview", ok: true, result };
    if (json) console.log(JSON.stringify(payload, null, 2));
    else console.log(`${apply ? "Backfill aplicado" : "Preview de backfill"}. Organización ${result.organization.status}; filas null detectadas: ${Object.values(result.nullCounts).reduce((a, b) => a + b, 0)}.`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const message = error instanceof Error ? error.message : String(error);
    const payload = { mode: apply ? "apply" : "preview", ok: false, error: /lock timeout|55P03/i.test(message) ? "POLICYDESK_BACKFILL_LOCK_TIMEOUT" : message };
    if (json) console.error(JSON.stringify(payload, null, 2)); else console.error(payload.error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
