import { NextRequest, NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { areDocumentFilesEnabled } from "@/lib/deployment";
import { logError } from "@/lib/logger";
import { AuthError } from "@/lib/auth";
import { requireOrganizationContext, withTenantTransaction } from "@/lib/organization-context";
import { recordSecurityAccessDenied, SECURITY_EVENT_TYPES } from "@/lib/security-events";
import { resolveOrganizationCapability } from "@/lib/organization-capabilities";

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
    if (!areDocumentFilesEnabled() || !process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
      return NextResponse.json(
        { error: "La descarga de documentos está deshabilitada en este demo." },
        { status: 501 },
      );
    }

    // Reject deactivated/unauthenticated users immediately.
    try {
      context = await requireOrganizationContext();
      const capability = await resolveOrganizationCapability(context.organizationId, "DOCUMENTS");
      if (!capability.enabled) return NextResponse.json({ error: "Los documentos no están habilitados para esta organización." }, { status: 403 });
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
    const document = await withTenantTransaction(context, async (tx) => tx.document.findFirst({
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

    // DEMO Blob metadata is the access-control ledger as well as the purge
    // ledger. Once the contractual deadline passes, deny access even if the
    // provider has not yet confirmed physical deletion.
    const demoArtifactIsAccessible = await withTenantTransaction(context, async (tx) => {
      const organization = await tx.organization.findUnique({ where: { id: context.organizationId }, select: { kind: true } });
      if (organization?.kind !== "DEMO") return true;
      if (!document.filePath.startsWith("blob:")) return false;
      const artifact = await tx.demoUploadArtifact.findFirst({
        where: { organizationId: context.organizationId, blobPath: document.filePath, status: "ACTIVE", expiresAt: { gt: new Date() } },
        select: { id: true },
      });
      return Boolean(artifact);
    });
    if (!demoArtifactIsAccessible) {
      return NextResponse.json({ error: "El archivo DEMO ya no está disponible." }, { status: 410 });
    }

    const inline = request.nextUrl.searchParams.get("inline") === "1";
    const disposition = inline ? "inline" : "attachment";
    const safeFileName = document.fileName.replace(/["\\]/g, "_");

    if (document.filePath.startsWith("blob:")) {
      const blob = await get(document.filePath.slice("blob:".length), { access: "private" });
      if (!blob) return NextResponse.json({ error: "El archivo ya no se encuentra disponible." }, { status: 404 });
      const headers = new Headers({
        "Content-Type": document.mimeType,
        "Content-Disposition": `${disposition}; filename="${safeFileName}"`,
        "Cache-Control": "private, no-store",
      });
      return new NextResponse(blob.stream, { status: 200, headers });
    }

    // Local filesystem paths are intentionally unsupported after the private
    // Blob cutover. Operators must migrate any legacy metadata before reopening
    // document access; never read an arbitrary path from a tenant row.
    return NextResponse.json(
      { error: "Este documento usa almacenamiento legado y no está disponible." },
      { status: 410 },
    );

  } catch (error) {
    logError("api.documents.download", error);

    return NextResponse.json(
      { error: "No se pudo descargar el documento. Intenta de nuevo." },
      { status: 500 }
    );
  }
}
