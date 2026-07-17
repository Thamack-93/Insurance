export type RestoreTargetInput = {
  sourceDatabaseUrl?: string;
  targetDatabaseUrl?: string;
  branchName?: string;
  allowRestore?: string;
  forbiddenDatabaseUrls?: Array<string | undefined>;
};

function parsePostgresUrl(value: string, label: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} no es una URL válida.`);
  }
  if (!/^postgres(ql):$/.test(url.protocol)) {
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
  if (input.allowRestore !== "true") {
    throw new Error("ALLOW_TEMPORARY_NEON_RESTORE=true es obligatorio.");
  }
  const branchName = input.branchName?.trim() ?? "";
  if (!/^(restore|preview|temp)[-_][a-z0-9._-]+$/i.test(branchName)) {
    throw new Error("RESTORE_NEON_BRANCH debe identificar una rama restore-, preview- o temp-.");
  }
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
  return { source, target, branchName };
}
