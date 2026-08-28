"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { AuthError } from "@/lib/auth";
import { writeActivityLog } from "@/lib/activity-log";
import { errorResult, successResult, type MutationResult } from "@/lib/mutation-utils";
import { assertOrganizationContextInTransaction, requireOrganizationContext } from "@/lib/organization-context";
import { normalizeMexicanPhone } from "@/lib/phone";

export async function updateMyPhone(input: { phone: string }): Promise<MutationResult> {
  try {
    const context = await requireOrganizationContext();
    const rawPhone = String(input.phone ?? "").trim();
    const phone = rawPhone ? normalizeMexicanPhone(rawPhone) : null;
    if (rawPhone && !phone) {
      return errorResult("Escribe un teléfono celular mexicano de 10 dígitos.");
    }

    const db = getDb();
    await db.$transaction(async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const current = await tx.user.findUnique({ where: { id: context.userId }, select: { phone: true } });
      await tx.user.update({ where: { id: context.userId }, data: { phone } });
      await writeActivityLog({
        organizationId: context.organizationId,
        entityType: "User",
        entityId: context.userId,
        action: "USER_SELF_PHONE_UPDATE",
        oldValue: { configured: Boolean(current?.phone) },
        newValue: { configured: Boolean(phone) },
        userId: context.userId,
        db: tx,
      });
    });

    revalidatePath("/settings/account");
    return successResult(context.userId, "/settings/account", phone ? "Teléfono guardado." : "Teléfono eliminado.");
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    return errorResult("No se pudo actualizar el teléfono.");
  }
}
