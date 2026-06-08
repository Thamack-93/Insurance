"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
import { errorResult, revalidatePaths, successResult, type MutationResult } from "@/lib/mutation-utils";
import { logError } from "@/lib/logger";
import { applyLedgerImportBatch, createLedgerImportPreview } from "@/lib/ledger-import";
import { runPolicyVigencyAudit } from "@/lib/vigency-maintenance";
import { runPaymentReconciliationAudit } from "@/lib/payment-maintenance";
import { upsertSuppressionRule } from "@/lib/data-quality-rules";

const REVIEW_APPROVED_NOTE = "Aprobado desde Data Quality.";
const REVIEW_DENIED_NOTE = "Denegado desde Data Quality.";
const REVIEW_SUPPRESSED_NOTE = "Suprimido por regla desde Data Quality.";
const REVIEW_REOPENED_NOTE = "Reabierto desde Data Quality.";

function parseIssueIds(formData: FormData) {
  return formData
    .getAll("issueIds")
    .map((value) => String(value).trim())
    .filter(Boolean);
}

function parseOperation(formData: FormData) {
  return String(formData.get("operation") ?? "").trim().toUpperCase();
}

function buildReceiptSuppressionCriteria(issue: {
  receipt: { id: string; receiptNumber: string } | null;
  policy: { id: string; policyNumber: string } | null;
  reason: string;
}) {
  return {
    receiptId: issue.receipt?.id ?? "",
    receiptNumber: issue.receipt?.receiptNumber ?? "",
    policyId: issue.policy?.id ?? "",
    policyNumber: issue.policy?.policyNumber ?? "",
    reason: issue.reason,
  };
}

function buildRenewalSuppressionCriteria(suggestion: {
  sourcePolicy: { id: string; policyNumber: string };
  targetPolicyId: string | null;
  reason: string | null;
}) {
  return {
    sourcePolicyId: suggestion.sourcePolicy.id,
    sourcePolicyNumber: suggestion.sourcePolicy.policyNumber,
    targetPolicyId: suggestion.targetPolicyId ?? "",
    reason: suggestion.reason ?? "RENEWAL_SUGGESTION",
  };
}

function buildLedgerSuppressionCriteria(issue: {
  batchId: string;
  rowId: string | null;
  row: { rowNumber: number | null; sourceType: string | null; sourceKey: string | null } | null;
  issueType: string;
}) {
  return {
    batchId: issue.batchId,
    rowId: issue.rowId ?? "",
    rowNumber: String(issue.row?.rowNumber ?? ""),
    sourceType: issue.row?.sourceType ?? "",
    sourceKey: issue.row?.sourceKey ?? "",
    issueType: issue.issueType,
  };
}

async function loadReceiptIssue(issueId: string) {
  const db = getDb();
  return db.receiptReconciliationIssue.findUnique({
    where: { id: issueId },
    include: {
      receipt: {
        select: {
          id: true,
          receiptNumber: true,
          policyId: true,
          clientId: true,
        },
      },
      policy: {
        select: {
          id: true,
          policyNumber: true,
        },
      },
    },
  });
}

async function loadRenewalSuggestion(suggestionId: string) {
  const db = getDb();
  return db.policyRenewalSuggestion.findUnique({
    where: { id: suggestionId },
    include: {
      sourcePolicy: {
        select: {
          id: true,
          policyNumber: true,
          clientId: true,
        },
      },
      targetPolicy: {
        select: {
          id: true,
          policyNumber: true,
        },
      },
    },
  });
}

async function loadLedgerIssue(issueId: string) {
  const db = getDb();
  return db.ledgerImportIssue.findUnique({
    where: { id: issueId },
    include: {
      row: {
        select: {
          id: true,
          rowNumber: true,
          sourceType: true,
          sourceKey: true,
        },
      },
      batch: {
        select: {
          id: true,
          sourceCsvName: true,
          sourcePaidName: true,
        },
      },
    },
  });
}

