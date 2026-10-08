import { assertRestorePurposeGuard } from "../../scripts/tenant-certification-target.mjs";

export type RestoreTargetInput = {
  sourceDatabaseUrl?: string;
  targetDatabaseUrl?: string;
  branchName?: string;
  allowRestore?: string;
  candidateSha?: string;
  vercel?: string;
  vercelEnv?: string;
  actualHead?: string;
  forbiddenDatabaseUrls?: Array<string | undefined>;
};

function parsePostgresUrl(value: string, label: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} no es una URL válida.`);
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) {
    throw new Error(`${label} debe apuntar a Postgres.`);
  }
  return url;
}

function normalizeNeonHostname(hostname: string) {
  return hostname.toLowerCase().replace(/-pooler(?=\.)/, "");
}

function neonEndpointIdentity(url: URL) {
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  return `${normalizeNeonHostname(url.hostname)}|${url.port}|${pathname}`;
}

function isSameNeonEndpoint(left: URL, right: URL) {
  return neonEndpointIdentity(left) === neonEndpointIdentity(right);
}

export function assertTemporaryNeonRestoreTarget(input: RestoreTargetInput) {
  const candidateSha = assertRestorePurposeGuard({
    ALLOW_TEMPORARY_NEON_RESTORE: input.allowRestore,
    CERTIFICATION_CANDIDATE_SHA: input.candidateSha,
    VERCEL: input.vercel,
    VERCEL_ENV: input.vercelEnv,
  }, input.actualHead);
  const branchName = input.branchName?.trim() ?? "";
  if (!/^(restore|preview|temp)-[a-z0-9._-]+$/i.test(branchName)) {
    throw new Error("RESTORE_NEON_BRANCH debe identificar una rama restore-, preview- o temp-.");
  }
  if (branchName !== `restore-cert-stage3-${candidateSha}`) throw new Error("RESTORE_NEON_BRANCH_CANDIDATE_MISMATCH");
  if (!input.sourceDatabaseUrl?.trim() || !input.targetDatabaseUrl?.trim()) {
    throw new Error("DATABASE_URL y RESTORE_DATABASE_URL son obligatorias.");
  }
  const source = parsePostgresUrl(input.sourceDatabaseUrl, "DATABASE_URL");
  const target = parsePostgresUrl(input.targetDatabaseUrl, "RESTORE_DATABASE_URL");
  if (!target.hostname.endsWith(".neon.tech")) {
    throw new Error("RESTORE_DATABASE_URL debe apuntar a una rama de Neon.");
  }
  const forbiddenEndpoints = [
    source,
    ...(input.forbiddenDatabaseUrls ?? [])
      .filter((value): value is string => Boolean(value?.trim()))
      .map((value) => parsePostgresUrl(value, "DATABASE_URL_VARIANT")),
  ];
  if (forbiddenEndpoints.some((endpoint) => isSameNeonEndpoint(endpoint, target))) {
    throw new Error("La restauración no puede apuntar al endpoint de la base actual ni a sus variantes de Neon.");
  }
  if (/-pooler\./i.test(target.hostname) || target.searchParams.has("pgbouncer")) {
    throw new Error("RESTORE_REQUIRES_DIRECT_ADMIN_CONNECTION");
  }
  return { source, target, branchName };
}
