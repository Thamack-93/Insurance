import fs from "node:fs/promises";

import { getDb } from "@/lib/db";
import { SYSTEM_USER_ID } from "@/lib/auth";
import { formatDateInput } from "@/lib/form-utils";
import { businessEndOfDay, businessStartOfDay, parseBusinessDateInput } from "@/lib/business-dates";
import { writeActivityLog } from "@/lib/activity-log";
import { reconcileReceiptState } from "@/lib/receipt-reconciliation";
import { toNumber } from "@/lib/money";
import { parseCliArgs, requireOrganizationId } from "./_shared.ts";

type ReceiptRow = {
  organizationId: string;
  id: string;
  receiptNumber: string;
  status: string;
  amount: unknown;
  currency: string;
  dueDate: Date;
  paidDate: Date | null;
  paymentMethod: string | null;
  policy: {
    id: string;
    policyNumber: string;
    clientId: string;
    insurerId: string;
  };
  payments: Array<{
    id: string;
    amount: unknown;
    paidDate: Date;
    paymentMethod: string | null;
  }>;
};

type PlanRow = {
  receiptId: string;
  receiptNumber: string;
  policyNumber: string;
  dueDate: string;
  amount: number;
  paidAmount: number;
  outstanding: number;
  action: "PAY_OUTSTANDING" | "RECONCILE_ONLY" | "REVIEW";
  reason?: string;
};

type Report = {
  startedAt: string;
  finishedAt: string;
  receiptsScanned: number;
  receiptsInScope: number;
  receiptsApplied: number;
  receiptsReconciled: number;
  receiptsForcedReviewed: number;
  receiptsReviewed: number;
  applied: PlanRow[];
  reviewed: PlanRow[];
};

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    dryRun: true,
    reportFile: null as string | null,
    includeReviewed: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--apply") {
      args.dryRun = false;
      continue;
    }
    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (token === "--include-reviewed") {
      args.includeReviewed = true;
      continue;
    }
    if (token === "--report-file") {
      args.reportFile = argv[index + 1] ?? null;
      index += 1;
      continue;
    }
    if (token.startsWith("--report-file=")) {
      args.reportFile = token.slice("--report-file=".length) || null;
    }
  }

  return args;
}

function dateKey(value: Date) {
  return formatDateInput(value);
}

function paymentAmount(payments: ReceiptRow["payments"]) {
  return payments.reduce((sum, payment) => sum + toNumber(payment.amount), 0);
}

function buildPlanRow(receipt: ReceiptRow): PlanRow {
  const paidAmount = paymentAmount(receipt.payments);
  const amount = toNumber(receipt.amount);
  const outstanding = Math.max(0, Math.round((amount - paidAmount) * 100) / 100);
  const latestPaymentDate = receipt.payments[0]?.paidDate ?? null;

  if (latestPaymentDate && latestPaymentDate.getTime() > receipt.dueDate.getTime()) {
    return {
      receiptId: receipt.id,
      receiptNumber: receipt.receiptNumber,
      policyNumber: receipt.policy.policyNumber,
      dueDate: dateKey(receipt.dueDate),
      amount,
      paidAmount,
      outstanding,
      action: "REVIEW",
      reason: "payment_after_due_date",
    };
  }

  if (paidAmount > amount + 0.01) {
    return {
      receiptId: receipt.id,
      receiptNumber: receipt.receiptNumber,
      policyNumber: receipt.policy.policyNumber,
      dueDate: dateKey(receipt.dueDate),
      amount,
      paidAmount,
      outstanding,
      action: "REVIEW",
      reason: "overpayment",
    };
  }

  if (paidAmount >= amount - 0.01) {
    return {
      receiptId: receipt.id,
      receiptNumber: receipt.receiptNumber,
      policyNumber: receipt.policy.policyNumber,
      dueDate: dateKey(receipt.dueDate),
      amount,
      paidAmount,
      outstanding: 0,
      action: "RECONCILE_ONLY",
      reason: receipt.status === "PAID" ? "already_paid" : "status_needs_reconcile",
    };
  }

  return {
    receiptId: receipt.id,
    receiptNumber: receipt.receiptNumber,
    policyNumber: receipt.policy.policyNumber,
    dueDate: dateKey(receipt.dueDate),
    amount,
    paidAmount,
    outstanding,
    action: "PAY_OUTSTANDING",
  };
}

