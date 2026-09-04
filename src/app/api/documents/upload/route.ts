import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { del, put } from "@vercel/blob";
import { AuthError } from "@/lib/auth";
import { requireOrganizationContext, type OrganizationContext, withTenantTransaction } from "@/lib/organization-context";
import { areDocumentFilesEnabled } from "@/lib/deployment";
import { logError } from "@/lib/logger";
import { assertSameOrigin, assertRequestBodySize, checkDistributedRateLimit, getRequestIp, RequestGuardError, securityFingerprint } from "@/lib/request-guards";
import { rateLimitResponse } from "@/lib/api-security";
import {
  recordSecurityAccessDenied,
  recordSecurityRateLimit,
  SECURITY_EVENT_TYPES,
} from "@/lib/security-events";
import { z } from "zod";
import { resolveOrganizationCapability } from "@/lib/organization-capabilities";
import { DEMO_UPLOAD_MAX_BYTES, validateDemoPdf } from "@/lib/demo-upload-validation";

const uploadSchema = z.object({
  clientId: z.string().optional(),
  policyId: z.string().optional(),
  endorsementId: z.string().optional(),
  receiptId: z.string().optional(),
  claimId: z.string().optional(),
  quoteId: z.string().optional(),
  documentType: z.enum([
    "POLICY",
    "RECEIPT",
    "ENDORSEMENT",
    "RENEWAL",
    "ID",
    "PAYMENT_PROOF",
    "QUOTE",
    "CLAIM",
    "LETTER",
    "OTHER",
  ]),
  notes: z.string().optional(),
});

const ALLOWED_TYPES = ["application/pdf"];
const MAX_SIZE = DEMO_UPLOAD_MAX_BYTES;
const UPLOAD_RATE_LIMIT = {
  limit: 10,
  windowMs: 15 * 60 * 1000,
};

type UploadResult = {
  ok: boolean;
  fileName: string;
  document?: { id: string; fileName: string; documentType: string; uploadedAt: Date; mimeType: string };
  storagePath?: string;
  sizeBytes?: number;
  sha256?: string;
  detectedMimeType?: string;
  error?: string;
};

async function processFile(
  file: File,
  metadata: z.infer<typeof uploadSchema>,
  context: OrganizationContext,
): Promise<UploadResult> {
  // Stage 3 accepts only structurally validated PDFs. The same parser guard
  // is applied to CUSTOMER uploads so a file cannot become an OCR/AI input
  // merely by changing the tenant kind. DEMO additionally records the
  // accepted artifact below for the 48-hour purge/reset lifecycle.
  const pdfValidation = await validateDemoPdf(file);
  if (!pdfValidation.ok) {
    return { ok: false, fileName: file.name, error: pdfValidation.message };
  }
  if (file.type && file.type !== "application/octet-stream" && file.type !== "application/zip" && !ALLOWED_TYPES.includes(file.type)) {
      return { ok: false, fileName: file.name, error: "Tipo de archivo no permitido. Solo se aceptan PDFs." };
  }
  if (file.size > MAX_SIZE) {
    return { ok: false, fileName: file.name, error: "El archivo es demasiado grande (máximo 15 MB)." };
  }

  let uploadedBlobUrl: string | null = null;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const detectedType = detectFileType(bytes);
    if (detectedType !== "application/pdf") {
      return { ok: false, fileName: file.name, error: "El archivo no coincide con un PDF válido." };
    }

    if (file.type && file.type !== detectedType && file.type !== "application/octet-stream") {
      return { ok: false, fileName: file.name, error: "El tipo del archivo no coincide con su contenido." };
    }

    const organizationNamespace = context.organizationId.replace(/[^a-zA-Z0-9_-]/g, "_");
    if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
      return { ok: false, fileName: file.name, error: "El almacenamiento privado de documentos no está configurado." };
    }
    // Keep customer names out of object paths. The random opaque key also
    // prevents overwrite/replay; the display filename remains tenant metadata.
    const blob = await put(`${organizationNamespace}/documents/${randomUUID()}`, Buffer.from(bytes), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: detectedType,
      cacheControlMaxAge: 0,
    });
    const storagePath = `blob:${blob.url}`;
    uploadedBlobUrl = blob.url;

    const document = await withTenantTransaction(context, (tx) => tx.document.create({
      data: {
        organizationId: context.organizationId,
        ...metadata,
        fileName: file.name,
        filePath: storagePath,
        mimeType: detectedType,
        uploadedAt: new Date(),
        createdById: context.userId,
        updatedById: context.userId,
      },
    }));

    return {
      ok: true,
      fileName: file.name,
      storagePath,
      document: {
        id: document.id,
        fileName: document.fileName,
        documentType: document.documentType,
        uploadedAt: document.uploadedAt,
        mimeType: document.mimeType,
      },
      sizeBytes: pdfValidation.sizeBytes ?? bytes.byteLength,
      sha256: pdfValidation.sha256,
      detectedMimeType: pdfValidation.detectedMimeType ?? detectedType,
    };
  } catch (error) {
    // A database/metadata failure after put() must not leave an untracked
    // private object that a DEMO reset or retention worker cannot find.
    if (uploadedBlobUrl) await del(uploadedBlobUrl).catch(() => undefined);
    logError("api.documents.upload.file", error);
    return { ok: false, fileName: file.name, error: "No se pudo guardar el archivo." };
  }
}

