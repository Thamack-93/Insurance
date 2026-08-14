import "dotenv/config";

import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { auditTenantFoundation, PROTECTED_TENANT_TABLES, SYSTEM_USER_ID } from "../src/lib/tenant-organization-foundation.ts";
import {
  PEDRO_CONFIGURATION_LOCK_KEY,
  PEDRO_ORGANIZATION_CURRENCY,
  PEDRO_ORGANIZATION_ID,
  PEDRO_ORGANIZATION_NAME,
  PEDRO_ORGANIZATION_SLUG,
  PEDRO_ORGANIZATION_TIME_ZONE,
  PEDRO_OWNER_EMAIL,
  planPedroConfiguration,
  validatePedroOrganizationInputs,
  type PedroOrganizationInputs,
  type PedroOrganizationSnapshot,
} from "../src/lib/pedro-organization.logic.ts";

function parseArgs() {
  const values = new Set(process.argv.slice(2));
  return { apply: values.has("--apply"), json: values.has("--json") };
}

function required(name: string, code: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(code);
  return value;
}

function inputs(): PedroOrganizationInputs {
  return validatePedroOrganizationInputs({
    name: process.env.PEDRO_ORGANIZATION_NAME ?? PEDRO_ORGANIZATION_NAME,
    slug: process.env.PEDRO_ORGANIZATION_SLUG ?? PEDRO_ORGANIZATION_SLUG,
    timeZone: process.env.PEDRO_ORGANIZATION_TIME_ZONE ?? PEDRO_ORGANIZATION_TIME_ZONE,
    currency: process.env.PEDRO_ORGANIZATION_CURRENCY ?? PEDRO_ORGANIZATION_CURRENCY,
    ownerEmail: process.env.PEDRO_OWNER_EMAIL ?? PEDRO_OWNER_EMAIL,
  });
}

function connectionString() {
  const value = process.env.DATABASE_URL_UNPOOLED?.trim();
  if (!value) throw new Error("POLICYDESK_PEDRO_DIRECT_DATABASE_REQUIRED");
  const url = new URL(value);
  if (/pooler/i.test(url.hostname)) throw new Error("POLICYDESK_PEDRO_DIRECT_DATABASE_REQUIRED");
  return value;
}

function guardApplyTarget(value: string) {
  const url = new URL(value);
  const loopback = ["localhost", "127.0.0.1", "::1"].includes(url.hostname.toLowerCase());
  if (loopback) return;
  const labels = [process.env.NODE_ENV, process.env.VERCEL_ENV, process.env.APP_ENV, process.env.DATABASE_ENV, process.env.SCRIPT_TARGET_ENV].filter(Boolean).join(" ");
  if (/production|prod/i.test(labels)) {
    if (process.env.ALLOW_PEDRO_ORGANIZATION_PRODUCTION !== "1") throw new Error("POLICYDESK_PEDRO_PRODUCTION_NOT_AUTHORIZED");
    return;
  }
  if (!/preview|staging|temporary|temp|test|development|dev/i.test(labels)) throw new Error("POLICYDESK_PEDRO_TARGET_NOT_EXPLICIT");
}

