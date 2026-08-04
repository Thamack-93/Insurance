"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getDb } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/auth";
import { writeActivityLog } from "@/lib/activity-log";

const LEGACY_ORGANIZATION_ID = "org_legacy_singleton_0001";

function text(value: FormDataEntryValue | null) {
  return String(value ?? "").trim();
}

async function assertMultiOrgEnabled() {
  const db = getDb();
  const singleton = await db.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM pg_indexes WHERE indexname = 'Organization_transition_singleton_idx'
    ) AS exists
  `;
  if (singleton[0]?.exists) {
    throw new Error("La apertura multi-organización sigue bloqueada hasta completar Cycle 2/3 y el restore drill.");
  }
}

export async function createOrganizationAction(formData: FormData) {
  const actor = await requireSuperAdmin();
  await assertMultiOrgEnabled();
  const name = text(formData.get("name"));
  const slug = text(formData.get("slug")).toLowerCase();
  const timeZone = text(formData.get("timeZone")) || "Etc/GMT+6";
  const defaultCurrency = (text(formData.get("defaultCurrency")) || "MXN").toUpperCase();
  if (!name || name.length > 120) throw new Error("El nombre de la organización es obligatorio y debe tener 120 caracteres o menos.");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("El slug debe usar kebab-case.");
  if (!/^[A-Z]{3}$/.test(defaultCurrency)) throw new Error("La moneda debe ser ISO de tres letras.");
  const db = getDb();
  const organization = await db.organization.create({
    data: { id: `org_${randomUUID().replaceAll("-", "").slice(0, 20)}`, name, slug, timeZone, defaultCurrency, status: "ACTIVE" },
  });
  await writeActivityLog({ entityType: "Organization", entityId: organization.id, action: "PLATFORM_ORGANIZATION_CREATED", userId: actor.id, organizationId: organization.id, newValue: { name, slug } });
  revalidatePath("/platform");
}

export async function setOrganizationStatusAction(formData: FormData) {
  const actor = await requireSuperAdmin();
  const organizationId = text(formData.get("organizationId"));
  const status = text(formData.get("status"));
  if (!organizationId || !["ACTIVE", "SUSPENDED"].includes(status)) throw new Error("Estado de organización inválido.");
  if (organizationId === LEGACY_ORGANIZATION_ID && status === "SUSPENDED") throw new Error("La organización legacy no puede suspenderse durante la transición.");
  const db = getDb();
  const previous = await db.organization.findUnique({ where: { id: organizationId }, select: { status: true } });
  if (!previous) throw new Error("Organización no encontrada.");
  await db.organization.update({ where: { id: organizationId }, data: { status } });
  await writeActivityLog({ entityType: "Organization", entityId: organizationId, action: `PLATFORM_ORGANIZATION_${status}`, userId: actor.id, organizationId, oldValue: { status: previous.status }, newValue: { status } });
  revalidatePath("/platform");
  revalidatePath(`/platform/organizations/${organizationId}`);
}

export async function createPlanAction(formData: FormData) {
  const actor = await requireSuperAdmin();
  const code = text(formData.get("code")).toUpperCase();
  const name = text(formData.get("name"));
  const amount = Number(text(formData.get("monthlyAmountMinor")));
  const currency = (text(formData.get("currency")) || "MXN").toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,31}$/.test(code) || !name || !Number.isSafeInteger(amount) || amount < 0 || !/^[A-Z]{3}$/.test(currency)) {
    throw new Error("Datos de plan inválidos.");
  }
  const db = getDb();
  const plan = await db.plan.create({ data: { code, name, monthlyAmountMinor: amount, currency } });
  await writeActivityLog({ entityType: "Plan", entityId: plan.id, action: "PLATFORM_PLAN_CREATED", userId: actor.id, newValue: { code, currency, amountMinor: amount } });
  revalidatePath("/platform");
}

export async function assignPlanAction(formData: FormData) {
  const actor = await requireSuperAdmin();
  const organizationId = text(formData.get("organizationId"));
  const planId = text(formData.get("planId"));
  const status = text(formData.get("status")) || "ACTIVE";
  if (!organizationId || !planId || !["TRIAL", "ACTIVE", "PAST_DUE", "CANCELED"].includes(status)) throw new Error("Suscripción inválida.");
  const db = getDb();
  const [organization, plan] = await Promise.all([
    db.organization.findUnique({ where: { id: organizationId } }),
    db.plan.findUnique({ where: { id: planId } }),
  ]);
  if (!organization || !plan) throw new Error("Organización o plan no encontrado.");
  const subscription = await db.organizationSubscription.create({ data: { organizationId, planId, status, monthlyAmountMinor: plan.monthlyAmountMinor, currency: plan.currency } });
  await writeActivityLog({ entityType: "OrganizationSubscription", entityId: subscription.id, action: "PLATFORM_SUBSCRIPTION_ASSIGNED", userId: actor.id, organizationId, newValue: { planId, status } });
  revalidatePath("/platform");
  revalidatePath(`/platform/organizations/${organizationId}`);
}

export async function updateMembershipAction(formData: FormData) {
  const actor = await requireSuperAdmin();
  const organizationId = text(formData.get("organizationId"));
  const userId = text(formData.get("userId"));
  const role = text(formData.get("role"));
  const active = text(formData.get("active")) !== "false";
  if (!organizationId || !userId || !["OWNER", "ADMIN", "AGENT"].includes(role)) throw new Error("Membership inválida.");
  if (userId === "system-user-0000") throw new Error("El usuario técnico no puede pertenecer a una organización.");
  const db = getDb();
  const membership = await db.organizationMembership.upsert({
    where: { organizationId_userId: { organizationId, userId } },
    create: { organizationId, userId, role, active },
    update: { role, active },
  });
  await writeActivityLog({ entityType: "OrganizationMembership", entityId: membership.id, action: "PLATFORM_MEMBERSHIP_UPDATED", userId: actor.id, organizationId, newValue: { userId, role, active } });
  revalidatePath(`/platform/organizations/${organizationId}`);
}

export async function recordChargeAction(formData: FormData) {
  const actor = await requireSuperAdmin();
  const organizationId = text(formData.get("organizationId"));
  const subscriptionId = text(formData.get("subscriptionId")) || null;
  const amountMinor = Number(text(formData.get("amountMinor")));
  const currency = (text(formData.get("currency")) || "MXN").toUpperCase();
  const reason = text(formData.get("reason"));
  const status = text(formData.get("status")) || "PAID";
  if (!organizationId || !Number.isSafeInteger(amountMinor) || amountMinor < 0 || !/^[A-Z]{3}$/.test(currency) || reason.length < 10 || !["PAID", "VOID", "REFUNDED"].includes(status)) {
    throw new Error("El cargo requiere importe, moneda, estado y un motivo de al menos 10 caracteres.");
  }
  const now = new Date();
  const db = getDb();
  if (subscriptionId) {
    const subscription = await db.organizationSubscription.findUnique({ where: { id: subscriptionId }, select: { organizationId: true } });
    if (!subscription || subscription.organizationId !== organizationId) throw new Error("La suscripción no pertenece a la organización indicada.");
  }
  const charge = await db.billingCharge.create({ data: { organizationId, subscriptionId, periodStart: now, periodEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)), amountMinor, currency, status, paidAt: status === "PAID" ? now : null, reason } });
  await writeActivityLog({ entityType: "BillingCharge", entityId: charge.id, action: "PLATFORM_CHARGE_RECORDED", userId: actor.id, organizationId, newValue: { amountMinor, currency, status, reason } });
  revalidatePath("/platform");
  revalidatePath(`/platform/organizations/${organizationId}`);
}
