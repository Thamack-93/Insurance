"use server";

import type { Prisma } from "@/generated/prisma/client";
import { writeActivityLog } from "@/lib/activity-log";
import { AuthError } from "@/lib/auth";
import { normalizeOptionalText, optionalRelationId, parseDateInput } from "@/lib/form-utils";
import { receiptSchema, type ReceiptFormValues } from "@/lib/validations";
import { errorResult, revalidatePaths, successResult, type MutationResult } from "@/lib/mutation-utils";
import { recordPayment } from "@/lib/payment-service";
import { cancelPolicyForNonPayment } from "@/lib/nonpayment-cancellation";
import { NON_PAYMENT_CANCELLATION_DAYS } from "@/lib/nonpayment-cancellation.logic";
import { receiptPortfolioWhere } from "@/lib/portfolio-access";
import { assertOrganizationContextInTransaction, requireOrganizationContext, requireOrganizationRole, type OrganizationContext, withTenantTransaction } from "@/lib/organization-context";
import { receiptSequenceForNumber } from "@/lib/sorting";
import {
  requestQualitasPaymentLinkForReceipt,
  type QualitasRecipientType,
} from "@/lib/qualitas-payment-link-service";
import type { QualitasPaymentLinkDeliveryMethod } from "@/lib/qualitas-payment-link";
import {
  prepareWhatsAppReceiptReminderForContext,
} from "@/lib/whatsapp-reminder-service";
import type { WhatsAppPhoneSource } from "@/lib/whatsapp-reminder";

const ALLOWED_PAYMENT_METHODS = ["TRANSFER", "CASH", "CARD", "CHECK", "OTHER"] as const;
type AllowedPaymentMethod = (typeof ALLOWED_PAYMENT_METHODS)[number];

function isAllowedPaymentMethod(value: string): value is AllowedPaymentMethod {
  return (ALLOWED_PAYMENT_METHODS as readonly string[]).includes(value);
}

async function normalizeReceiptInput(values: ReceiptFormValues, context: OrganizationContext, db: Prisma.TransactionClient) {
  const policy = await db.policy.findFirst({
    where: { id: values.policyId, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? { client: { portfolioOwnerId: context.userId } } : {}) },
    select: { id: true, clientId: true, insurerId: true, currency: true },
  });

  if (!policy) {
    throw new Error("La poliza seleccionada ya no existe.");
  }

  const endorsementId = optionalRelationId(values.endorsementId);
  if (endorsementId) {
    const endorsement = await db.policyEndorsement.findFirst({
      where: {
        id: endorsementId,
        organizationId: context.organizationId,
        policyId: policy.id,
      },
      select: { id: true },
    });

    if (!endorsement) {
      throw new Error("El endoso seleccionado no pertenece a esta poliza.");
    }
  }

  return {
    receiptNumber: values.receiptNumber.trim(),
    receiptSequence: receiptSequenceForNumber(values.receiptNumber),
    policyId: policy.id,
    endorsementId,
    clientId: policy.clientId,
    insurerId: policy.insurerId,
    periodStartDate: parseDateInput(values.periodStartDate),
    periodEndDate: parseDateInput(values.periodEndDate),
    dueDate: parseDateInput(values.dueDate),
    amount: values.amount,
    currency: values.currency || policy.currency,
    status: values.status,
    paidDate: values.paidDate ? parseDateInput(values.paidDate) : null,
    paymentMethod: normalizeOptionalText(values.paymentMethod),
    notes: normalizeOptionalText(values.notes),
  };
}

export async function createReceipt(values: ReceiptFormValues): Promise<MutationResult> {
  const parsed = receiptSchema.safeParse(values);

  if (!parsed.success) {
    return errorResult(parsed.error.issues[0]?.message ?? "No se pudo validar el recibo.");
  }

  try {
    const context = await requireOrganizationContext();
    const receipt = await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const payload = await normalizeReceiptInput(parsed.data, context, tx);
      const created = await tx.receipt.create({ data: { organizationId: context.organizationId, ...payload, createdById: context.userId, updatedById: context.userId } });
      await writeActivityLog({ organizationId: context.organizationId, entityType: "Receipt", entityId: created.id, action: "RECEIPT_CREATE", newValue: created, userId: context.userId, db: tx });
      return created;
    });

    revalidatePaths([
      "/receipts",
      "/due-payments",
      `/policies/${receipt.policyId}`,
      `/clients/${receipt.clientId}`,
      "/dashboard",
      "/today",
      "/portfolio",
      "/risks",
    ]);

    return successResult(receipt.id, "/receipts", "Recibo creado.");
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo crear el recibo.");
  }
}

