"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { writeActivityLog } from "@/lib/activity-log";
import { errorResult, successResult, type MutationResult } from "@/lib/mutation-utils";
import { logError } from "@/lib/logger";
import { applyLedgerImportBatch, createLedgerImportPreview } from "@/lib/ledger-import";
import { runPolicyVigencyAudit } from "@/lib/vigency-maintenance";
import { runPaymentReconciliationAudit } from "@/lib/payment-maintenance";

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