async function resolveOpenIssues(organizationId: string, receiptId: string, db = getDb()) {
  const openIssues = await db.receiptReconciliationIssue.findMany({
    where: { organizationId, receiptId, status: "OPEN" },
    select: { id: true },
  });

  for (const issue of openIssues) {
    await db.receiptReconciliationIssue.update({
      where: { id: issue.id, organizationId },
      data: {
        status: "RESOLVED",
        reviewedAt: new Date(),
        reviewedById: SYSTEM_USER_ID,
        resolutionNote: "Cierre histórico aplicado para 2023-2025.",
      },
    });
  }
}

async function reconcileReceipt(organizationId: string, receiptId: string, actorId: string, db = getDb()) {
  const receipt = await db.receipt.findFirst({
    where: { id: receiptId, organizationId },
    include: {
      payments: {
        orderBy: [{ paidDate: "desc" }, { createdAt: "desc" }],
      },
    },
  });

  if (!receipt) {
    throw new Error("El recibo no existe o fue eliminado.");
  }

  const snapshot = reconcileReceiptState({
    amount: Number(receipt.amount),
    status: receipt.status as "PENDING" | "PAID" | "OVERDUE" | "CANCELLED",
    dueDate: receipt.dueDate,
    paidDate: receipt.paidDate,
    paymentMethod: receipt.paymentMethod,
    payments: receipt.payments.map((payment) => ({
      amount: Number(payment.amount),
      paidDate: payment.paidDate,
      paymentMethod: payment.paymentMethod,
    })),
    closeTolerance: 5,
  });

  const adjustment =
    snapshot.nextStatus === "PAID"
      ? Math.round((Number(receipt.amount) - snapshot.paidAmount) * 100) / 100
      : 0;
  const reconciliationNote =
    adjustment !== 0
      ? `Ajuste auditado de conciliación: ${adjustment.toFixed(2)} ${receipt.currency}.`
      : snapshot.nextStatus === "PAID"
        ? "Cierre histórico con fecha de vencimiento."
        : receipt.reconciliationNote;

  await db.receipt.update({
    where: { id: receipt.id, organizationId },
    data: {
      status: snapshot.nextStatus,
      paidDate: snapshot.nextPaidDate,
      paymentMethod: snapshot.nextPaymentMethod,
      reconciliationAdjustment: adjustment,
      reconciliationNote,
      updatedById: actorId,
    },
  });

  if (snapshot.shouldReview) {
    const reason = snapshot.reasons.join(",") || "REVIEW_REQUIRED";
    const existingIssue = await db.receiptReconciliationIssue.findFirst({
      where: { organizationId, receiptId: receipt.id, reason, status: "OPEN" },
      select: { id: true },
    });

    if (existingIssue) {
      await db.receiptReconciliationIssue.update({
        where: { id: existingIssue.id, organizationId },
        data: {
          organizationId,
          detailsJson: JSON.stringify(snapshot),
          expectedAmount: receipt.amount,
          paidAmount: snapshot.paidAmount,
        },
      });
    } else {
      await db.receiptReconciliationIssue.create({
        data: {
          organizationId,
          receiptId: receipt.id,
          policyId: receipt.policyId,
          reason,
          status: "OPEN",
          detailsJson: JSON.stringify(snapshot),
          expectedAmount: receipt.amount,
          paidAmount: snapshot.paidAmount,
        },
      });
    }
  }

  if (snapshot.nextStatus === "PAID" || snapshot.shouldReview) {
    await writeActivityLog({
      organizationId,
      entityType: "Receipt",
      entityId: receipt.id,
      action: "RECEIPT_RECONCILED",
      oldValue: {
        status: receipt.status,
        paidDate: receipt.paidDate,
        paymentMethod: receipt.paymentMethod,
      },
      newValue: {
        status: snapshot.nextStatus,
        paidAmount: snapshot.paidAmount,
        adjustment,
        reasons: snapshot.reasons,
      },
      userId: actorId,
      db,
    });
  }
}