export async function updateReceipt(id: string, values: ReceiptFormValues): Promise<MutationResult> {
  const parsed = receiptSchema.safeParse(values);

  if (!parsed.success) {
    return errorResult(parsed.error.issues[0]?.message ?? "No se pudo validar el recibo.");
  }

  try {
    const context = await requireOrganizationContext();
    const receipt = await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const previous = await tx.receipt.findFirst({ where: { id, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? { client: { portfolioOwnerId: context.userId } } : {}) } });
      if (!previous) throw new Error("El recibo ya no existe.");
      const payload = await normalizeReceiptInput(parsed.data, context, tx);
      const updated = await tx.receipt.update({ where: { id }, data: { ...payload, updatedById: context.userId } });
      await writeActivityLog({ organizationId: context.organizationId, entityType: "Receipt", entityId: updated.id, action: "RECEIPT_UPDATE", oldValue: previous, newValue: updated, userId: context.userId, db: tx });
      return updated;
    });

    revalidatePaths([
      "/receipts",
      "/due-payments",
      `/policies/${receipt.policyId}`,
      `/clients/${receipt.clientId}`,
      "/dashboard",
      "/today",
      "/portfolio",
      "/risks",
    ]);

    return successResult(receipt.id, "/receipts", "Recibo actualizado.");
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudo actualizar el recibo.");
  }
}

export async function cancelReceiptAndPolicy(id: string): Promise<MutationResult> {
  try {
    const context = await requireOrganizationContext();
    const userId = context.userId;
    const result = await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const permitted = await tx.receipt.findFirst({ where: { id, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? { client: { portfolioOwnerId: userId } } : {}) }, select: { id: true } });
      if (!permitted) throw new Error("El recibo no existe o fue eliminado.");
      return cancelPolicyForNonPayment(context.organizationId, id, userId, new Date(), { client: tx, enforceCutoff: false });
    });

    revalidatePaths([
      "/receipts",
      "/due-payments",
      `/receipts/${id}`,
      `/policies/${result.policyId}`,
      "/clients",
      "/dashboard",
      "/today",
      "/portfolio",
      "/renewals",
      "/risks",
      "/data-quality",
    ]);

    return successResult(
      id,
      `/receipts/${id}`,
      `Póliza ${result.policyNumber} cancelada por falta de pago; ${result.cancelledReceiptCount ?? 0} recibo(s) cerrado(s).`,
    );
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    return errorResult(error instanceof Error ? error.message : `No se pudo cancelar el recibo después de ${NON_PAYMENT_CANCELLATION_DAYS} días.`);
  }
}

export async function cancelReceipt(id: string): Promise<MutationResult> {
  try {
    const context = await requireOrganizationContext();
    const result = await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const existingReceipt = await tx.receipt.findFirst({
      where: { id, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? { client: { portfolioOwnerId: context.userId } } : {}) },
      include: {
        policy: {
          select: {
            id: true,
            policyNumber: true,
            clientId: true,
          },
        },
        payments: {
          where: { status: "POSTED" },
          select: { id: true },
        },
      },
    });

      if (!existingReceipt) throw new Error("El recibo ya no existe.");
      if (existingReceipt.status === "CANCELLED") return { existingReceipt, updatedReceipt: existingReceipt, alreadyCancelled: true };
      if (existingReceipt.payments.length > 0) throw new Error("No se puede cancelar: elimina primero los pagos registrados desde el detalle del recibo.");
      const updatedReceipt = await tx.receipt.update({
      where: { id },
      data: {
        status: "CANCELLED",
        paidDate: null,
        paymentMethod: null,
        cancellationReason: "MANUAL",
        cancellationBatchId: null,
        cancelledAt: new Date(),
        updatedById: context.userId,
      },
    });

      await writeActivityLog({ organizationId: context.organizationId, entityType: "Receipt", entityId: updatedReceipt.id, action: "RECEIPT_CANCEL", oldValue: existingReceipt, newValue: updatedReceipt, userId: context.userId, db: tx });
      return { existingReceipt, updatedReceipt, alreadyCancelled: false };
    });
    const { existingReceipt, updatedReceipt } = result;
    if (result.alreadyCancelled) return successResult(existingReceipt.id, `/receipts/${existingReceipt.id}`, "El recibo ya estaba cancelado.");

    revalidatePaths([
      "/receipts",
      "/due-payments",
      `/receipts/${updatedReceipt.id}`,
      `/policies/${existingReceipt.policy.id}`,
      `/clients/${existingReceipt.policy.clientId}`,
      "/dashboard",
      "/today",
      "/portfolio",
      "/renewals",
      "/risks",
      "/data-quality",
    ]);

    return successResult(updatedReceipt.id, `/receipts/${updatedReceipt.id}`, "Recibo cancelado.");
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    return errorResult(error instanceof Error ? error.message : "No se pudo cancelar el recibo.");
  }
}

