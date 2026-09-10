import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { writeActivityLog } from "@/lib/activity-log";
import * as organizationContext from "@/lib/organization-context";
import type { OrganizationContext } from "@/lib/organization-context";
import { resolveOrganizationCapability } from "@/lib/organization-capabilities";
import { isSyntheticOutboundEmail, isSyntheticOutboundPhone } from "@/lib/outbound-contact-guard";
import {
  isQualitasClientRecipientEnabled,
  isQualitasInsurerName,
  isQualitasPaymentLinkEnabled,
  maskQualitasEmail,
  maskQualitasPhone,
  normalizeQualitasEmail,
  normalizeQualitasPhone,
  prepareQualitasPaymentLink,
  requestQualitasPaymentLink,
  type QualitasPaymentLinkOutcome,
  type QualitasPaymentLinkReason,
  type QualitasPaymentLinkDeliveryMethod,
  type QualitasPreparedPaymentLink,
  type QualitasPaymentLinkResult,
} from "@/lib/qualitas-payment-link";

type DbClient = PrismaClient | Prisma.TransactionClient;

function optionalOrganizationContextExport<T extends keyof typeof organizationContext>(name: T): (typeof organizationContext)[T] | undefined {
  try {
    return organizationContext[name];
  } catch {
    // Vitest mocks may intentionally expose only the guard needed by a logic
    // fixture. Treat omitted bridge exports as a test-only fallback.
    return undefined;
  }
}

export type QualitasRecipientType = "CLIENT" | "AGENT";

export type QualitasReceiptRequestInput = {
  receiptId: string;
  recipientType: QualitasRecipientType;
  deliveryChannel: QualitasPaymentLinkDeliveryMethod;
  context: OrganizationContext;
  client?: DbClient;
};

export type QualitasReceiptRequestResult =
  | {
      ok: true;
      outcome: QualitasPaymentLinkOutcome;
      reason: QualitasPaymentLinkReason;
      message: string;
      recipientLabel: string;
      destination: string;
    }
  | { ok: false; error: string };

function isPrepared(value: QualitasPreparedPaymentLink | QualitasPaymentLinkResult): value is QualitasPreparedPaymentLink {
  return "transportReady" in value;
}
function outcomeMessage(outcome: QualitasPaymentLinkOutcome, reason: QualitasPaymentLinkReason) {
  if (outcome === "SUCCESS") return "La solicitud fue enviada a Quálitas.";
  if (outcome === "ALREADY_IN_PROGRESS" || reason === "DUPLICATE_LINK_99991") {
    return "Quálitas indica que ya existe una liga de pago en proceso para esta póliza.";
  }
  if (outcome === "UNCERTAIN_POST_SUBMISSION" || reason === "FINAL_TIMEOUT" || reason === "FINAL_RESPONSE_UNRECOGNIZED") {
    return "No pudimos confirmar si Quálitas procesó la solicitud. Para evitar duplicados no se reenviará automáticamente.";
  }
  if (outcome === "PROVIDER_FLOW_CHANGED" || outcome === "PROVIDER_UNAVAILABLE") {
    return "Quálitas no está disponible en este momento. Intenta nuevamente más tarde.";
  }
  if (outcome === "POLICY_NOT_FOUND") return "Quálitas no reconoció la póliza.";
  if (outcome === "POLICY_NOT_ELIGIBLE") return "Quálitas indica que esta póliza no puede usar este flujo de pago.";
  if (outcome === "DESTINATION_REJECTED") return "Quálitas rechazó el destino seleccionado.";
  return "No se pudo completar la solicitud de enlace de pago de Quálitas.";
}

function auditOutcome(outcome: QualitasPaymentLinkOutcome) {
  if (outcome === "SUCCESS") return "SUCCESS";
  if (outcome === "ALREADY_IN_PROGRESS") return "ALREADY_IN_PROGRESS";
  if (outcome === "UNCERTAIN_POST_SUBMISSION") return "UNCERTAIN";
  return "FAILED";
}

