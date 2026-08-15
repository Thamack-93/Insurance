import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getDb } from "@/lib/db";
import { assertSafeDocumentPath } from "@/lib/files";
import { areDocumentFilesEnabled } from "@/lib/deployment";
import { logError } from "@/lib/logger";
import { AuthError } from "@/lib/auth";
import { requireOrganizationContext } from "@/lib/organization-context";
import { recordSecurityAccessDenied, SECURITY_EVENT_TYPES } from "@/lib/security-events";

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
  let context: Awaited<ReturnType<typeof requireOrganizationContext>>;
  let documentId = "";
  const { id } = await params;
  documentId = id;

  try {
    if (!areDocumentFilesEnabled()) {
      return NextResponse.json(
        { error: "La descarga de documentos está deshabilitada en este demo." },
        { status: 501 },
      );
    }

    // Reject deactivated/unauthenticated users immediately.
    try {
      context = await requireOrganizationContext();
    } catch (authErr) {
      if (authErr instanceof AuthError) {
        await recordSecurityAccessDenied({
          alertType: SECURITY_EVENT_TYPES.documentAccessDenied,
          title: "Descarga de documento sin sesión válida",
          description: `Se intentó descargar el documento ${documentId} sin una sesión válida.`,
          severity: "WARNING",
          entityType: "SecurityEvent",
          entityId: `document-download:auth:${documentId}`,
        });
        return NextResponse.json({ error: "No autorizado." }, { status: authErr.status });
      }
      throw authErr;
    }

    // Get document metadata from database
    const db = getDb();
    const document = (await db.document.findFirst({
      where: { id, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? { OR: [
        { client: { portfolioOwnerId: context.userId } },
        { policy: { client: { portfolioOwnerId: context.userId } } },
        { receipt: { client: { portfolioOwnerId: context.userId } } },
        { claim: { client: { portfolioOwnerId: context.userId } } },
        { quote: { client: { portfolioOwnerId: context.userId } } },
        { task: { client: { portfolioOwnerId: context.userId } } },
        { task: { clientId: null, createdById: context.userId } },
        { clientId: null, policyId: null, receiptId: null, claimId: null, quoteId: null, taskId: null, createdById: context.userId },
      ] } : {}) },
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
      await recordSecurityAccessDenied({
        alertType: SECURITY_EVENT_TYPES.documentPathInvalid,
        title: "Ruta de documento no válida",
        description: "Se intentó acceder a un archivo fuera del directorio permitido.",
        severity: "WARNING",
        entityType: "SecurityEvent",
        entityId: `document-download:path:${documentId}`,
      });
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