async function reviewReceiptIssue(issueId: string, decision: "APPROVE" | "DENY"): Promise<MutationResult> {
  try {
    const actor = await requireAdmin();
    const db = getDb();
    const issue = await db.receiptReconciliationIssue.findUnique({
      where: { id: issueId },
      include: {
        receipt: {
          select: {
            id: true,
            receiptNumber: true,
            policyId: true,
            clientId: true,
          },
        },
        policy: {
          select: {
            id: true,
            policyNumber: true,
          },
        },
      },
    });

    if (!issue || !issue.receipt || !issue.policy) {
      return errorResult("El issue de recibo ya no existe.");
    }

    if (issue.status !== "OPEN") {
      return successResult(issue.id, "/data-quality?tab=pagos", "El issue ya estaba revisado.");
    }

    const nextStatus = decision === "APPROVE" ? "RESOLVED" : "DISMISSED";
    const reviewedAt = new Date();

    await db.receiptReconciliationIssue.update({
      where: { id: issue.id },
      data: {
        status: nextStatus,
        reviewedAt,
        reviewedById: actor.id,
        resolutionNote: decision === "APPROVE" ? REVIEW_APPROVED_NOTE : REVIEW_DENIED_NOTE,
      },
    });

    await writeActivityLog({
      entityType: "ReceiptReconciliationIssue",
      entityId: issue.id,
      action: decision === "APPROVE" ? "RECEIPT_REVIEW_APPROVED" : "RECEIPT_REVIEW_DENIED",
      oldValue: issue,
      newValue: { ...issue, status: nextStatus, reviewedAt, reviewedById: actor.id },
      userId: actor.id,
    });

    revalidatePaths([
      "/data-quality",
      "/receipts",
      `/receipts/${issue.receipt.id}`,
      `/policies/${issue.policy.id}`,
      "/due-payments",
      "/dashboard",
      "/today",
      "/portfolio",
      "/risks",
    ]);

    return successResult(issue.id, "/data-quality?tab=pagos", decision === "APPROVE" ? "Issue aprobado." : "Issue denegado.");
  } catch (error) {
    logError("data-quality.reviewReceiptIssue", error);
    return errorResult(error instanceof Error ? error.message : "No se pudo revisar el issue de recibo.");
  }
}

async function reviewRenewalSuggestion(
  suggestionId: string,
  decision: "APPROVE" | "DENY",
): Promise<MutationResult> {
  try {
    const actor = await requireAdmin();
    const db = getDb();
    const suggestion = await db.policyRenewalSuggestion.findUnique({
      where: { id: suggestionId },
      include: {
        sourcePolicy: {
          select: {
            id: true,
            policyNumber: true,
            clientId: true,
          },
        },
        targetPolicy: {
          select: {
            id: true,
            policyNumber: true,
          },
        },
      },
    });

    if (!suggestion) {
      return errorResult("La sugerencia de renovación ya no existe.");
    }

    if (suggestion.status !== "PENDING") {
      return successResult(suggestion.id, "/data-quality?tab=renovaciones", "La sugerencia ya estaba revisada.");
    }

    const nextStatus = decision === "APPROVE" ? "RESOLVED" : "DECLINED";
    const reviewedAt = new Date();

    await db.policyRenewalSuggestion.update({
      where: { id: suggestion.id },
      data: {
        status: nextStatus,
        reviewedAt,
        reviewedById: actor.id,
        resolutionNote: decision === "APPROVE" ? REVIEW_APPROVED_NOTE : REVIEW_DENIED_NOTE,
      },
    });

    await writeActivityLog({
      entityType: "PolicyRenewalSuggestion",
      entityId: suggestion.id,
      action: decision === "APPROVE" ? "RENEWAL_REVIEW_APPROVED" : "RENEWAL_REVIEW_DENIED",
      oldValue: suggestion,
      newValue: { ...suggestion, status: nextStatus, reviewedAt, reviewedById: actor.id },
      userId: actor.id,
    });

    revalidatePaths([
      "/data-quality",
      "/renewals",
      "/dashboard",
      "/today",
      "/portfolio",
      `/policies/${suggestion.sourcePolicy.id}`,
      "/risks",
    ]);

    return successResult(
      suggestion.id,
      "/data-quality?tab=renovaciones",
      decision === "APPROVE" ? "Sugerencia aprobada." : "Sugerencia denegada.",
    );
  } catch (error) {
    logError("data-quality.reviewRenewalSuggestion", error);
    return errorResult(error instanceof Error ? error.message : "No se pudo revisar la sugerencia de renovación.");
  }
}

async function reviewLedgerIssue(issueId: string, decision: "APPROVE" | "DENY"): Promise<MutationResult> {
  try {
    const actor = await requireAdmin();
    const db = getDb();
    const issue = await db.ledgerImportIssue.findUnique({
      where: { id: issueId },
      include: {
        batch: {
          select: {
            id: true,
            sourceCsvName: true,
            sourcePaidName: true,
          },
        },
      },
    });

    if (!issue) {
      return errorResult("El issue de ledger ya no existe.");
    }

    if (issue.status !== "OPEN") {
      return successResult(issue.id, "/data-quality?tab=ledger", "El issue ya estaba revisado.");
    }

    const nextStatus = decision === "APPROVE" ? "RESOLVED" : "DISMISSED";
    const reviewedAt = new Date();

    await db.ledgerImportIssue.update({
      where: { id: issue.id },
      data: {
        status: nextStatus,
        reviewedAt,
        reviewedById: actor.id,
        resolutionNote: decision === "APPROVE" ? REVIEW_APPROVED_NOTE : REVIEW_DENIED_NOTE,
      },
    });

    await writeActivityLog({
      entityType: "LedgerImportIssue",
      entityId: issue.id,
      action: decision === "APPROVE" ? "LEDGER_ISSUE_APPROVED" : "LEDGER_ISSUE_DENIED",
      oldValue: issue,
      newValue: { ...issue, status: nextStatus, reviewedAt, reviewedById: actor.id },
      userId: actor.id,
    });

    revalidatePaths(["/data-quality", "/dashboard", "/today", "/portfolio", "/risks"]);

    return successResult(issue.id, "/data-quality?tab=ledger", decision === "APPROVE" ? "Issue aprobado." : "Issue denegado.");
  } catch (error) {
    logError("data-quality.reviewLedgerIssue", error);
    return errorResult(error instanceof Error ? error.message : "No se pudo revisar el issue de ledger.");
  }
}

