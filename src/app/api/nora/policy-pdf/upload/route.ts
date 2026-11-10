import { NextRequest, NextResponse } from "next/server";
import { handleUpload } from "@vercel/blob/client";
import { AuthError, requireUser } from "@/lib/auth";
import { requireOrganizationContext, withTenantTransaction } from "@/lib/organization-context";
import { resolveOrganizationCapability } from "@/lib/organization-capabilities";
import { logError } from "@/lib/logger";
import { assertSameOrigin, checkDistributedRateLimit, getRequestIp, readJsonBody, RequestGuardError } from "@/lib/request-guards";
import { guardErrorResponse, rateLimitResponse } from "@/lib/api-security";
import {
  NORA_POLICY_PDF_MAX_BYTES,
  isNoraPolicyPdfPathname,
} from "@/lib/nora-pdf-storage.shared";
import { DEMO_UPLOAD_MAX_BYTES } from "@/lib/demo-upload-validation";
import { BlobOperationBudgetExceededError, multipartAdvancedOperationCount, recordBlobAdvancedOperation } from "@/lib/blob-operations";
import { registerNoraTemporaryBlob, recordCompletedNoraPolicyPdfUpload } from "@/lib/nora-temporary-blob-ledger";

export const runtime = "nodejs";

function uploadErrorResponse(error: unknown) {
  const status = error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number"
    ? error.statusCode
    : 500;
  if (status === 401 || status === 403) {
    return { status, code: "UPLOAD_UNAUTHORIZED", error: "La sesión no está autorizada para conservar este PDF." };
  }
  if (status === 413) {
    return { status, code: "UPLOAD_REJECTED", error: "El PDF supera el tamaño permitido." };
  }
  if (status === 429) {
    return { status, code: "UPLOAD_RATE_LIMITED", error: "Se alcanzó el límite de subidas temporales." };
  }
  return { status: status >= 400 && status < 600 ? status : 500, code: "UPLOAD_SERVER_ERROR", error: "No se pudo preparar la subida temporal." };
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody<Parameters<typeof handleUpload>[0]["body"]>(request.clone(), 16 * 1024);

    // Vercel sends this signed callback after the client upload. The SDK checks
    // its signature before invoking onUploadCompleted, so it does not need a
    // browser session cookie or same-origin header.
    if (body?.type === "blob.upload-completed") {
      const result = await handleUpload({
        request,
        body,
        onBeforeGenerateToken: async () => { throw new Error("UNEXPECTED_UPLOAD_TOKEN_REQUEST"); },
        onUploadCompleted: async ({ blob, tokenPayload }) => {
          let callback: { organizationId?: unknown; userId?: unknown };
          try { callback = JSON.parse(tokenPayload ?? "{}"); } catch { return; }
          if (typeof callback.organizationId !== "string" || typeof callback.userId !== "string") return;
          const uploadedAt = new Date();
          await recordCompletedNoraPolicyPdfUpload({
            organizationId: callback.organizationId,
            userId: callback.userId,
            pathname: blob.pathname,
            uploadedAt,
            expiresAt: new Date(uploadedAt.getTime() + 60 * 60 * 1000),
          });
        },
      });
      return NextResponse.json(result);
    }

    if (process.env.PLATFORM_UPLOADS_ENABLED?.trim() === "0") {
      return NextResponse.json({ error: "Las subidas están deshabilitadas temporalmente por la plataforma." }, { status: 501 });
    }
    const user = await requireUser();
    const organization = await requireOrganizationContext();
    const organizationKind = await withTenantTransaction(organization, (tx) => tx.organization.findUnique({ where: { id: organization.organizationId }, select: { kind: true } }));
    const demoUpload = organizationKind?.kind === "DEMO";
    const noraCapability = await resolveOrganizationCapability(organization.organizationId, "NORA");
    if (!noraCapability.enabled) return NextResponse.json({ error: "Nora no está habilitada para esta organización." }, { status: 403 });

    try {
      assertSameOrigin(request, "nora policy pdf upload");
    } catch {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }

    if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) {
      return NextResponse.json({
        error: "El almacenamiento temporal de PDFs no está configurado en el servidor.",
        code: "BLOB_NOT_CONFIGURED",
      }, { status: 503 });
    }

    const rateLimit = await checkDistributedRateLimit(`nora-policy-pdf-upload:${getRequestIp(request)}:${user.id}`, {
      limit: 8,
      windowMs: 15 * 60 * 1000,
      requireDistributed: true,
    });
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "El payload de subida no es válido." }, { status: 400 });
    }

    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname, _clientPayload, multipart) => {
        if (!isNoraPolicyPdfPathname(pathname, user.id, organization.organizationId)) {
          throw new Error("La ruta temporal del PDF no es válida.");
        }

        const issuedAt = new Date();
        const expiresAt = new Date(issuedAt.getTime() + 30 * 60 * 1000 + 60 * 60 * 1000);
        await recordBlobAdvancedOperation({
          source: "nora.pdf.upload",
          operation: multipart ? "multipart_put" : "put",
          advancedOperations: multipart ? multipartAdvancedOperationCount(NORA_POLICY_PDF_MAX_BYTES) : 1,
        });
        await registerNoraTemporaryBlob({
          context: organization,
          userId: user.id,
          pathname,
          kind: "POLICY_PDF",
          uploadedAt: null,
          expiresAt,
        });

        return {
          allowedContentTypes: ["application/pdf"],
          maximumSizeInBytes: demoUpload ? DEMO_UPLOAD_MAX_BYTES : NORA_POLICY_PDF_MAX_BYTES,
          validUntil: Date.now() + 30 * 60 * 1000,
          tokenPayload: JSON.stringify({ organizationId: organization.organizationId, userId: user.id }),
          // The requested pathname already contains a random UUID; keeping it
          // stable lets the signed completion callback update the exact ledger
          // row created before the client upload.
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 0,
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        let callback: { organizationId?: unknown; userId?: unknown };
        try { callback = JSON.parse(tokenPayload ?? "{}"); } catch { return; }
        if (typeof callback.organizationId !== "string" || typeof callback.userId !== "string") return;
        const uploadedAt = new Date();
        await recordCompletedNoraPolicyPdfUpload({
          organizationId: callback.organizationId,
          userId: callback.userId,
          pathname: blob.pathname,
          uploadedAt,
          expiresAt: new Date(uploadedAt.getTime() + 60 * 60 * 1000),
        });
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof BlobOperationBudgetExceededError) {
      return NextResponse.json({ error: "El límite temporal de almacenamiento se alcanzó. Inténtalo después del reinicio del presupuesto.", code: "BLOB_OPERATION_BUDGET_EXCEEDED" }, { status: 429 });
    }
    if (error instanceof RequestGuardError) return guardErrorResponse(error);
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logError("api.nora.policyPdf.upload", error);
    const response = uploadErrorResponse(error);
    return NextResponse.json({ error: response.error, code: response.code }, { status: response.status });
  }
}
