import { NextRequest, NextResponse } from "next/server";
import { del, get } from "@vercel/blob";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth";
import { logError } from "@/lib/logger";
import { assertSameOrigin, checkDistributedRateLimit, getRequestIp, readJsonBody } from "@/lib/request-guards";
import { rateLimitResponse } from "@/lib/api-security";
import { requireOrganizationContext, withTenantTransaction } from "@/lib/organization-context";
import { resolveOrganizationCapability } from "@/lib/organization-capabilities";
import { extractPdfTextFromBytes } from "@/lib/pdf-text-extraction";
import { buildPolicyPdfCapturePreviewFromText, buildPolicyPdfCapturePreviewFromDraft } from "@/lib/policy-pdf-capture-preview";
import { extractPolicyPdfDraftFromAiFile } from "@/lib/assistant-ai";
import { OperationTimeoutError, withOperationTimeout } from "@/lib/operation-timeout";
import {
  cleanupExpiredNoraPolicyPdfUploads,
} from "@/lib/nora-pdf-storage";
import { isNoraPolicyPdfPathname, NORA_POLICY_PDF_MAX_BYTES } from "@/lib/nora-pdf-storage.shared";
import {
  recordSecurityAccessDenied,
  recordSecurityRateLimit,
  SECURITY_EVENT_TYPES,
} from "@/lib/security-events";
import { DEMO_UPLOAD_MAX_BYTES, validateDemoPdf } from "@/lib/demo-upload-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PDF_ANALYSIS_SERVER_TIMEOUT_MS = 45_000;

const analyzeSchema = z.object({
  text: z.string().trim().min(1).optional(),
  blobUrl: z.string().url().optional(),
  fileName: z.string().trim().max(255).optional().nullable(),
  prompt: z.string().trim().max(500).optional().nullable(),
  mode: z.enum(["local", "ai"]).default("local"),
  retainBlob: z.boolean().default(false),
  relatedDocuments: z.array(z.object({
    id: z.string().max(160),
    fileName: z.string().max(255),
    kind: z.enum(["policy", "receipt", "endorsement", "inciso", "unknown"]),
    source: z.enum(["local", "ai"]),
    policyNumber: z.string().nullable(),
    warnings: z.array(z.string()).max(10),
  })).max(20).optional(),
});

async function responseFromText(text: string, userId: string, organizationId: string, role: "ADMIN" | "AGENT", options: { requestedMode?: "local" | "ai"; skipAiReview?: boolean; extraWarnings?: string[]; aiFailureCode?: string | null; relatedDocuments?: z.infer<typeof analyzeSchema>["relatedDocuments"] } = {}) {
  const preview = await withOperationTimeout(
    buildPolicyPdfCapturePreviewFromText(text, undefined, {
      portfolioOwnerId: role === "ADMIN" ? undefined : userId,
      organizationId,
      user: { id: userId, role },
    }, options),
    PDF_ANALYSIS_SERVER_TIMEOUT_MS,
    "La revisión del PDF tardó demasiado al consultar la cartera o la IA.",
  );
  return {
    preview,
    provenance: preview.provenance,
  } as const;
}