export async function approveReceiptReviewIssue(issueId: string): Promise<MutationResult> {
  return reviewReceiptIssue(issueId, "APPROVE");
}

export async function denyReceiptReviewIssue(issueId: string): Promise<MutationResult> {
  return reviewReceiptIssue(issueId, "DENY");
}

export async function reopenReceiptReviewIssue(issueId: string): Promise<MutationResult> {
  try {
    const actor = await requireAdmin();
    const db = getDb();
    const issue = await loadReceiptIssue(issueId);
    if (!issue) {
      return errorResult("El issue de recibo ya no existe.");
    }

    await db.receiptReconciliationIssue.update({
      where: { id: issue.id },
      data: {
        status: "OPEN",
        suppressedByRuleId: null,
        duplicateOfId: null,
        mergedAt: null,
        mergedById: null,
        reviewedAt: null,
        reviewedById: null,
        resolutionNote: null,
      },
    });

    await writeActivityLog({
      entityType: "ReceiptReconciliationIssue",
      entityId: issue.id,
      action: "RECEIPT_REVIEW_REOPENED",
      oldValue: issue,
      newValue: { ...issue, status: "OPEN", reviewedAt: null, reviewedById: null },
      userId: actor.id,
    });

    revalidatePaths([
      "/data-quality",
      "/receipts",
      `/receipts/${issue.receipt?.id ?? ""}`,
      `/policies/${issue.policy?.id ?? ""}`,
      "/due-payments",
      "/dashboard",
      "/today",
      "/portfolio",
      "/risks",
    ]);

    return successResult(issue.id, "/data-quality?tab=pagos", "Issue reabierto.");
  } catch (error) {
    logError("data-quality.reopenReceiptReviewIssue", error);
    return errorResult(error instanceof Error ? error.message : "No se pudo reabrir el issue de recibo.");
  }
}

export async function suppressReceiptReviewIssue(issueId: string): Promise<MutationResult> {
  try {
    const actor = await requireAdmin();
    const db = getDb();
    const issue = await loadReceiptIssue(issueId);
    if (!issue || !issue.receipt || !issue.policy) {
      return errorResult("El issue de recibo ya no existe.");
    }

    const suppressionRule = await upsertSuppressionRule({
      category: "PAYMENTS",
      issueCode: issue.reason,
      criteria: buildReceiptSuppressionCriteria(issue),
      reason: `Suprimir ${issue.reason} para ${issue.policy.policyNumber}/${issue.receipt.receiptNumber}.`,
      actorId: actor.id,
    }, db);

    await db.receiptReconciliationIssue.update({
      where: { id: issue.id },
      data: {
        status: "DISMISSED",
        suppressedByRuleId: suppressionRule.id,
        duplicateOfId: null,
        mergedAt: null,
        mergedById: null,
        reviewedAt: new Date(),
        reviewedById: actor.id,
        resolutionNote: `${REVIEW_SUPPRESSED_NOTE} ${suppressionRule.reason ?? suppressionRule.issueCode}.`,
      },
    });

    await writeActivityLog({
      entityType: "ReceiptReconciliationIssue",
      entityId: issue.id,
      action: "RECEIPT_REVIEW_SUPPRESSED",
      oldValue: issue,
      newValue: { ...issue, status: "DISMISSED", suppressedByRuleId: suppressionRule.id, reviewedAt: new Date(), reviewedById: actor.id },
      userId: actor.id,
    });

    revalidatePaths([
      "/data-quality",
      "/receipts",
      `/receipts/${issue.receipt.id}`,
      `/policies/${issue.policy.id}`,
      "/due-payments",
      "/dashboard",
      "/today",
      "/portfolio",
      "/risks",
    ]);

    return successResult(issue.id, "/data-quality?tab=pagos", "Issue suprimido.");
  } catch (error) {
    logError("data-quality.suppressReceiptReviewIssue", error);
    return errorResult(error instanceof Error ? error.message : "No se pudo suprimir el issue de recibo.");
  }
}

