"use server";

import { revalidatePath } from "next/cache";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { get } from "@vercel/blob";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { extractBrokerComparisonWithAi } from "@/lib/assistant-ai";
import { writeActivityLog } from "@/lib/activity-log";
import { areDocumentFilesEnabled } from "@/lib/deployment";
import { assertSafeDocumentPath } from "@/lib/files";
import { assertOrganizationContextInTransaction, requireOrganizationContext, withTenantTransaction } from "@/lib/organization-context";
import { resolveOrganizationCapability } from "@/lib/organization-capabilities";
import { extractPdfTextFromBytes } from "@/lib/pdf-text-extraction";
import {
  BROKER_COMPARISON_PILOT_LABEL,
  brokerComparisonExtractionSchema,
  type BrokerComparisonExtraction,
  type SavedBrokerComparisonExtraction,
  withSavedBrokerComparisonExtraction,
} from "@/lib/broker-comparison-pdf.shared";

export type BrokerComparisonActionResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; error: string };

const documentIdSchema = z.string().trim().min(1).max(100);
const confirmInputSchema = z.object({
  documentId: documentIdSchema,
  expectedVersion: z.number().int().positive(),
  extraction: brokerComparisonExtractionSchema,
});

type BrokerComparisonDocument = {
  id: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  documentType: string;
  version: number;
  metadataJson: string | null;
  quoteId: string | null;
};

async function getAuthorizedBrokerComparisonDocument(id: string, expectedVersion?: number) {
  const context = await requireOrganizationContext();
  const user = await requireUser();
  const document = await withTenantTransaction(context, async (tx) => {
    await assertOrganizationContextInTransaction(tx, context);
    const [organization, documentCapability, aiCapability] = await Promise.all([
      tx.organization.findUnique({ where: { id: context.organizationId }, select: { kind: true } }),
      resolveOrganizationCapability(context.organizationId, "DOCUMENTS", tx),
      resolveOrganizationCapability(context.organizationId, "NORA", tx),
    ]);
    if (organization?.kind === "DEMO") throw new Error("DEMO_DISABLED");
    if (!areDocumentFilesEnabled() || !documentCapability.enabled) throw new Error("DOCUMENTS_DISABLED");
    if (!aiCapability.enabled) throw new Error("AI_CAPABILITY_DISABLED");

    const row = await tx.document.findFirst({
      where: {
        id,
        organizationId: context.organizationId,
        mimeType: "application/pdf",
        documentType: "QUOTE",
        quoteId: { not: null },
        ...(expectedVersion ? { version: expectedVersion } : {}),
        ...(context.membershipRole === "AGENT" ? { quote: { client: { portfolioOwnerId: context.userId } } } : {}),
      },
      select: { id: true, fileName: true, filePath: true, mimeType: true, documentType: true, version: true, metadataJson: true, quoteId: true },
    });
    if (!row) throw new Error(expectedVersion ? "DOCUMENT_CHANGED" : "DOCUMENT_NOT_AVAILABLE");
    if (row.filePath.startsWith("demo://")) throw new Error("DEMO_FILE_UNAVAILABLE");
    return row as BrokerComparisonDocument;
  });

  return {
    context,
    user: {
      id: user.id,
      role: context.membershipRole === "AGENT" ? "AGENT" as const : "ADMIN" as const,
      organizationId: context.organizationId,
    },
    document,
  };
}

async function readStoredPdf(filePath: string) {
  if (filePath.startsWith("blob:")) {
    if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) throw new Error("DOCUMENT_STORAGE_UNAVAILABLE");
    const blob = await get(filePath.slice("blob:".length), { access: "private", useCache: false });
    if (!blob) throw new Error("DOCUMENT_FILE_NOT_FOUND");
    return new Uint8Array(await new Response(blob.stream).arrayBuffer());
  }
  if (filePath.startsWith("demo://")) throw new Error("DEMO_FILE_UNAVAILABLE");
  const safePath = assertSafeDocumentPath(path.resolve(filePath));
  return new Uint8Array(await readFile(safePath));
}

function actionError(error: unknown): BrokerComparisonActionResult<never> {
  const code = error instanceof Error ? error.message : "UNKNOWN";
  if (code === "DEMO_DISABLED" || code === "DOCUMENTS_DISABLED" || code === "DEMO_FILE_UNAVAILABLE" || code === "AI_CAPABILITY_DISABLED") {
    return { ok: false, code, error: "La extracción de comparaciones no está habilitada para esta organización." };
  }
  if (code === "DOCUMENT_CHANGED") return { ok: false, code, error: "El documento cambió durante la revisión. Actualiza la página y vuelve a revisar." };
  if (code === "DOCUMENT_NOT_AVAILABLE") return { ok: false, code, error: "El PDF ya no está disponible en tu cartera." };
  if (code === "NO_TEXT") return { ok: false, code, error: "El PDF no contiene texto extraíble. Los documentos escaneados no se procesan en este piloto." };
  if (code === "AI_UNAVAILABLE") return { ok: false, code, error: "La extracción asistida no está disponible. No se guardó ningún resultado; puedes intentar más tarde." };
  if (code === "DOCUMENT_STORAGE_UNAVAILABLE" || code === "DOCUMENT_FILE_NOT_FOUND") return { ok: false, code, error: "El PDF original no está disponible para analizar." };
  return { ok: false, code: "ANALYSIS_FAILED", error: "No se pudo analizar el PDF. No se guardó ningún resultado." };
}

