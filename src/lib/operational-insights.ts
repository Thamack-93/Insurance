import "server-only";

import { Prisma } from "@/generated/prisma/client";

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
import { PAYMENT_CLOSE_TOLERANCE } from "@/lib/receipt-reconciliation";
import {
  OPERATIONAL_INSIGHT_GROUPS,
  OPERATIONAL_INSIGHT_PAGE_SIZE,
  groupOperationalInsightSignals,
  getOutstandingReceiptBalance,
  isPromiseSignalDue,
  selectOperationalInsightCandidatePage,
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
  records: ReturnType<typeof groupOperationalInsightSignals>;
  hasPrevious: boolean;
  hasNext: boolean;
  counts: Record<(typeof OPERATIONAL_INSIGHT_GROUPS)[number], { value: number; more: boolean }>;
};

type InsightCandidate = {
  recordKey: string | null;
  recordDate: Date | null;
  renewalsCount: bigint;
  collectionsCount: bigint;
  claimsCount: bigint;
  workCount: bigint;
};

function readCount(value: bigint | number | null | undefined) {
  return Number(value ?? 0);
}

async function readInsightCandidates(
  db: { $queryRaw<T>(query: Prisma.Sql): Promise<T> },
  input: {
    organizationId: string;
    portfolioOwnerId?: string;
    group: OperationalInsightGroupFilter;
    page: number;
    todayStart: Date;
    in30Days: Date;
    sevenDaysAgoEnd: Date;
    fiveDaysAgoEnd: Date;
  },
) {
  const offset = (input.page - 1) * OPERATIONAL_INSIGHT_PAGE_SIZE;
  return db.$queryRaw<InsightCandidate[]>(Prisma.sql`
    WITH
    renewal_signals AS (
      SELECT p."id" AS "policyId", p."endDate" AS "signalDate", 'renewals'::text AS "groupName"
      FROM "Policy" p
      JOIN "Client" c ON c."id" = p."clientId" AND c."organizationId" = ${input.organizationId}
      WHERE p."organizationId" = ${input.organizationId}
        AND (${input.portfolioOwnerId ?? null}::text IS NULL OR c."portfolioOwnerId" = ${input.portfolioOwnerId ?? null})
        AND p."status" IN ('ACTIVE', 'EXPIRED') AND p."renewalStage" NOT IN ('WON', 'LOST')
        AND NOT EXISTS (SELECT 1 FROM "Policy" child WHERE child."organizationId" = p."organizationId" AND child."renewedFromPolicyId" = p."id")
        AND p."endDate" < ${input.todayStart}
      UNION ALL
      SELECT p."id", p."endDate", 'renewals'::text
      FROM "Policy" p
      JOIN "Client" c ON c."id" = p."clientId" AND c."organizationId" = ${input.organizationId}
      WHERE p."organizationId" = ${input.organizationId}
        AND (${input.portfolioOwnerId ?? null}::text IS NULL OR c."portfolioOwnerId" = ${input.portfolioOwnerId ?? null})
        AND p."status" = 'ACTIVE' AND p."renewalStage" = 'PENDING' AND p."renewalStageAt" IS NULL
        AND NOT EXISTS (SELECT 1 FROM "Policy" child WHERE child."organizationId" = p."organizationId" AND child."renewedFromPolicyId" = p."id")
        AND p."endDate" >= ${input.todayStart} AND p."endDate" <= ${input.in30Days}
      UNION ALL
      SELECT p."id", p."renewalStageAt", 'renewals'::text
      FROM "Policy" p
      JOIN "Client" c ON c."id" = p."clientId" AND c."organizationId" = ${input.organizationId}
      WHERE p."organizationId" = ${input.organizationId}
        AND (${input.portfolioOwnerId ?? null}::text IS NULL OR c."portfolioOwnerId" = ${input.portfolioOwnerId ?? null})
        AND p."status" IN ('ACTIVE', 'EXPIRED') AND p."renewalStage" = 'PENDING'
        AND p."renewalStageAt" <= ${input.sevenDaysAgoEnd}
        AND NOT EXISTS (SELECT 1 FROM "Policy" child WHERE child."organizationId" = p."organizationId" AND child."renewedFromPolicyId" = p."id")
      UNION ALL
      SELECT p."id", p."renewalStageAt", 'renewals'::text
      FROM "Policy" p
      JOIN "Client" c ON c."id" = p."clientId" AND c."organizationId" = ${input.organizationId}
      WHERE p."organizationId" = ${input.organizationId}
        AND (${input.portfolioOwnerId ?? null}::text IS NULL OR c."portfolioOwnerId" = ${input.portfolioOwnerId ?? null})
        AND p."status" IN ('ACTIVE', 'EXPIRED') AND p."renewalStage" IN ('CONTACTED', 'QUOTED')
        AND p."renewalStageAt" <= ${input.fiveDaysAgoEnd}
        AND NOT EXISTS (SELECT 1 FROM "Policy" child WHERE child."organizationId" = p."organizationId" AND child."renewedFromPolicyId" = p."id")
    ),
    posted_totals AS (
      SELECT pay."receiptId", SUM(pay."amount") AS "paidAmount"
      FROM "Payment" pay
      WHERE pay."organizationId" = ${input.organizationId} AND pay."status" = 'POSTED'
      GROUP BY pay."receiptId"
    ),
    overdue_receipts AS (
      SELECT r."id" AS "receiptId", r."dueDate" AS "signalDate", 'collections'::text AS "groupName"
      FROM "Receipt" r
      JOIN "Client" c ON c."id" = r."clientId" AND c."organizationId" = ${input.organizationId}
      LEFT JOIN posted_totals pt ON pt."receiptId" = r."id"
      WHERE r."organizationId" = ${input.organizationId}
        AND (${input.portfolioOwnerId ?? null}::text IS NULL OR c."portfolioOwnerId" = ${input.portfolioOwnerId ?? null})
        AND r."status" IN ('PENDING', 'OVERDUE') AND r."dueDate" < ${input.todayStart}
        AND GREATEST(0::numeric, r."amount" - COALESCE(pt."paidAmount", 0)) > 0
        AND NOT (COALESCE(pt."paidAmount", 0) > 0 AND ABS(COALESCE(pt."paidAmount", 0) - r."amount") <= ${PAYMENT_CLOSE_TOLERANCE})
    ),
    collection_json AS (
      SELECT wi."id", wi."receiptId", wi."dueDate", wi."clientId", wi."metadataJson",
        CASE WHEN wi."metadataJson" IS JSON OBJECT THEN wi."metadataJson"::jsonb ELSE '{}'::jsonb END AS metadata
      FROM "WorkItem" wi
      LEFT JOIN "Client" c ON c."id" = wi."clientId" AND c."organizationId" = ${input.organizationId}
      WHERE wi."organizationId" = ${input.organizationId}
        AND (${input.portfolioOwnerId ?? null}::text IS NULL OR c."portfolioOwnerId" = ${input.portfolioOwnerId ?? null} OR (wi."clientId" IS NULL AND wi."assignedToId" = ${input.portfolioOwnerId ?? null}))
        AND wi."sourceType" = 'Collection' AND wi."status" IN ('OPEN', 'IN_PROGRESS', 'WAITING_CLIENT')
        AND wi."metadataJson" LIKE '%PROMISED_PAYMENT%' AND wi."receiptId" IS NOT NULL
    ),
    collection_promises AS (
      SELECT r."id" AS "receiptId", CASE
          WHEN jsonb_typeof(cj.metadata->'promisedPaymentDate') = 'string'
            AND (cj.metadata->>'promisedPaymentDate') ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'
            AND pg_input_is_valid(cj.metadata->>'promisedPaymentDate', 'timestamp with time zone')
          THEN (cj.metadata->>'promisedPaymentDate')::timestamptz ELSE NULL END AS "signalDate"
      FROM collection_json cj
      JOIN "Receipt" r ON r."id" = cj."receiptId" AND r."organizationId" = ${input.organizationId}
      JOIN "Client" c ON c."id" = r."clientId" AND c."organizationId" = ${input.organizationId}
      LEFT JOIN posted_totals pt ON pt."receiptId" = r."id"
      WHERE cj.metadata->>'outcome' = 'PROMISED_PAYMENT'
        AND (${input.portfolioOwnerId ?? null}::text IS NULL OR c."portfolioOwnerId" = ${input.portfolioOwnerId ?? null})
        AND GREATEST(0::numeric, r."amount" - COALESCE(pt."paidAmount", 0)) > 0
        AND NOT (COALESCE(pt."paidAmount", 0) > 0 AND ABS(COALESCE(pt."paidAmount", 0) - r."amount") <= ${PAYMENT_CLOSE_TOLERANCE})
        AND CASE
          WHEN jsonb_typeof(cj.metadata->'promisedPaymentDate') = 'string'
            AND (cj.metadata->>'promisedPaymentDate') ~ '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'
            AND pg_input_is_valid(cj.metadata->>'promisedPaymentDate', 'timestamp with time zone')
          THEN ((cj.metadata->>'promisedPaymentDate')::timestamptz AT TIME ZONE 'Etc/GMT+6')::date <= (${input.todayStart}::timestamptz AT TIME ZONE 'Etc/GMT+6')::date
          ELSE false END
    ),
    claim_signals AS (
      SELECT cl."id" AS "claimId", cl."updatedAt" AS "signalDate", 'claims'::text AS "groupName"
      FROM "Claim" cl
      JOIN "Client" c ON c."id" = cl."clientId" AND c."organizationId" = ${input.organizationId}
      WHERE cl."organizationId" = ${input.organizationId}
        AND (${input.portfolioOwnerId ?? null}::text IS NULL OR c."portfolioOwnerId" = ${input.portfolioOwnerId ?? null})
        AND cl."status" IN ('WAITING_CLIENT', 'WAITING_INSURER') AND cl."updatedAt" <= ${input.sevenDaysAgoEnd}
      UNION ALL
      SELECT cl."id", COALESCE(item."dueDate", item."updatedAt"), 'claims'::text
      FROM "ClaimChecklistItem" item
      JOIN "Claim" cl ON cl."id" = item."claimId" AND cl."organizationId" = ${input.organizationId}
      JOIN "Client" c ON c."id" = cl."clientId" AND c."organizationId" = ${input.organizationId}
      WHERE item."organizationId" = ${input.organizationId} AND cl."status" NOT IN ('RESOLVED', 'CANCELLED')
        AND (${input.portfolioOwnerId ?? null}::text IS NULL OR c."portfolioOwnerId" = ${input.portfolioOwnerId ?? null})
        AND item."status" IN ('MISSING', 'REQUESTED')
        AND (item."dueDate" < ${input.todayStart} OR item."updatedAt" <= ${input.sevenDaysAgoEnd})
    ),
    work_signals AS (
      SELECT CASE WHEN wi."policyId" IS NOT NULL THEN 'Policy:' || wi."policyId"
                  WHEN wi."receiptId" IS NOT NULL THEN 'Receipt:' || wi."receiptId"
                  WHEN LOWER(wi."entityType") = 'claim' THEN 'Claim:' || wi."entityId"
                  ELSE 'WorkItem:' || wi."id" END AS "recordKey",
        COALESCE(wi."dueDate", wi."updatedAt") AS "signalDate", 'work'::text AS "groupName"
      FROM "WorkItem" wi
      LEFT JOIN "Client" c ON c."id" = wi."clientId" AND c."organizationId" = ${input.organizationId}
      WHERE wi."organizationId" = ${input.organizationId}
        AND (${input.portfolioOwnerId ?? null}::text IS NULL OR c."portfolioOwnerId" = ${input.portfolioOwnerId ?? null} OR (wi."clientId" IS NULL AND wi."assignedToId" = ${input.portfolioOwnerId ?? null}))
        AND wi."status" IN ('OPEN', 'IN_PROGRESS', 'WAITING_CLIENT', 'WAITING_INSURER', 'WAITING_DOCUMENT', 'SENT')
        AND (wi."dueDate" < ${input.todayStart} OR wi."priority" IN ('HIGH', 'URGENT'))
    ),
    all_signals AS (
      SELECT 'Policy:' || "policyId" AS "recordKey", "signalDate", "groupName" FROM renewal_signals
      UNION ALL SELECT 'Receipt:' || "receiptId", "signalDate", "groupName" FROM overdue_receipts
      UNION ALL SELECT 'Receipt:' || "receiptId", "signalDate", 'collections' FROM collection_promises WHERE "signalDate" IS NOT NULL
      UNION ALL SELECT 'Claim:' || "claimId", "signalDate", "groupName" FROM claim_signals
      UNION ALL SELECT "recordKey", "signalDate", "groupName" FROM work_signals
    ),
    grouped AS (
      SELECT "recordKey", MIN("signalDate") AS "recordDate", ARRAY_AGG(DISTINCT "groupName") AS "groups"
      FROM all_signals GROUP BY "recordKey"
    ),
    totals AS (
      SELECT
        COUNT(*) FILTER (WHERE 'renewals' = ANY("groups")) AS "renewalsCount",
        COUNT(*) FILTER (WHERE 'collections' = ANY("groups")) AS "collectionsCount",
        COUNT(*) FILTER (WHERE 'claims' = ANY("groups")) AS "claimsCount",
        COUNT(*) FILTER (WHERE 'work' = ANY("groups")) AS "workCount"
      FROM grouped
    ),
    page_rows AS (
      SELECT g."recordKey", g."recordDate" FROM grouped g
      WHERE ${input.group} = 'all' OR ${input.group} = ANY(g."groups")
      ORDER BY g."recordDate" ASC, g."recordKey" ASC
      LIMIT ${OPERATIONAL_INSIGHT_PAGE_SIZE + 1} OFFSET ${offset}
    )
    SELECT page_rows."recordKey", page_rows."recordDate", totals.*
    FROM totals LEFT JOIN page_rows ON true
    ORDER BY page_rows."recordDate" ASC NULLS LAST, page_rows."recordKey" ASC NULLS LAST
  `);
}

