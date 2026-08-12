import { NextRequest, NextResponse } from "next/server";
import { writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { getDb } from "@/lib/db";
import { AuthError, requireUser } from "@/lib/auth";
import { assertSafeDocumentPath, documentsDir } from "@/lib/files";
import { areDocumentFilesEnabled } from "@/lib/deployment";
import { logError } from "@/lib/logger";
import { assertSameOrigin, assertRequestBodySize, checkDistributedRateLimit, getRequestIp, RequestGuardError, securityFingerprint } from "@/lib/request-guards";
import { rateLimitResponse } from "@/lib/api-security";
import {
  assertEndorsementPortfolioAccess,
  assertClientPortfolioAccess,
  assertPolicyPortfolioAccess,
  assertReceiptPortfolioAccess,
} from "@/lib/portfolio-access";
import {
  recordSecurityAccessDenied,
  recordSecurityRateLimit,
  SECURITY_EVENT_TYPES,
} from "@/lib/security-events";
import { z } from "zod";

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

const ALLOWED_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB
const UPLOAD_RATE_LIMIT = {
  limit: 10,
  windowMs: 15 * 60 * 1000,
};

type UploadResult = {
  ok: boolean;
  fileName: string;
  document?: { id: string; fileName: string; documentType: string; uploadedAt: Date; mimeType: string };
  savedPath?: string;
  error?: string;
};

async function processFile(
  file: File,
  metadata: z.infer<typeof uploadSchema>,
  userId: string,
): Promise<UploadResult> {
  if (file.type && file.type !== "application/octet-stream" && file.type !== "application/zip" && !ALLOWED_TYPES.includes(file.type)) {
    return { ok: false, fileName: file.name, error: "Tipo de archivo no permitido (PDF, JPG, PNG, WebP o Word)." };
  }
  if (file.size > MAX_SIZE) {
    return { ok: false, fileName: file.name, error: "El archivo es demasiado grande (máximo 10 MB)." };
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const detectedType = detectFileType(bytes);
    if (!detectedType) {
      return { ok: false, fileName: file.name, error: "El archivo no coincide con un tipo permitido." };
    }

    if (file.type && file.type !== detectedType && file.type !== "application/octet-stream") {
      return { ok: false, fileName: file.name, error: "El tipo del archivo no coincide con su contenido." };
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const fileName = `${timestamp}-${sanitizedFileName}`;
    const filePath = path.join(documentsDir, fileName);
    const safePath = assertSafeDocumentPath(filePath);

    await writeFile(safePath, Buffer.from(bytes));

    const db = getDb();
    const document = await db.document.create({
      data: {
        ...metadata,
        fileName: file.name,
        filePath: `data/documents/${fileName}`,
        mimeType: detectedType,
        uploadedAt: new Date(),
        createdById: userId,
        updatedById: userId,
      },
    });

    return {
      ok: true,
      fileName: file.name,
      savedPath: safePath,
      document: {
        id: document.id,
        fileName: document.fileName,
        documentType: document.documentType,
        uploadedAt: document.uploadedAt,
        mimeType: document.mimeType,
      },
    };
  } catch (error) {
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
  userId: string,
  role: string,
) {
  if (role === "ADMIN") return;

  if (metadata.clientId) {
    await assertClientPortfolioAccess(metadata.clientId, userId);
  }
  if (metadata.policyId) {
    await assertPolicyPortfolioAccess(metadata.policyId, userId);
  }
  if (metadata.endorsementId) {
    const db = getDb();
    const endorsement = await db.policyEndorsement.findFirst({
      where: {
        id: metadata.endorsementId,
        policy: { client: { portfolioOwnerId: userId } },
      },
      select: { id: true, policyId: true },
    });
    if (!endorsement) {
      throw new AuthError("No tienes acceso a este endoso.", 403);
    }
    if (metadata.policyId && metadata.policyId !== endorsement.policyId) {
      throw new AuthError("El endoso no pertenece a la póliza seleccionada.", 403);
    }
    await assertEndorsementPortfolioAccess(metadata.endorsementId, userId);
  }
  if (metadata.receiptId) {
    await assertReceiptPortfolioAccess(metadata.receiptId, userId);
  }
  if (metadata.claimId) {
    const db = getDb();
    const claim = await db.claim.findFirst({
      where: {
        id: metadata.claimId,
        client: { portfolioOwnerId: userId },
      },
      select: { id: true },
    });
    if (!claim) {
      throw new AuthError("No tienes acceso a esta reclamación.", 403);
    }
  }
  if (metadata.quoteId) {
    const db = getDb();
    const quote = await db.quote.findFirst({
      where: {
        id: metadata.quoteId,
        client: { portfolioOwnerId: userId },
      },
      select: { id: true },
    });
    if (!quote) {
      throw new AuthError("No tienes acceso a esta cotización.", 403);
    }
  }
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

    const activeUser = await requireUser();
    const userId = activeUser.id;
    try {
      await assertDocumentUploadOwnership(validatedData, userId, activeUser.role);
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
        });
      }
      throw error;
    }
    const rollback = formData.get("rollback") === "1" || files.length > 1;
    const results = await Promise.all(files.map((f) => processFile(f, validatedData, userId)));

    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;

    // Atomic mode: if any file fails in a multi-upload, roll back successful ones
    // by deleting their DB rows + files on disk.
    if (rollback && failCount > 0 && okCount > 0) {
      const db = getDb();
      await Promise.all(
        results
          .map(async (r, idx) => {
            if (!r.ok || !r.document) return;
            try {
              await db.document.delete({ where: { id: r.document.id } });
              if (r.savedPath) {
                await unlink(r.savedPath).catch(() => {});
              }
              results[idx] = {
                ok: false,
                fileName: r.fileName,
                error: "Revertido por falla en otro archivo del lote.",
              };
            } catch (e) {
              logError("api.documents.upload.rollback", e);
            }
          }),
      );
      return NextResponse.json(
        { success: false, okCount: 0, failCount: results.length, rolledBack: true, results },
        { status: 400 },
      );
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
