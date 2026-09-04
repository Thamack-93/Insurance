import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { writeActivityLog } from "@/lib/activity-log";
import { assertOrganizationContextInTransaction, type OrganizationContext } from "@/lib/organization-context";
import { receiptPortfolioWhere } from "@/lib/portfolio-access";
import { resolveClientWhatsAppPhone } from "@/lib/whatsapp-client-phone";
import {
  buildReceiptDueMessage,
  buildWhatsAppReminderUrl,
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

  const run = async (tx: Prisma.TransactionClient) => {
    await assertOrganizationContextInTransaction(tx, context);

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

    const selection = await resolveClientWhatsAppPhone({
      tx,
      organizationId: context.organizationId,
      userId: context.userId,
      client: receipt.client,
      capturedPhone: captured,
      source: "RECEIPT_REMINDER",
      sourceChannel: input.sourceChannel,
    });

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
  return "$transaction" in db ? db.$transaction(run) : run(db as Prisma.TransactionClient);
}