async function forceCloseReviewedReceipt(receipt: ReceiptRow, actorId: string, db = getDb()) {
  const outstanding = Math.max(0, Math.round((toNumber(receipt.amount) - paymentAmount(receipt.payments)) * 100) / 100);
  const sourceEvidenceKey = `historical-receipt-force:${receipt.id}:${dateKey(receipt.dueDate)}`;

  const existingPayment = await db.payment.findUnique({
    where: { organizationId_sourceEvidenceKey: { organizationId: receipt.organizationId, sourceEvidenceKey } },
    select: { id: true },
  });

  if (!existingPayment) {
    await db.payment.create({
      data: {
        organizationId: receipt.organizationId,
        receiptId: receipt.id,
        policyId: receipt.policy.id,
        clientId: receipt.policy.clientId,
        amount: outstanding,
        currency: receipt.currency,
        paidDate: receipt.dueDate,
        paymentMethod: "TRANSFER",
        sourceEvidenceKey,
        createdById: SYSTEM_USER_ID,
        updatedById: SYSTEM_USER_ID,
      },
    });
  }

  const updated = await db.receipt.update({
    where: { id: receipt.id, organizationId: receipt.organizationId },
    data: {
      status: "PAID",
      paidDate: receipt.dueDate,
      paymentMethod: "TRANSFER",
      reconciliationAdjustment: 0,
      reconciliationNote: "Cierre histórico forzado con fecha de vencimiento.",
      updatedById: actorId,
    },
  });

  await resolveOpenIssues(receipt.organizationId, receipt.id, db);

  await writeActivityLog({
    organizationId: receipt.organizationId,
    entityType: "Receipt",
    entityId: receipt.id,
    action: "HISTORICAL_RECEIPT_FORCE_APPLY",
    oldValue: {
      receiptNumber: receipt.receiptNumber,
      status: receipt.status,
      paidDate: receipt.paidDate,
      paymentMethod: receipt.paymentMethod,
      paidAmount: paymentAmount(receipt.payments),
    },
    newValue: {
      status: updated.status,
      paidDate: updated.paidDate,
      paymentMethod: updated.paymentMethod,
      dueDate: dateKey(receipt.dueDate),
      historicalClose: true,
      forcedReviewClose: true,
      outstanding,
    },
    userId: actorId,
    db,
  });
}

