"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin, AuthError } from "@/lib/auth";
import { provisionDemoOrganization, resetDemoOrganization, deleteDemoOrganization, extendDemoTrial, suspendOrganization, reactivateOrganization } from "@/lib/demo-organizations";

export async function provisionDemoOrganizationAction(input: { requestId: string; name: string; slug?: string; ownerName: string; requestedUsers?: number }) {
  try {
    await requireSuperAdmin();
    const requestId = String(input.requestId ?? "").trim();
    if (!requestId || requestId.length > 128) return { ok: false as const, error: "La solicitud de provisión no es válida." };
    const requestedUsers = input.requestedUsers === undefined ? 1 : Number(input.requestedUsers);
    if (requestedUsers !== 1) return { ok: false as const, error: "La DEMO externa usa una sola cuenta." };
    const result = await provisionDemoOrganization({ ...input, requestedUsers, requestId });
    revalidatePath("/platform");
    revalidatePath("/platform/organizations");
    return { ok: true as const, ...result };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false as const, error: error.message };
    return { ok: false as const, error: "No se pudo provisionar el DEMO. Revisa el estado de la provisión y los logs de plataforma." };
  }
}

export async function resetDemoOrganizationAction(input: { organizationId: string; requestId: string; reason: string; dryRun?: boolean }) {
  try {
    await requireSuperAdmin();
    const requestId = String(input.requestId ?? "").trim();
    if (!requestId || requestId.length > 128) return { ok: false as const, error: "La solicitud de reset no es válida." };
    const reason = String(input.reason ?? "").trim();
    if (reason.length < 8 || reason.length > 500) return { ok: false as const, error: "Captura un motivo de al menos 8 caracteres." };
    const result = await resetDemoOrganization(input.organizationId, requestId, input.dryRun === true, reason);
    revalidatePath("/platform");
    revalidatePath(`/platform/organizations/${encodeURIComponent(input.organizationId)}`);
    return { ok: true as const, ...result };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false as const, error: error.message };
    return { ok: false as const, error: "No se pudo reiniciar el DEMO. El tenant permanece protegido; revisa el estado antes de reintentar." };
  }
}

export async function deleteDemoOrganizationAction(input: { organizationId: string; confirmationSlug: string; requestId: string; reason: string }) {
  try {
    await requireSuperAdmin();
    const organizationId = String(input.organizationId ?? "").trim();
    if (!organizationId || organizationId.length > 160) return { ok: false as const, error: "El identificador del DEMO no es válido." };
    const requestId = String(input.requestId ?? "").trim();
    if (!requestId || requestId.length > 128) return { ok: false as const, error: "La solicitud de eliminación no es válida." };
    const confirmationSlug = String(input.confirmationSlug ?? "").trim();
    if (!confirmationSlug || confirmationSlug.length > 48) return { ok: false as const, error: "Confirma el slug exacto del DEMO." };
    const reason = String(input.reason ?? "").trim();
    if (reason.length < 8 || reason.length > 500) return { ok: false as const, error: "Captura un motivo de al menos 8 caracteres." };
    const result = await deleteDemoOrganization({ organizationId, requestId, confirmationSlug, reason });
    revalidatePath("/platform");
    revalidatePath("/platform/organizations");
    revalidatePath(`/platform/organizations/${encodeURIComponent(organizationId)}`);
    return { ok: true as const, ...result };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false as const, error: error.message };
    const code = error instanceof Error ? error.message : "";
    const knownErrors: Record<string, string> = {
      DEMO_DELETE_REQUIRES_SUSPENDED: "Suspende el DEMO antes de eliminarlo.",
      DEMO_DELETE_CONFIRMATION_MISMATCH: "El slug no coincide; no se eliminó nada.",
      DEMO_DELETE_BACKUP_REQUIRES_REVIEW: "Este DEMO tiene respaldos asociados; requiere revisión antes de eliminarlo.",
      DEMO_DELETE_RESTORE_REQUIRES_REVIEW: "Este DEMO tiene restauraciones asociadas; requiere revisión antes de eliminarlo.",
      DEMO_DELETE_BILLING_REQUIRES_REVIEW: "Este DEMO tiene cargos registrados; requiere revisión antes de eliminarlo.",
      DEMO_DELETE_RESET_NOT_IDLE: "Hay un reset o provisión en curso; espera a que termine antes de eliminarlo.",
      DEMO_DELETE_LOCK_UNAVAILABLE: "Hay otra operación activa para este DEMO; vuelve a intentar cuando termine.",
    };
    return { ok: false as const, error: knownErrors[code] ?? "No se pudo eliminar el DEMO. Sigue suspendido; revisa el estado antes de reintentar." };
  }
}

export async function extendDemoTrialAction(input: { organizationId: string; days: number; reason: string }) {
  try {
    await requireSuperAdmin();
    const trialEndsAt = await extendDemoTrial(input.organizationId, input.days, input.reason);
    revalidatePath("/platform");
    revalidatePath(`/platform/organizations/${encodeURIComponent(input.organizationId)}`);
    return { ok: true as const, trialEndsAt };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false as const, error: error.message };
    return { ok: false as const, error: "No se pudo extender el DEMO." };
  }
}

export async function suspendOrganizationAction(input: { organizationId: string; reason: string }) {
  try {
    await requireSuperAdmin();
    const result = await suspendOrganization(input.organizationId, input.reason);
    revalidatePath("/platform");
    revalidatePath(`/platform/organizations/${encodeURIComponent(input.organizationId)}`);
    return { ok: true as const, ...result };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false as const, error: error.message };
    return { ok: false as const, error: "No se pudo suspender la organización." };
  }
}

export async function reactivateOrganizationAction(input: { organizationId: string; reason: string }) {
  try {
    await requireSuperAdmin();
    const result = await reactivateOrganization(input.organizationId, input.reason);
    revalidatePath("/platform");
    revalidatePath(`/platform/organizations/${encodeURIComponent(input.organizationId)}`);
    return { ok: true as const, ...result };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false as const, error: error.message };
    return { ok: false as const, error: "No se pudo reactivar la organización." };
  }
}
