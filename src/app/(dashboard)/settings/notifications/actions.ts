"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeActivityLog } from "@/lib/activity-log";
import { logError } from "@/lib/logger";
import { errorResult, successResult, type MutationResult } from "@/lib/mutation-utils";
import {
  createAndDeliverTelegramNotificationEvent,
  createTelegramLinkCodeForUser,
  disconnectTelegramChannelForUser,
  buildTelegramDailyDigest,
  type TelegramLinkCodeResult,
} from "@/lib/telegram";
import {
  updateNotificationPreferences,
  type NotificationPreferenceInput,
} from "@/lib/notification-foundation";
import { isSupportedTimeZone } from "@/lib/time-zones";

export async function saveNotificationPreferences(
  preferences: NotificationPreferenceInput[],
): Promise<MutationResult> {
  try {
    const user = await requireUser();
    const updated = await updateNotificationPreferences({
      userId: user.id,
      actorId: user.id,
      preferences,
    });

    if (!updated) {
      return errorResult("No se pudieron guardar tus preferencias.");
    }

    revalidatePath("/settings/notifications");
    revalidatePath("/settings");
    return successResult(user.id, "/settings/notifications", "Preferencias guardadas.");
  } catch (error) {
    logError("settings.notifications.save", error);
    return errorResult("No se pudieron guardar tus preferencias.");
  }
}

export async function generateTelegramLinkCode(): Promise<TelegramLinkCodeResult> {
  try {
    const user = await requireUser();
    const result = await createTelegramLinkCodeForUser({
      userId: user.id,
      actorId: user.id,
    });

    if (result.ok) {
      revalidatePath("/settings/notifications");
      revalidatePath("/settings");
    }

    return result;
  } catch (error) {
    logError("settings.notifications.telegram.generateLinkCode", error);
    return { ok: false, error: "No se pudo generar el código de enlace." };
  }
}

export async function disconnectTelegram(): Promise<MutationResult> {
  try {
    const user = await requireUser();
    const result = await disconnectTelegramChannelForUser({
      userId: user.id,
      actorId: user.id,
    });

    if (!result.ok) {
      return errorResult(result.error);
    }

    revalidatePath("/settings/notifications");
    revalidatePath("/settings");
    return successResult(user.id, "/settings/notifications", result.message);
  } catch (error) {
    logError("settings.notifications.telegram.disconnect", error);
    return errorResult("No se pudo desconectar Telegram.");
  }
}

export async function sendTelegramTestMessage(): Promise<MutationResult> {
  try {
    const user = await requireUser();
    const event = await createAndDeliverTelegramNotificationEvent({
      type: "TEST_MESSAGE",
      title: "Mensaje de prueba",
      body: "PolicyDesk confirmó que Telegram está listo para recibir notificaciones.",
      priority: "LOW",
      userId: user.id,
      force: true,
    });

    if (!event) {
      return errorResult("No se pudo enviar el mensaje de prueba.");
    }

    await writeActivityLog({
      entityType: "NotificationEvent",
      entityId: event.id,
      action: `TELEGRAM_TEST_MESSAGE_${event.status}`,
      newValue: {
        status: event.status,
        error: event.error,
      },
      userId: user.id,
    });

    if (event.status === "SENT") {
      revalidatePath("/settings/notifications");
      return successResult(user.id, "/settings/notifications", "Mensaje de prueba enviado.");
    }

    if (event.status === "SKIPPED") {
      return errorResult(event.error ?? "Telegram no está vinculado.");
    }

    return errorResult(event.error ?? "No se pudo enviar el mensaje de prueba.");
  } catch (error) {
    logError("settings.notifications.telegram.test", error);
    return errorResult("No se pudo enviar el mensaje de prueba.");
  }
}

export async function sendTelegramDigestNow(): Promise<MutationResult> {
  try {
    const user = await requireUser();
    const channel = await getDb().notificationChannel.findUnique({
      where: {
        userId_type: {
          userId: user.id,
          type: "TELEGRAM",
        },
      },
      select: {
        telegramChatId: true,
        isEnabled: true,
      },
    });

    if (!channel?.isEnabled || !channel.telegramChatId) {
      return errorResult("Telegram no está vinculado.");
    }

    const body = await buildTelegramDailyDigest(user.id);
    const event = await createAndDeliverTelegramNotificationEvent({
      type: "DAILY_DIGEST",
      title: "Resumen diario PolicyDesk",
      body,
      priority: "LOW",
      userId: user.id,
      force: true,
    });

    if (!event) {
      return errorResult("No se pudo enviar el resumen.");
    }

    await writeActivityLog({
      entityType: "NotificationEvent",
      entityId: event.id,
      action: `TELEGRAM_DIGEST_NOW_${event.status}`,
      newValue: {
        status: event.status,
        error: event.error,
      },
      userId: user.id,
    });

    if (event.status === "SENT") {
      revalidatePath("/settings/notifications");
      return successResult(user.id, "/settings/notifications", "Resumen diario enviado.");
    }

    if (event.status === "SKIPPED") {
      return errorResult(event.error ?? "Telegram no está vinculado.");
    }

    return errorResult(event.error ?? "No se pudo enviar el resumen.");
  } catch (error) {
    logError("settings.notifications.telegram.digestNow", error);
    return errorResult("No se pudo enviar el resumen.");
  }
}

export async function updateNotificationTimezone(timeZone: string): Promise<MutationResult> {
  try {
    const user = await requireUser();
    const trimmed = timeZone.trim();

    if (!trimmed || !isSupportedTimeZone(trimmed)) {
      return errorResult("La zona horaria no es válida.");
    }

    const db = getDb();
    const updated = await db.$transaction(async (tx) => {
      const current = await tx.user.findUnique({
        where: { id: user.id },
        select: { id: true, timeZone: true },
      });

      if (!current) {
        throw new Error("No se pudo localizar tu cuenta.");
      }

      const next = await tx.user.update({
        where: { id: user.id },
        data: { timeZone: trimmed },
        select: { id: true, timeZone: true },
      });

      if (current.timeZone !== next.timeZone) {
        await writeActivityLog({
          entityType: "User",
          entityId: user.id,
          action: "USER_TIMEZONE_UPDATED",
          oldValue: { timeZone: current.timeZone },
          newValue: { timeZone: next.timeZone },
          userId: user.id,
          db: tx,
        });
      }

      return next;
    });

    revalidatePath("/settings/notifications");
    revalidatePath("/settings");
    return successResult(updated.id, "/settings/notifications", "Zona horaria actualizada.");
  } catch (error) {
    logError("settings.notifications.timezone.update", error);
    return errorResult("No se pudo actualizar la zona horaria.");
  }
}
