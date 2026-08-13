"use server";

import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
import {
  AuthError,
  hashPassword,
  requireUser,
  verifyPassword,
  SYSTEM_USER_ID,
  type UserRole,
} from "@/lib/auth";
import type { Prisma } from "@/generated/prisma/client";
import { errorResult, successResult, type MutationResult } from "@/lib/mutation-utils";
import { logError } from "@/lib/logger";
import { DEFAULT_USER_TIME_ZONE } from "@/lib/time-zones";
import {
  assertOrganizationContextInTransaction,
  requireOrganizationRole,
  type OrganizationRole,
} from "@/lib/organization-context";

export type AdminUserRow = {
  id: string;
  email: string;
  name: string;
  role: OrganizationRole;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  portfolioClients: number;
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
  const context = await requireOrganizationRole(["OWNER", "ADMIN"]);
  const db = getDb();
  const memberships = await db.organizationMembership.findMany({
    where: { organizationId: context.organizationId, userId: { not: SYSTEM_USER_ID } },
    orderBy: [{ active: "desc" }, { user: { name: "asc" } }],
    include: {
      user: {
        include: {
          _count: {
            select: { portfolioClients: { where: { organizationId: context.organizationId } } },
          },
        },
      },
    },
  });
  return memberships.map((membership) => ({
    id: membership.user.id,
    email: membership.user.email,
    name: membership.user.name,
    role: membership.role as OrganizationRole,
    active: membership.active && membership.user.active,
    lastLoginAt: membership.user.lastLoginAt ? membership.user.lastLoginAt.toISOString() : null,
    createdAt: membership.user.createdAt.toISOString(),
    portfolioClients: membership.user._count.portfolioClients,
  }));
}

