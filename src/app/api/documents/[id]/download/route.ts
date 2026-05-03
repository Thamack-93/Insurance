import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDb } from "@/lib/db";
import { assertSafeDocumentPath } from "@/lib/files";
import { logError } from "@/lib/logger";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Get document metadata from database
    const db = getDb();
    const document = await db.document.findUnique({
      where: { id },
    });

    if (!document) {
      return NextResponse.json(
        { error: "El documento no existe o fue eliminado." },
        { status: 404 }
      );
    }

    // Validate file path security
    const fullPath = path.resolve(document.filePath);
    const safePath = assertSafeDocumentPath(fullPath);

    // Read file from disk
    const fileBuffer = await readFile(safePath);

    // Inline preview vs attachment download
    const inline = request.nextUrl.searchParams.get("inline") === "1";
    const disposition = inline ? "inline" : "attachment";

    const headers = new Headers();
    headers.set("Content-Type", document.mimeType);
    headers.set("Content-Disposition", `${disposition}; filename="${document.fileName}"`);
    headers.set("Content-Length", fileBuffer.length.toString());

    return new NextResponse(fileBuffer, {
      status: 200,
      headers,
    });

  } catch (error) {
    logError("api.documents.download", error);

    if (error instanceof Error && error.message.includes("Document path must stay inside")) {
      return NextResponse.json(
        { error: "Ruta de archivo no válida." },
        { status: 403 }
      );
    }

    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json(
        { error: "El archivo ya no se encuentra disponible en el servidor." },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: "No se pudo descargar el documento. Intenta de nuevo." },
      { status: 500 }
    );
  }
}