export async function extractBrokerComparisonDocument(
  documentIdInput: string,
): Promise<BrokerComparisonActionResult<{ documentId: string; documentVersion: number; extraction: BrokerComparisonExtraction; pilotLabel: string }>> {
  const id = documentIdSchema.safeParse(documentIdInput);
  if (!id.success) return { ok: false, code: "INVALID_DOCUMENT", error: "El documento no es válido." };

  try {
    const { document, user } = await getAuthorizedBrokerComparisonDocument(id.data);
    const bytes = await readStoredPdf(document.filePath);
    const extractedText = await extractPdfTextFromBytes(bytes);
    if (!extractedText.text.trim()) throw new Error("NO_TEXT");

    const reviewed = await extractBrokerComparisonWithAi({ user, text: extractedText.text });
    if (!reviewed.value) throw new Error("AI_UNAVAILABLE");
    return {
      ok: true,
      value: {
        documentId: document.id,
        documentVersion: document.version,
        extraction: reviewed.value,
        pilotLabel: BROKER_COMPARISON_PILOT_LABEL,
      },
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function confirmBrokerComparisonExtraction(
  input: unknown,
): Promise<BrokerComparisonActionResult<{ documentId: string; version: number; saved: SavedBrokerComparisonExtraction; pilotLabel: string }>> {
  const parsed = confirmInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "INVALID_REVIEW", error: "Revisa los campos antes de confirmar." };

  try {
    const { context, user, document } = await getAuthorizedBrokerComparisonDocument(parsed.data.documentId, parsed.data.expectedVersion);
    const confirmedAt = new Date().toISOString();
    const saved: SavedBrokerComparisonExtraction = {
      ...parsed.data.extraction,
      version: 1,
      status: "REVIEWED",
      sourceDocumentId: document.id,
      confirmedAt,
      confirmedById: user.id,
      pilotLabel: BROKER_COMPARISON_PILOT_LABEL,
    };
    const nextMetadata = withSavedBrokerComparisonExtraction(document.metadataJson, saved);
    if (nextMetadata.length > 32_000) return { ok: false, code: "REVIEW_TOO_LARGE", error: "La revisión es demasiado extensa para guardarla." };

    await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const [organization, documentCapability, aiCapability] = await Promise.all([
        tx.organization.findUnique({ where: { id: context.organizationId }, select: { kind: true } }),
        resolveOrganizationCapability(context.organizationId, "DOCUMENTS", tx),
        resolveOrganizationCapability(context.organizationId, "NORA", tx),
      ]);
      if (organization?.kind === "DEMO" || !documentCapability.enabled || !aiCapability.enabled || !areDocumentFilesEnabled()) throw new Error("DOCUMENTS_DISABLED");
      const current = await tx.document.findFirst({
        where: {
          id: document.id,
          organizationId: context.organizationId,
          mimeType: "application/pdf",
          documentType: "QUOTE",
          quoteId: document.quoteId,
          version: parsed.data.expectedVersion,
          ...(context.membershipRole === "AGENT" ? { quote: { client: { portfolioOwnerId: context.userId } } } : {}),
        },
        select: { id: true, metadataJson: true, quoteId: true },
      });
      if (!current) throw new Error("DOCUMENT_CHANGED");
      const preservedMetadata = withSavedBrokerComparisonExtraction(current.metadataJson, saved);
      const updated = await tx.document.updateMany({
        where: {
          id: current.id,
          organizationId: context.organizationId,
          mimeType: "application/pdf",
          documentType: "QUOTE",
          quoteId: current.quoteId,
          version: parsed.data.expectedVersion,
          metadataJson: current.metadataJson,
          ...(context.membershipRole === "AGENT" ? { quote: { client: { portfolioOwnerId: context.userId } } } : {}),
        },
        data: { metadataJson: preservedMetadata, version: { increment: 1 }, updatedById: context.userId },
      });
      if (updated.count !== 1) throw new Error("DOCUMENT_CHANGED");
      await writeActivityLog({
        organizationId: context.organizationId,
        entityType: "Document",
        entityId: current.id,
        action: "BROKER_COMPARISON_EXTRACTION_CONFIRMED",
        newValue: { optionCount: parsed.data.extraction.draft.options.length, fieldCount: 5, sourceQuoteId: current.quoteId },
        userId: context.userId,
        db: tx,
      });
    });

    revalidatePath("/documents");
    return { ok: true, value: { documentId: document.id, version: parsed.data.expectedVersion + 1, saved, pilotLabel: BROKER_COMPARISON_PILOT_LABEL } };
  } catch (error) {
    return actionError(error);
  }
}

