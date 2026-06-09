import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDb } from "@/lib/db";
import { assertSafeDocumentPath } from "@/lib/files";
import { areDocumentFilesEnabled } from "@/lib/deployment";
import { logError } from "@/lib/logger";
import { AuthError, requireUser } from "@/lib/auth";

type DownloadableDocument = {
  id: string;
  fileName: string;
  filePath: string;
  mimeType: string;
  createdById: string | null;
  client: { portfolioOwnerId: string | null } | null;
  policy: { client: { portfolioOwnerId: string | null } | null } | null;
  receipt: { client: { portfolioOwnerId: string | null } | null } | null;
  claim: { client: { portfolioOwnerId: string | null } | null } | null;
  quote: { client: { portfolioOwnerId: string | null } | null } | null;
  task: { createdById: string | null; client: { portfolioOwnerId: string | null } | null } | null;
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  type ActiveUser = Awaited<ReturnType<typeof requireUser>>;
  let user: ActiveUser;

  try {
    if (!areDocumentFilesEnabled()) {
      return NextResponse.json(
        { error: "La descarga de documentos está deshabilitada en este demo." },
        { status: 501 },
      );
    }

    // Reject deactivated/unauthenticated users immediately.
    try {
      user = await requireUser();
    } catch (authErr) {
      if (authErr instanceof AuthError) {
        return NextResponse.json({ error: "No autorizado." }, { status: authErr.status });
      }
      throw authErr;
    }

    const { id } = await params;

    // Get document metadata from database
    const db = getDb();
    const document = (await db.document.findUnique({
      where: { id },
      include: {
        client: { select: { portfolioOwnerId: true } },
        policy: { select: { client: { select: { portfolioOwnerId: true } } } },
        receipt: { select: { client: { select: { portfolioOwnerId: true } } } },
        claim: { select: { client: { select: { portfolioOwnerId: true } } } },
        quote: { select: { client: { select: { portfolioOwnerId: true } } } },
        task: { select: { createdById: true, client: { select: { portfolioOwnerId: true } } } },
      },
    })) as DownloadableDocument | null;

    if (!document) {
      return NextResponse.json(
        { error: "El documento no existe o fue eliminado." },
        { status: 404 }
      );
    }

    if (user.role !== "ADMIN") {
      const isAllowed =
        document.createdById === user.id ||
        document.client?.portfolioOwnerId === user.id ||
        document.policy?.client?.portfolioOwnerId === user.id ||
        document.receipt?.client?.portfolioOwnerId === user.id ||
        document.claim?.client?.portfolioOwnerId === user.id ||
        document.quote?.client?.portfolioOwnerId === user.id ||
        document.task?.createdById === user.id ||
        document.task?.client?.portfolioOwnerId === user.id;

      if (!isAllowed) {
        return NextResponse.json({ error: "No tienes acceso a este documento." }, { status: 403 });
      }
    }

    // Validate file path security
    const fullPath = path.resolve(document.filePath);
    const safePath = assertSafeDocumentPath(fullPath);

    // Read file from disk
    const fileBuffer = await readFile(safePath);

    // Inline preview vs attachment download
    const inline = request.nextUrl.searchParams.get("inline") === "1";
    const disposition = inline ? "inline" : "attachment";
    const safeFileName = document.fileName.replace(/["\\]/g, "_");

    const headers = new Headers();
    headers.set("Content-Type", document.mimeType);
    headers.set("Content-Disposition", `${disposition}; filename="${safeFileName}"`);
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
