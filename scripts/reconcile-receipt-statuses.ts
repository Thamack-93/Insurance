import fs from "node:fs/promises";
import path from "node:path";

import { getDb } from "@/lib/db";
import { SYSTEM_USER_ID } from "@/lib/auth";
import { toNumber } from "@/lib/money";
import { reconcileReceiptState, type ReceiptPaymentSnapshot, type ReceiptStatus } from "@/lib/receipt-reconciliation";
import { parseCliArgs, requireOrganizationId } from "./_shared.ts";

type ReceiptRow = {
  id: string;
  receiptNumber: string;
  status: ReceiptStatus;
  amount: unknown;
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

type FamilySummary = {
  familyKey: string;
  policyNumber: string;
  clientId: string;
  insurerId: string;
  policyCount: number;
  receiptCount: number;
  updatedReceiptIds: string[];
  reviewReceiptIds: string[];
};

type Report = {
  startedAt: string;
  finishedAt: string;
  receiptsScanned: number;
  receiptsUpdated: number;
  receiptsFlaggedForReview: number;
  familiesScanned: number;
  familiesWithMultiplePolicies: number;
  affectedFamilies: FamilySummary[];
  reviewReceipts: Array<{
    receiptId: string;
    receiptNumber: string;
    familyKey: string;
    reasons: string[];
  }>;
};

const DEFAULT_REPORT_FILE = null;

function familyKey(policyNumber: string, clientId: string, insurerId: string) {
  return [policyNumber, clientId, insurerId].join("|");
}

function paymentSnapshots(payments: ReceiptRow["payments"]): ReceiptPaymentSnapshot[] {
  return payments.map((payment) => ({
    amount: toNumber(payment.amount),
    paidDate: payment.paidDate,
    paymentMethod: payment.paymentMethod,
  }));
}

function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    dryRun: false,
    reportFile: DEFAULT_REPORT_FILE as string | null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--dry-run") {
      args.dryRun = true;
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

async function main() {
  const args = parseArgs();
  const organizationId = requireOrganizationId(parseCliArgs());
  const db = getDb();
  const startedAt = new Date();

  const receipts = await db.receipt.findMany({
    where: { organizationId },
    include: {
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
    orderBy: [{ policyId: "asc" }, { dueDate: "asc" }, { receiptNumber: "asc" }],
  }) as ReceiptRow[];

  const familyBuckets = new Map<string, ReceiptRow[]>();
  for (const receipt of receipts) {
    const key = familyKey(receipt.policy.policyNumber, receipt.policy.clientId, receipt.policy.insurerId);
    const current = familyBuckets.get(key) ?? [];
    current.push(receipt);
    familyBuckets.set(key, current);
  }

  const report: Report = {
    startedAt: startedAt.toISOString(),
    finishedAt: startedAt.toISOString(),
    receiptsScanned: receipts.length,
    receiptsUpdated: 0,
    receiptsFlaggedForReview: 0,
    familiesScanned: familyBuckets.size,
    familiesWithMultiplePolicies: 0,
    affectedFamilies: [],
    reviewReceipts: [],
  };

  for (const [key, familyReceipts] of familyBuckets.entries()) {
    const policyIds = new Set(familyReceipts.map((receipt) => receipt.policy.id));
    if (policyIds.size > 1) {
      report.familiesWithMultiplePolicies += 1;
    }

    const familySummary: FamilySummary = {
      familyKey: key,
      policyNumber: familyReceipts[0]?.policy.policyNumber ?? "",
      clientId: familyReceipts[0]?.policy.clientId ?? "",
      insurerId: familyReceipts[0]?.policy.insurerId ?? "",
      policyCount: policyIds.size,
      receiptCount: familyReceipts.length,
      updatedReceiptIds: [],
      reviewReceiptIds: [],
    };

    const updates = familyReceipts
      .map((receipt) => {
        const reconciliation = reconcileReceiptState({
          amount: toNumber(receipt.amount),
          status: receipt.status,
          dueDate: receipt.dueDate,
          paidDate: receipt.paidDate,
          paymentMethod: receipt.paymentMethod,
          payments: paymentSnapshots(receipt.payments),
          now: startedAt,
        });

        return {
          receipt,
          reconciliation,
          shouldUpdate:
            receipt.status !== reconciliation.nextStatus ||
            (receipt.paidDate?.getTime() ?? null) !== (reconciliation.nextPaidDate?.getTime() ?? null) ||
            (receipt.paymentMethod ?? null) !== (reconciliation.nextPaymentMethod ?? null),
        };
      })
      .filter((entry) => entry.shouldUpdate || entry.reconciliation.shouldReview);

    if (updates.length === 0) {
      continue;
    }

    if (!args.dryRun) {
      await db.$transaction(async (tx) => {
        for (const { receipt, reconciliation, shouldUpdate } of updates) {
          if (shouldUpdate) {
            const updated = await tx.receipt.update({
              where: { id: receipt.id, organizationId },
              data: {
                status: reconciliation.nextStatus,
                paidDate: reconciliation.nextPaidDate,
                paymentMethod: reconciliation.nextPaymentMethod,
                updatedById: SYSTEM_USER_ID,
              },
            });

            await tx.activityLog.create({
              data: {
                organizationId,
                entityType: "Receipt",
                entityId: receipt.id,
                action: "RECEIPT_RECONCILED",
                oldValue: JSON.stringify({
                  receiptNumber: receipt.receiptNumber,
                  status: receipt.status,
                  paidDate: receipt.paidDate,
                  paymentMethod: receipt.paymentMethod,
                }),
                newValue: JSON.stringify({
                  receiptNumber: updated.receiptNumber,
                  status: updated.status,
                  paidDate: updated.paidDate,
                  paymentMethod: updated.paymentMethod,
                  paidAmount: reconciliation.paidAmount,
                  paymentCount: reconciliation.paymentCount,
                  reasons: reconciliation.reasons,
                }),
                userId: SYSTEM_USER_ID,
              },
            });

            report.receiptsUpdated += 1;
            familySummary.updatedReceiptIds.push(receipt.id);
          }

          if (reconciliation.shouldReview) {
            report.receiptsFlaggedForReview += 1;
            familySummary.reviewReceiptIds.push(receipt.id);
            report.reviewReceipts.push({
              receiptId: receipt.id,
              receiptNumber: receipt.receiptNumber,
              familyKey: key,
              reasons: reconciliation.reasons,
            });
          }
        }
      });
    } else {
      for (const { receipt, reconciliation, shouldUpdate } of updates) {
        if (shouldUpdate) {
          report.receiptsUpdated += 1;
          familySummary.updatedReceiptIds.push(receipt.id);
        }
        if (reconciliation.shouldReview) {
          report.receiptsFlaggedForReview += 1;
          familySummary.reviewReceiptIds.push(receipt.id);
          report.reviewReceipts.push({
            receiptId: receipt.id,
            receiptNumber: receipt.receiptNumber,
            familyKey: key,
            reasons: reconciliation.reasons,
          });
        }
      }
    }

    report.affectedFamilies.push(familySummary);
  }

  report.finishedAt = new Date().toISOString();

  if (args.reportFile) {
    const reportPath = path.isAbsolute(args.reportFile)
      ? args.reportFile
      : path.join(process.cwd(), args.reportFile);
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`Reporte escrito en ${reportPath}`);
  }

  console.log(JSON.stringify(report, null, 2));
  await db.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
});
