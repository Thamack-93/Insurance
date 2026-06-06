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

const REVIEW_APPROVED_NOTE = "Aprobado desde Data Quality.";
const REVIEW_DENIED_NOTE = "Denegado desde Data Quality.";

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

export async function approveRenewalSuggestionReview(suggestionId: string): Promise<MutationResult> {
  return reviewRenewalSuggestion(suggestionId, "APPROVE");
}

export async function denyRenewalSuggestionReview(suggestionId: string): Promise<MutationResult> {
  return reviewRenewalSuggestion(suggestionId, "DENY");
}

export async function approveLedgerIssue(issueId: string): Promise<MutationResult> {
  return reviewLedgerIssue(issueId, "APPROVE");
}

export async function denyLedgerIssue(issueId: string): Promise<MutationResult> {
  return reviewLedgerIssue(issueId, "DENY");
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
