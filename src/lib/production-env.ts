export type ProductionEnvProfile = "runtime" | "verification";

export type ProductionEnvEntry = {
  name: string;
  category: "required" | "active" | "disabled" | "operator-only" | "verification-only" | "optional";
  required: boolean;
  state: "configured" | "disabled" | "missing" | "invalid" | "not-configured" | "satisfied-by-alias";
  reason: string;
};

export type ProductionEnvManifest = {
  profile: ProductionEnvProfile;
  entries: ProductionEnvEntry[];
  failures: string[];
};

export const PRODUCTION_FLAG_EXPECTATIONS = {
  NORA_AGENT_MODE: "off",
  PLATFORM_BILLING_MUTATIONS_ENABLED: "0",
  PLATFORM_NORA_ENABLED: "0",
  PLATFORM_IMPORTS_ENABLED: "1",
  PLATFORM_EXPORTS_ENABLED: "1",
  PLATFORM_UPLOADS_ENABLED: "1",
  PLATFORM_EMAIL_ENABLED: "0",
  PLATFORM_TELEGRAM_ENABLED: "1",
  PLATFORM_WHATSAPP_ENABLED: "1",
  PLATFORM_QUALITAS_ENABLED: "0",
} as const;

const RUNTIME_REQUIRED = [
  "DATABASE_URL",
  "CRON_SECRET",
  "MONITOR_TOKEN",
  "BACKUP_ENCRYPTION_KEY",
  "BACKUP_ENCRYPTION_KEY_VERSION",
] as const;

const VERIFICATION_REQUIRED = [
  "PRODUCTION_READONLY_DATABASE_URL",
  "PRODUCTION_READONLY_ROLE",
  "PRODUCTION_EXPECTED_TENANT_MODE",
  "TENANT_RLS_APP_ROLE",
  "TENANT_RLS_PLATFORM_OWNER_ROLE",
] as const;

const OPERATOR_ONLY = new Set([
  "DATABASE_ADMIN_URL",
  "DATABASE_URL_DIRECT",
  "RESTORE_DATABASE_URL",
  "RESTORE_NEON_BRANCH",
  "ALLOW_TEMPORARY_NEON_RESTORE",
  "ALLOW_OPERATOR_BACKUP",
  "ALLOW_TENANT_PRODUCTION_IMPORT",
  "ALLOW_ORGANIZATION_PRODUCTION_ROLLBACK",
  "ALLOW_PLATFORM_ADMIN_PRODUCTION",
]);

const VERIFICATION_ONLY = new Set([
  "PRODUCTION_READONLY_DATABASE_URL",
  "PRODUCTION_READONLY_ROLE",
  "PRODUCTION_EXPECTED_TENANT_MODE",
  "TENANT_RLS_APP_ROLE",
  "TENANT_RLS_PLATFORM_OWNER_ROLE",
]);

export function categoryFor(name: string): ProductionEnvEntry["category"] {
  if (OPERATOR_ONLY.has(name)) return "operator-only";
  if (VERIFICATION_ONLY.has(name)) return "verification-only";
  if (name in PRODUCTION_FLAG_EXPECTATIONS || name === "CRON_SECRET" || name === "MONITOR_TOKEN") return "active";
  return "optional";
}

function entry(
  name: string,
  values: Record<string, string | undefined>,
  required: boolean,
  expected?: string,
  reason = required ? "Required for this production profile." : "Optional or operator-managed outside the runtime.",
): ProductionEnvEntry {
  const value = values[name]?.trim();
  const category = categoryFor(name);
  if (!value) {
    return {
      name,
      category: expected === "0" ? "disabled" : category,
      required,
      state: required ? "missing" : "not-configured",
      reason,
    };
  }
  if (expected !== undefined && value !== expected) {
    return { name, category, required, state: "invalid", reason: `Expected the explicit value ${expected}.` };
  }
  return {
    name,
    category: expected === "0" ? "disabled" : category,
    required,
    state: expected === "0" ? "disabled" : "configured",
    reason: expected === "0" ? "Explicitly disabled by production policy." : "Configured; the value is intentionally omitted from this manifest.",
  };
}

export function evaluateProductionEnv(
  values: Record<string, string | undefined>,
  profile: ProductionEnvProfile,
): ProductionEnvManifest {
  const entries: ProductionEnvEntry[] = [];
  const required = profile === "runtime" ? RUNTIME_REQUIRED : VERIFICATION_REQUIRED;

  for (const name of required) entries.push(entry(name, values, true, name === "PRODUCTION_EXPECTED_TENANT_MODE" ? "single-org" : undefined));

  const hasSessionSecret = Boolean(values.SESSION_SECRET?.trim() || values.AUTH_SECRET?.trim());
  entries.push({
    name: "SESSION_SECRET|AUTH_SECRET",
    category: "required",
    required: profile === "runtime",
    state: hasSessionSecret ? "satisfied-by-alias" : profile === "runtime" ? "missing" : "not-configured",
    reason: hasSessionSecret ? "One of the supported session secret aliases is configured." : profile === "runtime" ? "SESSION_SECRET or AUTH_SECRET is required." : "Session credentials are not required by the read-only verifier profile.",
  });

  if (profile === "runtime") {
    const documentsEnabled = values.ENABLE_DOCUMENT_FILES?.trim() !== "false";
    entries.push(entry("BLOB_READ_WRITE_TOKEN", values, documentsEnabled, undefined, documentsEnabled ? "Required while document files are enabled." : "Not required because document files are disabled."));
  }

  for (const [name, expected] of Object.entries(PRODUCTION_FLAG_EXPECTATIONS)) {
    entries.push(entry(name, values, true, expected, "Production capability policy requires an explicit value."));
  }

  if (profile === "verification") {
    entries.push(entry("QUALITAS_PRODUCTION_CERTIFIED", values, false, "0", "The provider remains disabled until separately certified."));
  }

  const failures = entries
    .filter((item) => item.required && (item.state === "missing" || item.state === "invalid"))
    .map((item) => `${item.name}:${item.state}`);
  return { profile, entries: entries.sort((a, b) => a.name.localeCompare(b.name)), failures };
}
