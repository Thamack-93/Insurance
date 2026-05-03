import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { getDb } from "@/lib/db";
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

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    
    if (!file) {
      return NextResponse.json(
        { error: "Selecciona un archivo para subir." },
        { status: 400 }
      );
    }

    // Validate file type and size
    const allowedTypes = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];

    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json(
        { error: "Tipo de archivo no permitido. Sube PDF, JPG, PNG o Word." },
        { status: 400 }
      );
    }

    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
      return NextResponse.json(
        { error: "El archivo es demasiado grande (máximo 10 MB)." },
        { status: 400 }
      );
    }

    // Parse and validate metadata
    const metadata = {
      clientId: formData.get("clientId") as string || undefined,
      policyId: formData.get("policyId") as string || undefined,
      receiptId: formData.get("receiptId") as string || undefined,
      taskId: formData.get("taskId") as string || undefined,
      claimId: formData.get("claimId") as string || undefined,
      quoteId: formData.get("quoteId") as string || undefined,
      documentType: formData.get("documentType") as string,
      notes: formData.get("notes") as string || undefined,
    };

    const validatedData = uploadSchema.parse(metadata);

    // Generate unique filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const fileName = `${timestamp}-${sanitizedFileName}`;
    
    // Create file path
    const filePath = path.join(documentsDir, fileName);
    const safePath = assertSafeDocumentPath(filePath);

    // Save file to disk
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(safePath, buffer);

    // Save metadata to database
    const db = getDb();
    const document = await db.document.create({
      data: {
        ...validatedData,
        fileName: file.name,
        filePath: `data/documents/${fileName}`,
        mimeType: file.type,
        uploadedAt: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      document: {
        id: document.id,
        fileName: document.fileName,
        documentType: document.documentType,
        uploadedAt: document.uploadedAt,
      },
    });

  } catch (error) {
    logError("api.documents.upload", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Los datos del documento no son válidos.", details: error.issues },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "No se pudo subir el documento. Intenta de nuevo." },
      { status: 500 }
    );
  }
}
