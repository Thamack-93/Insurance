import { createHash } from "node:crypto";
import { getBaseDb } from "@/lib/db-base";
import { DEPLOYMENT_IDENTITY_ID } from "@/lib/deployment-db-identity-constants";
import { logError } from "@/lib/logger";

export { DEPLOYMENT_IDENTITY_ID } from "@/lib/deployment-db-identity-constants";
export const DEPLOYMENT_DATABASE_ERROR_MESSAGE =
  "PolicyDesk no está disponible porque la identidad de la base de datos no coincide con este despliegue.";

export type DeploymentEnvironment = "production" | "preview" | "development" | "test";
export type DeploymentDatabaseSafetyCode =
  | "POLICYDESK_DEPLOYMENT_DATABASE_UNINITIALIZED"
  | "POLICYDESK_DEPLOYMENT_DATABASE_MISMATCH"
  | "POLICYDESK_DEPLOYMENT_DATABASE_UNAVAILABLE";

export type DeploymentDatabaseSafety = {
  safe: boolean;
  code: DeploymentDatabaseSafetyCode | null;
  expectedEnvironment: DeploymentEnvironment | null;
  actualEnvironment: DeploymentEnvironment | null;
  fingerprintMatches: boolean;
  runtimeEnvironmentMatches: boolean;
};

export class DeploymentDatabaseSafetyError extends Error {
  readonly status = 503;
  constructor(readonly code: DeploymentDatabaseSafetyCode) {
    super(DEPLOYMENT_DATABASE_ERROR_MESSAGE);
    this.name = "DeploymentDatabaseSafetyError";
  }
}

function normalizeEnvironment(value: string | undefined): DeploymentEnvironment | null {
  const normalized = value?.trim().toLowerCase();
  return normalized === "production" || normalized === "preview" || normalized === "development" || normalized === "test"
    ? normalized
    : null;
}

export function deriveDeploymentFingerprint(input: {
  projectId: string;
  branchId: string;
  databaseIdOrName: string;
}) {
  const parts = [input.projectId, input.branchId, input.databaseIdOrName].map((value) => value.trim());
  if (parts.some((value) => !value || value.length > 200 || /[\u0000\r\n]/.test(value))) {
    throw new Error("La identidad saneada de Neon es inválida.");
  }
  return createHash("sha256").update(["policydesk-db:v1", ...parts].join("\u0000")).digest("hex");
}

export function canonicalNeonEndpointId(connectionString: string) {
  try {
    const url = new URL(connectionString);
    const label = url.hostname.toLowerCase().split(".")[0] ?? "";
    return label.endsWith("-pooler") ? label.slice(0, -"-pooler".length) : label;
  } catch {
    return "";
  }
}

export function evaluateDeploymentDatabaseSafety(input: {
  expectedEnvironment?: string;
  expectedFingerprint?: string;
  vercel?: string;
  vercelEnvironment?: string;
  actualEnvironment?: string | null;
  actualFingerprint?: string | null;
}): DeploymentDatabaseSafety {
  const expectedEnvironment = normalizeEnvironment(input.expectedEnvironment);
  const expectedFingerprint = input.expectedFingerprint?.trim().toLowerCase() ?? "";
  const actualEnvironment = normalizeEnvironment(input.actualEnvironment ?? undefined);
  const fingerprintConfigured = /^[a-f0-9]{64}$/.test(expectedFingerprint);
  const fingerprintMatches = fingerprintConfigured && input.actualFingerprint === expectedFingerprint;
  const runtimeEnvironment = input.vercel === "1" ? normalizeEnvironment(input.vercelEnvironment) : expectedEnvironment;
  const runtimeEnvironmentMatches = runtimeEnvironment !== null && runtimeEnvironment === expectedEnvironment;

  if (!expectedEnvironment || !fingerprintConfigured || !actualEnvironment || !input.actualFingerprint) {
    return {
      safe: false,
      code: "POLICYDESK_DEPLOYMENT_DATABASE_UNINITIALIZED",
      expectedEnvironment,
      actualEnvironment,
      fingerprintMatches,
      runtimeEnvironmentMatches,
    };
  }

  const safe = runtimeEnvironmentMatches && actualEnvironment === expectedEnvironment && fingerprintMatches;
  return {
    safe,
    code: safe ? null : "POLICYDESK_DEPLOYMENT_DATABASE_MISMATCH",
    expectedEnvironment,
    actualEnvironment,
    fingerprintMatches,
    runtimeEnvironmentMatches,
  };
}

let inFlight: Promise<DeploymentDatabaseSafety> | null = null;
const loggedCodes = new Set<DeploymentDatabaseSafetyCode>();

function logUnsafeOnce(result: DeploymentDatabaseSafety) {
  if (result.safe) return;
  const code = result.code ?? "POLICYDESK_DEPLOYMENT_DATABASE_MISMATCH";
  if (loggedCodes.has(code)) return;
  loggedCodes.add(code);
  logError("deployment-db-safety.blocked", new DeploymentDatabaseSafetyError(code), {
    code,
    expectedEnvironment: result.expectedEnvironment,
    actualEnvironment: result.actualEnvironment,
    fingerprintMatches: result.fingerprintMatches,
    runtimeEnvironmentMatches: result.runtimeEnvironmentMatches,
  });
}

async function readSafety(): Promise<DeploymentDatabaseSafety> {
  try {
    const identity = await getBaseDb().deploymentIdentity.findUnique({ where: { id: DEPLOYMENT_IDENTITY_ID } });
    return evaluateDeploymentDatabaseSafety({
      expectedEnvironment: process.env.EXPECTED_DATABASE_ENV,
      expectedFingerprint: process.env.EXPECTED_DATABASE_FINGERPRINT,
      vercel: process.env.VERCEL,
      vercelEnvironment: process.env.VERCEL_ENV,
      actualEnvironment: identity?.environment ?? null,
      actualFingerprint: identity?.fingerprint ?? null,
    });
  } catch {
    return {
      safe: false,
      code: "POLICYDESK_DEPLOYMENT_DATABASE_UNAVAILABLE",
      expectedEnvironment: normalizeEnvironment(process.env.EXPECTED_DATABASE_ENV),
      actualEnvironment: null,
      fingerprintMatches: false,
      runtimeEnvironmentMatches: false,
    };
  }
}

export async function getDeploymentDatabaseSafety(): Promise<DeploymentDatabaseSafety> {
  if (!inFlight) {
    inFlight = readSafety().finally(() => {
      inFlight = null;
    });
  }
  const result = await inFlight;
  logUnsafeOnce(result);
  return result;
}

export async function assertDeploymentDatabaseSafety(): Promise<void> {
  const result = await getDeploymentDatabaseSafety();
  if (result.safe) return;
  const code = result.code ?? "POLICYDESK_DEPLOYMENT_DATABASE_MISMATCH";
  throw new DeploymentDatabaseSafetyError(code);
}

export function resetDeploymentDatabaseSafetyCache() {
  inFlight = null;
  loggedCodes.clear();
}