export async function bulkReceiptReviewIssuesAction(formData: FormData): Promise<void> {
  try {
    const actor = await requireAdmin();
    const db = getDb();
    const issueIds = parseIssueIds(formData);
    const operation = parseOperation(formData);

    if (!issueIds.length) {
      throw new Error("Selecciona al menos un issue de recibo.");
    }

    const issues = await db.receiptReconciliationIssue.findMany({
      where: { id: { in: issueIds } },
      include: {
        receipt: { select: { id: true, receiptNumber: true, policyId: true } },
        policy: { select: { id: true, policyNumber: true } },
      },
      orderBy: [{ createdAt: "asc" }],
    });

    if (!issues.length) {
      throw new Error("Los issues seleccionados ya no existen.");
    }

    if (operation === "MERGE") {
      if (issues.length < 2) {
        throw new Error("Selecciona al menos dos issues para fusionar.");
      }
      const [master, ...duplicates] = issues;
      for (const duplicate of duplicates) {
        await db.receiptReconciliationIssue.update({
          where: { id: duplicate.id },
          data: {
            status: "DISMISSED",
            duplicateOfId: master.id,
            mergedAt: new Date(),
            mergedById: actor.id,
            reviewedAt: new Date(),
            reviewedById: actor.id,
            resolutionNote: `Fusionada con ${master.reason} (${master.receipt?.receiptNumber ?? master.id}).`,
          },
        });
      }
      await writeActivityLog({
        entityType: "ReceiptReconciliationIssue",
        entityId: master.id,
        action: "RECEIPT_REVIEW_MERGED",
        oldValue: issues,
        newValue: {
          masterId: master.id,
          duplicateIds: duplicates.map((duplicate) => duplicate.id),
        },
        userId: actor.id,
      });
      revalidatePaths(["/data-quality", "/receipts", "/due-payments", "/dashboard", "/today", "/portfolio", "/risks"]);
      return;
    }

    const nextStatus =
      operation === "APPROVE" ? "RESOLVED" : operation === "DENY" ? "DISMISSED" : operation === "REOPEN" ? "OPEN" : null;
    if (!nextStatus && operation !== "SUPPRESS") {
      throw new Error("Operación de lote no válida.");
    }
    const resolvedStatus = operation === "SUPPRESS" ? "DISMISSED" : (nextStatus as "RESOLVED" | "DISMISSED" | "OPEN");

    let suppressionRuleId: string | null = null;
    if (operation === "SUPPRESS") {
      const first = issues[0];
      const rule = await upsertSuppressionRule(
        {
          category: "PAYMENTS",
          issueCode: first.reason,
          criteria: buildReceiptSuppressionCriteria(first),
          reason: `Suprimir ${first.reason} en recibos similares.`,
          actorId: actor.id,
        },
        db,
      );
      suppressionRuleId = rule.id;
    }

    for (const issue of issues) {
      await db.receiptReconciliationIssue.update({
        where: { id: issue.id },
        data: {
          status: resolvedStatus,
          suppressedByRuleId: operation === "SUPPRESS" ? suppressionRuleId : null,
          duplicateOfId: null,
          mergedAt: null,
          mergedById: null,
          reviewedAt: operation === "REOPEN" ? null : new Date(),
          reviewedById: operation === "REOPEN" ? null : actor.id,
          resolutionNote:
            operation === "APPROVE"
              ? REVIEW_APPROVED_NOTE
              : operation === "DENY"
                ? REVIEW_DENIED_NOTE
                : operation === "SUPPRESS"
                  ? `${REVIEW_SUPPRESSED_NOTE} ${issues[0].reason}.`
                  : operation === "REOPEN"
                    ? REVIEW_REOPENED_NOTE
                    : null,
        },
      });
    }

    await writeActivityLog({
      entityType: "ReceiptReconciliationIssue",
      entityId: issues[0].id,
      action: `RECEIPT_REVIEW_BULK_${operation}`,
      oldValue: issues,
      newValue: { operation, issueIds },
      userId: actor.id,
    });
    revalidatePaths(["/data-quality", "/receipts", "/due-payments", "/dashboard", "/today", "/portfolio", "/risks"]);
    return;
  } catch (error) {
    logError("data-quality.bulkReceiptReviewIssues", error);
    throw error instanceof Error ? error : new Error("No se pudo aplicar la revisión en lote de recibos.");
  }
}

export async function approveRenewalSuggestionReview(suggestionId: string): Promise<MutationResult> {
  return reviewRenewalSuggestion(suggestionId, "APPROVE");
}

export async function denyRenewalSuggestionReview(suggestionId: string): Promise<MutationResult> {
  return reviewRenewalSuggestion(suggestionId, "DENY");
}

