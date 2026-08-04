import "dotenv/config";
import { Pool, type PoolClient } from "pg";
import { PROTECTED_TENANT_TABLES, BOOTSTRAP_ORGANIZATION_ID } from "../src/lib/tenant-organization-foundation.ts";

const TARGET_ID = "org_pedro_gomez_0001";
const TARGET_SLUG = "pedro-gomez";
const PEDRO_EMAIL = "pedroagl93@gmail.com";

function parseArgs() { const args = new Set(process.argv.slice(2)); return { apply: args.has("--apply"), json: args.has("--json") }; }
function quote(value: string) { return `"${value.replaceAll('"', '""')}"`; }
function connectionString() { const value = process.env.DATABASE_URL_UNPOOLED?.trim(); if (!value) throw new Error("PEDRO_SPLIT_DATABASE_URL_REQUIRED"); return value; }

async function columns(client: PoolClient, table: string) {
  const result = await client.query<{ column_name: string }>(`SELECT "column_name" FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [table]);
  return new Set(result.rows.map((row) => row.column_name));
}

async function main() {
  const { apply, json } = parseArgs();
  if (apply && (process.env.ALLOW_MULTI_ORG_TRANSITION !== "1" || process.env.ALLOW_PEDRO_ORGANIZATION_SPLIT !== "1")) throw new Error("PEDRO_SPLIT_REQUIRES_EXPLICIT_MULTI_ORG_AUTHORIZATION");
  const pool = new Pool({ connectionString: connectionString(), max: 1 });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const barrier = await client.query<{ exists: boolean }>(`SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'Organization_transition_singleton_idx') AS exists`);
    if (barrier.rows[0]?.exists) throw new Error("PEDRO_SPLIT_SINGLETON_BARRIER_ACTIVE");
    const pedro = await client.query<{ id: string; timeZone: string }>(`SELECT "id","timeZone" FROM "User" WHERE lower("email") = $1 AND "active"`, [PEDRO_EMAIL]);
    if (pedro.rowCount !== 1) throw new Error("PEDRO_ACTIVE_USER_NOT_UNIQUE");
    const target = await client.query(`SELECT "id" FROM "Organization" WHERE "id" = $1`, [TARGET_ID]);
    const result: { targetCreated: boolean; moved: Record<string, number>; conflicts: Array<{ table: string; count: number }>; ownerUserId: string } = { targetCreated: target.rowCount === 0, moved: {}, conflicts: [], ownerUserId: pedro.rows[0].id };
    if (apply) {
      await client.query(`INSERT INTO "Organization" ("id","name","slug","status","timeZone","defaultCurrency") VALUES ($1,'Pedro Gómez',$2,'ACTIVE',$3,'MXN') ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "slug" = EXCLUDED."slug", "timeZone" = EXCLUDED."timeZone", "defaultCurrency" = EXCLUDED."defaultCurrency"`, [TARGET_ID, TARGET_SLUG, pedro.rows[0].timeZone]);
      const trial = await client.query<{ id: string }>(`SELECT "id" FROM "Plan" WHERE "code" = 'TRIAL' AND "active" LIMIT 1`);
      if (trial.rowCount !== 1) throw new Error("PEDRO_SPLIT_TRIAL_PLAN_MISSING");
      await client.query(`INSERT INTO "OrganizationMembership" ("id","organizationId","userId","role","active") VALUES ($1,$2,$3,'OWNER',true) ON CONFLICT ("organizationId","userId") DO UPDATE SET "role" = 'OWNER', "active" = true`, [`om_pedro_gomez_0001_${pedro.rows[0].id}`, TARGET_ID, pedro.rows[0].id]);
      await client.query(`INSERT INTO "OrganizationSubscription" ("id","organizationId","planId","status","monthlyAmountMinor","currency") SELECT $1,$2,"id",'TRIAL',0,'MXN' FROM "Plan" WHERE "code" = 'TRIAL' AND NOT EXISTS (SELECT 1 FROM "OrganizationSubscription" WHERE "organizationId" = $2 AND "status" IN ('TRIAL','ACTIVE'))`, [`sub_pedro_gomez_0001`, TARGET_ID]);
    }
    for (const table of PROTECTED_TENANT_TABLES) {
      const available = await columns(client, table);
      if (!available.has("organizationId")) continue;
      const ownership = ["portfolioOwnerId", "createdById"].filter((name) => available.has(name));
      if (!ownership.length) continue;
      const conflictPredicate = available.has("portfolioOwnerId") && available.has("createdById") ? `${quote("createdById")} = $2 AND ${quote("portfolioOwnerId")} IS NOT NULL AND ${quote("portfolioOwnerId")} <> $2` : "FALSE";
      const conflicts = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${quote(table)} WHERE ${quote("organizationId")} = $1 AND (${conflictPredicate})`, [BOOTSTRAP_ORGANIZATION_ID, pedro.rows[0].id]);
      const conflictCount = Number(conflicts.rows[0]?.count ?? 0);
      if (conflictCount) result.conflicts.push({ table, count: conflictCount });
      if (!apply) continue;
      if (conflictCount && available.has("id")) {
        await client.query(`INSERT INTO "OrganizationMigrationConflict" ("id","sourceOrganizationId","targetOrganizationId","tableName","rowId","reason","detailsJson") SELECT concat('pedro_', md5(${quote("id")}::text)), $1, $2, $3, ${quote("id")}::text, 'CREATED_BY_AND_OTHER_OWNER_CONFLICT', $4 FROM ${quote(table)} WHERE ${quote("organizationId")} = $1 AND (${conflictPredicate}) ON CONFLICT ("id") DO NOTHING`, [BOOTSTRAP_ORGANIZATION_ID, TARGET_ID, table, JSON.stringify({ ownerUserId: pedro.rows[0].id })]);
      }
      const movePredicate = ownership.map((name) => `${quote(name)} = $2`).join(" OR ");
      const moved = await client.query(`UPDATE ${quote(table)} SET ${quote("organizationId")} = $3 WHERE ${quote("organizationId")} = $1 AND (${movePredicate}) AND NOT (${conflictPredicate})`, [BOOTSTRAP_ORGANIZATION_ID, pedro.rows[0].id, TARGET_ID]);
      result.moved[table] = moved.rowCount ?? 0;
    }
    if (apply) {
      for (const table of PROTECTED_TENANT_TABLES) {
        const available = await columns(client, table);
        if (!available.has("organizationId")) continue;
        const nulls = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM ${quote(table)} WHERE ${quote("organizationId")} IS NULL`, []);
        if (Number(nulls.rows[0]?.count ?? 0) > 0) throw new Error(`PEDRO_SPLIT_NULL_TENANT_ROWS:${table}`);
      }
      await client.query("COMMIT");
    } else {
      await client.query("ROLLBACK");
    }
    const output = { mode: apply ? "apply" : "preview", ok: true, result };
    if (json) console.log(JSON.stringify(output, null, 2)); else console.log(`${apply ? "Separación aplicada" : "Preview de separación"}. Conflictos: ${result.conflicts.reduce((sum, item) => sum + item.count, 0)}.`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    const output = { mode: apply ? "apply" : "preview", ok: false, error: error instanceof Error ? error.message : "PEDRO_SPLIT_FAILED" };
    if (json) console.error(JSON.stringify(output, null, 2)); else console.error(output.error);
    process.exitCode = 1;
  } finally { client.release(); await pool.end(); }
}

void main();
