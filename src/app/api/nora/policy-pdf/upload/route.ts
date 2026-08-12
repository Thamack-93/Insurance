import { NextRequest, NextResponse } from "next/server";
import { handleUpload } from "@vercel/blob/client";
import { AuthError, requireUser } from "@/lib/auth";
import { logError } from "@/lib/logger";
import { assertSameOrigin, checkDistributedRateLimit, getRequestIp, readJsonBody, RequestGuardError } from "@/lib/request-guards";
import { guardErrorResponse, rateLimitResponse } from "@/lib/api-security";
import {
  NORA_POLICY_PDF_MAX_BYTES,
  isNoraPolicyPdfPathname,
} from "@/lib/nora-pdf-storage.shared";

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
    const user = await requireUser();

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

    const body = await readJsonBody<Parameters<typeof handleUpload>[0]["body"]>(request, 16 * 1024);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "El payload de subida no es válido." }, { status: 400 });
    }

    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname) => {
        if (!isNoraPolicyPdfPathname(pathname, user.id)) {
          throw new Error("La ruta temporal del PDF no es válida.");
        }

        return {
          allowedContentTypes: ["application/pdf"],
          maximumSizeInBytes: NORA_POLICY_PDF_MAX_BYTES,
          validUntil: Date.now() + 30 * 60 * 1000,
          addRandomSuffix: true,
          allowOverwrite: false,
          cacheControlMaxAge: 60,
        };
      },
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof RequestGuardError) return guardErrorResponse(error);
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logError("api.nora.policyPdf.upload", error);
    const response = uploadErrorResponse(error);
    return NextResponse.json({ error: response.error, code: response.code }, { status: response.status });
  }
}
