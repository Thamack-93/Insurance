"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin, AuthError } from "@/lib/auth";
import { provisionDemoOrganization, resetDemoOrganization, extendDemoTrial, suspendOrganization, reactivateOrganization } from "@/lib/demo-organizations";

export async function provisionDemoOrganizationAction(input: { requestId: string; name: string; slug?: string; ownerName: string; requestedUsers?: number }) {
  try {
    await requireSuperAdmin();
    const requestId = String(input.requestId ?? "").trim();
    if (!requestId || requestId.length > 128) return { ok: false as const, error: "La solicitud de provisión no es válida." };
    const requestedUsers = input.requestedUsers === undefined ? 1 : Number(input.requestedUsers);
    if (!Number.isInteger(requestedUsers) || requestedUsers < 1 || requestedUsers > 5) return { ok: false as const, error: "El DEMO admite entre 1 y 5 usuarios." };
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
