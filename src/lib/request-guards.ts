import { createHmac } from "node:crypto";

type RateLimitBucket = number[];

type RateLimitOptions = {
  limit: number;
  windowMs: number;
};

const rateLimitBuckets = new Map<string, RateLimitBucket>();
const localLocks = new Map<string, { token: string; expiresAt: number }>();

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
  backend: "distributed" | "local" | "unavailable";
};

export class RequestGuardError extends Error {
  status: 400 | 413 | 415;

  constructor(message: string, status: 400 | 413 | 415) {
    super(message);
    this.status = status;
  }
}

export function getRequestIp(request: Request | { headers: Pick<Headers, "get"> }): string {
  const vercelForwarded = request.headers.get("x-vercel-forwarded-for");
  if (vercelForwarded?.trim()) {
    return vercelForwarded.split(",")[0]?.trim() || "unknown";
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp?.trim()) return realIp.trim();

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const addresses = forwarded.split(",").map((value) => value.trim()).filter(Boolean);
    const last = addresses.at(-1);
    if (last) return last;
  }

  return "unknown";
}

export function checkRateLimit(key: string, options: RateLimitOptions) {
  const now = Date.now();
  const cutoff = now - options.windowMs;
  const history = (rateLimitBuckets.get(key) ?? []).filter((timestamp) => timestamp >= cutoff);

  if (history.length >= options.limit) {
    const oldest = history[0] ?? now;
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, oldest + options.windowMs - now),
    };
  }

  history.push(now);
  rateLimitBuckets.set(key, history);

  return {
    allowed: true,
    remaining: Math.max(0, options.limit - history.length),
    retryAfterMs: 0,
  };
}

function getDistributedRateLimitConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

