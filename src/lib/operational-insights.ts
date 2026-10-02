import "server-only";

import { businessAddDays, businessEndOfDay, businessStartOfDay, businessToday, daysBetweenBusinessDates, formatBusinessDate } from "@/lib/business-dates";
import {
  claimOperationalWhere,
  policyOperationalWhere,
  receiptOperationalWhere,
  requireOrganizationPortfolioReadScope,
  workItemOperationalWhere,
} from "@/lib/portfolio-access";
import { withTenantOrganization } from "@/lib/tenant-dal";
import { getRenewalStallState } from "@/lib/renewal-board.logic";
import { OPEN_WORK_ITEM_STATUSES } from "@/lib/work-queue";
import { getWorkItemHref } from "@/lib/work-item-navigation";
import { formatCurrency } from "@/lib/money";
import {
  OPERATIONAL_INSIGHT_GROUPS,
  OPERATIONAL_INSIGHT_PAGE_SIZE,
  groupOperationalInsightSignals,
  getOutstandingReceiptBalance,
  isPromiseSignalDue,
  paginateOperationalInsightRecords,
  type OperationalInsightGroupFilter,
  type OperationalInsightSignal,
} from "@/lib/operational-insights.logic";

const COLLECTION_WORK_ITEM_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_CLIENT"] as const;
const PENDING_CLAIM_REQUIREMENT_STATUSES = ["MISSING", "REQUESTED"] as const;
const TERMINAL_RENEWAL_STAGES = ["WON", "LOST"] as const;
const MAX_PAGE = 100;

export type OperationalInsightsResult = {
  today: Date;
  group: OperationalInsightGroupFilter;
  page: number;
  records: ReturnType<typeof paginateOperationalInsightRecords>["records"];
  hasPrevious: boolean;
  hasNext: boolean;
  counts: Record<(typeof OPERATIONAL_INSIGHT_GROUPS)[number], { value: number; more: boolean }>;
};

function getPageWindow(page: number) {
  return Math.min(MAX_PAGE * OPERATIONAL_INSIGHT_PAGE_SIZE + 1, page * OPERATIONAL_INSIGHT_PAGE_SIZE + 1);
}

