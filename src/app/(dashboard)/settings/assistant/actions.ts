"use server";

import { requireAdmin } from "@/lib/auth";
import {
  archiveAssistantReport,
  closeAssistantReport,
  deleteAssistantReport,
  reopenAssistantReport,
} from "@/lib/assistant-reports";
import { errorResult, revalidatePaths, successResult, type MutationResult } from "@/lib/mutation-utils";
import { logError } from "@/lib/logger";

export async function closeAssistantReportAction(reportId: string): Promise<MutationResult> {
  try {
    const actor = await requireAdmin();
    await closeAssistantReport(reportId, actor.id);
    revalidatePaths(["/settings", "/settings/assistant", "/assistant"]);
    return successResult(reportId, "/settings/assistant", "Reporte cerrado.");
  } catch (error) {
    logError("settings.assistant.closeReport", error);
    return errorResult(error instanceof Error ? error.message : "No se pudo cerrar el reporte.");
  }
}

export async function archiveAssistantReportAction(reportId: string): Promise<MutationResult> {
  try {
    const actor = await requireAdmin();
    await archiveAssistantReport(reportId, actor.id);
    revalidatePaths(["/settings", "/settings/assistant", "/assistant"]);
    return successResult(reportId, "/settings/assistant", "Reporte archivado.");
  } catch (error) {
    logError("settings.assistant.archiveReport", error);
    return errorResult(error instanceof Error ? error.message : "No se pudo archivar el reporte.");
  }
}

export async function reopenAssistantReportAction(reportId: string): Promise<MutationResult> {
  try {
    const actor = await requireAdmin();
    await reopenAssistantReport(reportId, actor.id);
    revalidatePaths(["/settings", "/settings/assistant", "/assistant"]);
    return successResult(reportId, "/settings/assistant", "Reporte reabierto.");
  } catch (error) {
    logError("settings.assistant.reopenReport", error);
    return errorResult(error instanceof Error ? error.message : "No se pudo reabrir el reporte.");
  }
}

export async function deleteAssistantReportAction(reportId: string): Promise<MutationResult> {
  try {
    const actor = await requireAdmin();
    await deleteAssistantReport(reportId, actor.id);
    revalidatePaths(["/settings", "/settings/assistant", "/assistant"]);
    return successResult(reportId, "/settings/assistant", "Reporte eliminado.");
  } catch (error) {
    logError("settings.assistant.deleteReport", error);
    return errorResult(error instanceof Error ? error.message : "No se pudo eliminar el reporte.");
  }
}