export async function reopenRenewalSuggestionReview(suggestionId: string): Promise<MutationResult> {
  try {
    const actor = await requireAdmin();
    const db = getDb();
    const suggestion = await loadRenewalSuggestion(suggestionId);
    if (!suggestion) {
      return errorResult("La sugerencia de renovación ya no existe.");
    }

    await db.policyRenewalSuggestion.update({
      where: { id: suggestion.id },
      data: {
        status: "PENDING",
        suppressedByRuleId: null,
        duplicateOfId: null,
        mergedAt: null,
        mergedById: null,
        reviewedAt: null,
        reviewedById: null,
        resolutionNote: null,
      },
    });

    await writeActivityLog({
      entityType: "PolicyRenewalSuggestion",
      entityId: suggestion.id,
      action: "RENEWAL_REVIEW_REOPENED",
      oldValue: suggestion,
      newValue: { ...suggestion, status: "PENDING", reviewedAt: null, reviewedById: null },
      userId: actor.id,
    });

    revalidatePaths([
      "/data-quality",
      "/renewals",
      "/dashboard",
      "/today",
      "/portfolio",
      `/policies/${suggestion.sourcePolicy.id}`,
      "/risks",
    ]);

    return successResult(suggestion.id, "/data-quality?tab=renovaciones", "Sugerencia reabierta.");
  } catch (error) {
    logError("data-quality.reopenRenewalSuggestionReview", error);
    return errorResult(error instanceof Error ? error.message : "No se pudo reabrir la sugerencia de renovación.");
  }
}

export async function suppressRenewalSuggestionReview(suggestionId: string): Promise<MutationResult> {
  try {
    const actor = await requireAdmin();
    const db = getDb();
    const suggestion = await loadRenewalSuggestion(suggestionId);
    if (!suggestion) {
      return errorResult("La sugerencia de renovación ya no existe.");
    }

    const suppressionRule = await upsertSuppressionRule({
      category: "RENOVATIONS",
      issueCode: suggestion.reason ?? "RENEWAL_SUGGESTION",
      criteria: buildRenewalSuppressionCriteria(suggestion),
      reason: `Suprimir renovación para ${suggestion.sourcePolicy.policyNumber}.`,
      actorId: actor.id,
    }, db);

    await db.policyRenewalSuggestion.update({
      where: { id: suggestion.id },
      data: {
        status: "DECLINED",
        suppressedByRuleId: suppressionRule.id,
        duplicateOfId: null,
        mergedAt: null,
        mergedById: null,
        reviewedAt: new Date(),
        reviewedById: actor.id,
        resolutionNote: `${REVIEW_SUPPRESSED_NOTE} ${suppressionRule.reason ?? suppressionRule.issueCode}.`,
      },
    });

    await writeActivityLog({
      entityType: "PolicyRenewalSuggestion",
      entityId: suggestion.id,
      action: "RENEWAL_REVIEW_SUPPRESSED",
      oldValue: suggestion,
      newValue: { ...suggestion, status: "DECLINED", suppressedByRuleId: suppressionRule.id, reviewedAt: new Date(), reviewedById: actor.id },
      userId: actor.id,
    });

    revalidatePaths([
      "/data-quality",
      "/renewals",
      "/dashboard",
      "/today",
      "/portfolio",
      `/policies/${suggestion.sourcePolicy.id}`,
      "/risks",
    ]);

    return successResult(suggestion.id, "/data-quality?tab=renovaciones", "Sugerencia suprimida.");
  } catch (error) {
    logError("data-quality.suppressRenewalSuggestionReview", error);
    return errorResult(error instanceof Error ? error.message : "No se pudo suprimir la sugerencia de renovación.");
  }
}

