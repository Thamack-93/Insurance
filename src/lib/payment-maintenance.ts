import "server-only";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { writeActivityLog } from "@/lib/activity-log";
import { getDb } from "@/lib/db";
import { reconcileReceiptState } from "@/lib/receipt-reconciliation";
import { logError } from "@/lib/logger";
import { toNumber } from "@/lib/money";
import { findMatchingSuppressionRule } from "@/lib/data-quality-rules";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type PaymentAuditReviewReceipt = {
  receiptId: string;
  receiptNumber: string;
  familyKey: string;
  policyId: string;
  policyNumber: string;
  clientName: string;
  insurerName: string;
  amount: number;
  paidAmount: number;
  reasons: string[];
};

export type PaymentAuditSummary = {
  familiesReviewed: number;
  familiesWithMultiplePolicies: number;
  receiptsScanned: number;
  receiptsUpdated: number;
  receiptsFlaggedForReview: number;
  receiptIssuesOpened: number;
  receiptIssuesResolved: number;
  reviewReceipts: PaymentAuditReviewReceipt[];
  familyKeysSample: string[];
};

export type MaintenanceRunSnapshot = {
  id: string;
  type: string;
  status: string;
  summaryJson: string | null;
  startedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type ReceiptRow = {
  id: string;
  receiptNumber: string;
  policyId: string;
  clientId: string;
  insurerId: string;
  amount: unknown;
  currency: string;
  dueDate: Date;
  status: string;
  paidDate: Date | null;
  paymentMethod: string | null;
  reconciliationAdjustment: unknown;
  reconciliationNote: string | null;
  policy: {
    id: string;
    policyNumber: string;
    familyRootId: string | null;
    clientId: string;
    insurerId: string;
  };
  client: { fullName: string };
  insurer: { name: string };
  payments: Array<{
    id: string;
    amount: unknown;
    paidDate: Date;
    paymentMethod: string | null;
  }>;
};

const CLOSE_TOLERANCE = 5;

function familyKey(policy: Pick<ReceiptRow["policy"], "id" | "familyRootId">) {
  return policy.familyRootId ?? policy.id;
}

function normalizeNumber(value: unknown) {
  return toNumber(value);
}

function paymentSnapshots(payments: ReceiptRow["payments"]) {
  return payments.map((payment) => ({
    amount: normalizeNumber(payment.amount),
    paidDate: payment.paidDate,
    paymentMethod: payment.paymentMethod,
  }));
}

export async function getLatestPaymentMaintenanceRun(
  type: string,
  organizationId: string,
  client?: DbClient,
): Promise<MaintenanceRunSnapshot | null> {
  const db = client ?? getDb();
  return db.maintenanceRun.findFirst({
    where: { type, organizationId },
    orderBy: { startedAt: "desc" },
  });
}

export async function runPaymentReconciliationAudit(input: {
  actorId: string;
  organizationId: string;
  client?: DbClient;
  now?: Date;
}): Promise<{ run: MaintenanceRunSnapshot; summary: PaymentAuditSummary }> {
  const db = input.client ?? getDb();
  const now = input.now ?? new Date();

  const run = await db.maintenanceRun.create({
    data: {
      organizationId: input.organizationId,
      type: "PAYMENT_RECONCILIATION_AUDIT",
      status: "RUNNING",
      createdById: input.actorId,
    },
  });

  const summary: PaymentAuditSummary = {
    familiesReviewed: 0,
    familiesWithMultiplePolicies: 0,
    receiptsScanned: 0,
    receiptsUpdated: 0,
    receiptsFlaggedForReview: 0,
    receiptIssuesOpened: 0,
    receiptIssuesResolved: 0,
    reviewReceipts: [],
    familyKeysSample: [],
  };

  try {
    const receipts = (await db.receipt.findMany({
      where: { organizationId: input.organizationId },
      select: {
        id: true,
        receiptNumber: true,
        policyId: true,
        clientId: true,
        insurerId: true,
        amount: true,
        currency: true,
        dueDate: true,
        status: true,
        paidDate: true,
        paymentMethod: true,
        reconciliationAdjustment: true,
        reconciliationNote: true,
        policy: {
          select: {
            id: true,
            policyNumber: true,
            familyRootId: true,
            clientId: true,
            insurerId: true,
          },
        },
        client: { select: { fullName: true } },
        insurer: { select: { name: true } },
        payments: {
          where: { status: "POSTED", organizationId: input.organizationId },
          select: {
            id: true,
            amount: true,
            paidDate: true,
            paymentMethod: true,
          },
          orderBy: [{ paidDate: "desc" }, { createdAt: "desc" }],
        },
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    })) as ReceiptRow[];

    const receiptsByFamily = new Map<string, ReceiptRow[]>();
    for (const receipt of receipts) {
      const key = familyKey(receipt.policy);
      const existing = receiptsByFamily.get(key) ?? [];
      existing.push(receipt);
      receiptsByFamily.set(key, existing);
    }

    summary.familiesReviewed = receiptsByFamily.size;
    summary.receiptsScanned = receipts.length;

    for (const [key, familyReceipts] of receiptsByFamily.entries()) {
      if (summary.familyKeysSample.length < 20) {
        summary.familyKeysSample.push(key);
      }

      const policyIds = new Set(familyReceipts.map((receipt) => receipt.policyId));
      if (policyIds.size > 1) {
        summary.familiesWithMultiplePolicies += 1;
      }

      for (const receipt of familyReceipts) {
        const reconciliation = reconcileReceiptState({
          amount: normalizeNumber(receipt.amount),
          status: receipt.status as "PENDING" | "PAID" | "OVERDUE" | "CANCELLED",
          dueDate: receipt.dueDate,
          paidDate: receipt.paidDate,
          paymentMethod: receipt.paymentMethod,
          payments: paymentSnapshots(receipt.payments),
          now,
          closeTolerance: CLOSE_TOLERANCE,
        });

        const adjustment =
          reconciliation.nextStatus === "PAID"
            ? Math.round((normalizeNumber(receipt.amount) - reconciliation.paidAmount) * 100) / 100
            : 0;
        const reconciliationNote =
          adjustment !== 0
            ? `Ajuste auditado de conciliación: ${adjustment.toFixed(2)} ${receipt.currency}.`
            : null;

        const changed =
          receipt.status !== reconciliation.nextStatus ||
          (receipt.paidDate?.getTime() ?? null) !== (reconciliation.nextPaidDate?.getTime() ?? null) ||
          receipt.paymentMethod !== reconciliation.nextPaymentMethod ||
          normalizeNumber(receipt.reconciliationAdjustment) !== adjustment ||
          receipt.reconciliationNote !== reconciliationNote;

        if (changed) {
          await db.receipt.update({
            where: { id: receipt.id },
            data: {
              status: reconciliation.nextStatus,
              paidDate: reconciliation.nextPaidDate,
              paymentMethod: reconciliation.nextPaymentMethod,
              reconciliationAdjustment: adjustment,
              reconciliationNote,
              updatedById: input.actorId,
            },
          });

          summary.receiptsUpdated += 1;

          await writeActivityLog({
            entityType: "Receipt",
            entityId: receipt.id,
            action: "RECEIPT_RECONCILED_DURING_PAYMENT_AUDIT",
            oldValue: {
              status: receipt.status,
              paidDate: receipt.paidDate,
              paymentMethod: receipt.paymentMethod,
              reconciliationAdjustment: normalizeNumber(receipt.reconciliationAdjustment),
              reconciliationNote: receipt.reconciliationNote,
            },
            newValue: {
              status: reconciliation.nextStatus,
              paidDate: reconciliation.nextPaidDate,
              paymentMethod: reconciliation.nextPaymentMethod,
              reconciliationAdjustment: adjustment,
              reconciliationNote,
              paidAmount: reconciliation.paidAmount,
              reasons: reconciliation.reasons,
            },
            userId: input.actorId,
            organizationId: input.organizationId,
            db,
          });
        }

        const issueReason = reconciliation.reasons.join(",") || "REVIEW_REQUIRED";
        const issueDetails = {
          familyKey: key,
          policyNumber: receipt.policy.policyNumber,
          receiptNumber: receipt.receiptNumber,
          current: {
            status: receipt.status,
            paidDate: receipt.paidDate,
            paymentMethod: receipt.paymentMethod,
            adjustment: normalizeNumber(receipt.reconciliationAdjustment),
          },
          next: {
            status: reconciliation.nextStatus,
            paidDate: reconciliation.nextPaidDate,
            paymentMethod: reconciliation.nextPaymentMethod,
            adjustment,
          },
          reconciliation,
        };

        const openIssues = await db.receiptReconciliationIssue.findMany({
          where: { organizationId: input.organizationId, receiptId: receipt.id, status: "OPEN" },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });
        const suppressionRule = await findMatchingSuppressionRule(
          {
            category: "PAYMENTS",
            issueCode: issueReason,
            fields: {
              receiptId: receipt.id,
              receiptNumber: receipt.receiptNumber,
              policyId: receipt.policy.id,
              policyNumber: receipt.policy.policyNumber,
              familyKey: key,
            },
          },
          input.organizationId,
          db,
        );

        if (reconciliation.shouldReview) {
          summary.receiptsFlaggedForReview += 1;
          if (summary.reviewReceipts.length < 100) {
            summary.reviewReceipts.push({
              receiptId: receipt.id,
              receiptNumber: receipt.receiptNumber,
              familyKey: key,
              policyId: receipt.policyId,
              policyNumber: receipt.policy.policyNumber,
              clientName: receipt.client.fullName,
              insurerName: receipt.insurer.name,
              amount: normalizeNumber(receipt.amount),
              paidAmount: reconciliation.paidAmount,
              reasons: reconciliation.reasons,
            });
          }

          if (suppressionRule) {
            if (openIssues.length > 0) {
              await db.receiptReconciliationIssue.update({
                where: { id: openIssues[0].id },
                data: {
                  reason: issueReason,
                  policyId: receipt.policyId,
                  detailsJson: JSON.stringify(issueDetails),
                  expectedAmount: receipt.amount as never,
                  paidAmount: reconciliation.paidAmount as never,
                  status: "DISMISSED",
                  suppressedByRuleId: suppressionRule.id,
                  reviewedAt: now,
                  reviewedById: input.actorId,
                  resolutionNote: `Suprimida por regla: ${suppressionRule.reason ?? suppressionRule.issueCode}.`,
                },
              });

              for (const duplicateIssue of openIssues.slice(1)) {
                await db.receiptReconciliationIssue.update({
                  where: { id: duplicateIssue.id },
                  data: {
                    status: "DISMISSED",
                    reviewedAt: now,
                    reviewedById: input.actorId,
                    resolutionNote: "Duplicado suprimido durante la auditoría de pagos.",
                  },
                });
                summary.receiptIssuesResolved += 1;
              }
            } else {
              await db.receiptReconciliationIssue.create({
                data: {
                  organizationId: input.organizationId,
                  maintenanceRunId: run.id,
                  receiptId: receipt.id,
                  policyId: receipt.policyId,
                  reason: issueReason,
                  status: "DISMISSED",
                  detailsJson: JSON.stringify(issueDetails),
                  expectedAmount: receipt.amount as never,
                  paidAmount: reconciliation.paidAmount as never,
                  suppressedByRuleId: suppressionRule.id,
                  reviewedAt: now,
                  reviewedById: input.actorId,
                  resolutionNote: `Suprimida por regla: ${suppressionRule.reason ?? suppressionRule.issueCode}.`,
                },
              });
              summary.receiptIssuesResolved += 1;
            }
            continue;
          }

          if (openIssues.length > 0) {
            await db.receiptReconciliationIssue.update({
              where: { id: openIssues[0].id },
              data: {
                reason: issueReason,
                policyId: receipt.policyId,
                detailsJson: JSON.stringify(issueDetails),
                expectedAmount: receipt.amount as never,
                paidAmount: reconciliation.paidAmount as never,
                reviewedAt: null,
                reviewedById: null,
                resolutionNote: null,
                status: "OPEN",
              },
            });

            for (const duplicateIssue of openIssues.slice(1)) {
              await db.receiptReconciliationIssue.update({
                where: { id: duplicateIssue.id },
                data: {
                  status: "RESOLVED",
                  reviewedAt: now,
                  reviewedById: input.actorId,
                  resolutionNote: "Duplicado consolidado durante la auditoría de pagos.",
                },
              });
              summary.receiptIssuesResolved += 1;
            }
          } else {
            await db.receiptReconciliationIssue.create({
              data: {
                organizationId: input.organizationId,
                maintenanceRunId: run.id,
                receiptId: receipt.id,
                policyId: receipt.policyId,
                reason: issueReason,
                status: "OPEN",
                detailsJson: JSON.stringify(issueDetails),
                expectedAmount: receipt.amount as never,
                paidAmount: reconciliation.paidAmount as never,
              },
            });
            summary.receiptIssuesOpened += 1;
          }
        } else if (openIssues.length > 0) {
          for (const issue of openIssues) {
            await db.receiptReconciliationIssue.update({
              where: { id: issue.id },
              data: {
                status: "RESOLVED",
                reviewedAt: now,
                reviewedById: input.actorId,
                resolutionNote: "Reconciliado automáticamente durante la auditoría de pagos.",
              },
            });
            summary.receiptIssuesResolved += 1;
          }
        }
      }
    }

    const completed = await db.maintenanceRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        summaryJson: JSON.stringify(summary),
        completedAt: now,
      },
    });

    await writeActivityLog({
      entityType: "MaintenanceRun",
      entityId: completed.id,
      action: "PAYMENT_RECONCILIATION_AUDIT_COMPLETED",
      newValue: summary,
      userId: input.actorId,
      organizationId: input.organizationId,
      db,
    });

    return { run: completed, summary };
  } catch (error) {
    const failed = await db.maintenanceRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        summaryJson: JSON.stringify({
          ...summary,
          error: error instanceof Error ? error.message : "Unknown error",
        }),
        completedAt: now,
      },
    });

    logError("payment-maintenance.runPaymentReconciliationAudit", error);
    throw new Error(`No se pudo completar la auditoría de pagos. ${failed.id}`);
  }
}
