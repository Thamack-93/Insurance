"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
import { logError } from "@/lib/logger";
import { errorResult, successResult, type MutationResult } from "@/lib/mutation-utils";
import {
  createAndDeliverTelegramNotificationEvent,
  createTelegramLinkCodeForUser,
  disconnectTelegramChannelForUser,
  sendTelegramBirthdayReminderForUser,
  sendTelegramDigestMessagesForUser,
  syncTelegramWebhook,
  type TelegramLinkCodeResult,
} from "@/lib/telegram";
import { updateNotificationPreferences } from "@/lib/notification-foundation";
import type { NotificationPreferenceInput } from "@/lib/notification-foundation-shared";
import { requireOrganizationContext } from "@/lib/organization-context";

export async function setTelegramMutationsEnabled(enabled: boolean): Promise<MutationResult> {
  try {
    const context = await requireOrganizationContext();
    const user = { id: context.userId };
    const db = getDb();
    const current = await db.notificationChannel.findUnique({
      where: {
        userId_type: {
          userId: user.id,
          type: "TELEGRAM",
        },
      },
      select: { telegramMutationsEnabled: true },
    });
    const channel = await db.notificationChannel.upsert({
      where: {
        userId_type: {
          userId: user.id,
          type: "TELEGRAM",
        },
      },
      update: {
        telegramMutationsEnabled: enabled,
      },
      create: {
        userId: user.id,
        type: "TELEGRAM",
        telegramMutationsEnabled: enabled,
      },
    });

    await writeActivityLog({
      organizationId: context.organizationId,
      entityType: "NotificationChannel",
      entityId: channel.id,
      action: enabled ? "TELEGRAM_MUTATIONS_ENABLED" : "TELEGRAM_MUTATIONS_DISABLED",
      oldValue: { telegramMutationsEnabled: current?.telegramMutationsEnabled ?? false },
      newValue: { telegramMutationsEnabled: enabled },
      userId: user.id,
    });

    revalidatePath("/settings/notifications");
    revalidatePath("/settings");
    return successResult(
      user.id,
      "/settings/notifications",
      enabled ? "Cambios reales por Telegram habilitados." : "Cambios reales por Telegram deshabilitados.",
    );
  } catch (error) {
    logError("settings.notifications.telegram.mutations", error);
    return errorResult("No se pudo actualizar el estado de los cambios reales por Telegram.");
  }
}

