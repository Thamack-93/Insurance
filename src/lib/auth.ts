import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { cache } from "react";
import { getDb } from "@/lib/db";
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL,
  createSessionToken,
  verifySessionToken,
  type SessionPayload,
  type UserRoleSession,
} from "@/lib/session";

const SCRYPT_KEYLEN = 64;

export type UserRole = UserRoleSession;

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!stored || !stored.startsWith("scrypt$")) return false;
  const [, salt, hash] = stored.split("$");
  if (!salt || !hash) return false;
  try {
    const derived = scryptSync(password, salt, SCRYPT_KEYLEN);
    const expected = Buffer.from(hash, "hex");
    if (derived.length !== expected.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export async function setSessionCookie(payload: Omit<SessionPayload, "exp">) {
  const { token } = await createSessionToken(payload);
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL,
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export const getSession = cache(async (): Promise<SessionPayload | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  return verifySessionToken(token);
});

export async function getCurrentUser() {
  const session = await getSession();
  if (!session) return null;
  const db = getDb();
  const user = await db.user.findUnique({ where: { id: session.userId } });
  if (!user || user.sessionVersion !== session.sessionVersion) return null;
  return user;
}

export async function getCurrentUserId(): Promise<string> {
  // Re-reads the user from the database so inactive accounts are rejected
  // immediately on any server action, not just on page navigation.
  const user = await requireUser();
  return user.id;
}

export async function getCurrentUserIdOrSystem(): Promise<string> {
  const session = await getSession();
  if (!session?.userId) return SYSTEM_USER_ID;
  try {
    const user = await requireUser();
    return user.id;
  } catch {
    return SYSTEM_USER_ID;
  }
}

/**
 * Returns the live, active user from the database. Throws AuthError if the
 * session is missing or the user is no longer active.
 */
export async function requireUser() {
  const session = await getSession();
  if (!session) throw new AuthError("Necesitas iniciar sesión.", 401);
  const db = getDb();
  const user = await db.user.findUnique({ where: { id: session.userId } });
  if (!user || user.sessionVersion !== session.sessionVersion || !user.active || user.id === SYSTEM_USER_ID) {
    throw new AuthError("Tu cuenta está deshabilitada.", 401);
  }
  return user;
}

/**
 * Like requireUser() but also enforces ADMIN role. Throws AuthError(403) when
 * the caller is authenticated but lacks privileges.
 */
export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "ADMIN") {
    throw new AuthError("Esta acción requiere permisos de administrador.", 403);
  }
  return user;
}

export async function requireSuperAdmin() {
  const user = await requireUser();
  if (user.platformRole !== "SUPERADMIN") {
    throw new AuthError("Esta acción requiere permisos de plataforma.", 403);
  }
  return user;
}

export const SYSTEM_USER_ID = "system-user-0000";

/**
 * Request-time gate for dashboard pages. Re-reads the user from the database on
 * every request so deactivations and role changes take effect immediately
 * (without waiting for the signed token to expire). If the session is missing
 * or the user is no longer active, clears the cookie and redirects to /login.
 */
export async function requireUserOrRedirect() {
  const { redirect } = await import("next/navigation");
  try {
    return await requireUser();
  } catch (error) {
    if (error instanceof AuthError) {
      try {
        await clearSessionCookie();
      } catch {
        // ignore — cookies may be read-only in some render contexts
      }
      redirect("/login");
    }
    throw error;
  }
}

/**
 * Like requireUserOrRedirect() but additionally enforces ADMIN role. Demoted
 * admins are sent to the canonical Today destination on their next request.
 */
export async function requireAdminOrRedirect() {
  const { redirect } = await import("next/navigation");
  const user = await requireUserOrRedirect();
  if (user.role !== "ADMIN") {
    redirect("/today");
  }
  return user;
}

export async function requireSuperAdminOrRedirect() {
  const { redirect } = await import("next/navigation");
  try {
    return await requireSuperAdmin();
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.status === 401) {
        try { await clearSessionCookie(); } catch { /* best effort */ }
        redirect("/login");
      }
      redirect("/today");
    }
    throw error;
  }
}

export async function requireOrganizationContextOrRedirect() {
  const { redirect } = await import("next/navigation");
  const { requireOrganizationContext } = await import("@/lib/organization-context");
  try {
    return await requireOrganizationContext();
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.status === 401) {
        try { await clearSessionCookie(); } catch { /* best effort */ }
        redirect("/login");
      }
      if (error.status === 409) redirect("/organization/select");
      redirect("/organization/no-access");
    }
    throw error;
  }
}