function detectFileType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return "application/pdf";
  }

  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }

  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }

  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46], 0) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }

  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return "application/msword";
  }

  if (
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) ||
    startsWith(bytes, [0x50, 0x4b, 0x05, 0x06]) ||
    startsWith(bytes, [0x50, 0x4b, 0x07, 0x08])
  ) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }

  return null;
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0) {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

async function assertDocumentUploadOwnership(
  metadata: z.infer<typeof uploadSchema>,
  context: OrganizationContext,
) {
  await withTenantTransaction(context, async (tx) => {
    const agentClient = context.membershipRole === "AGENT" ? { client: { portfolioOwnerId: context.userId } } : {};
    const checks = await Promise.all([
      metadata.clientId ? tx.client.count({ where: { id: metadata.clientId, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? { portfolioOwnerId: context.userId } : {}) } }) : 1,
      metadata.policyId ? tx.policy.count({ where: { id: metadata.policyId, organizationId: context.organizationId, ...agentClient } }) : 1,
      metadata.endorsementId ? tx.policyEndorsement.count({ where: { id: metadata.endorsementId, organizationId: context.organizationId, ...(metadata.policyId ? { policyId: metadata.policyId } : {}), ...(context.membershipRole === "AGENT" ? { policy: { client: { portfolioOwnerId: context.userId } } } : {}) } }) : 1,
      metadata.receiptId ? tx.receipt.count({ where: { id: metadata.receiptId, organizationId: context.organizationId, ...agentClient } }) : 1,
      metadata.claimId ? tx.claim.count({ where: { id: metadata.claimId, organizationId: context.organizationId, ...agentClient } }) : 1,
      metadata.quoteId ? tx.quote.count({ where: { id: metadata.quoteId, organizationId: context.organizationId, ...agentClient } }) : 1,
    ]);
    if (checks.some((value) => value !== 1)) throw new AuthError("TENANT_RELATION_MISMATCH", 404);
  });
}

async function rollbackUploadedResults(results: UploadResult[], context: OrganizationContext, reason: string, demoUpload = false) {
  await Promise.all(results.map(async (result, index) => {
    if (!result.ok || !result.document) return;
    try {
      await withTenantTransaction(context, async (tx) => {
        if (demoUpload) {
          await tx.demoUploadArtifact.deleteMany({ where: { organizationId: context.organizationId, blobPath: result.storagePath } });
        }
        await tx.document.deleteMany({ where: { id: result.document!.id, organizationId: context.organizationId } });
      });
      if (result.storagePath?.startsWith("blob:")) await del(result.storagePath.slice("blob:".length)).catch(() => {});
      results[index] = { ok: false, fileName: result.fileName, error: reason };
    } catch (error) {
      logError("api.documents.upload.rollback", error);
    }
  }));
}

