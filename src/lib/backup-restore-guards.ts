export type RestoreTargetInput = {
  sourceDatabaseUrl?: string;
  targetDatabaseUrl?: string;
  branchName?: string;
  allowRestore?: string;
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

function normalizeNeonEndpoint(hostname: string) {
  return hostname.toLowerCase().replace(/-pooler(?=\.)/, "");
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
  if (
    source.toString() === target.toString() ||
    normalizeNeonEndpoint(source.hostname) === normalizeNeonEndpoint(target.hostname)
  ) {
    throw new Error("La restauración no puede apuntar al endpoint de la base actual.");
  }
  return { source, target, branchName };
}
