import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { writeActivityLog } from "@/lib/activity-log";
import { assertOrganizationContextInTransaction, type OrganizationContext } from "@/lib/organization-context";
import { policyOperationalWhere } from "@/lib/portfolio-access";
import { isTerminalRenewalStage, resolveRenewalStage, type RenewalStage } from "@/lib/renewal-board.logic";
import { getLatestReceiptStatus, LATEST_RENEWAL_RECEIPT_INCLUDE } from "@/lib/renewal-receipt";
import { isRenewalWhatsAppEligible, buildRenewalQuoteShareMessage, buildRenewalWhatsAppContactMessage, WHATSAPP_RENEWAL_CONTACT_TEMPLATE, WHATSAPP_RENEWAL_QUOTE_TEMPLATE } from "@/lib/renewal-whatsapp";
import { buildWhatsAppUrl, type WhatsAppPhoneSource } from "@/lib/whatsapp";
import { resolveClientWhatsAppPhone } from "@/lib/whatsapp-client-phone";

type DbClient = PrismaClient | Prisma.TransactionClient;
type Handoff = "NATIVE_SHARE" | "WHATSAPP_FALLBACK";

type RenewalPolicy = Prisma.PolicyGetPayload<{
  include: {
    client: { select: { id: true; organizationId: true; fullName: true; phone: true; secondaryPhone: true } };
    insurer: { select: { id: true; name: true; organizationId: true } };
    renewals: { select: { id: true }; take: 1 };
    sourceRenewalSuggestions: { where: { status: { in: ["ACCEPTED", "DECLINED"] } }; select: { id: true }; take: 1 };
    receipts: typeof LATEST_RENEWAL_RECEIPT_INCLUDE.receipts;
  };
}>;

export type RenewalWhatsAppResult =
  | { outcome: "OPEN_WHATSAPP"; url: string; message: string; phoneSource: WhatsAppPhoneSource }
  | { outcome: "CAPTURE_PHONE" }
  | { outcome: "READY_TO_SHARE"; message: string };

function portfolioOwnerId(context: OrganizationContext) {
  return context.membershipRole === "AGENT" ? context.userId : undefined;
}

