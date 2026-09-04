"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { AuthError, hashPassword, requireSuperAdmin } from "@/lib/auth";
import { generateTemporaryPassword, temporaryPasswordExpiresAt } from "@/lib/password-policy";
import { isSupportedTimeZone } from "@/lib/time-zones";
import { logError } from "@/lib/logger";

const DEFAULT_ORGANIZATION_TIME_ZONE = "America/Mexico_City";

export type CreateOrganizationResult =
  | { ok: true; organizationId: string; slug: string; ownerEmail: string; temporaryPassword: string | null; alreadyExisted?: boolean; message: string }
  | { ok: false; error: string };

function normalizeSlug(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

export async function createOrganizationAction(input: {
  requestId: string;
  name: string;
  slug?: string;
  ownerName: string;
  ownerEmail: string;
  timeZone?: string;
  defaultCurrency?: string;
}): Promise<CreateOrganizationResult> {
  try {
    const actor = await requireSuperAdmin();
    // Stage 3 only exposes the isolated DEMO factory. Paid CUSTOMER onboarding
    // remains a separate commercial workflow and cannot accidentally create a
    // second production tenant during the cutover release.
    if (process.env.PLATFORM_CUSTOMER_PROVISIONING_ENABLED !== "1") {
      return { ok: false, error: "La creación de organizaciones aún no está habilitada para este entorno." };
    }

    const requestId = String(input.requestId ?? "").trim();
    const name = String(input.name ?? "").trim();
    const ownerName = String(input.ownerName ?? "").trim();
    const ownerEmail = normalizeEmail(String(input.ownerEmail ?? ""));
    const slug = normalizeSlug(String(input.slug ?? name));
    const timeZone = String(input.timeZone ?? DEFAULT_ORGANIZATION_TIME_ZONE).trim();
    const defaultCurrency = String(input.defaultCurrency ?? "MXN").trim().toUpperCase();

    if (!requestId || requestId.length > 128) return { ok: false, error: "La solicitud de creación no es válida." };
    if (name.length < 2 || name.length > 160) return { ok: false, error: "Captura un nombre de organización válido." };
    if (slug.length < 2 || slug.length > 80) return { ok: false, error: "El slug debe contener al menos 2 caracteres válidos." };
    if (ownerName.length < 2 || ownerName.length > 160) return { ok: false, error: "Captura el nombre del propietario." };
    if (!validEmail(ownerEmail)) return { ok: false, error: "Captura un correo válido para el propietario." };
    if (!isSupportedTimeZone(timeZone)) return { ok: false, error: "La zona horaria no es válida." };
    if (!/^[A-Z]{3}$/.test(defaultCurrency)) return { ok: false, error: "La moneda debe ser un código de 3 letras." };

    const db = getDb();
    const temporaryPassword = generateTemporaryPassword();
    const result = await db.$transaction(async (tx) => {
      const existing = await tx.platformAuditLog.findUnique({ where: { requestId } });
      if (existing?.action === "ORGANIZATION_CREATE" && existing.targetOrganizationId) {
        const organization = await tx.organization.findUnique({ where: { id: existing.targetOrganizationId }, select: { id: true, slug: true } });
        if (organization) return { status: "existing" as const, organizationId: organization.id, slug: organization.slug, ownerEmail, temporaryPassword: null };
      }

      const [sameSlug, sameEmail] = await Promise.all([
        tx.organization.findUnique({ where: { slug }, select: { id: true } }),
        tx.user.findUnique({ where: { email: ownerEmail }, select: { id: true, platformRole: true } }),
      ]);
      if (sameSlug) return { status: "slug" as const };
      if (sameEmail) return { status: "email" as const };

      const organizationId = `org_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
      const ownerId = `usr_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
      await tx.organization.create({
        data: { id: organizationId, name, slug, kind: "CUSTOMER", status: "ACTIVE", timeZone, defaultCurrency },
      });
      await tx.user.create({
        data: {
          id: ownerId,
          email: ownerEmail,
          name: ownerName,
          passwordHash: hashPassword(temporaryPassword),
          role: "ADMIN",
          platformRole: "NONE",
          active: true,
          mustChangePassword: true,
          temporaryPasswordExpiresAt: temporaryPasswordExpiresAt(),
          sessionVersion: 0,
          timeZone,
        },
      });
      await tx.organizationMembership.create({
        data: { id: `om_${ownerId}`, organizationId, userId: ownerId, role: "OWNER", active: true },
      });
      await tx.platformAuditLog.create({
        data: {
          requestId,
          actorUserId: actor.id,
          targetOrganizationId: organizationId,
          targetUserId: ownerId,
          action: "ORGANIZATION_CREATE",
          metadataJson: JSON.stringify({ name, slug, ownerEmail, timeZone, defaultCurrency }),
        },
      });
      return { status: "created" as const, organizationId, slug, ownerEmail, temporaryPassword };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    if (result.status === "slug") return { ok: false, error: "Ya existe una organización con ese slug." };
    if (result.status === "email") return { ok: false, error: "Ya existe un usuario con ese correo." };
    revalidatePath("/platform");
    revalidatePath("/platform/organizations");
    return {
      ok: true,
      organizationId: result.organizationId,
      slug: result.slug,
      ownerEmail: result.ownerEmail,
      temporaryPassword: result.temporaryPassword,
      alreadyExisted: result.status === "existing",
      message: result.status === "existing" ? "La solicitud ya fue procesada; no se vuelve a mostrar la contraseña." : "Organización creada con propietario activo y contraseña temporal.",
    };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return { ok: false, error: "El slug, correo o requestId ya está en uso." };
    logError("platform.createOrganization", error);
    return { ok: false, error: "No se pudo crear la organización." };
  }
}
