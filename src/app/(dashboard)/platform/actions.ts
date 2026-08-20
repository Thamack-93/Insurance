"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { AuthError, hashPassword, requireSuperAdmin, SYSTEM_USER_ID } from "@/lib/auth";
import { generateTemporaryPassword, temporaryPasswordExpiresAt } from "@/lib/password-policy";
import { logError } from "@/lib/logger";

export type PlatformPasswordResetResult =
  | { ok: true; tempPassword: string; email: string; organizationId: string; message: string }
  | { ok: false; error: string };

export async function resetTenantUserPasswordFromPlatform(input: {
  userId: string;
  confirmEmail: string;
  reason: string;
}): Promise<PlatformPasswordResetResult> {
  try {
    const actor = await requireSuperAdmin();
    const userId = String(input.userId ?? "").trim();
    const confirmEmail = String(input.confirmEmail ?? "").trim().toLowerCase();
    const reason = String(input.reason ?? "").trim();
    if (!userId || userId === SYSTEM_USER_ID || userId === actor.id) {
      return { ok: false, error: "La cuenta objetivo no es válida." };
    }
    if (reason.length < 8 || reason.length > 500) {
      return { ok: false, error: "Captura un motivo de al menos 8 caracteres." };
    }

    const db = getDb();
    const tempPassword = generateTemporaryPassword();
    const result = await db.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          platformRole: true,
          organizationMemberships: {
            select: { organizationId: true, role: true, active: true },
          },
        },
      });
      if (!target || target.platformRole === "SUPERADMIN" || target.organizationMemberships.length !== 1) {
        return { status: "invalid" as const };
      }
      if (target.email.toLowerCase() !== confirmEmail) return { status: "email" as const };

      await tx.user.update({
        where: { id: target.id },
        data: {
          passwordHash: hashPassword(tempPassword),
          mustChangePassword: true,
          temporaryPasswordExpiresAt: temporaryPasswordExpiresAt(),
          sessionVersion: { increment: 1 },
        },
      });
      await tx.platformAuditLog.create({
        data: {
          actorUserId: actor.id,
          targetOrganizationId: target.organizationMemberships[0].organizationId,
          targetUserId: target.id,
          action: "TENANT_USER_PASSWORD_RESET",
          reason,
          metadataJson: JSON.stringify({ role: target.organizationMemberships[0].role, active: target.organizationMemberships[0].active }),
        },
      });
      return {
        status: "updated" as const,
        email: target.email,
        organizationId: target.organizationMemberships[0].organizationId,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    if (result.status === "email") return { ok: false, error: "El correo de confirmación no coincide." };
    if (result.status !== "updated") return { ok: false, error: "Solo puedes resetear usuarios tenant, no superadmins." };

    revalidatePath(`/platform/organizations/${encodeURIComponent(result.organizationId)}`);
    return {
      ok: true,
      tempPassword,
      email: result.email,
      organizationId: result.organizationId,
      message: "Contraseña temporal generada. El usuario deberá cambiarla al entrar.",
    };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    logError("platform.resetTenantUserPassword", error);
    return { ok: false, error: "No se pudo resetear la contraseña tenant." };
  }
}
