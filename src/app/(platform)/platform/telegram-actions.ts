"use server";

import { revalidatePath } from "next/cache";
import { AuthError, requireSuperAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/logger";
import { errorResult, successResult, type MutationResult } from "@/lib/mutation-utils";
import { syncTelegramWebhook } from "@/lib/telegram";

export async function syncPlatformTelegramWebhookAction(): Promise<MutationResult> {
  try {
    const actor = await requireSuperAdmin();
    const result = await syncTelegramWebhook();
    if (!result.ok) return errorResult(result.error);

    await getDb().platformAuditLog.create({
      data: {
        actorUserId: actor.id,
        action: "TELEGRAM_WEBHOOK_SYNCED",
        reason: "Sincronización manual desde el panel de plataforma.",
        metadataJson: JSON.stringify({ source: "APP_BASE_URL" }),
      },
    });

    revalidatePath("/platform");
    return successResult(actor.id, "/platform", result.message);
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    logError("platform.telegram.syncWebhook", error);
    return errorResult("No se pudo sincronizar el webhook.");
  }
}
