import { NextRequest, NextResponse } from "next/server";
import { writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { getDb } from "@/lib/db";
import { AuthError, requireUser } from "@/lib/auth";
import { assertSafeDocumentPath, documentsDir } from "@/lib/files";
import { logError } from "@/lib/logger";
import { z } from "zod";

const uploadSchema = z.object({
  clientId: z.string().optional(),
  policyId: z.string().optional(),
  receiptId: z.string().optional(),
  taskId: z.string().optional(),
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
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { ok: false, fileName: file.name, error: "Tipo de archivo no permitido (PDF, JPG, PNG, WebP o Word)." };
  }
  if (file.size > MAX_SIZE) {
    return { ok: false, fileName: file.name, error: "El archivo es demasiado grande (máximo 10 MB)." };
  }

  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const fileName = `${timestamp}-${sanitizedFileName}`;
    const filePath = path.join(documentsDir, fileName);
    const safePath = assertSafeDocumentPath(filePath);

    const bytes = await file.arrayBuffer();
    await writeFile(safePath, Buffer.from(bytes));

    const db = getDb();
    const document = await db.document.create({
      data: {
        ...metadata,
        fileName: file.name,
        filePath: `data/documents/${fileName}`,
        mimeType: file.type,
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

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const metadata = {
      clientId: (formData.get("clientId") as string) || undefined,
      policyId: (formData.get("policyId") as string) || undefined,
      receiptId: (formData.get("receiptId") as string) || undefined,
      taskId: (formData.get("taskId") as string) || undefined,
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

    return NextResponse.json(
      { error: "No se pudo subir el documento. Intenta de nuevo." },
      { status: 500 },
    );
  }
}
