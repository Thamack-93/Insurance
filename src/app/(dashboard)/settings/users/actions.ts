"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
import {
  AuthError,
  hashPassword,
  requireAdmin,
  requireUser,
  verifyPassword,
  SYSTEM_USER_ID,
  type UserRole,
} from "@/lib/auth";
import { errorResult, successResult, type MutationResult } from "@/lib/mutation-utils";
import { logError } from "@/lib/logger";

export type AdminUserRow = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
};

function isRole(value: unknown): value is UserRole {
  return value === "ADMIN" || value === "AGENT";
}

function validatePasswordStrength(password: string): string | null {
  if (typeof password !== "string") return "La contraseña no es válida.";
  if (password.length < 8) return "La contraseña debe tener al menos 8 caracteres.";
  const hasLetter = /[a-zA-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  if (!hasLetter || !hasNumber) {
    return "La contraseña debe combinar letras y números.";
  }
  return null;
}

function generateTemporaryPassword(): string {
  // 10-char alphanumeric — readable enough to share over chat.
  return randomBytes(8).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 10) + "1";
}

export async function listUsers(): Promise<AdminUserRow[]> {
  await requireAdmin();
  const db = getDb();
  const users = await db.user.findMany({
    where: { id: { not: SYSTEM_USER_ID } },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
  return users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role as UserRole,
    active: u.active,
    lastLoginAt: u.lastLoginAt ? u.lastLoginAt.toISOString() : null,
    createdAt: u.createdAt.toISOString(),
  }));
}

async function ensureNotLastAdmin(db: ReturnType<typeof getDb>, excludeUserId?: string) {
  const remaining = await db.user.count({
    where: {
      id: { notIn: [SYSTEM_USER_ID, ...(excludeUserId ? [excludeUserId] : [])] },
      role: "ADMIN",
      active: true,
    },
  });
  return remaining;
}

export type InviteResult =
  | { ok: true; id: string; tempPassword: string; message: string }
  | { ok: false; error: string };

export async function inviteUser(input: {
  name: string;
  email: string;
  role: UserRole;
  tempPassword?: string;
}): Promise<InviteResult> {
  try {
    const actor = await requireAdmin();
    const name = String(input.name ?? "").trim();
    const email = String(input.email ?? "").trim().toLowerCase();
    const role = input.role;

    if (name.length < 2) return { ok: false, error: "Captura el nombre completo." };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return { ok: false, error: "Captura un correo válido." };
    }
    if (!isRole(role)) return { ok: false, error: "Rol no válido." };

    const tempPassword = (input.tempPassword?.trim() || generateTemporaryPassword());
    const passwordError = validatePasswordStrength(tempPassword);
    if (passwordError) return { ok: false, error: passwordError };

    const db = getDb();
    const existing = await db.user.findUnique({ where: { email } });
    if (existing) {
      return { ok: false, error: "Ya existe un usuario con ese correo." };
    }

    const created = await db.user.create({
      data: {
        name,
        email,
        role,
        active: true,
        passwordHash: hashPassword(tempPassword),
      },
    });

    await writeActivityLog({
      entityType: "User",
      entityId: created.id,
      action: "USER_INVITE",
      newValue: { email, name, role },
      userId: actor.id,
    });

    revalidatePath("/settings/users");
    return {
      ok: true,
      id: created.id,
      tempPassword,
      message: "Usuario invitado. Comparte la contraseña temporal de forma segura.",
    };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    logError("settings.users.invite", error);
    return { ok: false, error: "No se pudo crear el usuario." };
  }
}

