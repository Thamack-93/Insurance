"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { setSessionCookie, verifyPassword, SYSTEM_USER_ID } from "@/lib/auth";
import type { UserRoleSession } from "@/lib/session";
import { writeActivityLog } from "@/lib/activity-log";
import { checkRateLimit } from "@/lib/request-guards";
import { recordSecurityEvent, SECURITY_EVENT_TYPES } from "@/lib/security-events";

export type LoginResult = { ok: true } | { ok: false; error: string };

export async function loginAction(_prev: LoginResult | null, formData: FormData): Promise<LoginResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const redirectTo = String(formData.get("redirect") ?? "/today") || "/today";

  if (!email || !password) {
    return { ok: false, error: "Captura tu correo y contraseña." };
  }

  const rateLimit = checkRateLimit(`login:${email}`, {
    limit: 5,
    windowMs: 15 * 60 * 1000,
  });
  if (!rateLimit.allowed) {
    await recordSecurityEvent({
      alertType: SECURITY_EVENT_TYPES.rateLimitedLogin,
      title: "Demasiados intentos de inicio de sesión",
      description: `Se bloqueó el inicio de sesión para ${email} por exceder el límite permitido.`,
      severity: "WARNING",
      entityType: "SecurityEvent",
      entityId: `login-rate-limit:${email || "unknown"}`,
      userId: SYSTEM_USER_ID,
    });
    return { ok: false, error: "Demasiados intentos. Intenta de nuevo en unos minutos." };
  }

  const db = getDb();
  const user = await db.user.findUnique({ where: { email } });

  if (!user || user.id === SYSTEM_USER_ID || !verifyPassword(password, user.passwordHash)) {
    await recordSecurityEvent({
      alertType: SECURITY_EVENT_TYPES.loginFailed,
      title: "Inicio de sesión fallido",
      description: `Se rechazó el acceso para ${email}.`,
      severity: "WARNING",
      entityType: "SecurityEvent",
      entityId: `login-failed:${email || "unknown"}`,
      userId: SYSTEM_USER_ID,
    });
    return { ok: false, error: "Correo o contraseña incorrectos." };
  }

  if (!user.active) {
    await recordSecurityEvent({
      alertType: SECURITY_EVENT_TYPES.loginDisabled,
      title: "Inicio de sesión bloqueado",
      description: `Se intentó entrar con la cuenta deshabilitada ${user.email}.`,
      severity: "WARNING",
      entityType: "SecurityEvent",
      entityId: `login-disabled:${user.id}`,
      userId: SYSTEM_USER_ID,
    });
    return { ok: false, error: "Tu cuenta está deshabilitada. Contacta al administrador." };
  }

  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  await setSessionCookie({
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role as UserRoleSession,
  });

  await writeActivityLog({
    entityType: "User",
    entityId: user.id,
    action: "USER_LOGIN",
    userId: user.id,
  });

  const safeRedirect = redirectTo.startsWith("/") && !redirectTo.startsWith("//") ? redirectTo : "/today";
  redirect(safeRedirect);
}
