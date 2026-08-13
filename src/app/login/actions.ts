"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { setSessionCookie, verifyPassword, SYSTEM_USER_ID } from "@/lib/auth";
import type { UserRoleSession } from "@/lib/session";
import { writeActivityLog } from "@/lib/activity-log";
import { getRequestIp, checkDistributedRateLimit, securityFingerprint } from "@/lib/request-guards";
import { recordSecurityEvent, SECURITY_EVENT_TYPES } from "@/lib/security-events";
import { headers } from "next/headers";

export type LoginResult = { ok: true } | { ok: false; error: string };

export async function loginAction(_prev: LoginResult | null, formData: FormData): Promise<LoginResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const redirectTo = String(formData.get("redirect") ?? "/today") || "/today";

  if (!email || !password) {
    return { ok: false, error: "Captura tu correo y contraseña." };
  }

  const requestHeaders = await headers();
  const ip = getRequestIp({ headers: requestHeaders });
  const emailFingerprint = securityFingerprint(`email:${email}`);
  const ipFingerprint = securityFingerprint(`ip:${ip}`);
  const [emailLimit, ipLimit, pairLimit] = await Promise.all([
    checkDistributedRateLimit(`login:email:${emailFingerprint}`, { limit: 5, windowMs: 15 * 60 * 1000, requireDistributed: true }),
    checkDistributedRateLimit(`login:ip:${ipFingerprint}`, { limit: 20, windowMs: 15 * 60 * 1000, requireDistributed: true }),
    checkDistributedRateLimit(`login:pair:${emailFingerprint}:${ipFingerprint}`, { limit: 5, windowMs: 15 * 60 * 1000, requireDistributed: true }),
  ]);
  const rateLimit = [emailLimit, ipLimit, pairLimit].find((result) => !result.allowed) ?? emailLimit;
  if (!rateLimit.allowed) {
    await recordSecurityEvent({
      alertType: SECURITY_EVENT_TYPES.rateLimitedLogin,
      title: "Demasiados intentos de inicio de sesión",
      description: "Se bloqueó un inicio de sesión por exceder el límite permitido.",
      severity: "WARNING",
      entityType: "SecurityEvent",
      entityId: `login-rate-limit:${emailFingerprint}:${ipFingerprint}`,
      userId: SYSTEM_USER_ID,
      fingerprint: `login:${emailFingerprint}:${ipFingerprint}`,
    });
    return { ok: false, error: "Demasiados intentos. Intenta de nuevo en unos minutos." };
  }

  const db = getDb();
  const user = await db.user.findUnique({ where: { email } });

  if (!user || user.id === SYSTEM_USER_ID || !verifyPassword(password, user.passwordHash)) {
    await recordSecurityEvent({
      alertType: SECURITY_EVENT_TYPES.loginFailed,
      title: "Inicio de sesión fallido",
      description: "Se rechazó un intento de inicio de sesión.",
      severity: "WARNING",
      entityType: "SecurityEvent",
      entityId: `login-failed:${emailFingerprint}:${ipFingerprint}`,
      userId: SYSTEM_USER_ID,
      fingerprint: `login-failed:${emailFingerprint}:${ipFingerprint}`,
    });
    return { ok: false, error: "Correo o contraseña incorrectos." };
  }

  if (!user.active) {
    await recordSecurityEvent({
      alertType: SECURITY_EVENT_TYPES.loginDisabled,
      title: "Inicio de sesión bloqueado",
      description: "Se rechazó un intento de inicio de sesión para una cuenta no activa.",
      severity: "WARNING",
      entityType: "SecurityEvent",
      entityId: `login-disabled:${securityFingerprint(`user:${user.id}`)}:${ipFingerprint}`,
      userId: SYSTEM_USER_ID,
      fingerprint: `login-disabled:${securityFingerprint(`user:${user.id}`)}:${ipFingerprint}`,
    });
    return { ok: false, error: "Correo o contraseña incorrectos." };
  }

  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const memberships = await db.organizationMembership.findMany({
    where: { userId: user.id },
    select: { organizationId: true, active: true, organization: { select: { status: true } } },
    orderBy: { id: "asc" },
    take: 2,
  });
  const activeMemberships = memberships.filter(
    (membership) => membership.active && membership.organization.status === "ACTIVE",
  );
  const initialOrganizationId = memberships.length === 1 && activeMemberships.length === 1
    ? activeMemberships[0].organizationId
    : undefined;

  await setSessionCookie({
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role as UserRoleSession,
    platformRole: user.platformRole === "SUPERADMIN" ? "SUPERADMIN" : "NONE",
    organizationId: initialOrganizationId,
  });

  await writeActivityLog({
    entityType: "User",
    entityId: user.id,
    action: "USER_LOGIN",
    userId: user.id,
  });

  const fallback = user.platformRole === "SUPERADMIN"
    ? "/platform"
      : memberships.length === 1 && activeMemberships.length === 1
        ? "/today"
        : memberships.length > 1
          ? "/organization/no-access?reason=corrupt"
          : "/organization/no-access";
  // A requested route is safe only after the login has established exactly one
  // active tenant. Global users and users with corrupt/no memberships must go
  // through their controlled landing page first; otherwise a stale `/today`
  // redirect can send a SUPERADMIN into tenant routes.
  const canHonorRedirect = user.platformRole !== "SUPERADMIN" && memberships.length === 1 && activeMemberships.length === 1;
  const safeRedirect = canHonorRedirect && redirectTo.startsWith("/") && !redirectTo.startsWith("//")
    ? redirectTo
    : fallback;
  redirect(safeRedirect);
}
