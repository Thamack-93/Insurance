type RateLimitBucket = number[];

type RateLimitOptions = {
  limit: number;
  windowMs: number;
};

const rateLimitBuckets = new Map<string, RateLimitBucket>();

export function getRequestIp(request: Request | { headers: Headers }): string {
  const forwarded = request.headers.get("x-forwarded-for") ?? request.headers.get("x-vercel-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp?.trim()) return realIp.trim();

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

export function assertSameOrigin(request: Request | { url: string; headers: Headers }, context = "request") {
  const expectedOrigin = new URL(request.url).origin;
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

  if (sourceOrigin !== expectedOrigin) {
    throw new Error(`${context} must originate from ${expectedOrigin}.`);
  }
}