export async function getOperationalInsights(input: {
  group: OperationalInsightGroupFilter;
  page: number;
}): Promise<OperationalInsightsResult> {
  const scope = await requireOrganizationPortfolioReadScope();
  const today = businessToday();
  const todayStart = businessStartOfDay(today);
  const in30Days = businessAddDays(today, 30);
  const sevenDaysAgo = businessAddDays(today, -7);
  const fiveDaysAgo = businessAddDays(today, -5);
  const page = Math.min(MAX_PAGE, Math.max(1, input.page));

  return withTenantOrganization(scope.organizationId, async (db) => {
    const candidates = await readInsightCandidates(db, {
      organizationId: scope.organizationId,
      portfolioOwnerId: scope.portfolioOwnerId,
      group: input.group,
      page,
      todayStart,
      in30Days,
      sevenDaysAgoEnd: businessEndOfDay(sevenDaysAgo),
      fiveDaysAgoEnd: businessEndOfDay(fiveDaysAgo),
    });
    const selected = selectOperationalInsightCandidatePage(candidates);
    const firstPage = selected.rows;
    const recordKeys = firstPage.flatMap((candidate) => candidate.recordKey ? [candidate.recordKey] : []);
    const policyIds = recordKeys.filter((key) => key.startsWith("Policy:")).map((key) => key.slice("Policy:".length));
    const receiptIds = recordKeys.filter((key) => key.startsWith("Receipt:")).map((key) => key.slice("Receipt:".length));
    const claimIds = recordKeys.filter((key) => key.startsWith("Claim:")).map((key) => key.slice("Claim:".length));
    const workItemIds = recordKeys.filter((key) => key.startsWith("WorkItem:")).map((key) => key.slice("WorkItem:".length));
    const candidateCounts = candidates[0];
    const counts = Object.fromEntries(OPERATIONAL_INSIGHT_GROUPS.map((group) => [
      group,
      {
        value: readCount(candidateCounts?.[`${group}Count` as keyof InsightCandidate] as bigint | number | undefined),
        more: false,
      },
    ])) as OperationalInsightsResult["counts"];
    if (recordKeys.length === 0) {
      return {
        today,
        group: input.group,
        page,
        records: [],
        hasPrevious: page > 1,
        hasNext: false,
        counts,
      };
    }

    const [policies, overdueReceipts, collectionPromises, claims, workItems] = await Promise.all([
      policyIds.length ? db.policy.findMany({
        where: {
          AND: [
            { id: { in: policyIds } },
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
      }) : Promise.resolve([]),
      receiptIds.length ? db.receipt.findMany({
        where: {
          id: { in: receiptIds },
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
      }) : Promise.resolve([]),
      receiptIds.length ? db.workItem.findMany({
        where: {
          AND: [
            { receiptId: { in: receiptIds } },
            workItemOperationalWhere(scope.portfolioOwnerId, scope.organizationId),
            { sourceType: "Collection", status: { in: [...COLLECTION_WORK_ITEM_STATUSES] } },
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
              payments: { where: { status: "POSTED" }, select: { amount: true } },
            },
          },
        },
        orderBy: [{ dueDate: "asc" }, { id: "asc" }],
      }) : Promise.resolve([]),
      claimIds.length ? db.claim.findMany({
        where: {
          AND: [
            { id: { in: claimIds } },
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
      }) : Promise.resolve([]),
      (policyIds.length || receiptIds.length || claimIds.length || workItemIds.length) ? db.workItem.findMany({
        where: {
          AND: [
            {
              OR: [
                ...(policyIds.length ? [{ policyId: { in: policyIds } }] : []),
                ...(receiptIds.length ? [{ policyId: null, receiptId: { in: receiptIds } }] : []),
                ...(claimIds.length ? [{ policyId: null, receiptId: null, entityType: { equals: "claim", mode: "insensitive" as const }, entityId: { in: claimIds } }] : []),
                ...(workItemIds.length ? [{ id: { in: workItemIds }, policyId: null, receiptId: null, entityType: { not: "claim" } }] : []),
              ],
            },
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
      }) : Promise.resolve([]),
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
        receiptAmount: Number(item.receipt.amount),
        postedPaymentAmounts: item.receipt.payments.map((payment) => Number(payment.amount)),
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

    const hydratedByKey = new Map(groupOperationalInsightSignals(signals).map((record) => [record.id, record]));
    const records = recordKeys.flatMap((recordKey) => {
      const record = hydratedByKey.get(recordKey);
      return record ? [record] : [];
    });

    return {
      today,
      group: input.group,
      page,
      records,
      hasPrevious: page > 1,
      hasNext: page < MAX_PAGE && selected.hasNext,
      counts,
    };
  });
}
