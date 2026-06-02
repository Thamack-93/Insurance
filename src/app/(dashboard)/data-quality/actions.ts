"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { errorResult, successResult, type MutationResult } from "@/lib/mutation-utils";
import { logError } from "@/lib/logger";
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
