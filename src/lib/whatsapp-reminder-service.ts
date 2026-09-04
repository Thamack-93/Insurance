import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { writeActivityLog } from "@/lib/activity-log";
import { assertOrganizationContextInTransaction, type OrganizationContext } from "@/lib/organization-context";
import { resolveOrganizationCapability } from "@/lib/organization-capabilities";
import { receiptPortfolioWhere } from "@/lib/portfolio-access";
import { normalizeMexicanPhone } from "@/lib/phone";
import {
  buildReceiptDueMessage,
  buildWhatsAppReminderUrl,
  selectWhatsAppPhone,
  WHATSAPP_RECEIPT_TEMPLATE,
  type WhatsAppPhoneSource,
} from "@/lib/whatsapp-reminder";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type WhatsAppReminderSourceChannel = "WEB" | "TELEGRAM";

export type PrepareWhatsAppReminderResult =
  | { outcome: "OPEN_WHATSAPP"; url: string; phoneSource: WhatsAppPhoneSource }
  | { outcome: "CAPTURE_PHONE" };

export async function prepareWhatsAppReceiptReminderForContext(input: {
  db: DbClient;
  context: OrganizationContext;
  receiptId: string;
  capturedPhone?: string;
  sourceChannel: WhatsAppReminderSourceChannel;
  telegramDraftId?: string;
}): Promise<PrepareWhatsAppReminderResult> {
  const { db, context } = input;
  const captured = input.capturedPhone?.trim() || null;

  if (captured && !normalizeMexicanPhone(captured)) {
    throw new Error("Captura un teléfono mexicano válido de 10 dígitos.");
  }

  const run = async (tx: Prisma.TransactionClient) => {
    await assertOrganizationContextInTransaction(tx, context);
    const capability = await resolveOrganizationCapability(context.organizationId, "WHATSAPP", tx);
    if (!capability.enabled) throw new Error("WHATSAPP_CAPABILITY_DISABLED");

    const receipt = await tx.receipt.findFirst({
      where: {
        id: input.receiptId,
        organizationId: context.organizationId,
        status: { in: ["PENDING", "OVERDUE"] },
        ...(context.membershipRole === "AGENT" ? receiptPortfolioWhere(context.userId) : {}),
        client: { organizationId: context.organizationId },
        policy: {
          organizationId: context.organizationId,
          status: { not: "CANCELLED" },
          client: { organizationId: context.organizationId },
        },
        insurer: { organizationId: context.organizationId },
      },
      select: {
        id: true,
        dueDate: true,
        amount: true,
        currency: true,
        client: { select: { id: true, fullName: true, phone: true, secondaryPhone: true } },
        policy: { select: { policyNumber: true, clientId: true } },
        insurer: { select: { name: true } },
        payments: { where: { status: "POSTED" }, select: { id: true }, take: 1 },
      },
    });

    if (!receipt) throw new Error("El recibo ya no está disponible para un recordatorio.");
    if (receipt.policy.clientId !== receipt.client.id) {
      throw new Error("El recibo y la póliza vinculada requieren revisión manual.");
    }
    if (receipt.payments.length > 0) {
      throw new Error("El recibo tiene un pago registrado; requiere revisión manual antes de enviar un recordatorio.");
    }

    const existingPrimary = normalizeMexicanPhone(receipt.client.phone);
    const existingSecondary = normalizeMexicanPhone(receipt.client.secondaryPhone);
    let selection = selectWhatsAppPhone({ primary: receipt.client.phone, secondary: receipt.client.secondaryPhone });

    if (captured) {
      const capturedNormalized = normalizeMexicanPhone(captured);
      if (!capturedNormalized) throw new Error("Captura un teléfono mexicano válido de 10 dígitos.");
      const existing = existingPrimary ?? existingSecondary;
      if (existing && existing !== capturedNormalized) {
        throw new Error("El teléfono del cliente cambió; vuelve a intentarlo para evitar sobrescribirlo.");
      }

      if (!existing) {
        const updated = await tx.client.updateMany({
          where: {
            id: receipt.client.id,
            organizationId: context.organizationId,
            phone: receipt.client.phone,
            secondaryPhone: receipt.client.secondaryPhone,
          },
          data: { phone: capturedNormalized, updatedById: context.userId },
        });
        if (updated.count !== 1) {
          throw new Error("El teléfono del cliente cambió; vuelve a intentarlo para evitar sobrescribirlo.");
        }
        await writeActivityLog({
          entityType: "Client",
          entityId: receipt.client.id,
          action: "CLIENT_PHONE_CAPTURED_FOR_WHATSAPP",
      newValue: input.sourceChannel === "TELEGRAM"
        ? { captured: true, source: "RECEIPT_REMINDER", sourceChannel: input.sourceChannel }
        : { captured: true, source: "RECEIPT_REMINDER" },
          userId: context.userId,
          organizationId: context.organizationId,
          db: tx,
        });
        selection = { normalized: capturedNormalized, source: "CAPTURED" };
      } else {
        selection = selectWhatsAppPhone({ primary: receipt.client.phone, secondary: receipt.client.secondaryPhone });
      }
    }

    if (!selection) return { outcome: "CAPTURE_PHONE" as const };

    const message = buildReceiptDueMessage({
      clientName: receipt.client.fullName,
      insurerName: receipt.insurer.name,
      policyNumber: receipt.policy.policyNumber,
      dueDate: receipt.dueDate,
      amount: receipt.amount,
      currency: receipt.currency,
    });
    const url = buildWhatsAppReminderUrl(selection.normalized, message);

    await writeActivityLog({
      entityType: "Receipt",
      entityId: receipt.id,
      action: input.sourceChannel === "TELEGRAM" ? "WHATSAPP_REMINDER_PREPARED" : "WHATSAPP_REMINDER_OPENED",
      newValue: input.sourceChannel === "TELEGRAM"
        ? {
            phoneSource: selection.source,
            template: WHATSAPP_RECEIPT_TEMPLATE,
            sourceChannel: input.sourceChannel,
            status: "HANDOFF_PREPARED_NOT_SENT",
          }
        : {
            phoneSource: selection.source,
            template: WHATSAPP_RECEIPT_TEMPLATE,
            status: "HANDOFF_OPENED_NOT_SENT",
          },
      userId: context.userId,
      organizationId: context.organizationId,
      db: tx,
    });

    if (input.telegramDraftId) {
      const updatedDraft = await tx.telegramDraft.updateMany({
        where: {
          id: input.telegramDraftId,
          organizationId: context.organizationId,
          userId: context.userId,
          status: "COLLECTING",
          type: "WHATSAPP_RECEIPT_REMINDER",
        },
        data: { status: "CONFIRMED", confirmedAt: new Date() },
      });
      if (updatedDraft.count !== 1) {
        throw new Error("El recordatorio ya fue procesado o expiró; vuelve a intentarlo.");
      }
    }

    return { outcome: "OPEN_WHATSAPP" as const, url, phoneSource: selection.source };
  };
  // Request handlers should pass a transaction-bound TenantDb. Keep the root
  // client fallback only for legacy callers, where this function itself still
  // establishes the tenant transaction and revalidates membership.
  if ("$transaction" in db) {
    return db.$transaction(run);
  }
  return run(db as Prisma.TransactionClient);
}
