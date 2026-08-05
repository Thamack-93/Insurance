const encoder = new TextEncoder();

export type UserRoleSession = "ADMIN" | "AGENT";
export type PlatformRoleSession = "NONE" | "SUPERADMIN";

export type SessionPayload = {
  userId: string;
  email: string;
  name: string;
  role: UserRoleSession;
  platformRole?: PlatformRoleSession;
  /** Signed selection hint only. Membership authorization is revalidated per request. */
  organizationId?: string;
  exp: number;
};

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

const DEV_SECRET = "policydesk-dev-secret-change-in-production-please-0123456789";

function isProduction() {
  return process.env.NODE_ENV === "production";
}

function getSecret(): string {
  if (isProduction()) {
    // In production SESSION_SECRET must be set explicitly — no fallback
    // to AUTH_SECRET so that misconfigured deployments fail fast.
    const secret = process.env.SESSION_SECRET;
    if (!secret || secret.length < 32 || secret === DEV_SECRET) {
      throw new Error(
        "SESSION_SECRET no está configurada o es la de desarrollo. Define una cadena fuerte (≥32 caracteres) en la variable de entorno SESSION_SECRET antes de iniciar la aplicación en producción.",
      );
    }
    return secret;
  }
  // Development: accept SESSION_SECRET, fall back to AUTH_SECRET, then dev default.
  const secret = process.env.SESSION_SECRET ?? process.env.AUTH_SECRET;
  if (secret && secret.length >= 16) {
    return secret;
  }
  return DEV_SECRET;
}

/**
 * Validate the session secret eagerly. Call this once during server startup so
 * deployments fail fast when AUTH_SECRET is missing or weak in production.
 */
export function assertSessionSecretAvailable(): void {
  getSecret();
}

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < arr.byteLength; i++) {
    binary += String.fromCharCode(arr[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getKey(usage: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    usage,
  );
}

export async function createSessionToken(
  payload: Omit<SessionPayload, "exp">,
  ttlSeconds: number = SESSION_TTL_SECONDS,
): Promise<{ token: string; exp: number }> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const data: SessionPayload = { ...payload, exp };
  const json = JSON.stringify(data);
  const payloadBytes = encoder.encode(json);
  const payloadB64 = base64UrlEncode(payloadBytes);
  const key = await getKey(["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payloadB64));
  const sigB64 = base64UrlEncode(signature);
  return { token: `${payloadB64}.${sigB64}`, exp };
}

export async function verifySessionToken(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;
  try {
    const key = await getKey(["verify"]);
    const sigBytes = base64UrlDecode(sigB64);
    const dataBytes = encoder.encode(payloadB64);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ok = await crypto.subtle.verify("HMAC", key, sigBytes as any, dataBytes as any);
    if (!ok) return null;
    const payloadBytes = base64UrlDecode(payloadB64);
    const json = new TextDecoder().decode(payloadBytes);
    const payload = JSON.parse(json) as SessionPayload;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    if (!payload.userId || !payload.email) return null;
    if (payload.role !== "ADMIN" && payload.role !== "AGENT") {
      // Older tokens without a role default to AGENT for safety.
      payload.role = "AGENT";
    }
    if (payload.platformRole !== "SUPERADMIN") payload.platformRole = "NONE";
    return payload;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAME = "pd_session";
export const SESSION_TTL = SESSION_TTL_SECONDS;
