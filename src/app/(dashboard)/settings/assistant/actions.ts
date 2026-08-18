"use server";

import { requireOrganizationRole } from "@/lib/organization-context";
import {
  archiveAssistantReport,
  closeAssistantReport,
  deleteAssistantReport,
  reopenAssistantReport,
} from "@/lib/assistant-reports";
import { errorResult, revalidatePaths, successResult, type MutationResult } from "@/lib/mutation-utils";
import { logError } from "@/lib/logger";
import { archiveInternalKnowledgeSource, activateInternalKnowledgeSource, createInternalKnowledgeSource } from "@/lib/knowledge-base";

export async function closeAssistantReportAction(reportId: string): Promise<MutationResult> {
  try {
    const actor = await requireOrganizationRole(["OWNER", "ADMIN"]);
    await closeAssistantReport(reportId, actor.organizationId, actor.userId);
    revalidatePaths(["/settings", "/settings/assistant", "/assistant"]);
    return successResult(reportId, "/settings/assistant", "Reporte cerrado.");
  } catch (error) {
    logError("settings.assistant.closeReport", error);
    return errorResult(error instanceof Error ? error.message : "No se pudo cerrar el reporte.");
  }
}

export async function archiveAssistantReportAction(reportId: string): Promise<MutationResult> {
  try {
    const actor = await requireOrganizationRole(["OWNER", "ADMIN"]);
    await archiveAssistantReport(reportId, actor.organizationId, actor.userId);
    revalidatePaths(["/settings", "/settings/assistant", "/assistant"]);
    return successResult(reportId, "/settings/assistant", "Reporte archivado.");
  } catch (error) {
    logError("settings.assistant.archiveReport", error);
    return errorResult(error instanceof Error ? error.message : "No se pudo archivar el reporte.");
  }
}

export async function reopenAssistantReportAction(reportId: string): Promise<MutationResult> {
  try {
    const actor = await requireOrganizationRole(["OWNER", "ADMIN"]);
    await reopenAssistantReport(reportId, actor.organizationId, actor.userId);
    revalidatePaths(["/settings", "/settings/assistant", "/assistant"]);
    return successResult(reportId, "/settings/assistant", "Reporte reabierto.");
  } catch (error) {
    logError("settings.assistant.reopenReport", error);
    return errorResult(error instanceof Error ? error.message : "No se pudo reabrir el reporte.");
  }
}

export async function deleteAssistantReportAction(reportId: string): Promise<MutationResult> {
  try {
    const actor = await requireOrganizationRole(["OWNER", "ADMIN"]);
    await deleteAssistantReport(reportId, actor.organizationId, actor.userId);
    revalidatePaths(["/settings", "/settings/assistant", "/assistant"]);
    return successResult(reportId, "/settings/assistant", "Reporte eliminado.");
  } catch (error) {
    logError("settings.assistant.deleteReport", error);
    return errorResult(error instanceof Error ? error.message : "No se pudo eliminar el reporte.");
  }
}

export async function createKnowledgeSourceAction(formData: FormData): Promise<void> {
  try {
    const context = await requireOrganizationRole(["OWNER", "ADMIN"]);
    await createInternalKnowledgeSource({
      context,
      title: String(formData.get("title") ?? ""),
      insurerName: String(formData.get("insurerName") ?? "").trim() || null,
      product: String(formData.get("product") ?? "").trim() || null,
      version: String(formData.get("version") ?? ""),
      content: String(formData.get("content") ?? ""),
      status: "DRAFT",
    });
    revalidatePaths(["/settings/assistant"]);
  } catch (error) {
    logError("settings.assistant.createKnowledgeSource", error);
    throw error;
  }
}

export async function activateKnowledgeSourceAction(sourceId: string): Promise<void> {
  try {
    const context = await requireOrganizationRole(["OWNER", "ADMIN"]);
    await activateInternalKnowledgeSource(context, sourceId);
    revalidatePaths(["/settings/assistant"]);
  } catch (error) {
    logError("settings.assistant.activateKnowledgeSource", error);
    throw error;
  }
}

export async function archiveKnowledgeSourceAction(sourceId: string): Promise<void> {
  try {
    const context = await requireOrganizationRole(["OWNER", "ADMIN"]);
    await archiveInternalKnowledgeSource(context, sourceId);
    revalidatePaths(["/settings/assistant"]);
  } catch (error) {
    logError("settings.assistant.archiveKnowledgeSource", error);
    throw error;
  }
}
