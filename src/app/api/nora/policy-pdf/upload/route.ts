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

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();

    try {
      assertSameOrigin(request, "nora policy pdf upload");
    } catch {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
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
    return NextResponse.json({ error: "No se pudo preparar la subida temporal." }, { status: 500 });
  }
}
