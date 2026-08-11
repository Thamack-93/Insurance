import { Pool, type PoolClient } from "pg";
import { getFlag, hasFlag, parseCliArgs } from "./_shared.ts";
import {
  DEPLOYMENT_IDENTITY_ID,
  deriveDeploymentFingerprint,
  type DeploymentEnvironment,
} from "../src/lib/deployment-db-safety.ts";
import {
  localDatabaseIdentity,
  requireProtectedProductionReference,
  verifyNeonTarget,
} from "./deployment-db-neon.ts";

const args = parseCliArgs();
const apply = hasFlag(args, "apply");
const json = hasFlag(args, "json");
const rebind = hasFlag(args, "rebind-cloned-branch");
const topologyOnly = hasFlag(args, "topology-only");
const LOCK_KEY = "policydesk-deployment-identity-v1";

type StoredIdentity = { environment: string; fingerprint: string } | null;
type TargetIdentity = {
  projectId: string;
  branchId: string;
  endpointId: string;
  databaseIdentity: string;
  databaseName: string;
  branchProtected: boolean;
};

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

async function readIdentity(client: PoolClient): Promise<StoredIdentity> {
  const result = await client.query<{ environment: string; fingerprint: string }>(
    `SELECT "environment"::text AS environment, "fingerprint" FROM "DeploymentIdentity" WHERE "id" = $1`,
    [DEPLOYMENT_IDENTITY_ID],
  );
  return result.rows[0] ?? null;
}

function validateTransition(input: {
  current: StoredIdentity;
  environment: DeploymentEnvironment;
  fingerprint: string;
  expectedProductionFingerprint: string | null;
}) {
  const alreadyMatches = input.current?.environment === prismaEnvironment(input.environment)
    && input.current.fingerprint === input.fingerprint;
  if (input.current && !alreadyMatches) {
    if (!rebind) throw new Error("La identidad existente es distinta; usa el flujo explícito de rebind.");
    if (input.environment !== "preview" && input.environment !== "test") throw new Error("El rebind solo puede terminar en Preview o Test.");
    if (!input.expectedProductionFingerprint) throw new Error("El rebind requiere la identidad verificada de Production.");
    if (input.current.environment !== "PRODUCTION" || input.current.fingerprint !== input.expectedProductionFingerprint) {
      throw new Error("La identidad heredada no coincide con la Production verificada.");
    }
    if (apply && process.env.ALLOW_DEPLOYMENT_IDENTITY_REBIND !== "1") {
      throw new Error("El rebind requiere ALLOW_DEPLOYMENT_IDENTITY_REBIND=1.");
    }
  }
  return {
    alreadyMatches,
    operation: input.current && !alreadyMatches ? "rebind-cloned-branch" : alreadyMatches ? "validate" : "initialize",
  };
}

async function resolveTarget(input: {
  connectionString: string;
  environment: DeploymentEnvironment;
  projectId: string;
  branchId: string;
  endpointId: string;
  databaseName: string;
  isLocal: boolean;
}): Promise<TargetIdentity> {
  if (input.isLocal) {
    if (input.environment === "production" || input.environment === "preview") {
      throw new Error("Production/Preview no pueden inicializarse sobre un host local.");
    }
    const local = localDatabaseIdentity(input.connectionString);
    if (local.endpointId !== input.endpointId || local.databaseName !== input.databaseName) {
      throw new Error("La identidad local no coincide con la conexión.");
    }
    return { ...input, databaseIdentity: local.databaseName, branchProtected: false };
  }
  const apiKey = process.env.NEON_API_KEY?.trim();
  if (!apiKey) throw new Error("NEON_API_KEY es obligatoria para verificar un destino Neon remoto.");
  const verified = await verifyNeonTarget({
    apiKey,
    connectionString: input.connectionString,
    projectId: input.projectId,
    branchId: input.branchId,
    endpointId: input.endpointId,
    databaseName: input.databaseName,
    requireProtected: input.environment === "production",
  });
  return {
    projectId: verified.projectId,
    branchId: verified.branchId,
    endpointId: verified.endpointId,
    databaseIdentity: verified.databaseId,
    databaseName: verified.databaseName,
    branchProtected: verified.branchProtected,
  };
}

