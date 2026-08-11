import { setTimeout as delay } from "node:timers/promises";
import { canonicalNeonEndpointId } from "../src/lib/deployment-db-safety.ts";

const NEON_API_BASE_URL = "https://console.neon.tech/api/v2";
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;

type NeonEndpoint = {
  id: string;
  project_id: string;
  branch_id: string;
  host: string;
  type: string;
  disabled?: boolean;
};

type NeonBranch = {
  id: string;
  project_id: string;
  protected?: boolean;
};

type NeonDatabase = {
  id: string | number;
  branch_id: string;
  name: string;
};

export type VerifiedNeonTarget = {
  projectId: string;
  branchId: string;
  endpointId: string;
  databaseId: string;
  databaseName: string;
  branchProtected: boolean;
};

export class NeonTopologyVerificationError extends Error {
  constructor(message = "No se pudo verificar la topología del destino Neon.") {
    super(message);
    this.name = "NeonTopologyVerificationError";
  }
}

function canonicalDatabaseName(connectionString: string) {
  const url = new URL(connectionString);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, "")).trim();
  if (!databaseName || /[\u0000\r\n]/.test(databaseName)) {
    throw new NeonTopologyVerificationError("La base declarada en la conexión no es válida.");
  }
  return databaseName;
}

async function neonRequest<T>(path: string, apiKey: string, fetchImpl: typeof fetch): Promise<T> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchImpl(`${NEON_API_BASE_URL}${path}`, {
        headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.ok) return await response.json() as T;
      if (attempt === MAX_ATTEMPTS || (response.status < 500 && response.status !== 429)) {
        throw new NeonTopologyVerificationError();
      }
    } catch (error) {
      if (error instanceof NeonTopologyVerificationError) throw error;
      if (attempt === MAX_ATTEMPTS) throw new NeonTopologyVerificationError();
    }
    await delay(250 * (2 ** (attempt - 1)));
  }
  throw new NeonTopologyVerificationError();
}

export async function verifyNeonTarget(input: {
  apiKey: string;
  connectionString: string;
  projectId: string;
  branchId: string;
  endpointId: string;
  databaseName?: string;
  requireProtected?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<VerifiedNeonTarget> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const endpointId = canonicalNeonEndpointId(input.connectionString);
  const connectionHost = new URL(input.connectionString).hostname.toLowerCase();
  const databaseName = canonicalDatabaseName(input.connectionString);
  if (endpointId !== input.endpointId.toLowerCase()) throw new NeonTopologyVerificationError();
  if (input.databaseName && databaseName !== input.databaseName) throw new NeonTopologyVerificationError();

  const [endpointResponse, branchResponse, databaseResponse] = await Promise.all([
    neonRequest<{ endpoints: NeonEndpoint[] }>(`/projects/${encodeURIComponent(input.projectId)}/endpoints`, input.apiKey, fetchImpl),
    neonRequest<{ branch: NeonBranch }>(`/projects/${encodeURIComponent(input.projectId)}/branches/${encodeURIComponent(input.branchId)}`, input.apiKey, fetchImpl),
    neonRequest<{ databases: NeonDatabase[] }>(`/projects/${encodeURIComponent(input.projectId)}/branches/${encodeURIComponent(input.branchId)}/databases`, input.apiKey, fetchImpl),
  ]);
  const endpoint = endpointResponse.endpoints.find((candidate) => candidate.id.toLowerCase() === endpointId);
  const branch = branchResponse.branch;
  const database = databaseResponse.databases.find((candidate) => candidate.name === databaseName);
  if (!endpoint || !branch || !database) throw new NeonTopologyVerificationError();
  if (!endpoint.host || endpoint.host.toLowerCase() !== connectionHost) throw new NeonTopologyVerificationError();
  if (endpoint.project_id !== input.projectId || endpoint.branch_id !== input.branchId) throw new NeonTopologyVerificationError();
  if (branch.id !== input.branchId || branch.project_id !== input.projectId) throw new NeonTopologyVerificationError();
  if (database.branch_id !== input.branchId || endpoint.type !== "read_write" || endpoint.disabled) {
    throw new NeonTopologyVerificationError();
  }
  if (input.requireProtected && branch.protected !== true) {
    throw new NeonTopologyVerificationError("La rama Production de Neon debe estar protegida.");
  }
  return {
    projectId: endpoint.project_id,
    branchId: endpoint.branch_id,
    endpointId: endpoint.id.toLowerCase(),
    databaseId: String(database.id),
    databaseName: database.name,
    branchProtected: branch.protected === true,
  };
}

export function localDatabaseIdentity(connectionString: string) {
  return {
    endpointId: canonicalNeonEndpointId(connectionString),
    databaseName: canonicalDatabaseName(connectionString),
  };
}