export async function bulkRenewalSuggestionReviewsAction(formData: FormData): Promise<void> {
  try {
    const actor = await requireAdmin();
    const db = getDb();
    const suggestionIds = parseIssueIds(formData);
    const operation = parseOperation(formData);

    if (!suggestionIds.length) {
      throw new Error("Selecciona al menos una sugerencia.");
    }

    const suggestions = await db.policyRenewalSuggestion.findMany({
      where: { id: { in: suggestionIds } },
      include: {
        sourcePolicy: { select: { id: true, policyNumber: true } },
      },
      orderBy: [{ createdAt: "asc" }],
    });

    if (!suggestions.length) {
      throw new Error("Las sugerencias seleccionadas ya no existen.");
    }

    if (operation === "MERGE") {
      if (suggestions.length < 2) {
        throw new Error("Selecciona al menos dos sugerencias para fusionar.");
      }
      const [master, ...duplicates] = suggestions;
      for (const duplicate of duplicates) {
        await db.policyRenewalSuggestion.update({
          where: { id: duplicate.id },
          data: {
            status: "DECLINED",
            duplicateOfId: master.id,
            mergedAt: new Date(),
            mergedById: actor.id,
            reviewedAt: new Date(),
            reviewedById: actor.id,
            resolutionNote: `Fusionada con ${master.sourcePolicy.policyNumber}.`,
          },
        });
      }
      await writeActivityLog({
        entityType: "PolicyRenewalSuggestion",
        entityId: master.id,
        action: "RENEWAL_REVIEW_MERGED",
        oldValue: suggestions,
        newValue: { masterId: master.id, duplicateIds: duplicates.map((duplicate) => duplicate.id) },
        userId: actor.id,
      });
      revalidatePaths(["/data-quality", "/renewals", "/dashboard", "/today", "/portfolio", "/risks"]);
      return;
    }

    const nextStatus =
      operation === "APPROVE" ? "RESOLVED" : operation === "DENY" ? "DECLINED" : operation === "REOPEN" ? "PENDING" : null;
    if (!nextStatus && operation !== "SUPPRESS") {
      throw new Error("Operación de lote no válida.");
    }
    const resolvedStatus = operation === "SUPPRESS" ? "DECLINED" : (nextStatus as "RESOLVED" | "DECLINED" | "PENDING");

    let suppressionRuleId: string | null = null;
    if (operation === "SUPPRESS") {
      const first = suggestions[0];
      const rule = await upsertSuppressionRule(
        {
          category: "RENOVATIONS",
          issueCode: first.reason ?? "RENEWAL_SUGGESTION",
          criteria: buildRenewalSuppressionCriteria(first),
          reason: `Suprimir renovación para ${first.sourcePolicy.policyNumber}.`,
          actorId: actor.id,
        },
        db,
      );
      suppressionRuleId = rule.id;
    }

    for (const suggestion of suggestions) {
      await db.policyRenewalSuggestion.update({
        where: { id: suggestion.id },
        data: {
          status: resolvedStatus,
          suppressedByRuleId: operation === "SUPPRESS" ? suppressionRuleId : null,
          duplicateOfId: null,
          mergedAt: null,
          mergedById: null,
          reviewedAt: operation === "REOPEN" ? null : new Date(),
          reviewedById: operation === "REOPEN" ? null : actor.id,
          resolutionNote:
            operation === "APPROVE"
              ? REVIEW_APPROVED_NOTE
              : operation === "DENY"
                ? REVIEW_DENIED_NOTE
                : operation === "SUPPRESS"
                  ? `${REVIEW_SUPPRESSED_NOTE} ${suggestions[0].sourcePolicy.policyNumber}.`
                  : operation === "REOPEN"
                    ? REVIEW_REOPENED_NOTE
                    : null,
        },
      });
    }

    await writeActivityLog({
      entityType: "PolicyRenewalSuggestion",
      entityId: suggestions[0].id,
      action: `RENEWAL_REVIEW_BULK_${operation}`,
      oldValue: suggestions,
      newValue: { operation, suggestionIds },
      userId: actor.id,
    });
    revalidatePaths(["/data-quality", "/renewals", "/dashboard", "/today", "/portfolio", "/risks"]);
    return;
  } catch (error) {
    logError("data-quality.bulkRenewalSuggestionReviews", error);
    throw error instanceof Error ? error : new Error("No se pudo aplicar la revisión en lote de renovaciones.");
  }
}

export async function approveLedgerIssue(issueId: string): Promise<MutationResult> {
  return reviewLedgerIssue(issueId, "APPROVE");
}

export async function denyLedgerIssue(issueId: string): Promise<MutationResult> {
  return reviewLedgerIssue(issueId, "DENY");
}

export async function reopenLedgerIssue(issueId: string): Promise<MutationResult> {
  try {
    const actor = await requireAdmin();
    const db = getDb();
    const issue = await loadLedgerIssue(issueId);
    if (!issue) {
      return errorResult("El issue de ledger ya no existe.");
    }

    await db.ledgerImportIssue.update({
      where: { id: issue.id },
      data: {
        status: "OPEN",
        suppressedByRuleId: null,
        duplicateOfId: null,
        mergedAt: null,
        mergedById: null,
        reviewedAt: null,
        reviewedById: null,
        resolutionNote: null,
      },
    });

    await writeActivityLog({
      entityType: "LedgerImportIssue",
      entityId: issue.id,
      action: "LEDGER_ISSUE_REOPENED",
      oldValue: issue,
      newValue: { ...issue, status: "OPEN", reviewedAt: null, reviewedById: null },
      userId: actor.id,
    });

    revalidatePaths(["/data-quality", "/dashboard", "/today", "/portfolio", "/risks"]);

    return successResult(issue.id, "/data-quality?tab=ledger", "Issue reabierto.");
  } catch (error) {
    logError("data-quality.reopenLedgerIssue", error);
    return errorResult(error instanceof Error ? error.message : "No se pudo reabrir el issue de ledger.");
  }
}

