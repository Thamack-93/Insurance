"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { setSessionCookie, verifyPassword, SYSTEM_USER_ID } from "@/lib/auth";
import { writeActivityLog } from "@/lib/activity-log";

export type LoginResult = { ok: true } | { ok: false; error: string };

export async function loginAction(_prev: LoginResult | null, formData: FormData): Promise<LoginResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const redirectTo = String(formData.get("redirect") ?? "/dashboard") || "/dashboard";

  if (!email || !password) {
    return { ok: false, error: "Captura tu correo y contraseña." };
  }

  const db = getDb();
  const user = await db.user.findUnique({ where: { email } });

  if (!user || user.id === SYSTEM_USER_ID || !verifyPassword(password, user.passwordHash)) {
    return { ok: false, error: "Correo o contraseña incorrectos." };
  }

  if (!user.active) {
    return { ok: false, error: "Tu cuenta está deshabilitada. Contacta al administrador." };
  }

  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  await setSessionCookie({
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });

  await writeActivityLog({
    entityType: "User",
    entityId: user.id,
    action: "USER_LOGIN",
    userId: user.id,
  });

  const safeRedirect = redirectTo.startsWith("/") && !redirectTo.startsWith("//") ? redirectTo : "/dashboard";
  redirect(safeRedirect);
}