async function countRemainingTenantAdmins(
  tx: Prisma.TransactionClient,
  organizationId: string,
  excludeUserId?: string,
) {
  return tx.organizationMembership.count({
    where: {
      organizationId,
      userId: excludeUserId ? { not: excludeUserId } : undefined,
      role: { in: ["OWNER", "ADMIN"] },
      active: true,
      user: { active: true },
    },
  });
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
    const context = await requireOrganizationRole(["OWNER", "ADMIN"]);
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
    const created = await db.$transaction(async (tx) => {
      await assertOrganizationContextInTransaction(tx, context, ["OWNER", "ADMIN"]);
      const existing = await tx.user.findUnique({ where: { email }, select: { id: true } });
      if (existing) throw new AuthError("Ya existe un usuario con ese correo.", 409);

      const user = await tx.user.create({
        data: {
          name,
          email,
          role,
          active: true,
          timeZone: DEFAULT_USER_TIME_ZONE,
          passwordHash: hashPassword(tempPassword),
        },
      });
      // The Cycle 1 trigger may already have created this row. Upsert keeps the
      // operation compatible both before and after that temporary trigger is removed.
      await tx.organizationMembership.upsert({
        where: { organizationId_userId: { organizationId: context.organizationId, userId: user.id } },
        update: { role, active: true },
        create: { organizationId: context.organizationId, userId: user.id, role, active: true },
      });
      await writeActivityLog({
        entityType: "User",
        entityId: user.id,
        action: "USER_INVITE",
        newValue: { email, name, role },
        userId: context.userId,
        organizationId: context.organizationId,
        db: tx,
      });
      return user;
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
    const context = await requireOrganizationRole(["OWNER", "ADMIN"]);
    if (!isRole(role)) return errorResult("Rol no válido.");
    if (userId === SYSTEM_USER_ID) return errorResult("No puedes cambiar el rol del usuario del sistema.");

    const db = getDb();
    const outcome = await db.$transaction(async (tx) => {
      await assertOrganizationContextInTransaction(tx, context, ["OWNER", "ADMIN"]);
      const membership = await tx.organizationMembership.findFirst({
        where: { organizationId: context.organizationId, userId },
        include: { user: true },
      });
      if (!membership) return "missing" as const;
      if (membership.role === "OWNER") return "owner" as const;
      if (membership.role === role) return "unchanged" as const;
      if (membership.role === "ADMIN" && role === "AGENT") {
        const remaining = await countRemainingTenantAdmins(tx, context.organizationId, userId);
        if (remaining === 0) return "last-admin" as const;
      }

      await tx.user.update({ where: { id: userId }, data: { role } });
      await tx.organizationMembership.update({
        where: { organizationId_userId: { organizationId: context.organizationId, userId } },
        data: { role },
      });
      await writeActivityLog({
        entityType: "User",
        entityId: userId,
        action: "USER_ROLE_CHANGE",
        oldValue: { role: membership.role },
        newValue: { role },
        userId: context.userId,
        organizationId: context.organizationId,
        db: tx,
      });
      return "updated" as const;
    });

    if (outcome === "missing") return errorResult("El usuario no pertenece a esta organización.");
    if (outcome === "owner") return errorResult("El Owner no puede degradarse desde este flujo.");
    if (outcome === "last-admin") return errorResult("Debe quedar al menos un Owner o Administrador activo.");
    if (outcome === "unchanged") return successResult(userId, "/settings/users", "Sin cambios.");

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
    const context = await requireOrganizationRole(["OWNER", "ADMIN"]);
    if (userId === SYSTEM_USER_ID) return errorResult("No puedes modificar el usuario del sistema.");
    if (context.userId === userId && !active) {
      return errorResult("No puedes desactivar tu propia cuenta.");
    }

    const db = getDb();
    const outcome = await db.$transaction(async (tx) => {
      await assertOrganizationContextInTransaction(tx, context, ["OWNER", "ADMIN"]);
      const membership = await tx.organizationMembership.findFirst({
        where: { organizationId: context.organizationId, userId },
        include: { user: true },
      });
      if (!membership) return "missing" as const;
      if (membership.role === "OWNER" && !active) return "owner" as const;
      if (membership.active === active && membership.user.active === active) return "unchanged" as const;
      if (!active && membership.role === "ADMIN") {
        const remaining = await countRemainingTenantAdmins(tx, context.organizationId, userId);
        if (remaining === 0) return "last-admin" as const;
      }

      await tx.user.update({ where: { id: userId }, data: { active } });
      await tx.organizationMembership.update({
        where: { organizationId_userId: { organizationId: context.organizationId, userId } },
        data: { active },
      });
      await writeActivityLog({
        entityType: "User",
        entityId: userId,
        action: active ? "USER_ACTIVATE" : "USER_DEACTIVATE",
        oldValue: { active: membership.active },
        newValue: { active },
        userId: context.userId,
        organizationId: context.organizationId,
        db: tx,
      });
      return "updated" as const;
    });

    if (outcome === "missing") return errorResult("El usuario no pertenece a esta organización.");
    if (outcome === "owner") return errorResult("El Owner activo no puede desactivarse desde este flujo.");
    if (outcome === "last-admin") return errorResult("Debe quedar al menos un Owner o Administrador activo.");
    if (outcome === "unchanged") return successResult(userId, "/settings/users", "Sin cambios.");

    revalidatePath("/settings/users");
    return successResult(userId, "/settings/users", active ? "Usuario activado." : "Usuario desactivado.");
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    logError("settings.users.setActive", error);
    return errorResult("No se pudo actualizar el usuario.");
  }
}

export async function deleteUser(userId: string, replacementUserId?: string): Promise<MutationResult> {
  try {
    const context = await requireOrganizationRole(["OWNER", "ADMIN"]);
    if (userId === SYSTEM_USER_ID) return errorResult("No puedes eliminar el usuario del sistema.");
    if (context.userId === userId) return errorResult("No puedes eliminar tu propia cuenta.");

    const db = getDb();
    const replacementId = replacementUserId?.trim() || null;
    const outcome = await db.$transaction(async (tx) => {
      await assertOrganizationContextInTransaction(tx, context, ["OWNER", "ADMIN"]);
      const membership = await tx.organizationMembership.findFirst({
        where: { organizationId: context.organizationId, userId },
        include: { user: true },
      });
      if (!membership) return { status: "missing" as const };
      if (membership.role === "OWNER") return { status: "owner" as const };
      if (membership.user.active || membership.active) return { status: "active" as const };

      const portfolioClients = await tx.client.count({
        where: { organizationId: context.organizationId, portfolioOwnerId: userId },
      });
      if (portfolioClients > 0 && !replacementId) return { status: "replacement-required" as const };

      let replacement: { id: string } | null = null;
      if (replacementId) {
        if (replacementId === userId || replacementId === SYSTEM_USER_ID) return { status: "invalid-replacement" as const };
        const replacementMembership = await tx.organizationMembership.findFirst({
          where: {
            organizationId: context.organizationId,
            userId: replacementId,
            active: true,
            user: { active: true },
          },
          select: { userId: true },
        });
        if (!replacementMembership) return { status: "invalid-replacement" as const };
        replacement = { id: replacementMembership.userId };
      }

      if (replacement) {
        await tx.client.updateMany({
          where: { organizationId: context.organizationId, portfolioOwnerId: userId },
          data: { portfolioOwnerId: replacement.id },
        });
      }
      await tx.activityLog.updateMany({
        where: { userId, organizationId: context.organizationId },
        data: { userId: SYSTEM_USER_ID },
      });
      await writeActivityLog({
        entityType: "User",
        entityId: userId,
        action: "USER_DELETE",
        oldValue: { email: membership.user.email, role: membership.role, active: membership.active, portfolioClients },
        newValue: { replacementUserId: replacement?.id ?? null },
        userId: context.userId,
        organizationId: context.organizationId,
        db: tx,
      });
      // Cycle 1 keeps a synchronized membership for every legacy user. Remove
      // the inactive membership explicitly so its transition guard runs before
      // the user delete instead of relying on FK cascade ordering.
      await tx.organizationMembership.delete({
        where: { organizationId_userId: { organizationId: context.organizationId, userId } },
      });
      await tx.user.delete({ where: { id: userId } });
      return { status: "deleted" as const };
    });

    if (outcome.status === "missing") return errorResult("El usuario no pertenece a esta organización.");
    if (outcome.status === "owner") return errorResult("El Owner no puede eliminarse desde este flujo.");
    if (outcome.status === "active") return errorResult("Desactiva el usuario antes de eliminarlo.");
    if (outcome.status === "replacement-required") return errorResult("Selecciona un usuario activo para reasignar la cartera.");
    if (outcome.status === "invalid-replacement") return errorResult("El usuario de destino debe pertenecer y estar activo en esta organización.");

    revalidatePath("/settings/users");
    return successResult(userId, "/settings/users", "Usuario eliminado.");
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    logError("settings.users.delete", error);
    return errorResult("No se pudo eliminar el usuario sin afectar los datos operativos.");
  }
}

export type ResetPasswordResult =
  | { ok: true; tempPassword: string; message: string }
  | { ok: false; error: string };

export async function resetUserPassword(userId: string): Promise<ResetPasswordResult> {
  try {
    const context = await requireOrganizationRole(["OWNER", "ADMIN"]);
    if (userId === SYSTEM_USER_ID) return { ok: false, error: "No puedes resetear el usuario del sistema." };

    const db = getDb();
    const tempPassword = generateTemporaryPassword();
    const updated = await db.$transaction(async (tx) => {
      await assertOrganizationContextInTransaction(tx, context, ["OWNER", "ADMIN"]);
      const membership = await tx.organizationMembership.findFirst({
        where: { organizationId: context.organizationId, userId },
        select: { id: true },
      });
      if (!membership) return false;
      await tx.user.update({
        where: { id: userId },
        data: { passwordHash: hashPassword(tempPassword) },
      });
      await writeActivityLog({
        entityType: "User",
        entityId: userId,
        action: "USER_PASSWORD_RESET",
        userId: context.userId,
        organizationId: context.organizationId,
        db: tx,
      });
      return true;
    });
    if (!updated) return { ok: false, error: "El usuario no pertenece a esta organización." };

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
