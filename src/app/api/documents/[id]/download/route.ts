import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { get } from "@vercel/blob";
import { areDocumentFilesEnabled } from "@/lib/deployment";
import { assertSafeDocumentPath } from "@/lib/files";
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

function syntheticDemoPdf() {
  const stream = "BT /F1 18 Tf 72 720 Td (PolicyDesk - Documento sintetico DEMO) Tj 0 -32 Td /F1 11 Tf (Este archivo no contiene datos reales.) Tj ET\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const startXref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startXref}\n%%EOF`;
  return pdf;
}

const SYNTHETIC_DEMO_PDF = syntheticDemoPdf();

function isSyntheticDemoPath(filePath: string, organizationId: string) {
  return filePath.startsWith(`demo://${organizationId}/`);
}

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
      if (isSyntheticDemoPath(document.filePath, context.organizationId)) return true;
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
      if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
        return NextResponse.json({ error: "El almacenamiento de documentos no está configurado." }, { status: 503 });
      }
      const blob = await get(document.filePath.slice("blob:".length), { access: "private" });
      if (!blob) return NextResponse.json({ error: "El archivo ya no se encuentra disponible." }, { status: 404 });
      const headers = new Headers({
        "Content-Type": document.mimeType,
        "Content-Disposition": `${disposition}; filename="${safeFileName}"`,
        "Cache-Control": "private, no-store",
      });
      return new NextResponse(blob.stream, { status: 200, headers });
    }

    if (isSyntheticDemoPath(document.filePath, context.organizationId)) {
      return new NextResponse(SYNTHETIC_DEMO_PDF, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `${disposition}; filename="${safeFileName}"`,
          "Content-Length": Buffer.byteLength(SYNTHETIC_DEMO_PDF).toString(),
          "Cache-Control": "private, no-store",
        },
      });
    }

    if (document.filePath.startsWith("demo://")) {
      return NextResponse.json({ error: "La ruta sintética no pertenece a esta organización." }, { status: 404 });
    }

    // Keep the bounded legacy reader during the Blob migration so existing
    // customer documents remain downloadable. The path is constrained to the
    // private document store and never read directly from tenant metadata.
    const safePath = assertSafeDocumentPath(path.resolve(document.filePath));
    const fileBuffer = await readFile(safePath);
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": document.mimeType,
        "Content-Disposition": `${disposition}; filename="${safeFileName}"`,
        "Content-Length": fileBuffer.length.toString(),
        "Cache-Control": "private, no-store",
      },
    });

  } catch (error) {
    logError("api.documents.download", error);

    return NextResponse.json(
      { error: "No se pudo descargar el documento. Intenta de nuevo." },
      { status: 500 }
    );
  }
}