export async function bulkMarkReceiptsPaid(
  ids: string[],
  paymentMethod: string = "TRANSFER"
): Promise<MutationResult> {
  if (!ids.length) return errorResult("No hay recibos seleccionados.");
  if (!isAllowedPaymentMethod(paymentMethod)) {
    return errorResult("Método de pago no válido.");
  }

  const context = await requireOrganizationContext();
  const userId = context.userId;
  const now = new Date();

  try {
    const receipts = await withTenantTransaction(context, (tx) => tx.receipt.findMany({
      where: { id: { in: ids }, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? receiptPortfolioWhere(userId) : {}) },
      select: {
        id: true,
        receiptNumber: true,
        policyId: true,
        clientId: true,
        currency: true,
        amount: true,
        status: true,
      },
    }));

    const eligible = receipts.filter((r) => r.status !== "PAID" && r.status !== "CANCELLED");

    if (eligible.length === 0) {
      return errorResult("No hay recibos pendientes en la selección.");
    }

    let okCount = 0;
    const failures: string[] = [];

    for (const receipt of eligible) {
      try {
        await withTenantTransaction(context, async (tx) => {
          await assertOrganizationContextInTransaction(tx, context);
          return recordPayment({ organizationId: context.organizationId, receiptId: receipt.id, amount: Number(receipt.amount), paidDate: now, paymentMethod, sourceEvidenceKey: `bulk:${receipt.id}:${now.toISOString()}`, actorId: userId }, tx);
        });

        okCount += 1;
      } catch (innerError) {
        failures.push(receipt.receiptNumber);
        console.error(`bulkMarkReceiptsPaid failed for ${receipt.id}`, innerError);
      }
    }

    revalidatePaths([
      "/receipts",
      "/due-payments",
      "/dashboard",
      "/today",
      "/portfolio",
    ]);

    if (okCount === 0) {
      return errorResult("No se pudo marcar ningún recibo como pagado.");
    }

    const skipped = ids.length - eligible.length;
    const parts = [`${okCount} recibo${okCount !== 1 ? "s" : ""} marcado${okCount !== 1 ? "s" : ""} como pagado${okCount !== 1 ? "s" : ""}.`];
    if (skipped > 0) parts.push(`${skipped} ya estaba${skipped !== 1 ? "n" : ""} pagado${skipped !== 1 ? "s" : ""} o cancelado${skipped !== 1 ? "s" : ""}.`);
    if (failures.length) parts.push(`${failures.length} fallaron: ${failures.join(", ")}.`);

    return successResult("bulk", "", parts.join(" "));
  } catch (error) {
    return errorResult(error instanceof Error ? error.message : "No se pudieron marcar los recibos.");
  }
}
export async function deleteReceipt(id: string): Promise<MutationResult> {
  try {
    const context = await requireOrganizationRole(["OWNER", "ADMIN"]);
    const result = await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context, ["OWNER", "ADMIN"]);
      const existingReceipt = await tx.receipt.findFirst({
        where: { id, organizationId: context.organizationId },
        include: {
          _count: {
            select: {
              payments: true,
              commissions: true,
            },
          },
        },
      });

      if (!existingReceipt) throw new Error("El recibo ya no existe.");

      const counts = existingReceipt._count;
      const blockers: string[] = [];
      if (counts.payments > 0) blockers.push(`${counts.payments} pago${counts.payments !== 1 ? "s" : ""}`);
      if (counts.commissions > 0) blockers.push(`${counts.commissions} comisión${counts.commissions !== 1 ? "es" : ""}`);

      if (blockers.length > 0) return { deleted: false as const, existingReceipt, blockers };
      await tx.receipt.delete({ where: { id } });
      await writeActivityLog({ organizationId: context.organizationId, entityType: "Receipt", entityId: id, action: "RECEIPT_DELETE", oldValue: { receiptNumber: existingReceipt.receiptNumber, policyId: existingReceipt.policyId, clientId: existingReceipt.clientId }, userId: context.userId, db: tx });
      return { deleted: true as const, existingReceipt, blockers: [] };
    });
    if (!result.deleted) return errorResult(`No se puede eliminar: el recibo tiene ${result.blockers.join(", ")} asociado${result.blockers.length > 1 ? "s" : ""}. Cancela o elimina primero esos registros.`);
    const { existingReceipt } = result;

    revalidatePaths([
      "/receipts",
      "/due-payments",
      `/policies/${existingReceipt.policyId}`,
      `/clients/${existingReceipt.clientId}`,
      "/dashboard",
      "/today",
      "/portfolio",
      "/risks",
    ]);

    return successResult(id, "/receipts", "Recibo eliminado.");
  } catch (error) {
    if (error instanceof AuthError) return errorResult(error.message);
    return errorResult(error instanceof Error ? error.message : "No se pudo eliminar el recibo.");
  }
}

