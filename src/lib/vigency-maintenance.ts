import "server-only";

import { addYears, differenceInCalendarDays } from "date-fns";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { writeActivityLog } from "@/lib/activity-log";
import { getDb } from "@/lib/db";
import { inferClearPaymentFrequency } from "@/lib/payment-frequency";
import { reconcileReceiptState } from "@/lib/receipt-reconciliation";
import { toNumber } from "@/lib/money";
import { logError } from "@/lib/logger";
import { findMatchingSuppressionRule } from "@/lib/data-quality-rules";

type DbClient = PrismaClient | Prisma.TransactionClient;

export type VigencyAuditSummary = {
  familiesReviewed: number;
  familiesLinked: number;
  policiesUpdated: number;
  policySuggestionsUpserted: number;
  receiptsReviewed: number;
  receiptsRelinked: number;
  receiptsReconciled: number;
  paymentsReviewed: number;
  paymentsRelinked: number;
  receiptIssuesOpened: number;
  receiptIssuesResolved: number;
  multiYearPoliciesFlagged: number;
  overlappingFamilies: number;
  paymentFrequenciesNormalized: number;
  paymentFrequencyReviewCandidates: number;
  paymentFrequencyReviewSample: Array<{
    policyId: string;
    policyNumber: string;
    currentFrequency: string;
    receiptCount: number;
    reason: string;
  }>;
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

type PolicyRow = {
  id: string;
  policyNumber: string;
  familyRootId: string | null;
  renewedFromPolicyId: string | null;
  isMultiYearContract: boolean;
  clientId: string;
  insurerId: string;
  policyType: string;
  status: string;
  startDate: Date;
  endDate: Date;
  premiumAmount: unknown;
  currency: string;
  paymentFrequency: string;
  paymentPlan: string | null;
  insuredObject: string | null;
  beneficiaryInfo: string | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  client?: { fullName: string };
  insurer?: { name: string };
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
  periodStartDate: Date;
  periodEndDate: Date;
  payments: Array<{
    id: string;
    policyId: string;
    clientId: string;
    amount: unknown;
    paidDate: Date;
    paymentMethod: string | null;
  }>;
  policy: {
    id: string;
    policyNumber: string;
    familyRootId: string | null;
    startDate: Date;
    endDate: Date;
    clientId: string;
    insurerId: string;
  };
  client: { fullName: string };
  insurer: { name: string };
};

function familyKey(policy: Pick<PolicyRow, "clientId" | "insurerId" | "policyNumber">) {
  return `${policy.clientId}:${policy.insurerId}:${policy.policyNumber}`;
}

function termLengthDays(startDate: Date, endDate: Date) {
  return differenceInCalendarDays(endDate, startDate);
}

function buildAnnualTerms(startDate: Date, endDate: Date) {
  const terms: Array<{ startDate: Date; endDate: Date }> = [];
  for (let index = 0; addYears(startDate, index) < endDate; index += 1) {
    const termStart = addYears(startDate, index);
    const termEnd = addYears(startDate, index + 1);
    terms.push({
      startDate: termStart,
      endDate: termEnd > endDate ? endDate : termEnd,
    });
  }
  return terms;
}

function resolveReceiptTermIndex(
  receipt: Pick<ReceiptRow, "periodStartDate" | "periodEndDate" | "dueDate">,
  terms: Array<{ startDate: Date; endDate: Date }>,
) {
  if (terms.length <= 1) {
    return { index: 0, score: 0, ambiguous: false };
  }

  const ranked = terms
    .map((term, index) => {
      const overlapStart = receipt.periodStartDate > term.startDate ? receipt.periodStartDate : term.startDate;
      const overlapEnd = receipt.periodEndDate < term.endDate ? receipt.periodEndDate : term.endDate;
      const overlapDays = Math.max(0, differenceInCalendarDays(overlapEnd, overlapStart));
      const startMatch = receipt.periodStartDate >= term.startDate && receipt.periodStartDate < term.endDate ? 4 : 0;
      const endMatch = receipt.periodEndDate > term.startDate && receipt.periodEndDate <= term.endDate ? 4 : 0;
      const dueMatch = receipt.dueDate >= term.startDate && receipt.dueDate < term.endDate ? 1 : 0;
      return { index, score: overlapDays + startMatch + endMatch + dueMatch };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index);

  const best = ranked[0];
  const second = ranked[1];

  return {
    index: best?.index ?? 0,
    score: best?.score ?? 0,
    ambiguous: !best || best.score <= 0 || (second?.score ?? -1) === best.score,
  };
}

function normalizeNumber(value: unknown) {
  return toNumber(value);
}

export async function getLatestMaintenanceRun(
  type: string,
  client?: DbClient,
): Promise<MaintenanceRunSnapshot | null> {
  const db = client ?? getDb();
  return db.maintenanceRun.findFirst({
    where: { type },
    orderBy: { startedAt: "desc" },
  });
}

export async function runPolicyVigencyAudit(input: {
  actorId: string;
  client?: DbClient;
  now?: Date;
}): Promise<{ run: MaintenanceRunSnapshot; summary: VigencyAuditSummary }> {
  const db = input.client ?? getDb();
  const now = input.now ?? new Date();
  const run = await db.maintenanceRun.create({
    data: {
      type: "POLICY_VIGENCY_AUDIT",
      status: "RUNNING",
      createdById: input.actorId,
    },
  });

  const summary: VigencyAuditSummary = {
    familiesReviewed: 0,
    familiesLinked: 0,
    policiesUpdated: 0,
    policySuggestionsUpserted: 0,
    receiptsReviewed: 0,
    receiptsRelinked: 0,
    receiptsReconciled: 0,
    paymentsReviewed: 0,
    paymentsRelinked: 0,
    receiptIssuesOpened: 0,
    receiptIssuesResolved: 0,
    multiYearPoliciesFlagged: 0,
    overlappingFamilies: 0,
    paymentFrequenciesNormalized: 0,
    paymentFrequencyReviewCandidates: 0,
    paymentFrequencyReviewSample: [],
    familyKeysSample: [],
  };

  try {
    const policies = (await db.policy.findMany({
      select: {
        id: true,
        policyNumber: true,
        familyRootId: true,
        renewedFromPolicyId: true,
        isMultiYearContract: true,
        clientId: true,
        insurerId: true,
        policyType: true,
        status: true,
        startDate: true,
        endDate: true,
        premiumAmount: true,
        currency: true,
        paymentFrequency: true,
        paymentPlan: true,
        insuredObject: true,
        beneficiaryInfo: true,
        notes: true,
        createdAt: true,
        updatedAt: true,
        client: { select: { fullName: true } },
        insurer: { select: { name: true } },
      },
      orderBy: [{ clientId: "asc" }, { insurerId: "asc" }, { policyNumber: "asc" }, { startDate: "asc" }],
    })) as PolicyRow[];

    const policiesByFamily = new Map<string, PolicyRow[]>();
    for (const policy of policies) {
      const key = familyKey(policy);
      const existing = policiesByFamily.get(key) ?? [];
      existing.push(policy);
      policiesByFamily.set(key, existing);
    }

    const allReceipts = (await db.receipt.findMany({
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
        periodStartDate: true,
        periodEndDate: true,
        payments: {
          where: { status: "POSTED" },
          select: {
            id: true,
            policyId: true,
            clientId: true,
            amount: true,
            paidDate: true,
            paymentMethod: true,
          },
          orderBy: [{ paidDate: "desc" }, { createdAt: "desc" }],
        },
        policy: {
          select: {
            id: true,
            policyNumber: true,
            familyRootId: true,
            startDate: true,
            endDate: true,
            clientId: true,
            insurerId: true,
          },
        },
        client: { select: { fullName: true } },
        insurer: { select: { name: true } },
      },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
    })) as ReceiptRow[];

    const receiptsByFamily = new Map<string, ReceiptRow[]>();
    for (const receipt of allReceipts) {
      const policy = policies.find((item) => item.id === receipt.policyId);
      if (!policy) continue;
      const key = familyKey(policy);
      const existing = receiptsByFamily.get(key) ?? [];
      existing.push(receipt);
      receiptsByFamily.set(key, existing);
    }

    for (const [key, familyPolicies] of policiesByFamily.entries()) {
      summary.familiesReviewed += 1;
      if (summary.familyKeysSample.length < 20) {
        summary.familyKeysSample.push(key);
      }

      const orderedPolicies = [...familyPolicies].sort(
        (left, right) =>
          left.startDate.getTime() - right.startDate.getTime() ||
          left.endDate.getTime() - right.endDate.getTime() ||
          left.createdAt.getTime() - right.createdAt.getTime(),
      );
      const familyRoot = orderedPolicies[0];
      const familySpanDays = termLengthDays(familyRoot.startDate, orderedPolicies[orderedPolicies.length - 1].endDate);
      const isMultiYearCandidate = familyPolicies.some((policy) => termLengthDays(policy.startDate, policy.endDate) > 395) || familySpanDays > 395;
      const familyReceipts = receiptsByFamily.get(key) ?? [];
      const familyHasOverlap = orderedPolicies.some((policy, index) => {
        const previous = orderedPolicies[index - 1];
        return Boolean(previous && policy.startDate < previous.endDate);
      });

      if (familyHasOverlap) {
        summary.overlappingFamilies += 1;
      }

      const annualTerms = buildAnnualTerms(familyRoot.startDate, orderedPolicies[orderedPolicies.length - 1].endDate);
      const familyTerms = annualTerms.length > 0 ? annualTerms : [{ startDate: familyRoot.startDate, endDate: familyRoot.endDate }];
      const useTermSplit = annualTerms.length > 1 || familyPolicies.length > 1;
      const nextPolicies: PolicyRow[] = [];
      const receiptsByTermIndex = new Map<number, ReceiptRow[]>();

      for (const receipt of familyReceipts) {
        const targetResolution = resolveReceiptTermIndex(receipt, familyTerms);
        if (targetResolution.score <= 0) {
          continue;
        }

        const existingReceipts = receiptsByTermIndex.get(targetResolution.index) ?? [];
        existingReceipts.push(receipt);
        receiptsByTermIndex.set(targetResolution.index, existingReceipts);
      }

      if (useTermSplit) {
        for (let index = 0; index < annualTerms.length; index += 1) {
          const term = annualTerms[index];
          const receiptsForTerm = receiptsByTermIndex.get(index) ?? [];
          const existing =
            orderedPolicies.find(
              (policy) =>
                policy.startDate.toISOString().slice(0, 10) === term.startDate.toISOString().slice(0, 10) &&
                policy.endDate.toISOString().slice(0, 10) === term.endDate.toISOString().slice(0, 10),
            ) ?? (index === 0 ? familyRoot : null);

          if (existing) {
            const familyRootId = index === 0 ? null : familyRoot.id;
            const renewedFromPolicyId = index === 0 ? null : nextPolicies[index - 1]?.id ?? null;
            const isMultiYearContract = termLengthDays(term.startDate, term.endDate) > 395 || isMultiYearCandidate;
            const nextState = index < annualTerms.length - 1 ? "RENEWED" : familyRoot.endDate < now ? "EXPIRED" : "ACTIVE";

            const changed =
              existing.familyRootId !== familyRootId ||
              existing.renewedFromPolicyId !== renewedFromPolicyId ||
              existing.isMultiYearContract !== isMultiYearContract ||
              existing.startDate.getTime() !== term.startDate.getTime() ||
              existing.endDate.getTime() !== term.endDate.getTime() ||
              existing.status !== nextState ||
              normalizeNumber(existing.premiumAmount) !==
                normalizeNumber(receiptsForTerm.reduce((sum, receipt) => sum + normalizeNumber(receipt.amount), 0));

            if (changed) {
              const updated = await db.policy.update({
                where: { id: existing.id },
                data: {
                  policyNumber: familyRoot.policyNumber,
                  familyRootId,
                  renewedFromPolicyId,
                  isMultiYearContract,
                  clientId: familyRoot.clientId,
                  insurerId: familyRoot.insurerId,
                  policyType: familyRoot.policyType,
                  status: nextState,
                  startDate: term.startDate,
                  endDate: term.endDate,
                  premiumAmount: receiptsForTerm.reduce((sum, receipt) => sum + normalizeNumber(receipt.amount), 0),
                  currency: familyRoot.currency,
                  paymentFrequency: familyRoot.paymentFrequency,
                  paymentPlan: familyRoot.paymentPlan,
                  insuredObject: familyRoot.insuredObject,
                  beneficiaryInfo: familyRoot.beneficiaryInfo,
                  notes: familyRoot.notes,
                },
              });
              nextPolicies.push(updated as PolicyRow);
              summary.policiesUpdated += 1;
            } else {
              nextPolicies.push(existing);
            }
          } else {
            const created = (await db.policy.create({
              data: {
                policyNumber: familyRoot.policyNumber,
                familyRootId: index === 0 ? null : familyRoot.id,
                renewedFromPolicyId: index === 0 ? null : nextPolicies[index - 1]?.id ?? null,
                isMultiYearContract: termLengthDays(term.startDate, term.endDate) > 395 || isMultiYearCandidate,
                clientId: familyRoot.clientId,
                insurerId: familyRoot.insurerId,
                policyType: familyRoot.policyType,
                status: index < annualTerms.length - 1 ? "RENEWED" : familyRoot.endDate < now ? "EXPIRED" : "ACTIVE",
                startDate: term.startDate,
                endDate: term.endDate,
                premiumAmount: receiptsForTerm.reduce((sum, receipt) => sum + normalizeNumber(receipt.amount), 0),
                currency: familyRoot.currency,
                paymentFrequency: familyRoot.paymentFrequency,
                paymentPlan: familyRoot.paymentPlan,
                insuredObject: familyRoot.insuredObject,
                beneficiaryInfo: familyRoot.beneficiaryInfo,
                notes: familyRoot.notes,
              },
            })) as PolicyRow;

            nextPolicies.push(created);
            summary.policiesUpdated += 1;
          }
        }

        if (nextPolicies.length > 0) {
          summary.familiesLinked += 1;
        }

        for (let index = 0; index < nextPolicies.length; index += 1) {
          const policy = nextPolicies[index];
          const familyRootId = index === 0 ? null : familyRoot.id;
          const renewedFromPolicyId = index === 0 ? null : nextPolicies[index - 1]?.id ?? null;
          const isMultiYearContract = termLengthDays(policy.startDate, policy.endDate) > 395 || isMultiYearCandidate;
          if (
            policy.familyRootId !== familyRootId ||
            policy.renewedFromPolicyId !== renewedFromPolicyId ||
            policy.isMultiYearContract !== isMultiYearContract
          ) {
            await db.policy.update({
              where: { id: policy.id },
              data: { familyRootId, renewedFromPolicyId, isMultiYearContract },
            });
          }
          if (isMultiYearContract) {
            summary.multiYearPoliciesFlagged += 1;
          }
        }

        const policiesForFrequencyNormalization = nextPolicies.length > 0 ? nextPolicies : orderedPolicies;

        for (let index = 0; index < policiesForFrequencyNormalization.length; index += 1) {
          const policy = policiesForFrequencyNormalization[index];
          const receiptsForTerm = receiptsByTermIndex.get(index) ?? [];
          const inference = inferClearPaymentFrequency(
            {
              startDate: policy.startDate,
              endDate: policy.endDate,
              paymentFrequency: policy.paymentFrequency,
            },
            receiptsForTerm.map((receipt) => ({
              periodStartDate: receipt.periodStartDate,
              periodEndDate: receipt.periodEndDate,
              amount: receipt.amount,
            })),
          );

          if (policy.paymentFrequency === "SINGLE" && inference.normalizedFrequency === "SEMIANNUAL") {
            const updated = await db.policy.update({
              where: { id: policy.id },
              data: { paymentFrequency: inference.normalizedFrequency },
            });
            if (nextPolicies.length > 0) {
              nextPolicies[index] = updated as PolicyRow;
            }
            summary.paymentFrequenciesNormalized += 1;
            summary.policiesUpdated += 1;

            await writeActivityLog({
              entityType: "Policy",
              entityId: policy.id,
              action: "POLICY_PAYMENT_FREQUENCY_NORMALIZED",
              oldValue: {
                paymentFrequency: policy.paymentFrequency,
              },
              newValue: {
                paymentFrequency: inference.normalizedFrequency,
                receiptCount: inference.receiptCount,
                reason: inference.reason,
              },
              userId: input.actorId,
              db,
            });
            continue;
          }

          if (policy.paymentFrequency === "SINGLE" && inference.reviewRequired) {
            summary.paymentFrequencyReviewCandidates += 1;
            if (summary.paymentFrequencyReviewSample.length < 10) {
              summary.paymentFrequencyReviewSample.push({
                policyId: policy.id,
                policyNumber: policy.policyNumber,
                currentFrequency: policy.paymentFrequency,
                receiptCount: inference.receiptCount,
                reason: inference.reason ?? "Requiere revisión manual.",
              });
            }
          }
        }

        for (let index = 0; index < nextPolicies.length - 1; index += 1) {
          const sourcePolicy = nextPolicies[index];
          const targetPolicy = nextPolicies[index + 1];
          const gapDays = differenceInCalendarDays(targetPolicy.startDate, sourcePolicy.endDate);
          const confidence = gapDays <= 0 ? 0.95 : gapDays <= 15 ? 0.9 : gapDays <= 45 ? 0.8 : 0.7;
          const reason = gapDays <= 0
            ? "Vigencia consecutiva detectada automáticamente."
            : `Renovación detectada con separación de ${gapDays} día(s).`;
          const suppressionRule = await findMatchingSuppressionRule(
            {
              category: "RENOVATIONS",
              issueCode: "RENEWAL_SUGGESTION",
              fields: {
                sourcePolicyId: sourcePolicy.id,
                sourcePolicyNumber: sourcePolicy.policyNumber,
                targetPolicyId: targetPolicy.id,
                clientId: sourcePolicy.clientId,
                insurerId: sourcePolicy.insurerId,
              },
            },
            db,
          );
          const nextStatus = suppressionRule ? "DECLINED" : "PENDING";

          await db.policyRenewalSuggestion.upsert({
            where: {
              sourcePolicyId_targetPolicyId: {
                sourcePolicyId: sourcePolicy.id,
                targetPolicyId: targetPolicy.id,
              },
            },
            update: {
              confidence,
              reason,
              status: nextStatus,
              maintenanceRunId: run.id,
              suppressedByRuleId: suppressionRule?.id ?? undefined,
              reviewedAt: suppressionRule ? now : undefined,
              reviewedById: suppressionRule ? input.actorId : undefined,
              resolutionNote: suppressionRule ? `Suprimida por regla: ${suppressionRule.reason ?? suppressionRule.issueCode}.` : undefined,
            },
            create: {
              maintenanceRunId: run.id,
              sourcePolicyId: sourcePolicy.id,
              targetPolicyId: targetPolicy.id,
              confidence,
              reason,
              status: nextStatus,
              suppressedByRuleId: suppressionRule?.id ?? undefined,
              reviewedAt: suppressionRule ? now : undefined,
              reviewedById: suppressionRule ? input.actorId : undefined,
              resolutionNote: suppressionRule ? `Suprimida por regla: ${suppressionRule.reason ?? suppressionRule.issueCode}.` : undefined,
            },
          });

          summary.policySuggestionsUpserted += 1;
        }
      } else if (familyPolicies.some((policy) => termLengthDays(policy.startDate, policy.endDate) > 395)) {
        summary.multiYearPoliciesFlagged += 1;
      }

      const familyReceiptsOrdered = [...familyReceipts].sort(
        (left, right) => left.periodStartDate.getTime() - right.periodStartDate.getTime(),
      );

      for (const receipt of familyReceiptsOrdered) {
        summary.receiptsReviewed += 1;
        const targetResolution = resolveReceiptTermIndex(receipt, familyTerms);
        const targetIndex = targetResolution.index;
        const targetPolicy = nextPolicies[targetIndex] ?? nextPolicies[0] ?? familyRoot;

        if (
          receipt.policyId !== targetPolicy.id ||
          receipt.clientId !== targetPolicy.clientId ||
          receipt.insurerId !== targetPolicy.insurerId
        ) {
          if (targetResolution.score > 0) {
            await db.receipt.update({
              where: { id: receipt.id },
              data: {
                policyId: targetPolicy.id,
                clientId: targetPolicy.clientId,
                insurerId: targetPolicy.insurerId,
              },
            });
            summary.receiptsRelinked += 1;
          }
        }

        for (const payment of receipt.payments) {
          summary.paymentsReviewed += 1;
          if (payment.policyId !== targetPolicy.id || payment.clientId !== targetPolicy.clientId) {
            await db.payment.update({
              where: { id: payment.id },
              data: {
                policyId: targetPolicy.id,
                clientId: targetPolicy.clientId,
              },
            });
            summary.paymentsRelinked += 1;

            await writeActivityLog({
              entityType: "Payment",
              entityId: payment.id,
              action: "PAYMENT_RELINKED_DURING_VIGENCY_AUDIT",
              oldValue: {
                policyId: payment.policyId,
                clientId: payment.clientId,
              },
              newValue: {
                policyId: targetPolicy.id,
                clientId: targetPolicy.clientId,
                receiptId: receipt.id,
                receiptNumber: receipt.receiptNumber,
              },
              userId: input.actorId,
              db,
            });
          }
        }

        const reconciliation = reconcileReceiptState({
          amount: normalizeNumber(receipt.amount),
          status: receipt.status as "PENDING" | "PAID" | "OVERDUE" | "CANCELLED",
          dueDate: receipt.dueDate,
          paidDate: receipt.paidDate,
          paymentMethod: receipt.paymentMethod,
          payments: receipt.payments.map((payment) => ({
            amount: normalizeNumber(payment.amount),
            paidDate: payment.paidDate,
            paymentMethod: payment.paymentMethod,
          })),
          now,
          closeTolerance: 5,
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
            },
          });
          summary.receiptsReconciled += 1;
        }

        const reason = [
          ...reconciliation.reasons,
          targetResolution.ambiguous ? "TERM_ASSIGNMENT_AMBIGUOUS" : null,
        ]
          .filter(Boolean)
          .join(",") || "REVIEW_REQUIRED";
        const suppressionRule = await findMatchingSuppressionRule(
          {
            category: "PAYMENTS",
            issueCode: reason,
            fields: {
              receiptId: receipt.id,
              receiptNumber: receipt.receiptNumber,
              policyId: targetPolicy.id,
              policyNumber: targetPolicy.policyNumber,
              familyKey: key,
            },
          },
          db,
        );
        const issueDetails = {
          familyKey: key,
          policyNumber: familyRoot.policyNumber,
          termAssignment: targetResolution,
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

        if (reconciliation.shouldReview || targetResolution.ambiguous || suppressionRule) {
          const existingIssue = await db.receiptReconciliationIssue.findFirst({
            where: { receiptId: receipt.id, status: "OPEN" },
            orderBy: { createdAt: "desc" },
            select: { id: true, reason: true },
          });

          if (existingIssue) {
            await db.receiptReconciliationIssue.update({
              where: { id: existingIssue.id },
              data: {
                reason,
                policyId: targetPolicy.id,
                detailsJson: JSON.stringify(issueDetails),
                expectedAmount: receipt.amount as never,
                paidAmount: reconciliation.paidAmount as never,
                status: suppressionRule ? "DISMISSED" : "OPEN",
                suppressedByRuleId: suppressionRule?.id ?? null,
                reviewedAt: suppressionRule ? now : null,
                reviewedById: suppressionRule ? input.actorId : null,
                resolutionNote: suppressionRule ? `Suprimida por regla: ${suppressionRule.reason ?? suppressionRule.issueCode}.` : null,
              },
            });
          } else {
            await db.receiptReconciliationIssue.create({
              data: {
                maintenanceRunId: run.id,
                receiptId: receipt.id,
                policyId: targetPolicy.id,
                reason,
                status: suppressionRule ? "DISMISSED" : "OPEN",
                detailsJson: JSON.stringify(issueDetails),
                expectedAmount: receipt.amount as never,
                paidAmount: reconciliation.paidAmount as never,
                suppressedByRuleId: suppressionRule?.id ?? undefined,
                reviewedAt: suppressionRule ? now : undefined,
                reviewedById: suppressionRule ? input.actorId : undefined,
                resolutionNote: suppressionRule ? `Suprimida por regla: ${suppressionRule.reason ?? suppressionRule.issueCode}.` : undefined,
              },
            });
            if (!suppressionRule) {
              summary.receiptIssuesOpened += 1;
            } else {
              summary.receiptIssuesResolved += 1;
            }
          }
        } else {
          const existingIssue = await db.receiptReconciliationIssue.findFirst({
            where: { receiptId: receipt.id, status: "OPEN" },
            orderBy: { createdAt: "desc" },
            select: { id: true },
          });

          if (existingIssue) {
            await db.receiptReconciliationIssue.update({
              where: { id: existingIssue.id },
              data: {
                status: "RESOLVED",
                reviewedAt: now,
                resolutionNote: "Reconciliado automáticamente durante el mantenimiento de vigencias.",
              },
            });
            summary.receiptIssuesResolved += 1;
          }
        }
      }
    }

    const summaryJson = JSON.stringify(summary);
    const completed = await db.maintenanceRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        summaryJson,
        completedAt: now,
      },
    });

    await writeActivityLog({
      entityType: "MaintenanceRun",
      entityId: completed.id,
      action: "POLICY_VIGENCY_AUDIT_COMPLETED",
      newValue: summary,
      userId: input.actorId,
      db,
    });

    return {
      run: completed,
      summary,
    };
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

    logError("vigency-maintenance.runPolicyVigencyAudit", error);
    throw new Error(`No se pudo completar la auditoría de vigencias. ${failed.id}`);
  }
}