export async function suppressLedgerIssue(issueId: string): Promise<MutationResult> {
  try {
    const actor = await requireAdmin();
    const db = getDb();
    const issue = await loadLedgerIssue(issueId);
    if (!issue) {
      return errorResult("El issue de ledger ya no existe.");
    }

    const suppressionRule = await upsertSuppressionRule({
      category: "LEDGER",
      issueCode: issue.issueType,
      criteria: buildLedgerSuppressionCriteria(issue),
      reason: `Suprimir issue ${issue.issueType} del batch ${issue.batch.sourceCsvName}.`,
      actorId: actor.id,
    }, db);

    await db.ledgerImportIssue.update({
      where: { id: issue.id },
      data: {
        status: "DISMISSED",
        suppressedByRuleId: suppressionRule.id,
        duplicateOfId: null,
        mergedAt: null,
        mergedById: null,
        reviewedAt: new Date(),
        reviewedById: actor.id,
        resolutionNote: `${REVIEW_SUPPRESSED_NOTE} ${suppressionRule.reason ?? suppressionRule.issueCode}.`,
      },
    });

    await writeActivityLog({
      entityType: "LedgerImportIssue",
      entityId: issue.id,
      action: "LEDGER_ISSUE_SUPPRESSED",
      oldValue: issue,
      newValue: { ...issue, status: "DISMISSED", suppressedByRuleId: suppressionRule.id, reviewedAt: new Date(), reviewedById: actor.id },
      userId: actor.id,
    });

    revalidatePaths(["/data-quality", "/dashboard", "/today", "/portfolio", "/risks"]);

    return successResult(issue.id, "/data-quality?tab=ledger", "Issue suprimido.");
  } catch (error) {
    logError("data-quality.suppressLedgerIssue", error);
    return errorResult(error instanceof Error ? error.message : "No se pudo suprimir el issue de ledger.");
  }
}

export async function bulkLedgerIssuesAction(formData: FormData): Promise<void> {
  try {
    const actor = await requireAdmin();
    const db = getDb();
    const issueIds = parseIssueIds(formData);
    const operation = parseOperation(formData);

    if (!issueIds.length) {
      throw new Error("Selecciona al menos un issue de ledger.");
    }

    const issues = await db.ledgerImportIssue.findMany({
      where: { id: { in: issueIds } },
      include: {
        batch: { select: { id: true, sourceCsvName: true, sourcePaidName: true } },
        row: { select: { id: true, rowNumber: true, sourceType: true, sourceKey: true } },
      },
      orderBy: [{ createdAt: "asc" }],
    });

    if (!issues.length) {
      throw new Error("Los issues seleccionados ya no existen.");
    }

    if (operation === "MERGE") {
      if (issues.length < 2) {
        throw new Error("Selecciona al menos dos issues para fusionar.");
      }
      const [master, ...duplicates] = issues;
      for (const duplicate of duplicates) {
        await db.ledgerImportIssue.update({
          where: { id: duplicate.id },
          data: {
            status: "DISMISSED",
            duplicateOfId: master.id,
            mergedAt: new Date(),
            mergedById: actor.id,
            reviewedAt: new Date(),
            reviewedById: actor.id,
            resolutionNote: `Fusionado con ${master.issueType} (${master.batch.sourceCsvName}).`,
          },
        });
      }
      await writeActivityLog({
        entityType: "LedgerImportIssue",
        entityId: master.id,
        action: "LEDGER_ISSUE_MERGED",
        oldValue: issues,
        newValue: { masterId: master.id, duplicateIds: duplicates.map((duplicate) => duplicate.id) },
        userId: actor.id,
      });
      revalidatePaths(["/data-quality", "/dashboard", "/today", "/portfolio", "/risks"]);
      return;
    }

    const nextStatus =
      operation === "APPROVE" ? "RESOLVED" : operation === "DENY" ? "DISMISSED" : operation === "REOPEN" ? "OPEN" : null;
    if (!nextStatus && operation !== "SUPPRESS") {
      throw new Error("Operación de lote no válida.");
    }
    const resolvedStatus = operation === "SUPPRESS" ? "DISMISSED" : (nextStatus as "RESOLVED" | "DISMISSED" | "OPEN");

    let suppressionRuleId: string | null = null;
    if (operation === "SUPPRESS") {
      const first = issues[0];
      const rule = await upsertSuppressionRule(
        {
          category: "LEDGER",
          issueCode: first.issueType,
          criteria: buildLedgerSuppressionCriteria(first),
          reason: `Suprimir issue ${first.issueType} de ledger.`,
          actorId: actor.id,
        },
        db,
      );
      suppressionRuleId = rule.id;
    }

    for (const issue of issues) {
      await db.ledgerImportIssue.update({
        where: { id: issue.id },
        data: {
          status: resolvedStatus,
          suppressedByRuleId: operation === "SUPPRESS" ? suppressionRuleId : null,
          duplicateOfId: null,
          mergedAt: null,
          mergedById: null,
          reviewedAt: operation === "REOPEN" ? null : new Date(),
          reviewedById: operation === "REOPEN" ? null : actor.id,
          resolutionNote:
            operation === "APPROVE"
              ? REVIEW_APPROVED_NOTE
              : operation === "DENY"
                ? REVIEW_DENIED_NOTE
                : operation === "SUPPRESS"
                  ? `${REVIEW_SUPPRESSED_NOTE} ${issues[0].issueType}.`
                  : operation === "REOPEN"
                    ? REVIEW_REOPENED_NOTE
                    : null,
        },
      });
    }

    await writeActivityLog({
      entityType: "LedgerImportIssue",
      entityId: issues[0].id,
      action: `LEDGER_ISSUE_BULK_${operation}`,
      oldValue: issues,
      newValue: { operation, issueIds },
      userId: actor.id,
    });
    revalidatePaths(["/data-quality", "/dashboard", "/today", "/portfolio", "/risks"]);
    return;
  } catch (error) {
    logError("data-quality.bulkLedgerIssues", error);
    throw error instanceof Error ? error : new Error("No se pudo aplicar la revisión en lote de ledger.");
  }
}