async function main() {
  const connectionString = process.env.DATABASE_URL_UNPOOLED?.trim();
  if (!connectionString) throw new Error("DATABASE_URL_UNPOOLED es obligatoria.");
  const url = new URL(connectionString);
  const environment = parseEnvironment(required("environment"));
  const projectId = required("project-id");
  const branchId = required("branch-id");
  const endpointId = required("endpoint-id").toLowerCase();
  const databaseName = required("database");
  const isLocal = ["127.0.0.1", "localhost", "::1"].includes(url.hostname.toLowerCase());
  if (topologyOnly && (apply || rebind)) {
    throw new Error("--topology-only no puede combinarse con --apply o --rebind-cloned-branch.");
  }
  const requiresProductionComparison = environment === "preview" || rebind;
  const allowUnprotectedProductionReference = process.env.ALLOW_UNPROTECTED_PRODUCTION_REFERENCE_FOR_PREVIEW === "1";
  const productionReferenceMustBeProtected = requireProtectedProductionReference({
    environment,
    allowUnprotectedPreviewReference: allowUnprotectedProductionReference,
  });
  const productionBranchId = requiresProductionComparison ? required("production-branch-id") : null;
  const productionEndpointId = requiresProductionComparison ? required("production-endpoint-id").toLowerCase() : null;

  if (url.hostname.toLowerCase().split(".")[0]?.endsWith("-pooler")) {
    throw new Error("La inicialización requiere el endpoint directo, no el pooler.");
  }
  if (productionBranchId && productionEndpointId && (branchId === productionBranchId || endpointId === productionEndpointId)) {
    throw new Error("El target coincide con la rama o endpoint de Production.");
  }
  if (environment === "production" && apply && process.env.ALLOW_PRODUCTION_DEPLOYMENT_IDENTITY_APPLY !== "1") {
    throw new Error("Production requiere ALLOW_PRODUCTION_DEPLOYMENT_IDENTITY_APPLY=1.");
  }
  if ((environment === "development" || environment === "test") && !isLocal && apply
    && process.env.ALLOW_REMOTE_NONPRODUCTION_DEPLOYMENT_IDENTITY_APPLY !== "1") {
    throw new Error("Development/Test remotos requieren ALLOW_REMOTE_NONPRODUCTION_DEPLOYMENT_IDENTITY_APPLY=1.");
  }

  const target = await resolveTarget({ connectionString, environment, projectId, branchId, endpointId, databaseName, isLocal });
  const fingerprint = deriveDeploymentFingerprint({ projectId: target.projectId, branchId: target.branchId, databaseIdOrName: target.databaseIdentity });
  let expectedProductionFingerprint: string | null = null;
  let productionBranchProtected: boolean | null = environment === "production" ? target.branchProtected : null;
  if (requiresProductionComparison) {
    if (isLocal) {
      expectedProductionFingerprint = deriveDeploymentFingerprint({ projectId, branchId: productionBranchId!, databaseIdOrName: databaseName });
    } else {
      const apiKey = process.env.NEON_API_KEY!.trim();
      const productionConnectionString = process.env.PRODUCTION_DATABASE_URL_UNPOOLED?.trim();
      if (!productionConnectionString) throw new Error("Preview/rebind remotos requieren PRODUCTION_DATABASE_URL_UNPOOLED para verificar Production.");
      const production = await verifyNeonTarget({
        apiKey,
        connectionString: productionConnectionString,
        projectId,
        branchId: productionBranchId!,
        endpointId: productionEndpointId!,
        databaseName,
        requireProtected: productionReferenceMustBeProtected,
      });
      productionBranchProtected = production.branchProtected;
      expectedProductionFingerprint = deriveDeploymentFingerprint({
        projectId: production.projectId,
        branchId: production.branchId,
        databaseIdOrName: production.databaseId,
      });
    }
  }
  if (expectedProductionFingerprint && fingerprint === expectedProductionFingerprint) {
    throw new Error("El fingerprint de Preview coincide con Production.");
  }

  if (topologyOnly) {
    print({
      mode: "topology-only",
      targetEnvironment: environment,
      targetEndpointMatches: true,
      providerTopologyVerified: !isLocal,
      productionBranchProtected,
      unprotectedProductionReferenceAccepted: allowUnprotectedProductionReference && productionBranchProtected === false,
      derivedFingerprint: fingerprint,
      databaseMutationAttempted: false,
    });
    return;
  }

  const pool = new Pool({ connectionString, max: 1, application_name: "policydesk-deployment-identity-admin" });
  const client = await pool.connect();
  try {
    if (!apply) {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      try {
        const current = await readIdentity(client);
        const transition = validateTransition({ current, environment, fingerprint, expectedProductionFingerprint });
        print({
          mode: "preview",
          operation: transition.operation,
          targetEnvironment: environment,
          targetEndpointMatches: true,
          providerTopologyVerified: !isLocal,
          productionBranchProtected,
          unprotectedProductionReferenceAccepted: allowUnprotectedProductionReference && productionBranchProtected === false,
          currentIdentity: current ? current.environment.toLowerCase() : "missing",
          derivedFingerprint: fingerprint,
          fingerprintMatches: transition.alreadyMatches,
          mutationRequired: !transition.alreadyMatches,
        });
      } finally {
        await client.query("ROLLBACK");
      }
      return;
    }

    await client.query("BEGIN");
    try {
      await client.query(`SET LOCAL lock_timeout = '30s'`);
      await client.query(`SET LOCAL statement_timeout = '5min'`);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [LOCK_KEY]);
      const lockedTarget = await resolveTarget({ connectionString, environment, projectId, branchId, endpointId, databaseName, isLocal });
      const lockedFingerprint = deriveDeploymentFingerprint({
        projectId: lockedTarget.projectId,
        branchId: lockedTarget.branchId,
        databaseIdOrName: lockedTarget.databaseIdentity,
      });
      if (lockedFingerprint !== fingerprint
        || lockedTarget.endpointId !== target.endpointId
        || lockedTarget.databaseName !== target.databaseName) {
        throw new Error("La topología del destino cambió durante la operación.");
      }
      if (requiresProductionComparison && !isLocal) {
        const lockedProduction = await verifyNeonTarget({
          apiKey: process.env.NEON_API_KEY!.trim(),
          connectionString: process.env.PRODUCTION_DATABASE_URL_UNPOOLED!.trim(),
          projectId,
          branchId: productionBranchId!,
          endpointId: productionEndpointId!,
          databaseName,
          requireProtected: productionReferenceMustBeProtected,
        });
        const lockedProductionFingerprint = deriveDeploymentFingerprint({
          projectId: lockedProduction.projectId,
          branchId: lockedProduction.branchId,
          databaseIdOrName: lockedProduction.databaseId,
        });
        if (lockedProductionFingerprint !== expectedProductionFingerprint) {
          throw new Error("La topología de Production cambió durante la operación.");
        }
      }
      const current = await readIdentity(client);
      const transition = validateTransition({ current, environment, fingerprint, expectedProductionFingerprint });
      if (!transition.alreadyMatches) {
        await client.query(`SET LOCAL policydesk.deployment_identity_admin = '1'`);
        await client.query(
          `INSERT INTO "DeploymentIdentity" ("id", "environment", "fingerprint", "createdAt", "updatedAt")
           VALUES ($1, $2::"DeploymentEnvironment", $3, now(), now())
           ON CONFLICT ("id") DO UPDATE SET "environment" = EXCLUDED."environment", "fingerprint" = EXCLUDED."fingerprint", "updatedAt" = now()`,
          [DEPLOYMENT_IDENTITY_ID, prismaEnvironment(environment), fingerprint],
        );
      }
      const finalIdentity = await readIdentity(client);
      if (finalIdentity?.environment !== prismaEnvironment(environment) || finalIdentity.fingerprint !== fingerprint) {
        throw new Error("La identidad final no coincide con el destino verificado.");
      }
      await client.query("COMMIT");
      print({
        mode: "apply",
        operation: transition.operation,
        targetEnvironment: environment,
        targetEndpointMatches: true,
        providerTopologyVerified: !isLocal,
        productionBranchProtected,
        unprotectedProductionReferenceAccepted: allowUnprotectedProductionReference && productionBranchProtected === false,
        currentIdentity: current ? current.environment.toLowerCase() : "missing",
        derivedFingerprint: fingerprint,
        fingerprintMatches: true,
        mutationRequired: !transition.alreadyMatches,
        mutationApplied: !transition.alreadyMatches,
      });
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
