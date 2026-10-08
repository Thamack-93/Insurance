import "dotenv/config";

import { Pool } from "pg";
import { PROTECTED_TENANT_TABLES } from "../src/lib/tenant-organization-foundation.ts";
import { assertDisposableCertificationTarget, canonicalNeonHost, certificationPurpose } from "./tenant-certification-target.mjs";

function requireDisposableEnv() {
  if (process.env.TENANT_ISOLATION_TEST_DB !== "1" || process.env.PLAYWRIGHT_ENFORCE_DISPOSABLE_DB !== "1") {
    throw new Error("RLS role tests require the disposable tenant database guard.");
  }
}

function connectionUser(value: string) {
  return decodeURIComponent(new URL(value).username);
}

async function main() {
  requireDisposableEnv();
  const appRole = process.env.TENANT_RLS_APP_ROLE?.trim();
  const orgA = process.env.TENANT_RLS_ORG_A?.trim();
  const orgB = process.env.TENANT_RLS_ORG_B?.trim();
  const adminUrl = process.env.DATABASE_ADMIN_URL?.trim();
  const runtimeUrl = process.env.TENANT_RLS_RUNTIME_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!appRole || !orgA || !orgB || orgA === orgB) throw new Error("TENANT_RLS_APP_ROLE, TENANT_RLS_ORG_A and TENANT_RLS_ORG_B are required.");
  if (!adminUrl || !runtimeUrl) throw new Error("DATABASE_ADMIN_URL and TENANT_RLS_RUNTIME_DATABASE_URL (or DATABASE_URL) are required.");
  const adminTarget = new URL(adminUrl);
  const runtimeTarget = new URL(runtimeUrl);
  const certificationTarget = assertDisposableCertificationTarget(adminUrl, process.env, certificationPurpose());
  if (certificationTarget.mode === "local") {
    if (!["localhost", "127.0.0.1", "::1"].includes(runtimeTarget.hostname.toLowerCase())) {
      throw new Error("RLS_RUNTIME_DATABASE_MUST_MATCH_LOCAL_DISPOSABLE_TARGET");
    }
  } else {
    if (!/-pooler(?=\.)/.test(runtimeTarget.hostname) || canonicalNeonHost(runtimeTarget.hostname) !== certificationTarget.host) {
      throw new Error("RLS_RUNTIME_DATABASE_MUST_USE_CERTIFICATION_BRANCH_POOLER");
    }
  }
  if (connectionUser(runtimeUrl) !== appRole) throw new Error("RLS_RUNTIME_CONNECTION_MUST_USE_APP_ROLE");
  if (connectionUser(adminUrl) === appRole) throw new Error("RLS_ADMIN_CONNECTION_MUST_NOT_USE_APP_ROLE");
  if (adminTarget.pathname !== runtimeTarget.pathname) throw new Error("RLS_ADMIN_AND_RUNTIME_TARGET_MISMATCH");

  const admin = new Pool({ connectionString: adminUrl, max: 1, application_name: "policydesk-tenant-rls-admin-certification" });
  const runtime = new Pool({ connectionString: runtimeUrl, max: 4, application_name: "policydesk-tenant-rls-runtime-certification" });
  const adminClient = await admin.connect();
  try {
    const role = await adminClient.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean; rolcanlogin: boolean }>(
      "SELECT rolname, rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = $1", [appRole],
    );
    const appRoleRow = role.rows[0];
    if (!appRoleRow || appRoleRow.rolsuper || appRoleRow.rolbypassrls || !appRoleRow.rolcanlogin) throw new Error("RLS_APP_ROLE_IS_NOT_RESTRICTED_LOGIN_ROLE");

    const privilegedFunctions = await adminClient.query<{ proname: string; has_execute: boolean }>(`
      SELECT p.proname, has_function_privilege($1, p.oid, 'EXECUTE') AS has_execute
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.prosecdef
    `, [appRole]);
    const allowed = new Set(["policydesk_platform_tenant_metrics"]);
    for (const fn of privilegedFunctions.rows) if (fn.has_execute && !allowed.has(fn.proname)) throw new Error(`RLS_UNAPPROVED_SECURITY_DEFINER:${fn.proname}`);

    const rls = await adminClient.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
    `, [PROTECTED_TENANT_TABLES]);
    const rlsByTable = new Map(rls.rows.map((row) => [row.relname, row]));
    for (const table of PROTECTED_TENANT_TABLES) {
      const row = rlsByTable.get(table);
      if (!row?.relrowsecurity || !row.relforcerowsecurity) throw new Error(`RLS_NOT_FORCED:${table}`);
    }

    const client = await runtime.connect();
    try {
      const currentUser = await client.query<{ current_user: string }>("SELECT current_user");
      if (currentUser.rows[0]?.current_user !== appRole) throw new Error("RLS_RUNTIME_ROLE_ESCAPED");
      const roleAttributes = await client.query<{ rolsuper: boolean; rolbypassrls: boolean }>("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user");
      if (roleAttributes.rows[0]?.rolsuper || roleAttributes.rows[0]?.rolbypassrls) throw new Error("RLS_RUNTIME_ROLE_ESCAPED");

      // The one approved SECURITY DEFINER aggregate must be callable by the
      // runtime role, but it may only return the explicitly requested tenant
      // ids. This proves the function-owner grants are minimal and usable.
      const metrics = await client.query<{ organizationId: string }>(
        "SELECT \"organizationId\" FROM policydesk_platform_tenant_metrics($1::text[]) ORDER BY \"organizationId\"",
        [[orgA]],
      );
      if (metrics.rows.length !== 1 || metrics.rows[0]?.organizationId !== orgA) throw new Error("RLS_PLATFORM_AGGREGATE_SCOPE_FAILED");

      // A pooled connection must start empty and return empty after commit;
      // transaction-local GUCs may never contaminate its next borrower.
      await client.query("BEGIN");
      for (const table of PROTECTED_TENANT_TABLES) {
        const noContext = await client.query(`SELECT count(*)::int AS count FROM "${table}"`);
        if (Number(noContext.rows[0]?.count ?? 0) !== 0) throw new Error(`RLS_NO_CONTEXT_LEAK:${table}`);
      }
      await client.query("COMMIT");

      // A write without context must raise rather than merely report a
      // successful zero-row UPDATE/DELETE under the RLS USING predicate.
      await expectRejected("RLS_NO_CONTEXT_UPDATE_NOT_REJECTED", async () => {
        await client.query("BEGIN");
        try {
          await client.query('UPDATE "Client" SET "notes" = \'blocked-without-context\'');
        } finally {
          await client.query("ROLLBACK").catch(() => undefined);
        }
      });
      await expectRejected("RLS_NO_CONTEXT_DELETE_NOT_REJECTED", async () => {
        await client.query("BEGIN");
        try {
          await client.query('DELETE FROM "Client"');
        } finally {
          await client.query("ROLLBACK").catch(() => undefined);
        }
      });
      await expectRejected("RLS_NO_CONTEXT_INSERT_NOT_REJECTED", async () => {
        await client.query("BEGIN");
        try {
          await client.query(`INSERT INTO "Client" ("id", "organizationId", "fullName", "type", "status") VALUES ('rls-no-context-insert', $1, 'RLS blocked', 'PERSON', 'ACTIVE')`, [orgA]);
        } finally {
          await client.query("ROLLBACK").catch(() => undefined);
        }
      });

      // The restricted runtime role must not be able to bypass row security,
      // even when it has ordinary DML grants on protected tables. PostgreSQL
      // may accept the SET itself, so assert that a protected read still
      // rejects while row_security is disabled.
      await expectRejected("RLS_APP_ROLE_CAN_DISABLE_RLS", async () => {
        await client.query("BEGIN");
        try {
          await client.query("SET LOCAL row_security = off");
          await client.query('SELECT count(*) FROM "Client"');
        } finally {
          await client.query("ROLLBACK").catch(() => undefined);
        }
      });

      const countFor = async (organizationId: string) => {
        await client.query("BEGIN");
        try {
          await client.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
          const result = await client.query('SELECT count(*)::int AS count FROM "Client"');
          const foreign = await client.query('SELECT count(*)::int AS count FROM "Client" WHERE "organizationId" <> $1', [organizationId]);
          if (Number(foreign.rows[0]?.count ?? 0) !== 0) throw new Error("RLS_CROSS_TENANT_READ_LEAK");
          await client.query("COMMIT");
          return Number(result.rows[0]?.count ?? 0);
        } catch (error) {
          await client.query("ROLLBACK").catch(() => undefined);
          throw error;
        }
      };
      const visibleA = await countFor(orgA);
      const visibleB = await countFor(orgB);
      if (visibleA === 0 || visibleB === 0) throw new Error("RLS_FIXTURE_ORGANIZATIONS_EMPTY");
      // This is a fresh transaction on the same pooled session: A/B context
      // must not survive the commit above.
      await client.query("BEGIN");
      const clean = await client.query('SELECT count(*)::int AS count FROM "Client"');
      if (Number(clean.rows[0]?.count ?? 0) !== 0) throw new Error("RLS_POOL_CONTEXT_CONTAMINATION");
      await client.query("ROLLBACK");

      await client.query("BEGIN");
      try {
        await client.query("SELECT set_config('app.organization_id', $1, true)", [orgA]);
        const crossTenant = await client.query('SELECT count(*)::int AS count FROM "Client" WHERE "organizationId" = $1', [orgB]);
        const crossWrite = await client.query('UPDATE "Client" SET "notes" = \'blocked\' WHERE "organizationId" = $1', [orgB]);
        const crossDelete = await client.query('DELETE FROM "Client" WHERE "organizationId" = $1', [orgB]);
        if (Number(crossTenant.rows[0]?.count ?? 0) !== 0 || (crossWrite.rowCount ?? 0) !== 0 || (crossDelete.rowCount ?? 0) !== 0) throw new Error("RLS_CROSS_TENANT_MUTATION_LEAK");
        const relationLeak = await client.query<{ count: number }>(`SELECT count(*)::int AS count FROM "Policy" p JOIN "Client" c ON c."id" = p."clientId" WHERE p."organizationId" = $1 AND c."organizationId" = $2`, [orgA, orgB]);
        if (Number(relationLeak.rows[0]?.count ?? 0) !== 0) throw new Error("RLS_CROSS_TENANT_RELATION_LEAK");
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
      }

      // Reuse pooled connections under concurrency. Every worker alternates
      // tenants and then starts a fresh transaction; a transaction-local GUC
      // must never leak to the next borrower.
      const pooledWorker = async (worker: number) => {
        const pooled = await runtime.connect();
        try {
          const organizationId = worker % 2 === 0 ? orgA : orgB;
          await pooled.query("BEGIN");
          await pooled.query("SELECT set_config('app.organization_id', $1, true)", [organizationId]);
          const own = await pooled.query('SELECT count(*)::int AS count FROM "Client" WHERE "organizationId" = $1', [organizationId]);
          const foreign = await pooled.query('SELECT count(*)::int AS count FROM "Client" WHERE "organizationId" <> $1', [organizationId]);
          if (Number(own.rows[0]?.count ?? 0) === 0 || Number(foreign.rows[0]?.count ?? 0) !== 0) throw new Error("RLS_POOL_CROSS_TENANT_LEAK");
          await pooled.query("COMMIT");
          await pooled.query("BEGIN");
          const clean = await pooled.query('SELECT count(*)::int AS count FROM "Client"');
          if (Number(clean.rows[0]?.count ?? 0) !== 0) throw new Error("RLS_POOL_CONTEXT_CONTAMINATION");
          await pooled.query("ROLLBACK");
        } catch (error) {
          await pooled.query("ROLLBACK").catch(() => undefined);
          throw error;
        } finally {
          pooled.release();
        }
      };
      const concurrentWorkers = 24;
      await Promise.all(Array.from({ length: concurrentWorkers }, (_, worker) => pooledWorker(worker)));
      console.log(JSON.stringify({ ok: true, appRole, organizations: [orgA, orgB], protectedTables: PROTECTED_TENANT_TABLES.length, pooledContextChecks: 3 + concurrentWorkers, concurrentWorkers }));
    } finally {
      client.release();
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "RLS_ROLE_TEST_FAILED");
    process.exitCode = 1;
  } finally {
    adminClient.release();
    await runtime.end();
    await admin.end();
  }
}

async function expectRejected(code: string, operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch {
    return;
  }
  throw new Error(code);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "RLS_ROLE_TEST_FAILED");
  process.exitCode = 1;
});
