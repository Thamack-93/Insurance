"use server";

import { Prisma } from "@/generated/prisma/client";
import { AuthError, requireSuperAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { platformBillingMutationsEnabled } from "@/lib/platform-billing";
import { normalizeBillingCurrency, parseMinorAmount } from "@/lib/platform-billing.logic";
import { revalidatePaths } from "@/lib/mutation-utils";

type BillingMutationResult =
  | { ok: true; id: string; message: string }
  | { ok: false; error: string };

const SUBSCRIPTION_ASSIGNMENT_STATUSES = new Set(["TRIAL", "ACTIVE"]);
const CHARGE_CREATE_STATUSES = new Set(["PENDING", "PAID"]);
const CHARGE_TRANSITIONS: Record<string, readonly string[]> = {
  PENDING: ["PAID", "VOID"],
  PAID: ["REFUNDED"],
};

function text(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function requestId(value: unknown) {
  const result = text(value, 100);
  if (!result || !/^[a-zA-Z0-9:_-]{8,100}$/.test(result)) throw new Error("POLICYDESK_BILLING_REQUEST_ID_INVALID");
  return result;
}

function parseDate(value: unknown, code: string) {
  const date = new Date(text(value, 40));
  if (Number.isNaN(date.getTime())) throw new Error(code);
  return date;
}

function safeError(error: unknown) {
  if (error instanceof AuthError) return error.message;
  if (error instanceof Error && error.message.startsWith("POLICYDESK_BILLING_")) return error.message;
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "La operación ya existe o viola una unicidad de billing.";
  return "No se pudo completar la operación de billing.";
}

function assertBillingMutationsEnabled() {
  if (!platformBillingMutationsEnabled()) throw new Error("POLICYDESK_BILLING_MUTATIONS_DISABLED");
}

async function audit(tx: Prisma.TransactionClient, input: {
  requestId: string;
  actorUserId: string;
  action: string;
  organizationId?: string;
  reason: string;
  metadata: Record<string, unknown>;
}) {
  await tx.platformAuditLog.create({
    data: {
      requestId: input.requestId,
      actorUserId: input.actorUserId,
      targetOrganizationId: input.organizationId,
      action: input.action,
      reason: input.reason,
      metadataJson: JSON.stringify(input.metadata),
    },
  });
}

async function lockOrganization(tx: Prisma.TransactionClient, organizationId: string) {
  const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
    SELECT "id", "status" FROM "Organization" WHERE "id" = ${organizationId} FOR UPDATE
  `;
  if (rows.length !== 1) throw new Error("POLICYDESK_BILLING_ORGANIZATION_NOT_FOUND");
  return rows[0];
}

export async function createPlatformPlanAction(input: {
  requestId: string;
  code: string;
  name: string;
  monthlyAmountMinor: string | number;
  currency: string;
}): Promise<BillingMutationResult> {
  try {
    const actor = await requireSuperAdmin();
    assertBillingMutationsEnabled();
    const normalizedRequestId = requestIdInput(input.requestId);
    const code = text(input.code, 32).toUpperCase();
    const name = text(input.name, 120);
    const amount = parseMinorAmount(input.monthlyAmountMinor);
    const currency = normalizeBillingCurrency(input.currency);
    if (!/^[A-Z][A-Z0-9_]{1,31}$/.test(code) || !name) throw new Error("POLICYDESK_BILLING_PLAN_INVALID");

    const db = getDb();
    const result = await db.$transaction(async (tx) => {
      const existing = await tx.plan.findUnique({ where: { requestId: normalizedRequestId }, select: { id: true } });
      if (existing) return existing;
      const plan = await tx.plan.create({ data: { requestId: normalizedRequestId, code, name, monthlyAmountMinor: amount, currency } });
      await audit(tx, { requestId: normalizedRequestId, actorUserId: actor.id, action: "PLATFORM_PLAN_CREATED", reason: "Plan creado desde plataforma.", metadata: { code, currency, amountMinor: amount } });
      return plan;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    revalidatePaths(["/platform"]);
    return { ok: true, id: result.id, message: "Plan creado o confirmado." };
  } catch (error) {
    return { ok: false, error: safeError(error) };
  }
}

export async function assignPlatformSubscriptionAction(input: {
  requestId: string;
  organizationId: string;
  planId: string;
  status: string;
  reason: string;
}): Promise<BillingMutationResult> {
  try {
    const actor = await requireSuperAdmin();
    assertBillingMutationsEnabled();
    const normalizedRequestId = requestIdInput(input.requestId);
    const organizationId = text(input.organizationId, 100);
    const planId = text(input.planId, 100);
    const status = text(input.status, 20).toUpperCase();
    const reason = text(input.reason, 500);
    if (!organizationId || !planId || !SUBSCRIPTION_ASSIGNMENT_STATUSES.has(status) || reason.length < 10) throw new Error("POLICYDESK_BILLING_SUBSCRIPTION_INVALID");

    const db = getDb();
    const result = await db.$transaction(async (tx) => {
      const existing = await tx.organizationSubscription.findUnique({ where: { requestId: normalizedRequestId }, select: { id: true } });
      if (existing) return existing;
      const organization = await lockOrganization(tx, organizationId);
      if (organization.status === "RESTORING") throw new Error("POLICYDESK_BILLING_ORGANIZATION_RESTORING");
      const plan = await tx.plan.findUnique({ where: { id: planId }, select: { id: true, code: true, name: true, monthlyAmountMinor: true, currency: true, active: true } });
      if (!plan || !plan.active) throw new Error("POLICYDESK_BILLING_PLAN_NOT_ACTIVE");
      const current = await tx.organizationSubscription.findFirst({ where: { organizationId, status: { in: ["TRIAL", "ACTIVE", "PAST_DUE"] } }, select: { id: true, status: true } });
      if (current) await tx.organizationSubscription.update({ where: { id: current.id }, data: { status: "CANCELED", endsAt: new Date() } });
      const subscription = await tx.organizationSubscription.create({
        data: {
          requestId: normalizedRequestId,
          organizationId,
          planId: plan.id,
          status,
          monthlyAmountMinor: plan.monthlyAmountMinor,
          currency: plan.currency,
        },
      });
      await audit(tx, { requestId: normalizedRequestId, actorUserId: actor.id, organizationId, action: "PLATFORM_SUBSCRIPTION_ASSIGNED", reason, metadata: { planId: plan.id, planCode: plan.code, status, replacedSubscriptionId: current?.id ?? null } });
      return subscription;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    revalidatePaths(["/platform", `/platform/organizations/${encodeURIComponent(organizationId)}`]);
    return { ok: true, id: result.id, message: "Suscripción asignada o confirmada." };
  } catch (error) {
    return { ok: false, error: safeError(error) };
  }
}

export async function recordPlatformChargeAction(input: {
  requestId: string;
  organizationId: string;
  subscriptionId?: string;
  periodStart: string;
  periodEnd: string;
  amountMinor: string | number;
  currency: string;
  status: string;
  externalReference?: string;
  reason: string;
}): Promise<BillingMutationResult> {
  try {
    const actor = await requireSuperAdmin();
    assertBillingMutationsEnabled();
    const normalizedRequestId = requestIdInput(input.requestId);
    const organizationId = text(input.organizationId, 100);
    const subscriptionId = text(input.subscriptionId, 100) || null;
    const periodStart = parseDate(input.periodStart, "POLICYDESK_BILLING_PERIOD_START_INVALID");
    const periodEnd = parseDate(input.periodEnd, "POLICYDESK_BILLING_PERIOD_END_INVALID");
    const amountMinor = parseMinorAmount(input.amountMinor);
    const currency = normalizeBillingCurrency(input.currency);
    const status = text(input.status, 20).toUpperCase();
    const externalReference = text(input.externalReference, 200) || null;
    const reason = text(input.reason, 500);
    if (!organizationId || periodEnd < periodStart || !CHARGE_CREATE_STATUSES.has(status) || reason.length < 10) throw new Error("POLICYDESK_BILLING_CHARGE_INVALID");

    const db = getDb();
    const result = await db.$transaction(async (tx) => {
      const existing = await tx.billingCharge.findUnique({ where: { requestId: normalizedRequestId }, select: { id: true } });
      if (existing) return existing;
      await lockOrganization(tx, organizationId);
      if (subscriptionId) {
        const subscription = await tx.organizationSubscription.findUnique({ where: { id: subscriptionId }, select: { organizationId: true, currency: true } });
        if (!subscription || subscription.organizationId !== organizationId) throw new Error("POLICYDESK_BILLING_SUBSCRIPTION_NOT_FOUND");
        if (subscription.currency !== currency) throw new Error("POLICYDESK_BILLING_CURRENCY_MISMATCH");
      }
      const charge = await tx.billingCharge.create({
        data: { requestId: normalizedRequestId, organizationId, subscriptionId, periodStart, periodEnd, amountMinor, currency, status, paidAt: status === "PAID" ? new Date() : null, externalReference, reason },
      });
      await audit(tx, { requestId: normalizedRequestId, actorUserId: actor.id, organizationId, action: "PLATFORM_CHARGE_RECORDED", reason, metadata: { amountMinor, currency, status, subscriptionId, externalReference } });
      return charge;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    revalidatePaths(["/platform", `/platform/organizations/${encodeURIComponent(organizationId)}`]);
    return { ok: true, id: result.id, message: "Cargo creado o confirmado." };
  } catch (error) {
    return { ok: false, error: safeError(error) };
  }
}

export async function transitionPlatformChargeAction(input: {
  requestId: string;
  chargeId: string;
  status: string;
  reason: string;
}): Promise<BillingMutationResult> {
  try {
    const actor = await requireSuperAdmin();
    assertBillingMutationsEnabled();
    const normalizedRequestId = requestIdInput(input.requestId);
    const chargeId = text(input.chargeId, 100);
    const status = text(input.status, 20).toUpperCase();
    const reason = text(input.reason, 500);
    if (!chargeId || !reason || reason.length < 10 || !["PAID", "VOID", "REFUNDED"].includes(status)) throw new Error("POLICYDESK_BILLING_CHARGE_TRANSITION_INVALID");

    const db = getDb();
    const result = await db.$transaction(async (tx) => {
      const existingAudit = await tx.platformAuditLog.findUnique({ where: { requestId: normalizedRequestId }, select: { targetOrganizationId: true, metadataJson: true } });
      if (existingAudit?.targetOrganizationId) return { id: chargeId, organizationId: existingAudit.targetOrganizationId };
      const rows = await tx.$queryRaw<Array<{ id: string; organizationId: string; status: string }>>`
        SELECT "id", "organizationId", "status" FROM "BillingCharge" WHERE "id" = ${chargeId} FOR UPDATE
      `;
      const current = rows[0];
      if (!current) throw new Error("POLICYDESK_BILLING_CHARGE_NOT_FOUND");
      if (!CHARGE_TRANSITIONS[current.status]?.includes(status)) throw new Error("POLICYDESK_BILLING_CHARGE_TRANSITION_NOT_ALLOWED");
      const charge = await tx.billingCharge.update({ where: { id: chargeId }, data: { status, paidAt: status === "PAID" ? new Date() : undefined } });
      await audit(tx, { requestId: normalizedRequestId, actorUserId: actor.id, organizationId: current.organizationId, action: "PLATFORM_CHARGE_STATUS_CHANGED", reason, metadata: { chargeId, previousStatus: current.status, status } });
      return { id: charge.id, organizationId: current.organizationId };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    revalidatePaths(["/platform", `/platform/organizations/${encodeURIComponent(result.organizationId)}`]);
    return { ok: true, id: result.id, message: "Estado del cargo actualizado o confirmado." };
  } catch (error) {
    return { ok: false, error: safeError(error) };
  }
}

function requestIdInput(value: unknown) {
  return requestId(value);
}
