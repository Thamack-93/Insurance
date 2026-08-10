import { Pool } from "pg";
import {
  DEPLOYMENT_IDENTITY_ID,
  canonicalNeonEndpointId,
  evaluateDeploymentDatabaseSafety,
} from "../src/lib/deployment-db-safety.ts";

type StoredIdentity = { environment: string; fingerprint: string } | null;
type IdentityState = { identity: StoredIdentity; guardsValid: boolean };

async function readIdentity(connectionString: string, applicationName: string): Promise<IdentityState> {
  const pool = new Pool({ connectionString, max: 1, application_name: applicationName });
  try {
    const [identityResult, guardResult] = await Promise.all([
      pool.query<{ environment: string; fingerprint: string }>(
        `SELECT "environment"::text AS environment, "fingerprint" FROM "DeploymentIdentity" WHERE "id" = $1`,
        [DEPLOYMENT_IDENTITY_ID],
      ),
      pool.query<{ trigger_name: string; enabled: string; function_name: string }>(
        `SELECT trigger_definition.tgname AS trigger_name,
                trigger_definition.tgenabled AS enabled,
                function_definition.proname AS function_name
           FROM pg_trigger trigger_definition
           JOIN pg_class table_definition ON table_definition.oid = trigger_definition.tgrelid
           JOIN pg_proc function_definition ON function_definition.oid = trigger_definition.tgfoid
          WHERE table_definition.relname = 'DeploymentIdentity'
            AND NOT trigger_definition.tgisinternal`,
      ),
    ]);
    const expectedTriggers = new Set(["DeploymentIdentity_guard", "DeploymentIdentity_truncate_guard"]);
    const validTriggers = guardResult.rows.filter(
      (row) => row.enabled === "O" && row.function_name === "policydesk_guard_deployment_identity",
    );
    return {
      identity: identityResult.rows[0] ?? null,
      guardsValid: validTriggers.length === expectedTriggers.size && validTriggers.every((row) => expectedTriggers.has(row.trigger_name)),
    };
  } finally {
    await pool.end();
  }
}

async function main() {
  const pooledUrl = process.env.DATABASE_URL?.trim();
  const directUrl = process.env.DATABASE_URL_UNPOOLED?.trim();
  if (!pooledUrl || !directUrl) throw new Error("DATABASE_URL y DATABASE_URL_UNPOOLED son obligatorias.");
  const [pooled, direct] = await Promise.all([
    readIdentity(pooledUrl, "policydesk-deployment-safety-pooled"),
    readIdentity(directUrl, "policydesk-deployment-safety-direct"),
  ]);
  const safety = evaluateDeploymentDatabaseSafety({
    expectedEnvironment: process.env.EXPECTED_DATABASE_ENV,
    expectedFingerprint: process.env.EXPECTED_DATABASE_FINGERPRINT,
    vercel: process.env.VERCEL,
    vercelEnvironment: process.env.VERCEL_ENV,
    actualEnvironment: pooled.identity?.environment,
    actualFingerprint: pooled.identity?.fingerprint,
  });
  const identitiesMatch = Boolean(
    pooled.identity && direct.identity &&
    pooled.identity.environment === direct.identity.environment &&
    pooled.identity.fingerprint === direct.identity.fingerprint,
  );
  const endpointsMatch = canonicalNeonEndpointId(pooledUrl) === canonicalNeonEndpointId(directUrl);
  const guardsValid = pooled.guardsValid && direct.guardsValid;
  const pass = safety.safe && identitiesMatch && endpointsMatch && guardsValid;
  console.log(JSON.stringify({
    status: pass ? "PASS" : "FAIL",
    expectedEnvironment: safety.expectedEnvironment,
    actualEnvironment: safety.actualEnvironment,
    runtimeEnvironmentMatches: safety.runtimeEnvironmentMatches,
    fingerprintMatches: safety.fingerprintMatches,
    pooledAndDirectIdentityMatch: identitiesMatch,
    pooledAndDirectEndpointMatch: endpointsMatch,
    identityGuardsValid: guardsValid,
  }));
  if (!pass) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "FAIL", error: error instanceof Error ? error.message : "Safety check failed." }));
  process.exitCode = 1;
});