async function main() {
  const args = parseArgs();
  const organizationId = requireOrganizationId(parseCliArgs());
  const db = getDb();
  const startedAt = new Date();
  const yearStart = businessStartOfDay(parseBusinessDateInput("2023-01-01"));
  const yearEnd = businessEndOfDay(parseBusinessDateInput("2025-12-31"));

  const receipts = (await db.receipt.findMany({
    where: {
      organizationId,
      dueDate: {
        gte: yearStart,
        lte: yearEnd,
      },
      status: {
        notIn: ["PAID", "CANCELLED"],
      },
    },
    include: {
      client: {
        select: {
          id: true,
          fullName: true,
        },
      },
      policy: {
        select: {
          id: true,
          policyNumber: true,
          clientId: true,
          insurerId: true,
        },
      },
      payments: {
        orderBy: [{ paidDate: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          amount: true,
          paidDate: true,
          paymentMethod: true,
        },
      },
    },
    orderBy: [{ dueDate: "asc" }, { receiptNumber: "asc" }],
  })) as ReceiptRow[];

  const report: Report = {
    startedAt: startedAt.toISOString(),
    finishedAt: startedAt.toISOString(),
    receiptsScanned: receipts.length,
    receiptsInScope: 0,
    receiptsApplied: 0,
    receiptsReconciled: 0,
    receiptsForcedReviewed: 0,
    receiptsReviewed: 0,
    applied: [],
    reviewed: [],
  };

  for (const receipt of receipts) {
    const plan = buildPlanRow(receipt);
    report.receiptsInScope += 1;

    if (plan.action === "REVIEW") {
      report.receiptsReviewed += 1;
      report.reviewed.push(plan);

      if (args.includeReviewed) {
        if (args.dryRun) {
          report.receiptsForcedReviewed += 1;
          continue;
        }

        await forceCloseReviewedReceipt(receipt, SYSTEM_USER_ID, db);
        report.receiptsForcedReviewed += 1;
        report.applied.push(plan);
      }
      continue;
    }

    if (args.dryRun) {
      if (plan.action === "PAY_OUTSTANDING") {
        report.receiptsApplied += 1;
      } else {
        report.receiptsReconciled += 1;
      }
      report.applied.push(plan);
      continue;
    }

    if (plan.action === "PAY_OUTSTANDING") {
      const sourceEvidenceKey = `historical-receipt:${receipt.id}:${dateKey(receipt.dueDate)}`;
      const payment = await db.payment.findUnique({
        where: { organizationId_sourceEvidenceKey: { organizationId: receipt.organizationId, sourceEvidenceKey } },
        select: { id: true },
      });

      if (!payment) {
        await db.payment.create({
          data: {
            organizationId: receipt.organizationId,
            receiptId: receipt.id,
            policyId: receipt.policy.id,
            clientId: receipt.policy.clientId,
            amount: plan.outstanding,
            currency: receipt.currency,
            paidDate: receipt.dueDate,
            paymentMethod: "TRANSFER",
            sourceEvidenceKey,
            createdById: SYSTEM_USER_ID,
            updatedById: SYSTEM_USER_ID,
          },
        });
      }

      await reconcileReceipt(organizationId, receipt.id, SYSTEM_USER_ID, db);
      await resolveOpenIssues(organizationId, receipt.id, db);
      report.receiptsApplied += 1;
      report.applied.push(plan);
      continue;
    }

    const updated = await db.receipt.update({
      where: { id: receipt.id, organizationId },
      data: {
        status: "PAID",
        paidDate: receipt.dueDate,
        paymentMethod: receipt.paymentMethod ?? "TRANSFER",
        reconciliationAdjustment: 0,
        reconciliationNote: "Cierre histórico con fecha de vencimiento.",
        updatedById: SYSTEM_USER_ID,
      },
    });
    await resolveOpenIssues(organizationId, receipt.id, db);

    await writeActivityLog({
      organizationId,
      entityType: "Receipt",
      entityId: updated.id,
      action: "HISTORICAL_RECEIPT_CLOSE",
      oldValue: {
        receiptNumber: receipt.receiptNumber,
        status: receipt.status,
        paidDate: receipt.paidDate,
        paymentMethod: receipt.paymentMethod,
      },
      newValue: {
        status: updated.status,
        paidDate: updated.paidDate,
        paymentMethod: updated.paymentMethod,
        dueDate: dateKey(receipt.dueDate),
        historicalClose: true,
      },
      userId: SYSTEM_USER_ID,
      db,
    });

    report.receiptsReconciled += 1;
    report.applied.push(plan);
  }

  report.finishedAt = new Date().toISOString();

  const output = JSON.stringify(report, null, 2);
  console.log(output);

  if (args.reportFile) {
    await fs.writeFile(args.reportFile, `${output}\n`, "utf8");
  }

  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
