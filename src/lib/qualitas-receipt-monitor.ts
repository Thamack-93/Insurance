import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { createNotification } from "@/lib/notifications";
import { resolveOrganizationCapability } from "@/lib/organization-capabilities";
import { assertOrganizationContextInTransaction, withSystemOrganizationTransaction, withTenantTransaction, type OrganizationContext } from "@/lib/organization-context";
import { writeActivityLog } from "@/lib/activity-log";
import { isQualitasInsurerName, lookupQualitasPendingReceipts } from "@/lib/qualitas-payment-link";
import { compareQualitasNextReceipt, type QualitasMonitorComparison, type QualitasMonitorReceipt } from "@/lib/qualitas-receipt-monitor-logic";
import { recordPayment } from "@/lib/payment-service";

const DISALLOWED_FREQUENCIES = new Set(["ANNUAL", "SINGLE"]);

export function isQualitasReceiptMonitorEnabled() {
  return process.env.QUALITAS_RECEIPT_MONITOR_ENABLED?.trim() === "1";
}

function eligibleFrequency(value: string) {
  return !DISALLOWED_FREQUENCIES.has(value.trim().toUpperCase());
}

function dateKey(value: Date | string) {
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

type PolicyCheckSnapshot = {
  policyNumber: string;
  receipts: Array<QualitasMonitorReceipt & { receiptNumber: string; amount: number; currency: string }>;
};

async function getPolicyCheckSnapshot(
  tx: Prisma.TransactionClient,
  input: { policyId: string; organizationId: string; userId?: string; onlyEnabled?: boolean },
): Promise<PolicyCheckSnapshot | null> {
  const policy = await tx.policy.findFirst({
    where: {
      id: input.policyId,
      organizationId: input.organizationId,
      ...(input.userId ? { client: { portfolioOwnerId: input.userId } } : {}),
    },
    include: { insurer: { select: { name: true } }, client: { select: { id: true, fullName: true } } },
  });
  if (!policy || !isQualitasInsurerName(policy.insurer.name) || policy.status !== "ACTIVE" || !eligibleFrequency(policy.paymentFrequency)) return null;
  if (input.onlyEnabled && !policy.qualitasReceiptMonitorEnabled) return null;
  const receipts = await tx.receipt.findMany({
    where: { organizationId: input.organizationId, policyId: policy.id, status: { notIn: ["PAID", "CANCELLED"] } },
    orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    select: { id: true, receiptNumber: true, dueDate: true, status: true, amount: true, currency: true },
  });
  return {
    policyNumber: policy.policyNumber,
    receipts: receipts.map((receipt) => ({ ...receipt, amount: Number(receipt.amount) })),
  };
}

async function hasQualitasCapability(organizationId: string, tx: Prisma.TransactionClient) {
  const capability = await resolveOrganizationCapability(organizationId, "QUALITAS", tx);
  return capability.enabled && isQualitasReceiptMonitorEnabled();
}

export type ManualQualitasReceiptCheck = {
  status: QualitasMonitorComparison["status"];
  observationId: string;
  checkedAt: string;
  portalDueDate: string | null;
  targetReceipt: null | { id: string; receiptNumber: string; dueDate: string; amount: number; currency: string };
  reason?: string;
};

export async function checkQualitasReceiptStatus(policyId: string, context: OrganizationContext): Promise<ManualQualitasReceiptCheck> {
  const initial = await withTenantTransaction(context, async (tx) => {
    await assertOrganizationContextInTransaction(tx, context);
    if (!(await hasQualitasCapability(context.organizationId, tx))) throw new Error("QUALITAS_RECEIPT_MONITOR_DISABLED");
    const snapshot = await getPolicyCheckSnapshot(tx, { policyId, organizationId: context.organizationId, userId: context.userId });
    if (!snapshot) throw new Error("QUALITAS_POLICY_NOT_AVAILABLE");
    return snapshot;
  });
  if (!initial.receipts.length) throw new Error("QUALITAS_NO_OPEN_RECEIPTS");

  // A portal response is checked outside a database transaction. The only
  // writes below are the sanitized audit observation; receipt state is untouched.
  const lookup = await lookupQualitasPendingReceipts(initial.policyNumber, { traceId: "qualitas-receipt-monitor" });
  const portalDueDate = lookup.outcome === "OK" ? lookup.nextDueDate : null;
  const comparison = compareQualitasNextReceipt(portalDueDate, initial.receipts);
  const checkedAt = new Date();
  return withTenantTransaction(context, async (tx) => {
    await assertOrganizationContextInTransaction(tx, context);
    const current = await getPolicyCheckSnapshot(tx, { policyId, organizationId: context.organizationId, userId: context.userId });
    if (!current) throw new Error("QUALITAS_POLICY_NOT_AVAILABLE");
    const target = comparison.targetReceiptId ? current.receipts.find((receipt) => receipt.id === comparison.targetReceiptId) : undefined;
    const currentComparison = target
      ? compareQualitasNextReceipt(portalDueDate, current.receipts)
      : { status: "INCONCLUSIVE" as const, portalDueDate };
    const checked = await writeActivityLog({
      organizationId: context.organizationId,
      entityType: "Policy",
      entityId: policyId,
      action: "QUALITAS_RECEIPT_CHECKED",
      newValue: {
        status: lookup.outcome === "OK" ? currentComparison.status : "INCONCLUSIVE",
        reason: lookup.outcome === "OK" ? undefined : lookup.reason,
        targetReceiptId: target?.id,
        localDueDate: target ? dateKey(target.dueDate) : undefined,
        portalDueDate,
        checkedAt: checkedAt.toISOString(),
      },
      userId: context.userId,
      db: tx,
    });
    return {
      status: lookup.outcome === "OK" ? currentComparison.status : "INCONCLUSIVE",
      observationId: checked.id,
      checkedAt: checkedAt.toISOString(),
      portalDueDate,
      targetReceipt: target ? {
        id: target.id,
        receiptNumber: target.receiptNumber,
        dueDate: dateKey(target.dueDate),
        amount: target.amount,
        currency: target.currency,
      } : null,
      reason: lookup.outcome === "OK" ? undefined : lookup.reason,
    };
  });
}

export async function confirmQualitasDetectedPayment(observationId: string, context: OrganizationContext) {
  return withTenantTransaction(context, async (tx) => {
    await assertOrganizationContextInTransaction(tx, context);
    if (!(await hasQualitasCapability(context.organizationId, tx))) throw new Error("QUALITAS_RECEIPT_MONITOR_DISABLED");
    const observation = await tx.activityLog.findFirst({
      where: { id: observationId, organizationId: context.organizationId, action: "QUALITAS_RECEIPT_CHECKED", entityType: "Policy" },
      select: { id: true, entityId: true, createdAt: true, newValue: true },
    });
    if (!observation || Date.now() - observation.createdAt.getTime() > 24 * 60 * 60 * 1000) throw new Error("QUALITAS_OBSERVATION_EXPIRED");
    let parsed: { status?: string; targetReceiptId?: string; portalDueDate?: string } = {};
    try { parsed = JSON.parse(observation.newValue ?? "{}"); } catch { throw new Error("QUALITAS_OBSERVATION_INVALID"); }
    if (parsed.status !== "LIKELY_ADVANCED" || !parsed.targetReceiptId || !parsed.portalDueDate) throw new Error("QUALITAS_OBSERVATION_NOT_CONFIRMABLE");
    const snapshot = await getPolicyCheckSnapshot(tx, { policyId: observation.entityId, organizationId: context.organizationId, userId: context.userId });
    if (!snapshot) throw new Error("QUALITAS_POLICY_NOT_AVAILABLE");
    const currentComparison = compareQualitasNextReceipt(parsed.portalDueDate, snapshot.receipts);
    if (currentComparison.status !== "LIKELY_ADVANCED" || currentComparison.targetReceiptId !== parsed.targetReceiptId) {
      throw new Error("QUALITAS_RECEIPT_STATE_CHANGED");
    }
    const receipt = snapshot.receipts.find((item) => item.id === parsed.targetReceiptId);
    if (!receipt) throw new Error("QUALITAS_RECEIPT_STATE_CHANGED");
    const result = await recordPayment({
      organizationId: context.organizationId,
      receiptId: receipt.id,
      amount: receipt.amount,
      paidDate: observation.createdAt,
      paymentMethod: "DOMICILIATED",
      notes: `Confirmado manualmente con base en consulta Quálitas del ${observation.createdAt.toISOString()}; el portal mostró el siguiente recibo con vencimiento ${parsed.portalDueDate}.`,
      sourceEvidenceKey: `qualitas-receipt-monitor:${observation.id}`,
      actorId: context.userId,
    }, tx);
    return { paymentId: result.payment.id, receiptId: receipt.id };
  });
}

export async function setQualitasReceiptMonitor(policyId: string, enabled: boolean, context: OrganizationContext) {
  return withTenantTransaction(context, async (tx) => {
    await assertOrganizationContextInTransaction(tx, context);
    if (enabled && !(await hasQualitasCapability(context.organizationId, tx))) throw new Error("QUALITAS_RECEIPT_MONITOR_DISABLED");
    const snapshot = await getPolicyCheckSnapshot(tx, { policyId, organizationId: context.organizationId, userId: context.userId });
    if (!snapshot) throw new Error("QUALITAS_POLICY_NOT_AVAILABLE");
    if (enabled) {
      const recentCheck = await tx.activityLog.findFirst({
        where: {
          organizationId: context.organizationId,
          entityType: "Policy",
          entityId: policyId,
          action: "QUALITAS_RECEIPT_CHECKED",
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { newValue: true },
      });
      let parsedCheck: { status?: string; targetReceiptId?: string; portalDueDate?: string } = {};
      try { parsedCheck = JSON.parse(recentCheck?.newValue ?? "{}"); } catch { /* fail closed */ }
      const currentCheck = parsedCheck.portalDueDate ? compareQualitasNextReceipt(parsedCheck.portalDueDate, snapshot.receipts) : null;
      if (
        !["PENDING", "LIKELY_ADVANCED"].includes(parsedCheck.status ?? "") ||
        !currentCheck ||
        currentCheck.status !== parsedCheck.status ||
        currentCheck.targetReceiptId !== parsedCheck.targetReceiptId
      ) throw new Error("QUALITAS_MANUAL_VALIDATION_REQUIRED");
    }
    await tx.policy.update({
      where: { id: policyId, organizationId: context.organizationId },
      data: { qualitasReceiptMonitorEnabled: enabled, updatedById: context.userId },
    });
    await writeActivityLog({
      organizationId: context.organizationId,
      entityType: "Policy",
      entityId: policyId,
      action: "QUALITAS_RECEIPT_MONITOR_CONFIGURED",
      newValue: { enabled },
      userId: context.userId,
      db: tx,
    });
    return { enabled };
  });
}

export type QualitasReceiptMonitorScanSummary = { scanned: number; advanced: number; inconclusive: number; alertsCreated: number };

export async function runQualitasReceiptMonitorScan(organizationId: string): Promise<QualitasReceiptMonitorScanSummary> {
  const summary: QualitasReceiptMonitorScanSummary = { scanned: 0, advanced: 0, inconclusive: 0, alertsCreated: 0 };
  if (!organizationId.trim() || !isQualitasReceiptMonitorEnabled()) return summary;
  const policies = await withSystemOrganizationTransaction(organizationId, "qualitas receipt monitor", async (tx) => {
    if (!(await hasQualitasCapability(organizationId, tx))) return [];
    const rows = await tx.policy.findMany({
      where: { organizationId, qualitasReceiptMonitorEnabled: true, status: "ACTIVE", paymentFrequency: { notIn: [...DISALLOWED_FREQUENCIES] } },
      include: { insurer: { select: { name: true } } },
      orderBy: [{ id: "asc" }],
    });
    return rows.filter((policy) => isQualitasInsurerName(policy.insurer.name)).map((policy) => ({ id: policy.id, policyNumber: policy.policyNumber }));
  });

  for (const policy of policies) {
    const receipts = await withSystemOrganizationTransaction(organizationId, "qualitas receipt monitor", async (tx) => tx.receipt.findMany({
      where: { organizationId, policyId: policy.id, status: { notIn: ["PAID", "CANCELLED"] } },
      select: { id: true, dueDate: true, status: true },
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
    }));
    if (!receipts.length) continue;
    summary.scanned += 1;
    let lookup: Awaited<ReturnType<typeof lookupQualitasPendingReceipts>>;
    try {
      lookup = await lookupQualitasPendingReceipts(policy.policyNumber, { traceId: "qualitas-receipt-monitor-job" });
    } catch {
      summary.inconclusive += 1;
      continue;
    }
    if (lookup.outcome !== "OK") { summary.inconclusive += 1; continue; }
    const comparison = compareQualitasNextReceipt(lookup.nextDueDate, receipts);
    if (comparison.status === "INCONCLUSIVE") { summary.inconclusive += 1; continue; }
    if (comparison.status === "PENDING") continue;
    summary.advanced += 1;
    await withSystemOrganizationTransaction(organizationId, "qualitas receipt monitor", async (tx) => {
      const current = await getPolicyCheckSnapshot(tx, { policyId: policy.id, organizationId, onlyEnabled: true });
      const currentComparison = current ? compareQualitasNextReceipt(lookup.nextDueDate, current.receipts) : null;
      if (!current || currentComparison?.status !== "LIKELY_ADVANCED") return;
      const receipt = current.receipts.find((item) => item.id === currentComparison.targetReceiptId);
      if (!receipt) return;
      const existingAlert = await tx.alert.findFirst({
        where: { organizationId, receiptId: receipt.id, alertType: "QUALITAS_RECEIPT_ADVANCED" },
        select: { id: true },
      });
      if (existingAlert) return;
      const alert = await createNotification({
        organizationId,
        type: "QUALITAS_RECEIPT_ADVANCED",
        title: `Revisa el recibo ${receipt.receiptNumber} de Quálitas`,
        body: `El portal ya muestra el siguiente recibo (${lookup.nextDueDate}). Confirma el cargo domiciliado y registra el pago si corresponde.`,
        severity: "WARNING",
        entityType: "Receipt",
        entityId: receipt.id,
      }, tx);
      if (alert) summary.alertsCreated += 1;
      await writeActivityLog({
        organizationId,
        entityType: "Receipt",
        entityId: receipt.id,
        action: "QUALITAS_RECEIPT_ADVANCED_ALERTED",
        newValue: { localDueDate: currentComparison.localDueDate, portalDueDate: lookup.nextDueDate, alertId: alert?.id ?? null },
        db: tx,
      });
    });
  }
  return summary;
}
