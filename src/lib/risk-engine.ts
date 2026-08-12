import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { formatDate, today } from "@/lib/dates";
import { businessAddDays } from "@/lib/business-dates";
import { formatCurrency } from "@/lib/money";
import { matchesSuppressionCriteria } from "@/lib/data-quality-rules";
import { OPEN_WORK_ITEM_STATUSES } from "@/lib/work-queue";
import { ACTIVE_RENEWAL_POLICY_WHERE } from "@/lib/renewal-decisions";
import { loadEligibleRenewalPolicies } from "@/lib/renewals";
import {
  clientOperationalWhere,
  commissionOperationalWhere,
  documentOperationalWhere,
  policyOperationalWhere,
  receiptOperationalWhere,
  workItemOperationalWhere,
} from "@/lib/portfolio-access";

export type RiskFinding = {
  alertType: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  description: string;
  entityType: string;
  entityId: string;
  suggestedAction: string;
};

const TAKE_LIMIT = 25;

export async function detectRisks(portfolioOwnerId?: string, organizationId?: string): Promise<RiskFinding[]> {
  const db = getDb();
  const now = today();
  const in60 = businessAddDays(now, 60);
  const olderThan15 = businessAddDays(now, -15);
  const policyScope = policyOperationalWhere(portfolioOwnerId, organizationId);
  const activeClientScope = {
    ...clientOperationalWhere(portfolioOwnerId, organizationId),
    status: "ACTIVE",
  } satisfies Prisma.ClientWhereInput;
  const activeRenewalScope = {
    ...policyScope,
    ...ACTIVE_RENEWAL_POLICY_WHERE,
  };
  const clientWithoutActivePolicyScope = {
    ...activeClientScope,
    policies: {
      none: {
        OR: [
          ACTIVE_RENEWAL_POLICY_WHERE,
          { sourceRenewalSuggestions: { some: { status: "DECLINED" } } },
        ],
      },
    },
  };
  const receiptScope = receiptOperationalWhere(portfolioOwnerId, organizationId);
  const commissionScope = commissionOperationalWhere(portfolioOwnerId, organizationId);
  const workItemScope = workItemOperationalWhere(portfolioOwnerId, organizationId);
  const documentScope = documentOperationalWhere(portfolioOwnerId, organizationId);

  const [
    suppressionRules,
    overdueReceipts,
    overdueCommissions,
    staleWorkItems,
    clientsWithoutContact,
    inconsistentPolicies,
    orphanDocuments,
    clientsWithoutActivePolicies,
    renewalsWithoutWorkItem,
    duplicatePolicyKeys,
    duplicateReceiptKeys,
    policiesWithoutReceipts,
  ] = await Promise.all([
    db.dataQualitySuppressionRule.findMany({
      where: {
        active: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    }),
    db.receipt.findMany({
      where: {
        ...receiptScope,
        dueDate: { lt: now },
        status: { notIn: ["PAID", "CANCELLED"] },
        payments: { none: { status: "POSTED" } },
      },
      take: TAKE_LIMIT,
      select: {
        id: true,
        receiptNumber: true,
        amount: true,
        currency: true,
        client: { select: { fullName: true } },
        policy: { select: { policyNumber: true } },
      },
    }),
    db.commission.findMany({
      where: { ...commissionScope, expectedDate: { lt: now }, status: { notIn: ["PAID", "CANCELLED"] } },
      take: TAKE_LIMIT,
      select: { id: true, expectedAmount: true },
    }),
    db.workItem.findMany({
      where: {
        ...workItemScope,
        workItemType: "TASK",
        startDate: { lt: olderThan15 },
        status: { in: [...OPEN_WORK_ITEM_STATUSES] },
      },
      take: TAKE_LIMIT,
      select: { id: true, sourceId: true, folio: true, title: true },
    }),
    db.client.findMany({
      where: { ...activeClientScope, OR: [{ phone: null }, { email: null }] },
      take: TAKE_LIMIT,
      select: { id: true, fullName: true },
    }),
    db.policy.findMany({
      where: {
        ...activeRenewalScope,
        OR: [{ endDate: { lt: new Date("2000-01-01") } }, { startDate: { gt: in60 } }],
      },
      take: TAKE_LIMIT,
      select: { id: true, policyNumber: true },
    }),
    db.document.findMany({
      where: { ...documentScope, clientId: null, policyId: null, receiptId: null, taskId: null, claimId: null, quoteId: null },
      take: TAKE_LIMIT,
      select: { id: true, fileName: true },
    }),
    db.client.findMany({
      where: clientWithoutActivePolicyScope,
      take: TAKE_LIMIT,
      select: { id: true, fullName: true },
    }),
    loadEligibleRenewalPolicies(
      {
        endDate: { gte: now, lte: in60 },
        workItems: {
          none: {
            workItemType: "TASK",
            status: { in: [...OPEN_WORK_ITEM_STATUSES] },
          },
        },
        sourceRenewalSuggestions: {
          none: {
            status: { in: ["PENDING", "ACCEPTED", "MERGED", "DECLINED"] },
          },
        },
      },
      portfolioOwnerId,
      organizationId,
    ).then((policies) => policies.slice(0, TAKE_LIMIT)),
    // Duplicate detection now happens in the database via groupBy.
    db.policy.groupBy({
      by: ["policyNumber", "clientId", "insurerId"],
      where: activeRenewalScope,
      _count: { policyNumber: true },
      having: { policyNumber: { _count: { gt: 1 } } },
    }),
    db.receipt.groupBy({
      by: ["policyId", "receiptNumber"],
      where: receiptScope,
      _count: { receiptNumber: true },
      having: { receiptNumber: { _count: { gt: 1 } } },
    }),
    db.policy.findMany({
      where: {
        ...activeRenewalScope,
        receipts: { none: {} },
      },
      take: TAKE_LIMIT,
      select: {
        id: true,
        policyNumber: true,
        client: { select: { fullName: true } },
      },
    }),
  ]);

  const duplicatePolicies = duplicatePolicyKeys.length
    ? await db.policy.findMany({
        where: {
          ...activeRenewalScope,
          OR: duplicatePolicyKeys.map((row) => ({
            policyNumber: row.policyNumber,
            clientId: row.clientId,
            insurerId: row.insurerId,
          })),
        },
        select: { id: true, policyNumber: true, clientId: true, insurerId: true, startDate: true, endDate: true },
        take: TAKE_LIMIT * 2,
      })
    : [];

  const duplicateReceiptCandidates = duplicateReceiptKeys.length
    ? await db.receipt.findMany({
        where: {
          OR: duplicateReceiptKeys.map((row) => ({
            policyId: row.policyId,
            receiptNumber: row.receiptNumber,
          })),
        },
        select: {
          id: true,
          receiptNumber: true,
          policyId: true,
          periodStartDate: true,
          periodEndDate: true,
          status: true,
          amount: true,
          paidDate: true,
        },
        take: TAKE_LIMIT * 2,
      })
    : [];

  // Group by policyId + receiptNumber and filter out false positives
  const receiptGroups = new Map<string, typeof duplicateReceiptCandidates>();
  for (const r of duplicateReceiptCandidates) {
    const key = `${r.policyId}:${r.receiptNumber}`;
    const existing = receiptGroups.get(key) ?? [];
    existing.push(r);
    receiptGroups.set(key, existing);
  }

  const duplicateReceipts: typeof duplicateReceiptCandidates = [];
  for (const group of receiptGroups.values()) {
    if (group.length < 2) continue;

    // Filter 1: if any is CANCELLED and another is not, skip the group
    const hasCancelled = group.some((r) => r.status === "CANCELLED");
    const hasActive = group.some((r) => r.status !== "CANCELLED");
    if (hasCancelled && hasActive) continue;

    // Filter 2: if only one has a paidDate and others have different periods, skip
    const paidCount = group.filter((r) => r.paidDate != null).length;
    const unpaidCount = group.length - paidCount;
    if (paidCount === 1 && unpaidCount >= 1) {
      const paid = group.find((r) => r.paidDate != null)!;
      const allUnpaidSamePeriod = group
        .filter((r) => r.paidDate == null)
        .every(
          (r) =>
            r.periodStartDate.getTime() === paid.periodStartDate.getTime() &&
            r.periodEndDate.getTime() === paid.periodEndDate.getTime(),
        );
      if (!allUnpaidSamePeriod) continue;
    }

    // Filter 3: if all have different periods, these are legitimate (prorrateo, frequency change)
    const periods = group.map(
      (r) => `${r.periodStartDate.toISOString()}:${r.periodEndDate.toISOString()}`,
    );
    const uniquePeriods = new Set(periods);
    if (uniquePeriods.size > 1) continue;

    // Only keep groups where all share the same period and are active
    duplicateReceipts.push(...group);
  }

  const overlappingPolicies = duplicatePolicies.filter((candidate, index, rows) =>
    rows.some(
      (other, otherIndex) =>
        otherIndex !== index &&
        other.policyNumber === candidate.policyNumber &&
        other.clientId === candidate.clientId &&
        other.insurerId === candidate.insurerId &&
        other.startDate <= candidate.endDate &&
        other.endDate >= candidate.startDate,
    ),
  );

  return [
    ...overdueReceipts.map((receipt) =>
      risk(
        "RECEIPT_OVERDUE",
        "CRITICAL",
        "Recibo vencido sin pago",
        `${receipt.receiptNumber} · ${receipt.policy?.policyNumber ?? "Sin póliza"} · ${receipt.client?.fullName ?? "Sin cliente"} · ${formatCurrency(receipt.amount, receipt.currency)}`,
        "Receipt",
        receipt.id,
        "Contactar cliente y registrar seguimiento.",
      ),
    ),
    ...overdueCommissions.map((commission) => risk("COMMISSION_OVERDUE", "WARNING", "Comision vencida sin cobro", String(commission.expectedAmount), "Commission", commission.id, "Revisar cobranza con aseguradora.")),
    ...staleWorkItems.map((workItem) =>
      risk(
        "STALE_TASK",
        "WARNING",
        "Pendiente abierto mas de 15 dias",
        `${workItem.folio ?? workItem.sourceId ?? workItem.id} · ${workItem.title}`,
        "WorkItem",
        workItem.sourceId ?? workItem.id,
        "Actualizar o cerrar pendiente.",
      ),
    ),
    ...clientsWithoutContact.map((client) => risk("CLIENT_MISSING_CONTACT", "WARNING", "Cliente sin telefono o email", client.fullName, "Client", client.id, "Completar datos de contacto.")),
    ...inconsistentPolicies.map((policy) => risk("INCONSISTENT_DATES", "CRITICAL", "Fechas inconsistentes", policy.policyNumber, "Policy", policy.id, "Corregir vigencia de poliza.")),
    ...orphanDocuments.map((document) => risk("ORPHAN_DOCUMENT", "INFO", "Documento huerfano", document.fileName, "Document", document.id, "Asociar documento a una entidad.")),
    ...clientsWithoutActivePolicies.map((client) => risk("CLIENT_WITHOUT_ACTIVE_POLICY", "INFO", "Cliente sin polizas activas", client.fullName, "Client", client.id, "Revisar si debe archivarse o reactivarse.")),
    ...renewalsWithoutWorkItem.map((policy) =>
      risk(
        "RENEWAL_WITHOUT_WORK_ITEM",
        "WARNING",
        "Renovacion proxima sin pendiente",
        `${policy.policyNumber} · ${policy.client.fullName} · ${policy.insurer.name} · vence ${formatDate(policy.endDate)} · ${policy.policyType} · ${formatCurrency(policy.premiumAmount, policy.currency)}`,
        "Policy",
        policy.id,
        "Crear pendiente de renovacion.",
      ),
    ),
    ...overlappingPolicies.map((policy) => risk("OVERLAPPING_POLICY_TERM", "WARNING", "Vigencias de poliza solapadas", policy.policyNumber, "Policy", policy.id, "Verificar familia de renovacion.")),
    ...duplicateReceipts.map((receipt) => risk("DUPLICATE_RECEIPT_NUMBER", "WARNING", "Recibo duplicado", receipt.receiptNumber, "Receipt", receipt.id, "Verificar duplicado.")),
    ...policiesWithoutReceipts.map((policy) =>
      risk(
        "POLICY_WITHOUT_RECEIPTS",
        "CRITICAL",
        "Póliza activa sin recibos",
        `${policy.policyNumber} · ${policy.client?.fullName ?? "Sin cliente"}`,
        "Policy",
        policy.id,
        "Capturar los recibos pendientes para la póliza.",
      ),
    ),
  ].filter((finding) => {
    return !suppressionRules.some((rule) =>
      rule.issueCode === finding.alertType &&
      matchesSuppressionCriteria(rule.criteriaJson, {
        alertType: finding.alertType,
        severity: finding.severity,
        title: finding.title,
        description: finding.description,
        entityType: finding.entityType,
        entityId: finding.entityId,
      }),
    );
  });
}

function risk(
  alertType: string,
  severity: RiskFinding["severity"],
  title: string,
  description: string,
  entityType: string,
  entityId: string,
  suggestedAction: string,
): RiskFinding {
  return { alertType, severity, title, description, entityType, entityId, suggestedAction };
}