export async function POST(request: NextRequest) {
  try {
    if (process.env.PLATFORM_UPLOADS_ENABLED?.trim() === "0") {
      return NextResponse.json({ error: "El procesamiento de archivos está deshabilitado temporalmente por la plataforma." }, { status: 501 });
    }
    let user: Awaited<ReturnType<typeof requireUser>>;
    let portfolioOwnerId: string | undefined;
    let organizationId: string;
    let tenantContext: Awaited<ReturnType<typeof requireOrganizationContext>>;
    let assistantRole: "ADMIN" | "AGENT";
    let demoUpload = false;
    try {
      user = await requireUser();
      const organization = await requireOrganizationContext();
      tenantContext = organization;
      const organizationKind = await withTenantTransaction(organization, (tx) => tx.organization.findUnique({ where: { id: organization.organizationId }, select: { kind: true } }));
      demoUpload = organizationKind?.kind === "DEMO";
      const noraCapability = await resolveOrganizationCapability(organization.organizationId, "NORA");
      if (!noraCapability.enabled) throw new AuthError("Nora no está habilitada para esta organización.", 403);
      organizationId = organization.organizationId;
      assistantRole = organization.membershipRole === "AGENT" ? "AGENT" : "ADMIN";
      portfolioOwnerId = assistantRole === "AGENT" ? organization.userId : undefined;
    } catch (error) {
      if (error instanceof AuthError) {
        await recordSecurityAccessDenied({
          alertType: SECURITY_EVENT_TYPES.accessDenied,
          title: "Análisis de PDF sin sesión válida",
          description: "Se intentó analizar una carátula de póliza sin sesión válida.",
          severity: "WARNING",
          entityType: "SecurityEvent",
          entityId: "nora-policy-pdf-analyze:auth",
        });
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }

    try {
      assertSameOrigin(request, "nora policy pdf analyze");
    } catch {
      await recordSecurityAccessDenied({
        alertType: SECURITY_EVENT_TYPES.sameOriginBlocked,
        title: "Análisis de PDF bloqueado por same-origin",
        description: "Se intentó analizar una carátula de póliza desde un origen no permitido.",
        severity: "WARNING",
        entityType: "SecurityEvent",
        entityId: "nora-policy-pdf-analyze:same-origin",
      });
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }

    const rateLimit = await checkDistributedRateLimit(`nora-policy-pdf-analyze:${getRequestIp(request)}:${user.id}`, {
      limit: 8,
      windowMs: 15 * 60 * 1000,
      requireDistributed: true,
    });
    if (!rateLimit.allowed) {
      await recordSecurityRateLimit({
        alertType: SECURITY_EVENT_TYPES.rateLimitedRequest,
        title: "Límite de análisis de PDF alcanzado",
        description: "Se bloqueó el análisis de una carátula de póliza por exceso de intentos.",
        severity: "WARNING",
        entityType: "SecurityEvent",
        entityId: "nora-policy-pdf-analyze:rate-limit",
      });
      return rateLimitResponse(rateLimit);
    }

    let payload: z.infer<typeof analyzeSchema>;
    try {
      payload = analyzeSchema.parse(await readJsonBody(request, 256 * 1024));
    } catch {
      return NextResponse.json({ error: "El payload de análisis no es válido." }, { status: 400 });
    }

    if (!payload.text && !payload.blobUrl) {
      return NextResponse.json({ error: "Debes enviar texto extraído o una URL temporal del PDF." }, { status: 400 });
    }

    // DEMO text-only requests could otherwise bypass server-side PDF
    // validation. The browser still sends the original Blob, so validation is
    // performed on its bytes before any extraction or AI provider call.
    if (demoUpload && payload.text && !payload.blobUrl) {
      return NextResponse.json({ error: "Los DEMO requieren una subida PDF validada antes del análisis." }, { status: 422 });
    }

    if (payload.mode === "ai" && !payload.blobUrl) {
      return NextResponse.json({ error: "La extracción IA requiere conservar el PDF temporal para enviarlo al gateway." }, { status: 400 });
    }

    if (payload.text && payload.mode !== "ai" && !(demoUpload && payload.blobUrl)) {
      const result = await responseFromText(payload.text, user.id, organizationId, assistantRole, { requestedMode: "local", relatedDocuments: payload.relatedDocuments });
      return NextResponse.json({ success: true, ...result, pdfReference: payload.retainBlob && payload.blobUrl ? { url: payload.blobUrl, fileName: payload.fileName ?? "policy.pdf", expiresAt: Date.now() + 30 * 60 * 1000 } : null });
    }

    const blobUrl = payload.blobUrl!;
    const blobPath = new URL(blobUrl).pathname.replace(/^\/+/, "");
    if (!isNoraPolicyPdfPathname(blobPath, user.id, organizationId)) {
      return NextResponse.json({ error: "La carátula temporal no pertenece a tu sesión." }, { status: 403 });
    }

    const blob = await get(blobUrl, { access: "private" });
    if (!blob) {
      return NextResponse.json({ error: "La carátula temporal ya no está disponible." }, { status: 404 });
    }

    if ((blob.blob?.size ?? 0) > (demoUpload ? DEMO_UPLOAD_MAX_BYTES : NORA_POLICY_PDF_MAX_BYTES)) {
      return NextResponse.json({ error: "El PDF temporal supera el tamaño permitido." }, { status: 413 });
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await new Response(blob.stream).arrayBuffer());
    } catch (error) {
      logError("api.nora.policyPdf.analyze.readBlob", error);
      return NextResponse.json({ error: "No se pudo leer la carátula temporal." }, { status: 500 });
    }

    // Validate the actual Blob bytes for every tenant before extraction or an
    // AI provider sees them. DEMO adds the retention ledger below; CUSTOMER
    // uploads receive the same structural safety boundary without reset state.
    const validation = await validateDemoPdf(new File([bytes.buffer as ArrayBuffer], payload.fileName ?? "policy.pdf", { type: "application/pdf" }));
    if (!validation.ok) {
      await del(blobUrl).catch(() => {});
      return NextResponse.json({ error: validation.message, code: validation.code }, { status: 422 });
    }

    if (demoUpload) {
      // Nora's temporary Blob uploads are DEMO real-data uploads too. Record
      // their provenance and the first-upload reset deadline before OCR/AI so
      // a successful validation can never bypass the retention ledger.
      const uploadedAt = new Date();
      try {
        await withTenantTransaction(tenantContext, async (tx) => {
          const state = await tx.demoOrganizationState.findUnique({ where: { organizationId } });
          if (!state) throw new Error("DEMO_STATE_MISSING");
          if (!state.realDataResetAt) {
            await tx.demoOrganizationState.updateMany({
              where: { organizationId, realDataResetAt: null },
              data: { realDataResetAt: new Date(uploadedAt.getTime() + 7 * 86_400_000) },
            });
          }
          await tx.demoUploadArtifact.upsert({
            where: { blobPath: `blob:${blobUrl}` },
            update: {
              sizeBytes: validation.sizeBytes,
              sha256: validation.sha256,
              detectedMimeType: validation.detectedMimeType,
              validationStatus: "ACCEPTED",
              validatedAt: uploadedAt,
            },
            create: {
              organizationId,
              userId: user.id,
              blobPath: `blob:${blobUrl}`,
              kind: "NORA_POLICY_PDF",
              uploadedAt,
              expiresAt: new Date(uploadedAt.getTime() + 48 * 60 * 60 * 1000),
              sizeBytes: validation.sizeBytes,
              sha256: validation.sha256,
              detectedMimeType: validation.detectedMimeType,
              validationStatus: "ACCEPTED",
              validatedAt: uploadedAt,
            },
          });
        });
      } catch (error) {
        await del(blobUrl).catch(() => {});
        logError("api.nora.policyPdf.analyze.demoArtifact", error);
        return NextResponse.json({ error: "No se pudo registrar la retención segura del PDF DEMO." }, { status: 503 });
      }
    }

    let preview = null;
    let analysisSource: "local" | "ai" = "ai";
    try {
      let extracted: Awaited<ReturnType<typeof extractPdfTextFromBytes>> | null = null;
      try {
        extracted = await extractPdfTextFromBytes(bytes, { timeoutMs: 20_000 });
      } catch (error) {
        logError("api.nora.policyPdf.analyze.serverExtraction", error);
      }

      if (payload.mode === "ai") {
        const aiExtraction = await extractPolicyPdfDraftFromAiFile({
          user: { id: user.id, role: assistantRole },
          fileName: payload.fileName ?? blob.blob.pathname.split("/").pop() ?? "policy.pdf",
          fileData: bytes,
          instruction: payload.prompt ?? null,
        });

        if (!aiExtraction.value) {
          if (!extracted?.text.trim()) {
            return NextResponse.json({ error: aiExtraction.attempted ? "La extracción IA no pudo completar este PDF después de recorrer los modelos configurados." : "La IA no está disponible. Configura AI_GATEWAY_API_KEY o prueba con una versión con mejor calidad." }, { status: 422 });
          }
          const fallback = await responseFromText(extracted.text, user.id, organizationId, assistantRole, {
            requestedMode: "ai",
            skipAiReview: true,
            extraWarnings: ["La IA fue solicitada, pero no pudo completar la extracción; se muestra el resultado local para revisión."],
            aiFailureCode: aiExtraction.failureCode ?? "gateway_error",
            relatedDocuments: payload.relatedDocuments,
          });
          preview = fallback.preview;
          analysisSource = "local";
        } else {
          preview = await withOperationTimeout(
            buildPolicyPdfCapturePreviewFromDraft({
              draft: aiExtraction.value.draft,
              fieldConfidence: aiExtraction.value.fieldConfidence,
              warnings: aiExtraction.value.warnings,
              aiReview: aiExtraction.value.aiReview ?? null,
              aiReviewTelemetry: aiExtraction,
              extractionSource: "ai",
              requestedMode: "ai",
              aiRunIds: aiExtraction.runId ? [aiExtraction.runId] : [],
              trackingStatus: aiExtraction.trackingStatus,
              context: { portfolioOwnerId, organizationId, user: { id: user.id, role: assistantRole } },
            }),
            PDF_ANALYSIS_SERVER_TIMEOUT_MS,
            "La revisión de la captura tardó demasiado al consultar la cartera.",
          );
          analysisSource = "ai";
        }
      } else if (extracted?.text.trim()) {
        const result = await responseFromText(extracted.text, user.id, organizationId, assistantRole, { requestedMode: "local", relatedDocuments: payload.relatedDocuments });
        preview = result.preview;
        analysisSource = result.provenance.extractionSource;
      } else {
        return NextResponse.json({ error: "No se pudo extraer texto del PDF en el servidor." }, { status: 422 });
      }
    } finally {
      if (!payload.retainBlob) {
        await del(blobUrl).catch(() => {});
        // Keep the retention ledger truthful when a temporary Nora PDF is
        // intentionally deleted at the end of analysis rather than waiting
        // for the 48-hour retention worker to discover a missing object.
        if (demoUpload) {
          await withTenantTransaction(tenantContext, (tx) => tx.demoUploadArtifact.updateMany({
            where: { organizationId, blobPath: `blob:${blobUrl}`, status: "ACTIVE" },
            data: { status: "PURGED", validationStatus: "PURGED", deletedAt: new Date() },
          })).catch((error) => logError("api.nora.policyPdf.analyze.markPurged", error));
        }
      }
      await cleanupExpiredNoraPolicyPdfUploads(user.id, organizationId).catch((error) => {
        logError("api.nora.policyPdf.analyze.cleanup", error);
      });
    }

    return NextResponse.json({ success: true, analysisSource, provenance: preview?.provenance, preview, pdfReference: payload.retainBlob ? { url: blobUrl, fileName: payload.fileName ?? "policy.pdf", expiresAt: Date.now() + 30 * 60 * 1000 } : null });
  } catch (error) {
    if (error instanceof OperationTimeoutError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 504 });
    }
    logError("api.nora.policyPdf.analyze", error);
    return NextResponse.json({ error: "No se pudo analizar el PDF." }, { status: 500 });
  }
}