async function loadEligibleRenewal(tx: Prisma.TransactionClient, context: OrganizationContext, policyId: string): Promise<{ policy: RenewalPolicy; stage: RenewalStage }> {
  const policy = await tx.policy.findFirst({
    where: { id: policyId, ...policyOperationalWhere(portfolioOwnerId(context), context.organizationId) },
    include: {
      client: { select: { id: true, organizationId: true, fullName: true, phone: true, secondaryPhone: true } },
      insurer: { select: { id: true, name: true, organizationId: true } },
      renewals: { select: { id: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 },
      sourceRenewalSuggestions: { where: { status: { in: ["ACCEPTED", "DECLINED"] } }, select: { id: true }, take: 1 },
      ...LATEST_RENEWAL_RECEIPT_INCLUDE,
    },
  });

  if (!policy || policy.client.organizationId !== context.organizationId || policy.insurer.organizationId !== context.organizationId || policy.client.id !== policy.clientId) {
    throw new Error("La renovación ya no está disponible.");
  }
  const stage = resolveRenewalStage({
    policyStatus: policy.status,
    renewalStage: policy.renewalStage,
    hasDeclinedSuggestion: policy.sourceRenewalSuggestions.some(() => true),
  });
  if (isTerminalRenewalStage(stage)) {
    throw new Error(stage === "WON" ? "Esta póliza ya se renovó; no se puede preparar un contacto." : "Esta renovación ya se cerró como no renovada.");
  }
  if (!isRenewalWhatsAppEligible({
    stage,
    policyStatus: policy.status,
    hasSuccessor: policy.renewals.length > 0,
    hasDecision: policy.sourceRenewalSuggestions.length > 0,
    latestReceiptStatus: getLatestReceiptStatus(policy.receipts),
  })) {
    throw new Error("La renovación ya no está disponible para este contacto.");
  }
  return { policy, stage };
}

function assertWhatsAppEnabled() {
  if (process.env.PLATFORM_WHATSAPP_ENABLED === "0") throw new Error("WHATSAPP_CAPABILITY_DISABLED");
}

export async function prepareRenewalWhatsAppContactForContext(input: {
  db: DbClient;
  context: OrganizationContext;
  policyId: string;
  capturedPhone?: string;
}): Promise<RenewalWhatsAppResult> {
  const run = async (tx: Prisma.TransactionClient) => {
    await assertOrganizationContextInTransaction(tx, input.context);
    assertWhatsAppEnabled();
    const { policy, stage } = await loadEligibleRenewal(tx, input.context, input.policyId);
    const selection = await resolveClientWhatsAppPhone({
      tx,
      organizationId: input.context.organizationId,
      userId: input.context.userId,
      client: policy.client,
      capturedPhone: input.capturedPhone,
      source: "RENEWAL_CONTACT",
    });
    if (!selection) return { outcome: "CAPTURE_PHONE" as const };

    const message = buildRenewalWhatsAppContactMessage({ clientName: policy.client.fullName, policyNumber: policy.policyNumber, insurerName: policy.insurer.name, endDate: policy.endDate });
    const url = buildWhatsAppUrl(selection.normalized, message);
    await writeActivityLog({
      entityType: "Policy",
      entityId: policy.id,
      action: "RENEWAL_WHATSAPP_PREPARED",
      newValue: { renewalStage: stage, handoff: "WHATSAPP", phoneSource: selection.source, template: WHATSAPP_RENEWAL_CONTACT_TEMPLATE, status: "HANDOFF_PREPARED_NOT_SENT" },
      userId: input.context.userId,
      organizationId: input.context.organizationId,
      db: tx,
    });
    return { outcome: "OPEN_WHATSAPP" as const, url, message, phoneSource: selection.source };
  };
  return "$transaction" in input.db ? input.db.$transaction(run) : run(input.db as Prisma.TransactionClient);
}

export async function prepareRenewalQuoteShareForContext(input: {
  db: DbClient;
  context: OrganizationContext;
  policyId: string;
  handoff: Handoff;
  capturedPhone?: string;
}): Promise<RenewalWhatsAppResult> {
  const run = async (tx: Prisma.TransactionClient) => {
    await assertOrganizationContextInTransaction(tx, input.context);
    assertWhatsAppEnabled();
    const { policy, stage } = await loadEligibleRenewal(tx, input.context, input.policyId);
    const message = buildRenewalQuoteShareMessage({ clientName: policy.client.fullName, policyNumber: policy.policyNumber, insurerName: policy.insurer.name, endDate: policy.endDate });

    if (input.handoff === "NATIVE_SHARE") {
      await writeActivityLog({
        entityType: "Policy",
        entityId: policy.id,
        action: "RENEWAL_QUOTE_SHARE_PREPARED",
        newValue: { renewalStage: stage, handoff: input.handoff, template: WHATSAPP_RENEWAL_QUOTE_TEMPLATE, fileSource: "DEVICE", status: "HANDOFF_PREPARED_NOT_SENT" },
        userId: input.context.userId,
        organizationId: input.context.organizationId,
        db: tx,
      });
      return { outcome: "READY_TO_SHARE" as const, message };
    }

    const selection = await resolveClientWhatsAppPhone({
      tx,
      organizationId: input.context.organizationId,
      userId: input.context.userId,
      client: policy.client,
      capturedPhone: input.capturedPhone,
      source: "RENEWAL_CONTACT",
    });
    if (!selection) return { outcome: "CAPTURE_PHONE" as const };
    const url = buildWhatsAppUrl(selection.normalized, message);
    await writeActivityLog({
      entityType: "Policy",
      entityId: policy.id,
      action: "RENEWAL_QUOTE_SHARE_PREPARED",
      newValue: { renewalStage: stage, handoff: input.handoff, phoneSource: selection.source, template: WHATSAPP_RENEWAL_QUOTE_TEMPLATE, fileSource: "DEVICE", status: "HANDOFF_PREPARED_NOT_SENT" },
      userId: input.context.userId,
      organizationId: input.context.organizationId,
      db: tx,
    });
    return { outcome: "OPEN_WHATSAPP" as const, url, message, phoneSource: selection.source };
  };
  return "$transaction" in input.db ? input.db.$transaction(run) : run(input.db as Prisma.TransactionClient);
}