async function tenantNullCount(client: PoolClient) {
  let total = 0;
  for (const table of PROTECTED_TENANT_TABLES) {
    const result = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM "${table}" WHERE "organizationId" IS NULL`);
    total += Number(result.rows[0]?.count ?? 0);
  }
  return total;
}

async function readSnapshot(client: PoolClient, ownerEmail: string): Promise<PedroOrganizationSnapshot> {
  const organizations = await client.query<{ id: string; status: string }>(`SELECT "id","status" FROM "Organization" ORDER BY "id"`);
  const organization = organizations.rows.length === 1 ? organizations.rows[0] : null;
  const users = await client.query<{ id: string; email: string; active: boolean; role: string; platformRole: string }>(
    `SELECT "id","email","active","role","platformRole" FROM "User" WHERE "id" <> $1 AND "platformRole" <> 'SUPERADMIN' ORDER BY "id"`,
    [SYSTEM_USER_ID],
  );
  const pedro = users.rows.find((row) => row.email.toLowerCase() === ownerEmail);
  const memberships = await client.query<{ userId: string; role: string; active: boolean }>(
    `SELECT "userId","role","active" FROM "OrganizationMembership" ORDER BY "userId"`,
  );
  const owners = memberships.rows.filter((row) => row.role === "OWNER");
  const pedroMembership = pedro ? memberships.rows.find((row) => row.userId === pedro.id) : undefined;
  const audit = await auditTenantFoundation(client, { requireActive: false });
  return {
    organizationStatus: organization?.status ?? null,
    organizationId: organization?.id ?? null,
    nonTechnicalUsers: users.rows.length,
    nonTechnicalUserIds: users.rows.map((row) => row.id),
    ownerUserId: owners[0]?.userId ?? null,
    ownerCount: owners.length,
    pedroUserId: pedro?.id ?? null,
    pedroActive: pedro?.active ?? false,
    pedroLegacyRole: pedro?.role ?? null,
    pedroMembershipRole: pedroMembership?.role ?? null,
    pedroMembershipActive: pedroMembership?.active ?? null,
    tenantNullCount: await tenantNullCount(client),
    tenantAuditOk: audit.ok,
  };
}

function output(json: boolean, payload: Record<string, unknown>) {
  if (json) console.log(JSON.stringify(payload, null, 2));
  else if (payload.ok) console.log(`${String(payload.mode)}: ${String(payload.status)}.`);
  else console.error(String(payload.error));
}

async function main() {
  const { apply, json } = parseArgs();
  let input: PedroOrganizationInputs;
  let connection: string;
  let actorId: string | null;
  let reason: string | null;
  try {
    input = inputs();
    connection = connectionString();
    if (apply) guardApplyTarget(connection);
    actorId = apply ? required("PEDRO_CUTOVER_ACTOR_USER_ID", "POLICYDESK_PEDRO_CUTOVER_ACTOR_REQUIRED") : null;
    reason = apply ? required("PEDRO_CUTOVER_REASON", "POLICYDESK_PEDRO_CUTOVER_REASON_REQUIRED") : null;
    if (reason && (reason.length < 10 || reason.length > 500)) throw new Error("POLICYDESK_PEDRO_CUTOVER_REASON_INVALID");
  } catch (error) {
    const message = error instanceof Error && /^POLICYDESK_[A-Z0-9_]+$/.test(error.message) ? error.message : "POLICYDESK_PEDRO_CONFIGURATION_INPUT_INVALID";
    output(json, { ok: false, mode: apply ? "apply" : "preview", error: message });
    process.exitCode = 1;
    return;
  }

  const pool = new Pool({ connectionString: connection, max: 1, application_name: "policydesk-pedro-organization" });
  const client = await pool.connect();
  try {
    await client.query(apply ? "BEGIN ISOLATION LEVEL SERIALIZABLE" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    if (apply) {
      await client.query("SET LOCAL lock_timeout = '30s'");
      await client.query("SET LOCAL statement_timeout = '5min'");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [PEDRO_CONFIGURATION_LOCK_KEY]);
      await client.query(`SELECT "id" FROM "Organization" WHERE "id" = $1 FOR UPDATE`, [PEDRO_ORGANIZATION_ID]);
    }
    const snapshot = await readSnapshot(client, input.ownerEmail);
    const plan = planPedroConfiguration(snapshot);
    if (plan.status !== "READY") throw new Error(plan.reason);
    if (snapshot.organizationStatus !== "ACTIVE") throw new Error("POLICYDESK_PEDRO_ORGANIZATION_NOT_ACTIVE");
    if (plan.action === "NOOP") {
      await client.query("COMMIT");
      output(json, { ok: true, mode: apply ? "apply" : "preview", status: "NOOP", organizationId: PEDRO_ORGANIZATION_ID, ownerMembership: true });
      return;
    }
    if (!apply) {
      await client.query("COMMIT");
      output(json, { ok: true, mode: "preview", status: "READY", action: "CONFIGURE", organizationId: PEDRO_ORGANIZATION_ID, ownerMembership: true });
      return;
    }

    const actor = await client.query<{ id: string; active: boolean }>(`SELECT "id","active" FROM "User" WHERE "id" = $1 FOR UPDATE`, [actorId]);
    if (actor.rowCount !== 1 || !actor.rows[0].active) throw new Error("POLICYDESK_PEDRO_CUTOVER_ACTOR_INVALID");
    const existingSlug = await client.query<{ id: string }>(`SELECT "id" FROM "Organization" WHERE "slug" = $1 AND "id" <> $2`, [input.slug, PEDRO_ORGANIZATION_ID]);
    if (existingSlug.rowCount) throw new Error("POLICYDESK_PEDRO_ORGANIZATION_SLUG_CONFLICT");

    await client.query(
      `UPDATE "Organization" SET "name"=$2,"slug"=$3,"kind"='CUSTOMER',"timeZone"=$4,"defaultCurrency"=$5,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,
      [PEDRO_ORGANIZATION_ID, input.name, input.slug, input.timeZone, input.currency],
    );
    await client.query(
      `INSERT INTO "ActivityLog" ("id","organizationId","entityType","entityId","action","oldValue","newValue","userId")
       VALUES ($1, $2, 'Organization', $2, 'ORGANIZATION_CONFIGURED_FOR_PEDRO', $3, $4, $5)`,
      [
        `pedro-org-config-${randomUUID().replaceAll("-", "")}`,
        PEDRO_ORGANIZATION_ID,
        JSON.stringify({ id: PEDRO_ORGANIZATION_ID, scope: "organization-metadata" }),
        JSON.stringify({ name: input.name, slug: input.slug, timeZone: input.timeZone, defaultCurrency: input.currency, owner: "single-owner" }),
        actorId,
      ],
    );
    const finalSnapshot = await readSnapshot(client, input.ownerEmail);
    const finalPlan = planPedroConfiguration(finalSnapshot);
    if (finalPlan.status !== "READY" || finalPlan.action !== "NOOP") throw new Error("POLICYDESK_PEDRO_FINAL_STATE_INVALID");
    await client.query("COMMIT");
    output(json, { ok: true, mode: "apply", status: "APPLIED", organizationId: PEDRO_ORGANIZATION_ID, ownerMembership: true, sessionPolicy: "revalidate-on-request" });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const message = error instanceof Error && /^POLICYDESK_[A-Z0-9_]+$/.test(error.message) ? error.message : "POLICYDESK_PEDRO_CONFIGURATION_FAILED";
    output(json, { ok: false, mode: apply ? "apply" : "preview", error: message });
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
