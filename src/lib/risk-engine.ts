import { addDays, subDays } from "date-fns";
import { getDb } from "@/lib/db";
import { today } from "@/lib/dates";
import { OPEN_WORK_ITEM_STATUSES } from "@/lib/work-queue";

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

export async function detectRisks(portfolioOwnerId?: string): Promise<RiskFinding[]> {
  const db = getDb();
  const now = today();
  const in60 = addDays(now, 60);
  const olderThan15 = subDays(now, 15);
  const policyScope = portfolioOwnerId ? { client: { portfolioOwnerId } } : {};
  const receiptScope = portfolioOwnerId ? { client: { portfolioOwnerId } } : {};
  const commissionScope = portfolioOwnerId ? { client: { portfolioOwnerId } } : {};
  const clientScope = portfolioOwnerId ? { portfolioOwnerId } : {};
  const workItemScope = portfolioOwnerId
    ? { OR: [{ client: { portfolioOwnerId } }, { clientId: null, assignedToId: portfolioOwnerId }] }
    : {};

  const [
    expiredPolicies,
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
  ] = await Promise.all([
    db.policy.findMany({
      where: { ...policyScope, endDate: { lt: now }, status: { notIn: ["RENEWED", "CANCELLED"] } },
      take: TAKE_LIMIT,
      select: { id: true, policyNumber: true },
    }),
    db.receipt.findMany({
      where: {
        ...receiptScope,
        dueDate: { lt: now },
        status: { notIn: ["PAID", "CANCELLED"] },
        payments: { none: {} },
      },
      take: TAKE_LIMIT,
      select: { id: true, receiptNumber: true },
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
      where: { ...clientScope, OR: [{ phone: null }, { email: null }] },
      take: TAKE_LIMIT,
      select: { id: true, fullName: true },
    }),
    db.policy.findMany({
      where: { ...policyScope, OR: [{ endDate: { lt: new Date("2000-01-01") } }, { startDate: { gt: in60 } }] },
      take: TAKE_LIMIT,
      select: { id: true, policyNumber: true },
    }),
    db.document.findMany({
      where: {
        ...(portfolioOwnerId ? { client: { portfolioOwnerId } } : {}),
        clientId: null,
        policyId: null,
        receiptId: null,
        taskId: null,
        claimId: null,
        quoteId: null,
      },
      take: TAKE_LIMIT,
      select: { id: true, fileName: true },
    }),
    db.client.findMany({
      where: { ...clientScope, policies: { none: { status: "ACTIVE" } } },
      take: TAKE_LIMIT,
      select: { id: true, fullName: true },
    }),
    db.policy.findMany({
      where: {
        ...policyScope,
        status: "ACTIVE",
        endDate: { gte: now, lte: in60 },
        workItems: {
          none: {
            workItemType: "TASK",
            status: { in: [...OPEN_WORK_ITEM_STATUSES] },
          },
        },
      },
      take: TAKE_LIMIT,
      select: { id: true, policyNumber: true },
    }),
    // Duplicate detection now happens in the database via groupBy.
    db.policy.groupBy({
      by: ["policyNumber", "clientId", "insurerId"],
      where: policyScope,
      _count: { policyNumber: true },
      having: { policyNumber: { _count: { gt: 1 } } },
    }),
    db.receipt.groupBy({
      by: ["policyId", "receiptNumber"],
      where: receiptScope,
      _count: { receiptNumber: true },
      having: { receiptNumber: { _count: { gt: 1 } } },
    }),
  ]);

  const duplicatePolicies = duplicatePolicyKeys.length
    ? await db.policy.findMany({
        where: {
          ...policyScope,
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

  const duplicateReceipts = duplicateReceiptKeys.length
    ? await db.receipt.findMany({
        where: {
          OR: duplicateReceiptKeys.map((row) => ({
            policyId: row.policyId,
            receiptNumber: row.receiptNumber,
          })),
        },
        select: { id: true, receiptNumber: true },
        take: TAKE_LIMIT * 2,
      })
    : [];

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
    ...expiredPolicies.map((policy) => risk("POLICY_EXPIRED", "CRITICAL", "Poliza vencida", policy.policyNumber, "Policy", policy.id, "Revisar renovacion o cancelacion.")),
    ...overdueReceipts.map((receipt) => risk("RECEIPT_OVERDUE", "CRITICAL", "Recibo vencido sin pago", receipt.receiptNumber, "Receipt", receipt.id, "Contactar cliente y registrar seguimiento.")),
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
    ...renewalsWithoutWorkItem.map((policy) => risk("RENEWAL_WITHOUT_WORK_ITEM", "WARNING", "Renovacion proxima sin pendiente", policy.policyNumber, "Policy", policy.id, "Crear pendiente de renovacion.")),
    ...overlappingPolicies.map((policy) => risk("OVERLAPPING_POLICY_TERM", "WARNING", "Vigencias de poliza solapadas", policy.policyNumber, "Policy", policy.id, "Verificar familia de renovacion.")),
    ...duplicateReceipts.map((receipt) => risk("DUPLICATE_RECEIPT_NUMBER", "WARNING", "Recibo duplicado", receipt.receiptNumber, "Receipt", receipt.id, "Verificar duplicado.")),
  ];
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