export async function runVigencyAuditAction(): Promise<MutationResult> {
  try {
    const actor = await requireAdmin();
    const { summary } = await runPolicyVigencyAudit({ actorId: actor.id });

    revalidatePath("/data-quality");
    revalidatePath("/receipts");
    revalidatePath("/renewals");
    revalidatePath("/policies");
    revalidatePath("/dashboard");
    revalidatePath("/risks");

    return successResult(
      "vigency-audit",
      "/data-quality",
      `Auditoría ejecutada: ${summary.familiesReviewed} familias revisadas y ${summary.receiptsReconciled} recibos reconciliados.`,
    );
  } catch (error) {
    logError("data-quality.runVigencyAudit", error);
    return errorResult("No se pudo ejecutar la auditoría de vigencias.");
  }
}

export async function runPaymentAuditAction(): Promise<MutationResult> {
  try {
    const actor = await requireAdmin();
    const { summary } = await runPaymentReconciliationAudit({ actorId: actor.id });

    revalidatePath("/data-quality");
    revalidatePath("/receipts");
    revalidatePath("/renewals");
    revalidatePath("/policies");
    revalidatePath("/dashboard");
    revalidatePath("/risks");

    return successResult(
      "payment-audit",
      "/data-quality",
      `Auditoría de pagos ejecutada: ${summary.receiptsScanned} recibos revisados y ${summary.receiptsFlaggedForReview} casos enviados a revisión.`,
    );
  } catch (error) {
    logError("data-quality.runPaymentAudit", error);
    return errorResult("No se pudo ejecutar la auditoría de pagos.");
  }
}

export async function previewLedgerImportAction(formData: FormData): Promise<void> {
  let batchId: string | null = null;
  try {
    const actor = await requireAdmin();
    const csvFile = formData.get("ledgerCsv");
    const paidFile = formData.get("ledgerPaid");

    if (!(csvFile instanceof File) || !(paidFile instanceof File)) {
      throw new Error("Sube el CSV de pólizas y el XLS de pagos para generar el preview.");
    }

    const csvBuffer = Buffer.from(await csvFile.arrayBuffer());
    const paidBuffer = Buffer.from(await paidFile.arrayBuffer());

    const result = await createLedgerImportPreview({
      actorId: actor.id,
      csvName: csvFile.name,
      csvBuffer,
      paidName: paidFile.name,
      paidBuffer,
    });
    batchId = result.batchId;

    await writeActivityLog({
      entityType: "LedgerImportBatch",
      entityId: result.batchId,
      action: "LEDGER_IMPORT_PREVIEW_CREATED",
      newValue: result.summary,
      userId: actor.id,
    });

    revalidatePath("/data-quality");
  } catch (error) {
    logError("data-quality.previewLedgerImport", error);
    throw new Error("No se pudo generar el preview del ledger.");
  }

  if (batchId) {
    redirect(`/data-quality?ledgerBatch=${batchId}`);
  }

  throw new Error("No se pudo generar el preview del ledger.");
}

export async function applyLedgerImportBatchAction(formData: FormData): Promise<void> {
  let redirectTo: string | null = null;
  try {
    const actor = await requireAdmin();
    const batchId = String(formData.get("batchId") ?? "");

    if (!batchId) {
      throw new Error("Selecciona un batch válido.");
    }

    const result = await applyLedgerImportBatch({
      actorId: actor.id,
      batchId,
    });

    revalidatePath("/data-quality");
    revalidatePath("/receipts");
    revalidatePath("/dashboard");
    revalidatePath("/today");
    revalidatePath("/portfolio");
    revalidatePath("/risks");

    redirectTo = `/data-quality?ledgerBatch=${result.batchId}`;
  } catch (error) {
    logError("data-quality.applyLedgerImportBatch", error);
    throw new Error(error instanceof Error ? error.message : "No se pudo aplicar el batch del ledger.");
  }

  if (redirectTo) {
    redirect(redirectTo);
  }
}