export async function requestQualitasPaymentLinkForReceipt(
  input: QualitasReceiptRequestInput,
): Promise<QualitasReceiptRequestResult> {
  if (!input.client) {
    // Logic tests provide a minimal context mock; production always exposes
    // the live membership-backed tenant bridge.
    const requireContext = optionalOrganizationContextExport("requireOrganizationContext");
    const liveContext = typeof requireContext === "function"
      ? await requireContext()
      : input.context;
    if (liveContext.organizationId !== input.context.organizationId || liveContext.userId !== input.context.userId) {
      throw new Error("ORGANIZATION_CONTEXT_MISMATCH");
    }
    const tenantTransaction = optionalOrganizationContextExport("withTenantTransaction");
    if (typeof tenantTransaction === "function") {
      return tenantTransaction(liveContext, (tx) => requestQualitasPaymentLinkForReceipt({ ...input, client: tx }));
    }
    const dbModule = await import("@/lib/db");
    return requestQualitasPaymentLinkForReceipt({ ...input, client: dbModule["getDb"]() });
  }
  // The caller has already established a tenant transaction. Resolve both
  // provider and delivery entitlements on that same client so a concurrent
  // suspension/kill-switch cannot be bypassed between authorization and the
  // persisted audit/outbound decision.
  const capability = await resolveOrganizationCapability(input.context.organizationId, "QUALITAS", input.client as Prisma.TransactionClient);
  if (!capability.enabled) return { ok: false, error: "La integración de Quálitas no está certificada o habilitada para esta organización." };
  const deliveryCapability = await resolveOrganizationCapability(
    input.context.organizationId,
    input.deliveryChannel === "EMAIL" ? "EMAIL" : "WHATSAPP",
    input.client as Prisma.TransactionClient,
  );
  if (!deliveryCapability.enabled) {
    return { ok: false, error: `El canal ${input.deliveryChannel} no está habilitado para esta organización.` };
  }
  if (!isQualitasPaymentLinkEnabled()) {
    return { ok: false, error: "La integración de enlaces de pago de Quálitas no está habilitada." };
  }
  if (input.recipientType === "CLIENT" && !isQualitasClientRecipientEnabled()) {
    return { ok: false, error: "El envío al cliente todavía no está habilitado." };
  }

  const db = input.client;
  const [receipt, actor] = await Promise.all([
    db.receipt.findFirst({
      where: {
        id: input.receiptId,
        organizationId: input.context.organizationId,
        ...(input.context.membershipRole === "AGENT" ? { client: { portfolioOwnerId: input.context.userId } } : {}),
      },
      include: {
        client: { select: { id: true, fullName: true, email: true, phone: true, organizationId: true } },
        policy: { select: { id: true, policyNumber: true, status: true, organizationId: true } },
        insurer: { select: { id: true, name: true, organizationId: true } },
      },
    }),
    db.user.findFirst({ where: { id: input.context.userId, active: true }, select: { id: true, email: true, phone: true } }),
  ]);

  if (
    !receipt ||
    !actor ||
    !["PENDING", "OVERDUE"].includes(receipt.status) ||
    receipt.policy.status === "CANCELLED" ||
    receipt.organizationId !== input.context.organizationId ||
    receipt.client.organizationId !== input.context.organizationId ||
    receipt.policy.organizationId !== input.context.organizationId ||
    receipt.insurer.organizationId !== input.context.organizationId ||
    !isQualitasInsurerName(receipt.insurer.name)
  ) {
    return { ok: false, error: "El recibo no existe, no está abierto o no es una póliza Quálitas autorizada." };
  }

  const recipientLabel = input.recipientType === "CLIENT" ? "Cliente" : "Agente";
  const email = input.recipientType === "CLIENT"
    ? normalizeQualitasEmail(receipt.client.email)
    : normalizeQualitasEmail(actor.email);
  const phone = input.recipientType === "CLIENT"
    ? normalizeQualitasPhone(receipt.client.phone)
    : normalizeQualitasPhone(actor.phone);
  const destination = input.deliveryChannel === "EMAIL" ? email : phone;

  if (!destination || (input.deliveryChannel === "EMAIL" ? isSyntheticOutboundEmail(destination) : isSyntheticOutboundPhone(destination))) {
    return {
      ok: false,
      error: input.deliveryChannel === "EMAIL"
        ? `Confirma un correo real para ${recipientLabel} antes de realizar un envío.`
        : `Confirma un teléfono real para ${recipientLabel} antes de realizar un envío.`,
    };
  }

  const correlationId = randomUUID();
  let providerResult: QualitasPaymentLinkResult;
  try {
    const prepared = await prepareQualitasPaymentLink(
      { policyNumber: receipt.policy.policyNumber, deliveryChannel: input.deliveryChannel, destination, correlationId },
      { traceId: correlationId, correlationId },
    );
    providerResult = isPrepared(prepared)
      ? await requestQualitasPaymentLink(prepared, { traceId: correlationId, correlationId })
      : prepared;
  } catch {
    providerResult = { outcome: "PROVIDER_UNAVAILABLE", reason: "NETWORK_ERROR" };
  }

  try {
    const persistAudit = async (tx: Prisma.TransactionClient) => {
      await organizationContext.assertOrganizationContextInTransaction(tx, input.context);
      await writeActivityLog({
        organizationId: input.context.organizationId,
        entityType: "Policy",
        entityId: receipt.policy.id,
        action: "QUALITAS_PAYMENT_LINK_REQUESTED",
        newValue: {
          receiptId: receipt.id,
          recipientType: input.recipientType,
          deliveryChannel: input.deliveryChannel,
          result: auditOutcome(providerResult.outcome),
          reason: providerResult.reason,
        },
        userId: input.context.userId,
        db: tx,
      });
    };
    if ("$transaction" in db) await db.$transaction(persistAudit);
    else await persistAudit(db);
  } catch {
    return { ok: false, error: "La solicitud terminó, pero no se pudo guardar su auditoría." };
  }

  return {
    ok: true,
    outcome: providerResult.outcome,
    reason: providerResult.reason,
    message: outcomeMessage(providerResult.outcome, providerResult.reason),
    recipientLabel,
    destination: input.deliveryChannel === "EMAIL" ? maskQualitasEmail(destination) : maskQualitasPhone(destination),
  };
}
