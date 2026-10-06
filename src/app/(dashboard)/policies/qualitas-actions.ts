"use server";

import { AuthError } from "@/lib/auth";
import { checkDistributedRateLimit, securityFingerprint } from "@/lib/request-guards";
import { logError } from "@/lib/logger";
import { requireOrganizationContext } from "@/lib/organization-context";
import { revalidatePaths, successResult, errorResult, type MutationResult } from "@/lib/mutation-utils";
import {
  checkQualitasReceiptStatus,
  confirmQualitasDetectedPayment,
  isQualitasReceiptMonitorEnabled,
  setQualitasReceiptMonitor,
  type ManualQualitasReceiptCheck,
} from "@/lib/qualitas-receipt-monitor";

export type QualitasReceiptCheckResult =
  | { ok: true; result: ManualQualitasReceiptCheck }
  | { ok: false; error: string };

export async function checkQualitasReceipt(policyId: string): Promise<QualitasReceiptCheckResult> {
  if (!policyId?.trim()) return { ok: false, error: "Selecciona una póliza válida." };
  try {
    const context = await requireOrganizationContext();
    if (!isQualitasReceiptMonitorEnabled()) return { ok: false, error: "La consulta de recibos Quálitas aún no está habilitada." };
    const limited = await checkDistributedRateLimit(
      `qualitas-receipt-check:${securityFingerprint(context.organizationId)}:${securityFingerprint(policyId)}`,
      { limit: 1, windowMs: 60_000, requireDistributed: true },
    );
    if (!limited.allowed) return { ok: false, error: "Espera un minuto antes de volver a consultar esta póliza." };
    const result = await checkQualitasReceiptStatus(policyId, context);
    return { ok: true, result };
  } catch (error) {
    logError("policies.checkQualitasReceipt", error);
    if (error instanceof AuthError) return { ok: false, error: "No tienes acceso a esta póliza." };
    if (error instanceof Error) {
      if (error.message === "QUALITAS_RECEIPT_MONITOR_DISABLED") return { ok: false, error: "El monitoreo de recibos Quálitas no está habilitado para esta organización." };
      if (error.message === "QUALITAS_POLICY_NOT_AVAILABLE") return { ok: false, error: "La póliza no es elegible para la consulta Quálitas." };
      if (error.message === "QUALITAS_NO_OPEN_RECEIPTS") return { ok: false, error: "La póliza no tiene recibos abiertos para comparar." };
    }
    return { ok: false, error: "No se pudo consultar Quálitas. El recibo queda sin cambios." };
  }
}

export async function confirmQualitasReceiptPayment(observationId: string): Promise<MutationResult> {
  if (!observationId?.trim()) return errorResult("No encontramos una consulta válida para confirmar.");
  try {
    const context = await requireOrganizationContext();
    const result = await confirmQualitasDetectedPayment(observationId, context);
    revalidatePaths(["/payments", "/receipts", `/receipts/${result.receiptId}`, "/policies", "/today"]);
    return successResult(result.paymentId, `/receipts/${result.receiptId}`, "Pago domiciliado registrado.");
  } catch (error) {
    logError("policies.confirmQualitasReceiptPayment", error);
    return errorResult(error instanceof Error && error.message === "QUALITAS_RECEIPT_STATE_CHANGED"
      ? "El recibo cambió desde la consulta. Vuelve a verificarlo antes de registrar el pago."
      : "No se pudo registrar el pago domiciliado. El recibo permanece sin cambios.");
  }
}

export async function configureQualitasReceiptMonitor(policyId: string, enabled: boolean): Promise<MutationResult> {
  if (!policyId?.trim()) return errorResult("Selecciona una póliza válida.");
  try {
    const context = await requireOrganizationContext();
    const result = await setQualitasReceiptMonitor(policyId, Boolean(enabled), context);
    revalidatePaths([`/policies/${policyId}`]);
    return successResult(policyId, `/policies/${policyId}`, result.enabled ? "Monitoreo diario activado." : "Monitoreo diario desactivado.");
  } catch (error) {
    logError("policies.configureQualitasReceiptMonitor", error);
    if (error instanceof AuthError) return errorResult("No tienes acceso a esta póliza.");
    if (error instanceof Error && error.message === "QUALITAS_MANUAL_VALIDATION_REQUIRED") return errorResult("Primero consulta el portal manualmente y valida el resultado para esta póliza.");
    return errorResult("No se pudo actualizar el monitoreo de recibos Quálitas.");
  }
}