async function redisCommand(command: string[]) {
  const config = getDistributedRateLimitConfig();
  if (!config) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 800);
  try {
    const response = await fetch(`${config.url}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([command]),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as Array<{ result?: unknown }>;
    return payload[0]?.result ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function acquireDistributedLock(key: string, ttlMs: number, requireDistributed = distributedRateLimitRequired()) {
  if (!Number.isInteger(ttlMs) || ttlMs < 1_000) throw new Error("DISTRIBUTED_LOCK_TTL_INVALID");
  const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const config = getDistributedRateLimitConfig();
  const mustUseDistributed = requireDistributed && distributedRateLimitRequired();

  if (!config) {
    if (mustUseDistributed) return { acquired: false, backend: "unavailable" as const, token: null, renew: async () => false, release: async () => {} };
    const now = Date.now();
    const existing = localLocks.get(key);
    if (existing && existing.expiresAt > now) {
      return { acquired: false, backend: "local" as const, token: null, renew: async () => false, release: async () => {} };
    }
    localLocks.set(key, { token, expiresAt: now + ttlMs });
    return {
      acquired: true,
      backend: "local" as const,
      token,
      renew: async () => {
        const current = localLocks.get(key);
        if (!current || current.token !== token || current.expiresAt <= Date.now()) return false;
        current.expiresAt = Date.now() + ttlMs;
        return true;
      },
      release: async () => {
        if (localLocks.get(key)?.token === token) localLocks.delete(key);
      },
    };
  }

  const result = await redisCommand(["SET", `policydesk:lock:${key}`, token, "NX", "PX", String(ttlMs)]);
  if (result !== "OK") {
    return { acquired: false, backend: result === null ? ("unavailable" as const) : ("distributed" as const), token: null, renew: async () => false, release: async () => {} };
  }

  return {
    acquired: true,
    backend: "distributed" as const,
    token,
    renew: async () => {
      const renewed = await redisCommand(["EVAL", "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('pexpire',KEYS[1],ARGV[2]) else return 0 end", "1", `policydesk:lock:${key}`, token, String(ttlMs)]);
      return Number(renewed ?? 0) === 1;
    },
    release: async () => {
      await redisCommand(["EVAL", "if redis.call('get',KEYS[1]) == ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end", "1", `policydesk:lock:${key}`, token]);
    },
  };
}

export function distributedRateLimitRequired() {
  return process.env.REQUIRE_DISTRIBUTED_RATE_LIMIT === "1" || process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production";
}

export function assertDistributedRateLimitConfigured() {
  if (distributedRateLimitRequired() && !getDistributedRateLimitConfig()) {
    throw new Error("UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN son obligatorios en producción.");
  }
}

export async function checkDistributedRateLimit(
  key: string,
  options: RateLimitOptions & { requireDistributed?: boolean },
): Promise<RateLimitResult> {
  const requireDistributed = options.requireDistributed === false ? false : distributedRateLimitRequired();
  const config = getDistributedRateLimitConfig();

  if (!config) {
    if (requireDistributed) {
      return { allowed: false, remaining: 0, retryAfterMs: options.windowMs, backend: "unavailable" };
    }
    return { ...checkRateLimit(key, options), backend: "local" };
  }

  const bucket = Math.floor(Date.now() / options.windowMs);
  const redisKey = `policydesk:ratelimit:${key}:${bucket}`;
  const count = Number(await redisCommand(["INCR", redisKey]));
  if (!Number.isFinite(count) || count <= 0) {
    return { allowed: false, remaining: 0, retryAfterMs: options.windowMs, backend: "unavailable" };
  }

  if (count === 1) {
    await redisCommand(["EXPIRE", redisKey, String(Math.ceil(options.windowMs / 1000) + 1)]);
  }

  const retryAfterMs = options.windowMs - (Date.now() % options.windowMs);
  return {
    allowed: count <= options.limit,
    remaining: Math.max(0, options.limit - count),
    retryAfterMs: count <= options.limit ? 0 : retryAfterMs,
    backend: "distributed",
  };
}

export function securityFingerprint(value: string) {
  const secret = process.env.SECURITY_EVENT_FINGERPRINT_SECRET?.trim() || process.env.SESSION_SECRET?.trim() || "policydesk-dev-fingerprint";
  return createHmac("sha256", secret).update(value).digest("hex").slice(0, 24);
}

export function assertRequestBodySize(request: Request, maxBytes: number) {
  const contentLength = request.headers.get("content-length");
  if (!contentLength) return;
  const parsed = Number(contentLength);
  if (Number.isFinite(parsed) && parsed > maxBytes) {
    throw new RequestGuardError("El cuerpo de la petición supera el tamaño permitido.", 413);
  }
}

export function assertJsonContentType(request: Request) {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new RequestGuardError("Esta ruta requiere un payload JSON.", 415);
  }
}

export async function readJsonBody<T>(request: Request, maxBytes: number): Promise<T> {
  assertRequestBodySize(request, maxBytes);
  assertJsonContentType(request);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new RequestGuardError("El cuerpo de la petición supera el tamaño permitido.", 413);
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    throw new RequestGuardError("El payload JSON no es válido.", 400);
  }
}

export function assertSameOrigin(request: Request | { url: string; headers: Headers }, context = "request") {
  const expectedOrigins = new Set([new URL(request.url).origin]);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host")?.trim();
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  const requestProtocol = new URL(request.url).protocol.replace(":", "");
  const protocol = forwardedProtocol === "http" || forwardedProtocol === "https" ? forwardedProtocol : requestProtocol;

  if (host) {
    try {
      expectedOrigins.add(new URL(`${protocol}://${host}`).origin);
    } catch {
      // Ignore malformed proxy metadata and retain the canonical request URL.
    }
  }
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const source = origin ?? referer;

  if (!source) {
    throw new Error(`${context} requires a same-origin Origin/Referer header.`);
  }

  let sourceOrigin: string;
  try {
    sourceOrigin = new URL(source).origin;
  } catch {
    throw new Error(`${context} sent an invalid origin header.`);
  }

  if (!expectedOrigins.has(sourceOrigin)) {
    throw new Error(`${context} must originate from the current application origin.`);
  }
}
