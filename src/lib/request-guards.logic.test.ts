import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireDistributedLock,
  assertSameOrigin,
  checkDistributedRateLimit,
  readJsonBody,
  RequestGuardError,
  securityFingerprint,
} from "@/lib/request-guards";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("request same-origin guard", () => {
  it("accepts the canonical request origin", () => {
    expect(() => assertSameOrigin({
      url: "http://localhost:3000/api/assistant",
      headers: new Headers({ origin: "http://localhost:3000" }),
    })).not.toThrow();
  });

  it("accepts an exact forwarded host behind a trusted proxy", () => {
    expect(() => assertSameOrigin({
      url: "http://localhost:3000/api/assistant",
      headers: new Headers({
        origin: "https://preview.example.com",
        host: "localhost:3000",
        "x-forwarded-host": "preview.example.com",
        "x-forwarded-proto": "https",
      }),
    })).not.toThrow();
  });

  it("rejects unrelated origins", () => {
    expect(() => assertSameOrigin({
      url: "https://app.example.com/api/assistant",
      headers: new Headers({ origin: "https://evil.example" }),
    })).toThrow();
  });
});

describe("request payload guards", () => {
  it("accepts bounded JSON payloads", async () => {
    await expect(readJsonBody(new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
    }), 1024)).resolves.toEqual({ ok: true });
  });

  it("rejects an unexpected content type and oversized payload", async () => {
    await expect(readJsonBody(new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    }), 1024)).rejects.toMatchObject({ status: 415 });

    await expect(readJsonBody(new Request("http://localhost/api", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "0123456789" }),
    }), 5)).rejects.toBeInstanceOf(RequestGuardError);
  });

  it("fingerprints sensitive keys without exposing the source value", () => {
    const fingerprint = securityFingerprint("email:person@example.com");
    expect(fingerprint).toMatch(/^[a-f0-9]{24}$/);
    expect(fingerprint).not.toContain("person");
  });
});

describe("temporary local protection", () => {
  it("uses the local limiter and lock when distributed protection is disabled", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.stubEnv("REQUIRE_DISTRIBUTED_RATE_LIMIT", "0");

    await expect(
      checkDistributedRateLimit("test-local", { limit: 1, windowMs: 60_000, requireDistributed: true }),
    ).resolves.toMatchObject({ allowed: true, backend: "local" });

    const lock = await acquireDistributedLock("test-local-lock", 1_000, true);
    expect(lock).toMatchObject({ acquired: true, backend: "local" });
    await lock.release();
  });

  it("can fail closed when distributed protection is explicitly enabled", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    vi.stubEnv("REQUIRE_DISTRIBUTED_RATE_LIMIT", "1");

    await expect(
      checkDistributedRateLimit("test-required", { limit: 1, windowMs: 60_000, requireDistributed: true }),
    ).resolves.toMatchObject({ allowed: false, backend: "unavailable" });
  });
});