export type RequestQualitasPaymentLinkInput = {
  receiptId: string;
  recipientType: QualitasRecipientType;
  deliveryChannel: QualitasPaymentLinkDeliveryMethod;
};

export type RequestQualitasPaymentLinkResult =
  | { ok: true; id: string; redirectTo: string; message: string; outcome: string; destination: string }
  | { ok: false; error: string };

export async function requestQualitasPaymentLink(
  input: RequestQualitasPaymentLinkInput,
): Promise<RequestQualitasPaymentLinkResult> {
  if (!input.receiptId || !["CLIENT", "AGENT"].includes(input.recipientType) || !["EMAIL", "WHATSAPP"].includes(input.deliveryChannel)) {
    return { ok: false, error: "La selección de destinatario o canal no es válida." };
  }

  try {
    const context = await requireOrganizationContext();
    const result = await requestQualitasPaymentLinkForReceipt({ ...input, context });
    if (!result.ok) return result;
    revalidatePaths(["/receipts", `/receipts/${input.receiptId}`, "/dashboard", "/today"]);
    return {
      ok: true,
      id: input.receiptId,
      redirectTo: `/receipts/${input.receiptId}`,
      message: result.message,
      outcome: result.outcome,
      destination: result.destination,
    };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: "No se pudo solicitar la liga de pago de Quálitas." };
  }
}

export type WhatsAppReceiptReminderInput = {
  receiptId: string;
  capturedPhone?: string;
};

export type WhatsAppReceiptReminderResult =
  | { ok: true; outcome: "OPEN_WHATSAPP"; url: string; phoneSource: WhatsAppPhoneSource }
  | { ok: true; outcome: "CAPTURE_PHONE" }
  | { ok: false; error: string };

/**
 * Authorizes and prepares a manual WhatsApp handoff. No WhatsApp API is
 * called: the returned URL is opened by the agent and remains editable there.
 */
export async function prepareWhatsAppReceiptReminder(
  input: WhatsAppReceiptReminderInput,
): Promise<WhatsAppReceiptReminderResult> {
  if (!input || typeof input.receiptId !== "string" || !input.receiptId.trim()) {
    return { ok: false, error: "El recibo seleccionado no es válido." };
  }

  try {
    const context = await requireOrganizationContext();
    const payload = {
      context,
      receiptId: input.receiptId,
      capturedPhone: input.capturedPhone,
      sourceChannel: "WEB" as const,
    };
    let tenantTransaction: typeof withTenantTransaction | undefined;
    try {
      tenantTransaction = withTenantTransaction;
    } catch {
      tenantTransaction = undefined;
    }
    const result = typeof tenantTransaction === "function"
      ? await tenantTransaction(context, (tx) => prepareWhatsAppReceiptReminderForContext({ db: tx, ...payload }))
      : await prepareWhatsAppReceiptReminderForContext({
          db: (await import("@/lib/db"))["getDb"](),
          ...payload,
        });

    if (result.outcome === "CAPTURE_PHONE") {
      return { ok: true, outcome: "CAPTURE_PHONE" };
    }

    revalidatePaths(["/receipts", `/receipts/${input.receiptId}`, "/clients"]);
    return { ok: true, ...result };
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: error instanceof Error ? error.message : "No se pudo preparar el recordatorio." };
  }
}
