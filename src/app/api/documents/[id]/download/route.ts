import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDb } from "@/lib/db";
import { assertSafeDocumentPath } from "@/lib/files";

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
        { error: "Document not found" },
        { status: 404 }
      );
    }

    // Validate file path security
    const fullPath = path.resolve(document.filePath);
    const safePath = assertSafeDocumentPath(fullPath);

    // Read file from disk
    const fileBuffer = await readFile(safePath);

    // Set appropriate headers
    const headers = new Headers();
    headers.set("Content-Type", document.mimeType);
    headers.set("Content-Disposition", `attachment; filename="${document.fileName}"`);
    headers.set("Content-Length", fileBuffer.length.toString());

    return new NextResponse(fileBuffer, {
      status: 200,
      headers,
    });

  } catch (error) {
    console.error("Download error:", error);
    
    if (error instanceof Error && error.message.includes("Document path must stay inside")) {
      return NextResponse.json(
        { error: "Invalid file path" },
        { status: 403 }
      );
    }

    if (error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json(
        { error: "File not found on disk" },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: "Download failed" },
      { status: 500 }
    );
  }
}
