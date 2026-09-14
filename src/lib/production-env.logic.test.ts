import { describe, expect, it } from "vitest";
import { evaluateProductionEnv } from "@/lib/production-env";

const runtimeValues = {
  DATABASE_URL: "postgresql://runtime",
  SESSION_SECRET: "a-secret",
  CRON_SECRET: "cron-secret",
  MONITOR_TOKEN: "monitor-token",
  BACKUP_ENCRYPTION_KEY: "hex:0123456789abcdef",
  BACKUP_ENCRYPTION_KEY_VERSION: "v1",
  BLOB_READ_WRITE_TOKEN: "blob-token",
  ENABLE_DOCUMENT_FILES: "true",
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
};

describe("production environment contract", () => {
  it("passes an explicit singleton runtime configuration", () => {
    const report = evaluateProductionEnv(runtimeValues, "runtime");
    expect(report.failures).toEqual([]);
    expect(report.entries.find((item) => item.name === "PLATFORM_NORA_ENABLED")?.state).toBe("disabled");
  });

  it("fails closed when required secrets or flags are missing", () => {
    const report = evaluateProductionEnv({ DATABASE_URL: "postgresql://runtime" }, "runtime");
    expect(report.failures).toContain("MONITOR_TOKEN:missing");
    expect(report.failures).toContain("PLATFORM_IMPORTS_ENABLED:missing");
    expect(report.failures).toContain("SESSION_SECRET|AUTH_SECRET:missing");
  });

  it("validates the read-only verifier profile independently of runtime secrets", () => {
    const report = evaluateProductionEnv({
      PRODUCTION_READONLY_DATABASE_URL: "postgresql://readonly",
      PRODUCTION_READONLY_ROLE: "policydesk_readonly",
      PRODUCTION_EXPECTED_TENANT_MODE: "single-org",
      TENANT_RLS_APP_ROLE: "policydesk_app",
      TENANT_RLS_PLATFORM_OWNER_ROLE: "policydesk_platform_owner",
      ...Object.fromEntries(Object.entries(runtimeValues).filter(([name]) => name.startsWith("PLATFORM_") || name === "NORA_AGENT_MODE")),
    }, "verification");
    expect(report.failures).toEqual([]);
  });

  it("never includes secret values in the manifest", () => {
    const report = evaluateProductionEnv(runtimeValues, "runtime");
    expect(JSON.stringify(report)).not.toContain("postgresql://runtime");
    expect(JSON.stringify(report)).not.toContain("monitor-token");
    expect(JSON.stringify(report)).not.toContain("blob-token");
  });
});