export async function getOperationalInsights(input: {
  group: OperationalInsightGroupFilter;
  page: number;
}): Promise<OperationalInsightsResult> {
  const scope = await requireOrganizationPortfolioReadScope();
  const today = businessToday();
  const todayStart = businessStartOfDay(today);
  const todayEnd = businessEndOfDay(today);
  const in30Days = businessAddDays(today, 30);
  const sevenDaysAgo = businessAddDays(today, -7);
  const fiveDaysAgo = businessAddDays(today, -5);
  const page = Math.min(MAX_PAGE, Math.max(1, input.page));
  const take = getPageWindow(page);

  return withTenantOrganization(scope.organizationId, async (db) => {
    const [policies, overdueReceipts, collectionPromises, claims, workItems] = await Promise.all([
      db.policy.findMany({
        where: {
          AND: [
            policyOperationalWhere(scope.portfolioOwnerId, scope.organizationId),
            { status: { in: ["ACTIVE", "EXPIRED"] } },
            { renewalStage: { notIn: [...TERMINAL_RENEWAL_STAGES] } },
            { renewals: { none: {} } },
            {
              OR: [
                { status: "ACTIVE", renewalStage: "PENDING", renewalStageAt: null, endDate: { gte: todayStart, lte: in30Days } },
                { renewalStage: "PENDING", renewalStageAt: { lte: businessEndOfDay(sevenDaysAgo) } },
                { renewalStage: { in: ["CONTACTED", "QUOTED"] }, renewalStageAt: { lte: businessEndOfDay(fiveDaysAgo) } },
                { endDate: { lt: todayStart } },
              ],
            },
          ],
        },
        select: {
          id: true,
          policyNumber: true,
          status: true,
          endDate: true,
          renewalStage: true,
          renewalStageAt: true,
          client: { select: { id: true, fullName: true } },
          insurer: { select: { name: true } },
        },
        orderBy: [{ endDate: "asc" }, { id: "asc" }],
        take,
      }),
      db.receipt.findMany({
        where: {
          ...receiptOperationalWhere(scope.portfolioOwnerId, scope.organizationId),
          status: { in: ["PENDING", "OVERDUE"] },
          dueDate: { lt: todayStart },
        },
        select: {
          id: true,
          receiptNumber: true,
          amount: true,
          currency: true,
          dueDate: true,
          status: true,
          client: { select: { id: true, fullName: true } },
          policy: { select: { id: true, policyNumber: true } },
          payments: { where: { status: "POSTED" }, select: { amount: true } },
        },
        orderBy: [{ dueDate: "asc" }, { id: "asc" }],
        take,
      }),
      db.workItem.findMany({
        where: {
          AND: [
            workItemOperationalWhere(scope.portfolioOwnerId, scope.organizationId),
            { sourceType: "Collection", status: { in: [...COLLECTION_WORK_ITEM_STATUSES] } },
            { dueDate: { lte: todayEnd } },
            { metadataJson: { contains: "PROMISED_PAYMENT" } },
            { receiptId: { not: null } },
          ],
        },
        select: {
          id: true,
          sourceType: true,
          sourceId: true,
          workItemType: true,
          taskType: true,
          entityType: true,
          entityId: true,
          clientId: true,
          policyId: true,
          receiptId: true,
          title: true,
          dueDate: true,
          metadataJson: true,
          client: { select: { fullName: true } },
          policy: { select: { policyNumber: true } },
          receipt: {
            select: {
              id: true,
              receiptNumber: true,
              amount: true,
              currency: true,
              policy: { select: { id: true, policyNumber: true } },
              payments: { where: { status: "POSTED" }, select: { paidDate: true, amount: true } },
            },
          },
        },
        orderBy: [{ dueDate: "asc" }, { id: "asc" }],
        take,
      }),
      db.claim.findMany({
        where: {
          AND: [
            claimOperationalWhere(scope.portfolioOwnerId, scope.organizationId),
            { status: { notIn: ["RESOLVED", "CANCELLED"] } },
            {
              OR: [
                { status: { in: ["WAITING_CLIENT", "WAITING_INSURER"] }, updatedAt: { lte: businessEndOfDay(sevenDaysAgo) } },
                {
                  checklistItems: {
                    some: {
                      status: { in: [...PENDING_CLAIM_REQUIREMENT_STATUSES] },
                      OR: [
                        { dueDate: { lt: todayStart } },
                        { updatedAt: { lte: businessEndOfDay(sevenDaysAgo) } },
                      ],
                    },
                  },
                },
              ],
            },
          ],
        },
        select: {
          id: true,
          folio: true,
          status: true,
          updatedAt: true,
          dueDate: true,
          client: { select: { fullName: true } },
          policy: { select: { policyNumber: true } },
          insurer: { select: { name: true } },
          checklistItems: {
            where: {
              status: { in: [...PENDING_CLAIM_REQUIREMENT_STATUSES] },
              OR: [
                { dueDate: { lt: todayStart } },
                { updatedAt: { lte: businessEndOfDay(sevenDaysAgo) } },
              ],
            },
            select: { id: true, label: true, status: true, dueDate: true, updatedAt: true },
            orderBy: [{ dueDate: "asc" }, { updatedAt: "asc" }, { id: "asc" }],
          },
        },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
        take,
      }),
      db.workItem.findMany({
        where: {
          AND: [
            workItemOperationalWhere(scope.portfolioOwnerId, scope.organizationId),
            { status: { in: [...OPEN_WORK_ITEM_STATUSES] } },
            { OR: [{ dueDate: { lt: todayStart } }, { priority: { in: ["HIGH", "URGENT"] } }] },
          ],
        },
        select: {
          id: true,
          sourceType: true,
          sourceId: true,
          workItemType: true,
          taskType: true,
          entityType: true,
          entityId: true,
          clientId: true,
          policyId: true,
          receiptId: true,
          title: true,
          dueDate: true,
          priority: true,
          status: true,
          updatedAt: true,
          client: { select: { fullName: true } },
          policy: { select: { policyNumber: true } },
        },
        orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { priorityRank: "desc" }, { id: "asc" }],
        take,
      }),
    ]);

    const signals: OperationalInsightSignal[] = [];
    for (const policy of policies) {
      const daysUntilRenewal = daysBetweenBusinessDates(policy.endDate, today);
      const stall = getRenewalStallState({
        stage: policy.renewalStage,
        stageChangedAt: policy.renewalStageAt,
        daysUntilRenewal,
        today,
      });
      const record = {
        recordKey: `Policy:${policy.id}`,
        recordTitle: policy.client.fullName,
        recordSubtitle: `${policy.policyNumber} · ${policy.insurer.name}`,
        href: `/policies/${policy.id}`,
      };
      if (policy.endDate < todayStart) {
        signals.push({ ...record, id: `renewal-expired:${policy.id}`, group: "renewals", label: "Renovación vencida sin resolver", detail: `Venció ${formatBusinessDate(policy.endDate)}.`, date: policy.endDate });
      }
      if (policy.status === "ACTIVE" && policy.renewalStage === "PENDING" && !policy.renewalStageAt && daysUntilRenewal >= 0 && daysUntilRenewal <= 30) {
        signals.push({ ...record, id: `renewal-not-started:${policy.id}`, group: "renewals", label: "Renovación sin iniciar", detail: `Vence en ${daysUntilRenewal} días.`, date: policy.endDate });
      } else if (stall.stalled && stall.reason === "no-progress") {
        signals.push({ ...record, id: `renewal-stalled:${policy.id}`, group: "renewals", label: "Renovación estancada", detail: `Sin avance por ${stall.daysSinceLastMove} días.`, date: policy.renewalStageAt ?? policy.endDate });
      }
    }

    for (const receipt of overdueReceipts) {
      const balance = getOutstandingReceiptBalance(Number(receipt.amount), receipt.payments.map((payment) => Number(payment.amount)));
      if (balance <= 0) continue;
      signals.push({
        id: `receipt-overdue:${receipt.id}`,
        group: "collections",
        recordKey: `Receipt:${receipt.id}`,
        recordTitle: receipt.client.fullName,
        recordSubtitle: `${receipt.receiptNumber} · ${receipt.policy.policyNumber}`,
        href: `/receipts/${receipt.id}`,
        label: "Recibo vencido con saldo",
        detail: `${formatCurrency(balance, receipt.currency)} pendientes desde ${formatBusinessDate(receipt.dueDate)}.`,
        date: receipt.dueDate,
      });
    }

    for (const item of collectionPromises) {
      if (!item.receipt) continue;
      const promiseState = isPromiseSignalDue({
        metadataJson: item.metadataJson,
        today,
        postedPaymentDates: item.receipt.payments.map((payment) => payment.paidDate),
      });
      if (!promiseState) continue;
      const metadata = JSON.parse(item.metadataJson ?? "{}") as { promisedPaymentDate?: string };
      const promisedDate = new Date(metadata.promisedPaymentDate ?? item.dueDate ?? today);
      const balance = getOutstandingReceiptBalance(Number(item.receipt.amount), item.receipt.payments.map((payment) => Number(payment.amount)));
      if (balance <= 0) continue;
      signals.push({
        id: `${promiseState}:${item.receipt.id}`,
        group: "collections",
        recordKey: `Receipt:${item.receipt.id}`,
        recordTitle: item.client?.fullName ?? "Cliente",
        recordSubtitle: `${item.receipt.receiptNumber} · ${item.receipt.policy.policyNumber}`,
        href: `/receipts/${item.receipt.id}`,
        label: promiseState === "promise-today" ? "Promesa de pago para hoy" : "Promesa de pago incumplida",
        detail: `Prometido para ${formatBusinessDate(promisedDate)}; saldo ${formatCurrency(balance, item.receipt.currency)}.`,
        date: promisedDate,
      });
    }

    for (const claim of claims) {
      const record = {
        recordKey: `Claim:${claim.id}`,
        recordTitle: claim.client.fullName,
        recordSubtitle: `${claim.folio} · ${claim.policy.policyNumber} · ${claim.insurer.name}`,
        href: `/claims/${claim.id}`,
      };
      if ((claim.status === "WAITING_CLIENT" || claim.status === "WAITING_INSURER") && daysBetweenBusinessDates(today, claim.updatedAt) >= 7) {
        signals.push({ ...record, id: `claim-waiting:${claim.id}`, group: "claims", label: claim.status === "WAITING_CLIENT" ? "En espera del cliente" : "En espera de la aseguradora", detail: `Sin actualización desde ${formatBusinessDate(claim.updatedAt)}.`, date: claim.updatedAt });
      }
      for (const requirement of claim.checklistItems) {
        const overdue = requirement.dueDate !== null && requirement.dueDate < todayStart;
        const stale = daysBetweenBusinessDates(today, requirement.updatedAt) >= 7;
        if (!overdue && !stale) continue;
        signals.push({ ...record, id: `claim-requirement:${requirement.id}`, group: "claims", label: overdue ? "Requisito vencido" : "Requisito sin avance", detail: `${requirement.label}${requirement.dueDate ? ` · límite ${formatBusinessDate(requirement.dueDate)}` : ` · sin avance desde ${formatBusinessDate(requirement.updatedAt)}`}.`, date: requirement.dueDate ?? requirement.updatedAt });
      }
    }

    for (const item of workItems) {
      const overdue = item.dueDate !== null && item.dueDate < todayStart;
      const highPriority = item.priority === "HIGH" || item.priority === "URGENT";
      if (!overdue && !highPriority) continue;
      signals.push({
        id: `work-item:${item.id}`,
        group: "work",
        recordKey: item.policyId ? `Policy:${item.policyId}` : item.receiptId ? `Receipt:${item.receiptId}` : item.entityType.toLowerCase() === "claim" ? `Claim:${item.entityId}` : `WorkItem:${item.id}`,
        recordTitle: item.client?.fullName ?? item.title,
        recordSubtitle: item.policy?.policyNumber ? `${item.title} · ${item.policy.policyNumber}` : item.title,
        href: getWorkItemHref(item),
        label: overdue ? "Pendiente vencido" : "Pendiente de prioridad alta",
        detail: `${item.priority === "URGENT" ? "Urgente" : item.priority === "HIGH" ? "Alta" : "Abierta"}${item.dueDate ? ` · límite ${formatBusinessDate(item.dueDate)}` : ""}.`,
        date: item.dueDate ?? item.updatedAt,
      });
    }

    const records = groupOperationalInsightSignals(signals);
    const groupCapped = {
      renewals: policies.length === take,
      collections: overdueReceipts.length === take || collectionPromises.length === take,
      claims: claims.length === take,
      work: workItems.length === take,
    };
    const counts = Object.fromEntries(OPERATIONAL_INSIGHT_GROUPS.map((group) => [
      group,
      {
        value: records.filter((record) => record.groups.includes(group)).length,
        more: groupCapped[group],
      },
    ])) as OperationalInsightsResult["counts"];
    const hasMoreCandidates = input.group === "all"
      ? Object.values(groupCapped).some(Boolean)
      : groupCapped[input.group];
    const paginated = paginateOperationalInsightRecords(records, input.group, page, hasMoreCandidates);

    return {
      today,
      group: input.group,
      page,
      records: paginated.records,
      hasPrevious: paginated.hasPrevious,
      hasNext: page < MAX_PAGE && paginated.hasNext,
      counts,
    };
  });
}
