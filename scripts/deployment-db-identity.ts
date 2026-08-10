import { Pool } from "pg";
import { getFlag, hasFlag, parseCliArgs } from "./_shared.ts";
import {
  DEPLOYMENT_IDENTITY_ID,
  canonicalNeonEndpointId,
  deriveDeploymentFingerprint,
  type DeploymentEnvironment,
} from "../src/lib/deployment-db-safety.ts";

const args = parseCliArgs();
const apply = hasFlag(args, "apply");
const json = hasFlag(args, "json");
const rebind = hasFlag(args, "rebind-cloned-branch");

function required(name: string) {
  const value = getFlag(args, name)?.trim();
  if (!value) throw new Error(`Falta --${name}.`);
  return value;
}

function parseEnvironment(value: string): DeploymentEnvironment {
  const normalized = value.trim().toLowerCase();
  if (normalized === "production" || normalized === "preview" || normalized === "development" || normalized === "test") return normalized;
  throw new Error("--environment debe ser production, preview, development o test.");
}

function prismaEnvironment(value: DeploymentEnvironment) {
  return value.toUpperCase();
}

function print(value: Record<string, unknown>) {
  if (json) console.log(JSON.stringify(value));
  else Object.entries(value).forEach(([key, entry]) => console.log(`${key}: ${String(entry)}`));
}

async function main() {
  const connectionString = process.env.DATABASE_URL_UNPOOLED?.trim();
  if (!connectionString) throw new Error("DATABASE_URL_UNPOOLED es obligatoria.");
  const url = new URL(connectionString);
  const environment = parseEnvironment(required("environment"));
  const projectId = required("project-id");
  const branchId = required("branch-id");
  const database = required("database");
  const endpointId = required("endpoint-id").toLowerCase();
  const actualEndpointId = canonicalNeonEndpointId(connectionString);
  const isLocal = ["127.0.0.1", "localhost", "::1"].includes(url.hostname.toLowerCase());
  const requiresProductionComparison = environment === "preview" || rebind;
  const productionBranchId = requiresProductionComparison ? required("production-branch-id") : null;
  const productionEndpointId = requiresProductionComparison ? required("production-endpoint-id").toLowerCase() : null;

  if (url.hostname.toLowerCase().split(".")[0]?.endsWith("-pooler")) {
    throw new Error("La inicialización requiere el endpoint directo, no el pooler.");
  }
  if (actualEndpointId !== endpointId) throw new Error("El endpoint saneado no coincide con --endpoint-id.");
  if ((environment === "production" || environment === "preview") && isLocal) {
    throw new Error("Production/Preview no pueden inicializarse sobre un host local.");
  }
  if (productionBranchId && productionEndpointId && (branchId === productionBranchId || endpointId === productionEndpointId)) {
    throw new Error("El target coincide con la rama o endpoint de Production.");
  }
  if (environment === "production" && apply && process.env.ALLOW_PRODUCTION_DEPLOYMENT_IDENTITY_APPLY !== "1") {
    throw new Error("Production requiere ALLOW_PRODUCTION_DEPLOYMENT_IDENTITY_APPLY=1.");
  }
  if ((environment === "development" || environment === "test") && !isLocal && apply && process.env.ALLOW_REMOTE_NONPRODUCTION_DEPLOYMENT_IDENTITY_APPLY !== "1") {
    throw new Error("Development/Test remotos requieren ALLOW_REMOTE_NONPRODUCTION_DEPLOYMENT_IDENTITY_APPLY=1.");
  }

  const fingerprint = deriveDeploymentFingerprint({ projectId, branchId, databaseIdOrName: database });
  const pool = new Pool({ connectionString, max: 1, application_name: "policydesk-deployment-identity-admin" });
  const client = await pool.connect();
  try {
    const currentResult = await client.query<{ environment: string; fingerprint: string }>(
      `SELECT "environment"::text AS environment, "fingerprint" FROM "DeploymentIdentity" WHERE "id" = $1`,
      [DEPLOYMENT_IDENTITY_ID],
    );
    const current = currentResult.rows[0] ?? null;
    const alreadyMatches = current?.environment === prismaEnvironment(environment) && current.fingerprint === fingerprint;

    if (current && !alreadyMatches) {
      if (!rebind) throw new Error("La identidad existente es distinta; usa el flujo explícito de rebind.");
      if (environment !== "preview" && environment !== "test") throw new Error("El rebind solo puede terminar en Preview o Test.");
      if (!productionBranchId || !productionEndpointId) throw new Error("El rebind requiere la identidad saneada de Production.");
      const expectedPrevious = deriveDeploymentFingerprint({ projectId, branchId: productionBranchId, databaseIdOrName: database });
      if (current.environment !== "PRODUCTION" || current.fingerprint !== expectedPrevious) {
        throw new Error("La identidad heredada no coincide con la Production declarada.");
      }
      if (apply && process.env.ALLOW_DEPLOYMENT_IDENTITY_REBIND !== "1") {
        throw new Error("El rebind requiere ALLOW_DEPLOYMENT_IDENTITY_REBIND=1.");
      }
    }

    print({
      mode: apply ? "apply" : "preview",
      operation: current && !alreadyMatches ? "rebind-cloned-branch" : alreadyMatches ? "validate" : "initialize",
      targetEnvironment: environment,
      targetEndpointMatches: actualEndpointId === endpointId,
      currentIdentity: current ? current.environment.toLowerCase() : "missing",
      derivedFingerprint: fingerprint,
      fingerprintMatches: alreadyMatches,
      mutationRequired: !alreadyMatches,
    });

    if (!apply || alreadyMatches) return;
    await client.query("BEGIN");
    try {
      await client.query(`SET LOCAL policydesk.deployment_identity_admin = '1'`);
      await client.query(
        `INSERT INTO "DeploymentIdentity" ("id", "environment", "fingerprint", "createdAt", "updatedAt")
         VALUES ($1, $2::"DeploymentEnvironment", $3, now(), now())
         ON CONFLICT ("id") DO UPDATE SET "environment" = EXCLUDED."environment", "fingerprint" = EXCLUDED."fingerprint", "updatedAt" = now()`,
        [DEPLOYMENT_IDENTITY_ID, prismaEnvironment(environment), fingerprint],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Falló la inicialización de identidad.");
  process.exitCode = 1;
});