export async function changeUserRole(userId: string, role: UserRole): Promise<MutationResult> {
  try {
    const actor = await requireAdmin();
    if (!isRole(role)) return errorResult("Rol no válido.");
    if (userId === SYSTEM_USER_ID) return errorResult("No puedes cambiar el rol del usuario del sistema.");

    const db = getDb();
    const target = await db.user.findUnique({ where: { id: userId } });
    if (!target) return errorResult("El usuario ya no existe.");
    if (target.role === role) return successResult(userId, "/settings/users", "Sin cambios.");

    if (target.role === "ADMIN" && role !== "ADMIN") {
      const remaining = await ensureNotLastAdmin(db, target.id);
      if (remaining === 0) {
        return errorResult("Debe quedar al menos un Administrador activo.");
      }
    }

    if (actor.id === userId && role !== "ADMIN") {
      const remaining = await ensureNotLastAdmin(db, actor.id);
      if (remaining === 0) {
        return errorResult("No puedes quitarte el rol si eres el único Administrador.");
      }
    }

    await db.user.update({ where: { id: userId }, data: { role } });
    await writeActivityLog({
      entityType: "User",
      entityId: userId,
      action: "USER_ROLE_CHANGE",
      oldValue: { role: target.role },
      newValue: { role },
      userId: actor.id,
    });

    revalidatePath("/settings/users");
    return successResult(userId, "/settings/users", "Rol actualizado.");
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    logError("settings.users.changeRole", error);
    return errorResult("No se pudo cambiar el rol.");
  }
}

export async function setUserActive(userId: string, active: boolean): Promise<MutationResult> {
  try {
    const actor = await requireAdmin();
    if (userId === SYSTEM_USER_ID) return errorResult("No puedes modificar el usuario del sistema.");
    if (actor.id === userId && !active) {
      return errorResult("No puedes desactivar tu propia cuenta.");
    }

    const db = getDb();
    const target = await db.user.findUnique({ where: { id: userId } });
    if (!target) return errorResult("El usuario ya no existe.");
    if (target.active === active) return successResult(userId, "/settings/users", "Sin cambios.");

    if (!active && target.role === "ADMIN") {
      const remaining = await ensureNotLastAdmin(db, target.id);
      if (remaining === 0) {
        return errorResult("Debe quedar al menos un Administrador activo.");
      }
    }

    await db.user.update({ where: { id: userId }, data: { active } });
    await writeActivityLog({
      entityType: "User",
      entityId: userId,
      action: active ? "USER_ACTIVATE" : "USER_DEACTIVATE",
      oldValue: { active: target.active },
      newValue: { active },
      userId: actor.id,
    });

    revalidatePath("/settings/users");
    return successResult(userId, "/settings/users", active ? "Usuario activado." : "Usuario desactivado.");
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    logError("settings.users.setActive", error);
    return errorResult("No se pudo actualizar el usuario.");
  }
}

export type ResetPasswordResult =
  | { ok: true; tempPassword: string; message: string }
  | { ok: false; error: string };

export async function resetUserPassword(userId: string): Promise<ResetPasswordResult> {
  try {
    const actor = await requireAdmin();
    if (userId === SYSTEM_USER_ID) return { ok: false, error: "No puedes resetear el usuario del sistema." };

    const db = getDb();
    const target = await db.user.findUnique({ where: { id: userId } });
    if (!target) return { ok: false, error: "El usuario ya no existe." };

    const tempPassword = generateTemporaryPassword();
    await db.user.update({
      where: { id: userId },
      data: { passwordHash: hashPassword(tempPassword) },
    });

    await writeActivityLog({
      entityType: "User",
      entityId: userId,
      action: "USER_PASSWORD_RESET",
      userId: actor.id,
    });

    revalidatePath("/settings/users");
    return {
      ok: true,
      tempPassword,
      message: "Contraseña temporal generada. Compártela de forma segura.",
    };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    logError("settings.users.resetPassword", error);
    return { ok: false, error: "No se pudo resetear la contraseña." };
  }
}

export async function changeMyPassword(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<MutationResult> {
  try {
    const user = await requireUser();
    const current = String(input.currentPassword ?? "");
    const next = String(input.newPassword ?? "");

    if (!verifyPassword(current, user.passwordHash)) {
      return errorResult("La contraseña actual no es correcta.");
    }
    const passwordError = validatePasswordStrength(next);
    if (passwordError) return errorResult(passwordError);
    if (current === next) return errorResult("La nueva contraseña debe ser distinta.");

    const db = getDb();
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: hashPassword(next) },
    });

    await writeActivityLog({
      entityType: "User",
      entityId: user.id,
      action: "USER_SELF_PASSWORD_CHANGE",
      userId: user.id,
    });

    return successResult(user.id, "/settings/account", "Contraseña actualizada.");
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    logError("settings.users.changeMyPassword", error);
    return errorResult("No se pudo actualizar la contraseña.");
  }
}