export async function generateTelegramLinkCode(): Promise<TelegramLinkCodeResult> {
  try {
    const context = await requireOrganizationContext();
    const user = { id: context.userId };
    const result = await createTelegramLinkCodeForUser({
      organizationId: context.organizationId,
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
    const context = await requireOrganizationContext();
    const user = { id: context.userId };
    const result = await disconnectTelegramChannelForUser({
      organizationId: context.organizationId,
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
    const context = await requireOrganizationContext();
    const user = { id: context.userId };
    const event = await createAndDeliverTelegramNotificationEvent({
      organizationId: context.organizationId,
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
      organizationId: context.organizationId,
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
    const context = await requireOrganizationContext();
    const user = { id: context.userId };
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

    const result = await sendTelegramDigestMessagesForUser({
      userId: user.id,
      mode: "manual",
    });

    await writeActivityLog({
      organizationId: context.organizationId,
      entityType: "NotificationEvent",
      entityId: `telegram-digest-now:${user.id}`,
      action: result.failed === 0 ? "TELEGRAM_DIGEST_NOW_SENT" : "TELEGRAM_DIGEST_NOW_PARTIAL",
      newValue: {
        sent: result.sent,
        failed: result.failed,
        parts: result.parts,
      },
      userId: user.id,
    });

    if (result.sent > 0) {
      revalidatePath("/settings/notifications");
      return result.failed === 0
        ? successResult(user.id, "/settings/notifications", "Resumen diario enviado en varios mensajes.")
        : successResult(user.id, "/settings/notifications", "Resumen diario enviado parcialmente.");
    }

    return errorResult("No se pudo enviar el resumen.");
  } catch (error) {
    logError("settings.notifications.telegram.digestNow", error);
    return errorResult("No se pudo enviar el resumen.");
  }
}

export async function sendTelegramBirthdaysNow(): Promise<MutationResult> {
  try {
    const context = await requireOrganizationContext();
    const user = { id: context.userId };
    const channel = await getDb().notificationChannel.findUnique({
      where: {
        userId_type: {
          userId: user.id,
          type: "TELEGRAM",
        },
      },
      select: { telegramChatId: true, isEnabled: true },
    });

    if (!channel?.isEnabled || !channel.telegramChatId) {
      return errorResult("Telegram no está vinculado.");
    }

    const result = await sendTelegramBirthdayReminderForUser({
      userId: user.id,
      mode: "manual",
    });

    await writeActivityLog({
      organizationId: context.organizationId,
      entityType: "NotificationEvent",
      entityId: `telegram-birthdays-now:${user.id}:${Date.now()}`,
      action: result.failed === 0 ? "TELEGRAM_BIRTHDAYS_NOW_SENT" : "TELEGRAM_BIRTHDAYS_NOW_PARTIAL",
      newValue: {
        sent: result.sent,
        skipped: result.skipped,
        failed: result.failed,
        birthdayCount: result.birthdayCount,
        mode: "manual",
      },
      userId: user.id,
    });

    if (result.birthdayCount === 0) {
      return errorResult("No hay cumpleaños de clientes hoy.");
    }
    if (result.sent > 0) {
      revalidatePath("/settings/notifications");
      return successResult(user.id, "/settings/notifications", "Aviso de cumpleaños enviado. El envío automático sigue programado.");
    }
    return errorResult("No se pudo enviar el aviso de cumpleaños.");
  } catch (error) {
    logError("settings.notifications.telegram.birthdaysNow", error);
    return errorResult("No se pudo enviar el aviso de cumpleaños.");
  }
}

export async function updateTelegramPreferences(preferences: NotificationPreferenceInput[]): Promise<MutationResult> {
  try {
    const context = await requireOrganizationContext();
    const user = { id: context.userId };
    const updated = await updateNotificationPreferences({ organizationId: context.organizationId, userId: user.id, actorId: user.id, preferences });
    if (!updated) return errorResult("No se pudieron actualizar las preferencias.");
    revalidatePath("/settings/notifications");
    return successResult(user.id, "/settings/notifications", "Preferencias de Telegram actualizadas.");
  } catch (error) {
    logError("settings.notifications.telegram.preferences", error);
    return errorResult("No se pudieron actualizar las preferencias.");
  }
}

export async function setTelegramDigestHour(hour: number): Promise<MutationResult> {
  try {
    const context = await requireOrganizationContext();
    const user = { id: context.userId };
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return errorResult("La hora debe estar entre 00 y 23.");
    await getDb().user.update({ where: { id: user.id }, data: { telegramDigestHour: hour } });
    revalidatePath("/settings/notifications");
    return successResult(user.id, "/settings/notifications", "Horario del resumen actualizado.");
  } catch (error) {
    logError("settings.notifications.telegram.digestHour", error);
    return errorResult("No se pudo actualizar el horario.");
  }
}

export async function syncTelegramWebhookAction(_formData?: FormData): Promise<MutationResult> {
  void _formData;
  try {
    const context = await requireOrganizationContext();
    const user = { id: context.userId };
    if (context.membershipRole === "AGENT") return errorResult("Solo un administrador puede sincronizar el webhook.");
    const requestHeaders = await headers();
    const proto = requestHeaders.get("x-forwarded-proto") ?? "https";
    const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
    if (!host) return errorResult("No se pudo determinar el dominio actual.");
    const result = await syncTelegramWebhook(`${proto}://${host}`);
    if (!result.ok) return errorResult(result.error);
    revalidatePath("/settings/notifications");
    return successResult(user.id, "/settings/notifications", result.message);
  } catch (error) {
    logError("settings.notifications.telegram.syncWebhook", error);
    return errorResult("No se pudo sincronizar el webhook.");
  }
}
