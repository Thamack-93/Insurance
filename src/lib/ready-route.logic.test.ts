import { afterEach, describe, expect, it, vi } from "vitest";

const queryRaw = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ getDb: () => ({ $queryRaw: queryRaw }) }));

import { GET } from "@/app/api/ready/route";
import { PRODUCTION_FLAG_EXPECTATIONS } from "@/lib/production-env";

const productionEnv = {
  NODE_ENV: "production",
  VERCEL_ENV: "production",
  DATABASE_URL: "postgresql://app@db.example/policydesk",
  CRON_SECRET: "cron-secret",
  MONITOR_TOKEN: "monitor-secret",
  BACKUP_ENCRYPTION_KEY: "a".repeat(64),
  BACKUP_ENCRYPTION_KEY_VERSION: "v2",
  SESSION_SECRET: "session-secret",
  BLOB_READ_WRITE_TOKEN: "blob-token",
  ...PRODUCTION_FLAG_EXPECTATIONS,
};

function stubProductionEnv() {
  for (const [name, value] of Object.entries(productionEnv)) vi.stubEnv(name, value);
}

afterEach(() => {
  queryRaw.mockReset();
  vi.unstubAllEnvs();
});

describe("/api/ready contract", () => {
  it("requires the dedicated monitor bearer token", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await GET(new Request("https://example.test/api/ready"));
    expect(response.status).toBe(401);
  });

  it("passes when database and explicit production configuration are healthy", async () => {
    stubProductionEnv();
    queryRaw.mockResolvedValue([]);

    const response = await GET(new Request("https://example.test/api/ready", {
      headers: { authorization: "Bearer monitor-secret" },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, checks: { database: true, configuration: true } });
    expect(body.configurationFailureCount).toBe(0);
  });

  it("fails closed when an explicit production variable is missing", async () => {
    stubProductionEnv();
    vi.stubEnv("CRON_SECRET", "");
    queryRaw.mockResolvedValue([]);

    const response = await GET(new Request("https://example.test/api/ready", {
      headers: { authorization: "Bearer monitor-secret" },
    }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.checks.configuration).toBe(false);
    expect(body.configurationFailureCount).toBeGreaterThan(0);
  });

  it("reports database outages as not ready", async () => {
    stubProductionEnv();
    queryRaw.mockRejectedValue(new Error("database unavailable"));

    const response = await GET(new Request("https://example.test/api/ready", {
      headers: { authorization: "Bearer monitor-secret" },
    }));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ ok: false, checks: { database: false, configuration: true } });
  });
});
