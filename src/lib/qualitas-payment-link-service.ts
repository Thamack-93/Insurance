import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
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
  type QualitasProviderEvent,
} from "@/lib/qualitas-payment-link";

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
};

export type QualitasReceiptRequestResult =
  | {
      ok: true;
      outcome: QualitasPaymentLinkOutcome;
      reason: QualitasPaymentLinkReason;
      message: string;
      recipientLabel: string;
      destination: string;
      auditStatus: "RECORDED" | "PENDING";
    }
  | { ok: false; error: string };

type QualitasPreparedAttempt =
  | { ok: false; error: string }
  | {
      ok: true;
      receiptId: string;
      policyId: string;
      policyNumber: string;
      recipientLabel: string;
      destination: string;
    };

function isPrepared(value: QualitasPreparedPaymentLink | QualitasPaymentLinkResult): value is QualitasPreparedPaymentLink {
  return "transportReady" in value;
}
function outcomeMessage(outcome: QualitasPaymentLinkOutcome, reason: QualitasPaymentLinkReason) {
  if (reason === "AUTHORIZATION_RECHECK_FAILED") return "No se pudo volver a validar la autorización; no se envió la liga. Actualiza la sesión antes de intentarlo de nuevo.";
  if (outcome === "SUCCESS") return "La solicitud fue enviada a Quálitas.";
  if (outcome === "ALREADY_IN_PROGRESS" || reason === "DUPLICATE_LINK_99991") {
    return "Quálitas indica que ya existe una liga de pago en proceso para esta póliza.";
  }
  if (outcome === "UNCERTAIN_POST_SUBMISSION" || reason === "FINAL_TIMEOUT" || reason === "FINAL_RESPONSE_UNRECOGNIZED") {
    return "No pudimos confirmar si Quálitas procesó la solicitud. Verifica si llegó por el canal elegido antes de volver a solicitar para evitar duplicados.";
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

function logQualitasRequestEvent(input: {
  event: "attempt_started" | "provider_result" | "audit_pending";
  correlationId: string;
  organizationId: string;
  policyId: string;
  deliveryChannel: QualitasPaymentLinkDeliveryMethod;
  outcome?: QualitasPaymentLinkOutcome;
  reason?: QualitasPaymentLinkReason;
}) {
  safeQualitasInfo("[qualitas.payment_link.request]", {
    event: "qualitas.payment_link.request",
    phase: input.event,
    correlationId: input.correlationId,
    organizationId: input.organizationId,
    policyId: input.policyId,
    deliveryChannel: input.deliveryChannel,
    ...(input.outcome ? { outcome: input.outcome } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    timestamp: new Date().toISOString(),
  });
}

function auditPendingMessage(outcome: QualitasPaymentLinkOutcome, reason: QualitasPaymentLinkReason) {
  if (outcome === "SUCCESS") {
    return "Quálitas confirmó el envío, pero la auditoría quedó pendiente. Verifica si llegó antes de volver a solicitar.";
  }
  if (outcome === "UNCERTAIN_POST_SUBMISSION" || reason === "FINAL_TIMEOUT" || reason === "FINAL_RESPONSE_UNRECOGNIZED") {
    return "No pudimos confirmar si Quálitas procesó la solicitud y la auditoría quedó pendiente. Verifica si llegó antes de volver a solicitar.";
  }
  return `${outcomeMessage(outcome, reason)} La auditoría quedó pendiente. Verifica el estado antes de volver a solicitar.`;
}

async function withQualitasTenantTransaction<T>(
  context: OrganizationContext,
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const execute = async (tx: Prisma.TransactionClient) => {
    await organizationContext.assertOrganizationContextInTransaction(tx, context);
    return callback(tx);
  };

  const tenantTransaction = optionalOrganizationContextExport("withTenantTransaction");
  if (typeof tenantTransaction === "function") {
    return tenantTransaction(context, execute);
  }

  const dbModule = await import("@/lib/db");
  return dbModule["getDb"]().$transaction(execute);
}

function safeQualitasInfo(label: string, payload: Record<string, unknown>) {
  try {
    if (typeof console !== "undefined") console.info(label, JSON.stringify(payload));
  } catch {
    // Telemetry must never change the result of an external provider request.
  }
}

export async function requestQualitasPaymentLinkForReceipt(
  input: QualitasReceiptRequestInput,
): Promise<QualitasReceiptRequestResult> {
  // Logic tests may expose only the transaction guard. Production revalidates
  // the signed organization selection against the live membership on every
  // operation before touching a tenant-scoped record.
  const requireContext = optionalOrganizationContextExport("requireOrganizationContext");
  const liveContext = typeof requireContext === "function"
    ? await requireContext()
    : input.context;
  if (liveContext.organizationId !== input.context.organizationId || liveContext.userId !== input.context.userId) {
    throw new Error("ORGANIZATION_CONTEXT_MISMATCH");
  }

  const correlationId = randomUUID();
  let attempt: QualitasPreparedAttempt;
  try {
    attempt = await withQualitasTenantTransaction(liveContext, async (tx) => {
        // Resolve provider and delivery entitlements in the same tenant-bound
        // transaction as the pre-send audit record.
        const capability = await resolveOrganizationCapability(liveContext.organizationId, "QUALITAS", tx);
        if (!capability.enabled) return { ok: false as const, error: "La integración de Quálitas no está certificada o habilitada para esta organización." };
        const deliveryCapability = await resolveOrganizationCapability(
          liveContext.organizationId,
          input.deliveryChannel === "EMAIL" ? "EMAIL" : "WHATSAPP",
          tx,
        );
        if (!deliveryCapability.enabled) {
          return { ok: false as const, error: `El canal ${input.deliveryChannel} no está habilitado para esta organización.` };
        }
        if (!isQualitasPaymentLinkEnabled()) {
          return { ok: false as const, error: "La integración de enlaces de pago de Quálitas no está habilitada." };
        }
        if (input.recipientType === "CLIENT" && !isQualitasClientRecipientEnabled()) {
          return { ok: false as const, error: "El envío al cliente todavía no está habilitado." };
        }

        const [receipt, actor] = await Promise.all([
          tx.receipt.findFirst({
            where: {
              id: input.receiptId,
              organizationId: liveContext.organizationId,
              ...(liveContext.membershipRole === "AGENT" ? { client: { portfolioOwnerId: liveContext.userId } } : {}),
            },
            include: {
              client: { select: { id: true, fullName: true, email: true, phone: true, organizationId: true } },
              policy: { select: { id: true, policyNumber: true, status: true, organizationId: true } },
              insurer: { select: { id: true, name: true, organizationId: true } },
            },
          }),
          tx.user.findFirst({ where: { id: liveContext.userId, active: true }, select: { id: true, email: true, phone: true } }),
        ]);

        if (
          !receipt || !actor || !["PENDING", "OVERDUE"].includes(receipt.status) || receipt.policy.status === "CANCELLED" ||
          receipt.organizationId !== liveContext.organizationId || receipt.client.organizationId !== liveContext.organizationId ||
          receipt.policy.organizationId !== liveContext.organizationId || receipt.insurer.organizationId !== liveContext.organizationId ||
          !isQualitasInsurerName(receipt.insurer.name)
        ) {
          return { ok: false as const, error: "El recibo no existe, no está abierto o no es una póliza Quálitas autorizada." };
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
            ok: false as const,
            error: input.deliveryChannel === "EMAIL"
              ? `Confirma un correo real para ${recipientLabel} antes de realizar un envío.`
              : `Confirma un teléfono real para ${recipientLabel} antes de realizar un envío.`,
          };
        }

        await writeActivityLog({
          organizationId: liveContext.organizationId,
          entityType: "Policy",
          entityId: receipt.policy.id,
          action: "QUALITAS_PAYMENT_LINK_ATTEMPT_STARTED",
          newValue: {
            correlationId,
            receiptId: receipt.id,
            recipientType: input.recipientType,
            deliveryChannel: input.deliveryChannel,
            result: "PENDING",
            reason: "PROVIDER_RESULT_NOT_RECORDED",
          },
          userId: liveContext.userId,
          db: tx,
        });
        return {
          ok: true as const,
          receiptId: receipt.id,
          policyId: receipt.policy.id,
          policyNumber: receipt.policy.policyNumber,
          recipientLabel,
          destination,
        };
    });
  } catch {
    return { ok: false, error: "No se pudo registrar el intento; no se envió solicitud a Quálitas." };
  }

  if (!attempt.ok) return attempt;
  logQualitasRequestEvent({
    event: "attempt_started",
    correlationId,
    organizationId: liveContext.organizationId,
    policyId: attempt.policyId,
    deliveryChannel: input.deliveryChannel,
  });

  let providerResult: QualitasPaymentLinkResult;
  let finalSubmissionStarted = false;
  let finalSubmissionAuthorizationRejected = false;
  let releaseFinalSubmissionLock: (() => void) | undefined;
  let finalSubmissionLock: Promise<void> | undefined;
  try {
    const requestOptions = {
      traceId: correlationId,
      correlationId,
      onFinalSubmissionStarted: async () => {
        let resolveAuthorized!: () => void;
        let rejectAuthorized!: (error: unknown) => void;
        const authorizationReady = new Promise<void>((resolve, reject) => {
          resolveAuthorized = resolve;
          rejectAuthorized = reject;
        });
        finalSubmissionLock = withQualitasTenantTransaction(liveContext, async () => {
          finalSubmissionStarted = true;
          safeQualitasInfo("[qualitas.payment_link.provider]", {
            event: "qualitas.payment_link.provider",
            correlationId,
            organizationId: liveContext.organizationId,
            policyId: attempt.policyId,
            step: "final_submission",
            phase: "started",
            finalSubmission: true,
            timestamp: new Date().toISOString(),
          });
          resolveAuthorized();
          await new Promise<void>((resolve) => {
            releaseFinalSubmissionLock = resolve;
          });
        });
        void finalSubmissionLock.catch(rejectAuthorized);
        try {
          await authorizationReady;
        } catch (error) {
          finalSubmissionAuthorizationRejected = true;
          throw error;
        }
      },
      onFinalSubmissionFinished: async () => {
        releaseFinalSubmissionLock?.();
        try {
          await finalSubmissionLock;
        } catch {
          // Provider responses remain authoritative if transaction cleanup fails.
        }
      },
      onEvent: (event: QualitasProviderEvent) => {
        safeQualitasInfo("[qualitas.payment_link.provider]", {
          event: event.event,
          correlationId,
          organizationId: liveContext.organizationId,
          policyId: attempt.policyId,
          step: event.step,
          phase: event.phase,
          ...(event.status ? { status: event.status } : {}),
          ...(event.durationMs !== undefined ? { durationMs: event.durationMs } : {}),
          ...(event.finalSubmission !== undefined ? { finalSubmission: event.finalSubmission } : {}),
          ...(event.outcome ? { outcome: event.outcome } : {}),
          ...(event.reason ? { reason: event.reason } : {}),
          timestamp: new Date().toISOString(),
        });
      },
    };
    const prepared = await prepareQualitasPaymentLink(
      { policyNumber: attempt.policyNumber, deliveryChannel: input.deliveryChannel, destination: attempt.destination, correlationId },
      requestOptions,
    );
    providerResult = isPrepared(prepared)
      ? await requestQualitasPaymentLink(prepared, requestOptions)
      : prepared;
  } catch {
    providerResult = finalSubmissionAuthorizationRejected
      ? { outcome: "PROVIDER_UNAVAILABLE", reason: "AUTHORIZATION_RECHECK_FAILED" }
      : finalSubmissionStarted
        ? { outcome: "UNCERTAIN_POST_SUBMISSION", reason: "FINAL_RESPONSE_UNRECOGNIZED" }
        : { outcome: "PROVIDER_UNAVAILABLE", reason: "NETWORK_ERROR" };
  }
  logQualitasRequestEvent({
    event: "provider_result",
    correlationId,
    organizationId: liveContext.organizationId,
    policyId: attempt.policyId,
    deliveryChannel: input.deliveryChannel,
    outcome: providerResult.outcome,
    reason: providerResult.reason,
  });

  let auditStatus: "RECORDED" | "PENDING" = "RECORDED";
  try {
    await withQualitasTenantTransaction(liveContext, async (tx) => {
      await writeActivityLog({
        organizationId: liveContext.organizationId,
        entityType: "Policy",
        entityId: attempt.policyId,
        action: "QUALITAS_PAYMENT_LINK_REQUESTED",
        newValue: {
          correlationId,
          receiptId: attempt.receiptId,
          recipientType: input.recipientType,
          deliveryChannel: input.deliveryChannel,
          result: auditOutcome(providerResult.outcome),
          reason: providerResult.reason,
        },
        userId: liveContext.userId,
        db: tx,
      });
    });
  } catch {
    auditStatus = "PENDING";
    logQualitasRequestEvent({
      event: "audit_pending",
      correlationId,
      organizationId: liveContext.organizationId,
      policyId: attempt.policyId,
      deliveryChannel: input.deliveryChannel,
      outcome: providerResult.outcome,
      reason: providerResult.reason,
    });
  }

  return {
    ok: true,
    outcome: providerResult.outcome,
    reason: providerResult.reason,
    message: auditStatus === "PENDING"
      ? auditPendingMessage(providerResult.outcome, providerResult.reason)
      : outcomeMessage(providerResult.outcome, providerResult.reason),
    recipientLabel: attempt.recipientLabel,
    destination: input.deliveryChannel === "EMAIL" ? maskQualitasEmail(attempt.destination) : maskQualitasPhone(attempt.destination),
    auditStatus,
  };
}