export async function POST(request: NextRequest) {
  try {
    if (!areDocumentFilesEnabled()) {
      return NextResponse.json(
        { error: "La carga de documentos está deshabilitada en este demo." },
        { status: 501 },
      );
    }

    assertRequestBodySize(request, 25 * 1024 * 1024);

    try {
      assertSameOrigin(request, "document upload");
    } catch {
      await recordSecurityAccessDenied({
        alertType: SECURITY_EVENT_TYPES.sameOriginBlocked,
        title: "Subida de documentos bloqueada por same-origin",
        description: "Se intentó subir un documento desde un origen no permitido.",
        severity: "WARNING",
        entityType: "SecurityEvent",
        entityId: "document-upload:same-origin",
      });
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
    const rateLimit = await checkDistributedRateLimit(`upload:${securityFingerprint(`ip:${getRequestIp(request)}`)}`, {
      ...UPLOAD_RATE_LIMIT,
      requireDistributed: true,
    });
    if (!rateLimit.allowed) {
      await recordSecurityRateLimit({
        alertType: SECURITY_EVENT_TYPES.rateLimitedRequest,
        title: "Límite de subidas alcanzado",
        description: "Se bloqueó una subida de documentos por exceso de intentos.",
        severity: "WARNING",
        entityType: "SecurityEvent",
        entityId: "document-upload:rate-limit",
      });
      return rateLimitResponse(rateLimit, "Demasiadas subidas. Intenta de nuevo en unos minutos.");
    }

    const formData = await request.formData();

    if (String(formData.get("taskId") ?? "").trim()) {
      return NextResponse.json(
        { error: "Los documentos nuevos deben ligarse a un WorkItem, cliente, póliza, recibo o expediente compatible." },
        { status: 410 },
      );
    }

    const metadata = {
      clientId: (formData.get("clientId") as string) || undefined,
      policyId: (formData.get("policyId") as string) || undefined,
      endorsementId: (formData.get("endorsementId") as string) || undefined,
      receiptId: (formData.get("receiptId") as string) || undefined,
      claimId: (formData.get("claimId") as string) || undefined,
      quoteId: (formData.get("quoteId") as string) || undefined,
      documentType: formData.get("documentType") as string,
      notes: (formData.get("notes") as string) || undefined,
    };
    const validatedData = uploadSchema.parse(metadata);

    // Accept either `files` (multi) or `file` (single, backward-compat).
    const filesEntries = formData.getAll("files").filter((f): f is File => f instanceof File);
    const singleFile = formData.get("file");
    const files: File[] = filesEntries.length > 0
      ? filesEntries
      : singleFile instanceof File
        ? [singleFile]
        : [];

    if (files.length === 0) {
      return NextResponse.json({ error: "Selecciona al menos un archivo para subir." }, { status: 400 });
    }

    const context = await requireOrganizationContext();
    const userId = context.userId;
    const documentsCapability = await resolveOrganizationCapability(context.organizationId, "DOCUMENTS");
    if (!documentsCapability.enabled) return NextResponse.json({ error: "Los documentos no están habilitados para esta organización." }, { status: 403 });
    const organization = await withTenantTransaction(context, async (tx) => tx.organization.findUnique({ where: { id: context.organizationId }, select: { kind: true } }));
    const demoUpload = organization?.kind === "DEMO";
    if (demoUpload && formData.get("uploadConsent") !== "1") {
      return NextResponse.json({ error: "Confirma tu autorización, el procesamiento por proveedores de IA aprobados, la retención del original por 48 horas y el riesgo de que no hay antivirus externo por archivo." }, { status: 400 });
    }
    try {
      await assertDocumentUploadOwnership(validatedData, context);
    } catch (error) {
      if (error instanceof AuthError) {
        await recordSecurityAccessDenied({
          alertType: SECURITY_EVENT_TYPES.documentAccessDenied,
          title: "Subida de documento sin acceso",
          description: `Se intentó subir un documento fuera de la cartera permitida para ${userId}.`,
          severity: "WARNING",
          entityType: "SecurityEvent",
          entityId: `document-upload:denied:${validatedData.documentType}`,
          userId,
          organizationId: context.organizationId,
        });
      }
      throw error;
    }
    const rollback = formData.get("rollback") === "1" || files.length > 1;
    const results = await Promise.all(files.map((f) => processFile(f, validatedData, context)));

    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;

    // Atomic mode: if any file fails in a multi-upload, roll back successful
    // ones by deleting their DB rows and private Blob objects.
    if (rollback && failCount > 0 && okCount > 0) {
      await rollbackUploadedResults(results, context, "Revertido por falla en otro archivo del lote.", demoUpload);
      return NextResponse.json(
        { success: false, okCount: 0, failCount: results.length, rolledBack: true, results },
        { status: 400 },
      );
    }

    if (demoUpload && okCount > 0) {
      const uploadedAt = new Date();
      try {
        await withTenantTransaction(context, async (tx) => {
          const state = await tx.demoOrganizationState.findUnique({ where: { organizationId: context.organizationId } });
          if (!state) throw new Error("DEMO_STATE_MISSING");
          if (!state.realDataResetAt) {
            // Conditional update makes the first upload win even when two users
            // finish uploads concurrently; later uploads cannot extend the
            // seven-day reset deadline.
            await tx.demoOrganizationState.updateMany({
              where: { organizationId: context.organizationId, realDataResetAt: null },
              data: { realDataResetAt: new Date(uploadedAt.getTime() + 7 * 86_400_000) },
            });
          }
          for (const result of results) {
            if (!result.ok || !result.document || !result.storagePath) continue;
            await tx.demoUploadArtifact.create({
              data: {
                organizationId: context.organizationId,
                userId,
                blobPath: result.storagePath,
                kind: result.document.documentType,
                uploadedAt,
                expiresAt: new Date(uploadedAt.getTime() + 48 * 60 * 60 * 1000),
                sizeBytes: result.sizeBytes,
                sha256: result.sha256,
                detectedMimeType: result.detectedMimeType,
                validationStatus: "ACCEPTED",
                validatedAt: uploadedAt,
              },
            });
          }
        });
      } catch (error) {
        await rollbackUploadedResults(results, context, "La carga DEMO se revirtió porque no pudo registrarse su retención segura.", true);
        throw error;
      }
    }

    // Backward-compat single-file response shape when only one file uploaded.
    if (files.length === 1) {
      const r = results[0];
      if (!r.ok) {
        return NextResponse.json({ error: r.error, results }, { status: 400 });
      }
      return NextResponse.json({ success: true, document: r.document, results });
    }

    return NextResponse.json({
      success: failCount === 0,
      okCount,
      failCount,
      results,
    });
  } catch (error) {
    logError("api.documents.upload", error);

    if (error instanceof AuthError) {
      await recordSecurityAccessDenied({
        alertType: SECURITY_EVENT_TYPES.documentAccessDenied,
        title: "Carga de documento sin sesión válida",
        description: "Se intentó subir un documento sin una sesión válida.",
        severity: "WARNING",
        entityType: "SecurityEvent",
        entityId: "document-upload:auth",
      });
      return NextResponse.json(
        { error: "Necesitas iniciar sesión para subir documentos." },
        { status: error.status },
      );
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Los datos del documento no son válidos.", details: error.issues },
        { status: 400 },
      );
    }

    if (error instanceof RequestGuardError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }

    return NextResponse.json(
      { error: "No se pudo subir el documento. Intenta de nuevo." },
      { status: 500 },
    );
  }
}
