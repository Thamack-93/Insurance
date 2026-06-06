import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { logError } from "@/lib/logger";
import { assertSameOrigin, checkRateLimit, getRequestIp } from "@/lib/request-guards";
import { buildPolicyPdfCapturePreview } from "@/lib/policy-pdf-capture";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    try {
      await requireUser();
    } catch (error) {
      if (error instanceof AuthError) {
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }

    assertSameOrigin(request, "policy pdf capture preview");
    const rateLimit = checkRateLimit(`policy-pdf-preview:${getRequestIp(request)}`, {
      limit: 8,
      windowMs: 15 * 60 * 1000,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Demasiados intentos. Espera un momento e inténtalo de nuevo." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000))) },
        },
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Selecciona un PDF para analizar." }, { status: 400 });
    }
    if (file.type !== "application/pdf" && file.type !== "application/octet-stream") {
      return NextResponse.json({ error: "El archivo debe ser un PDF." }, { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "El PDF supera el tamaño máximo de 10 MB." }, { status: 400 });
    }

    const preview = await buildPolicyPdfCapturePreview(new Uint8Array(await file.arrayBuffer()));
    return NextResponse.json({ success: true, preview });
  } catch (error) {
    logError("api.policies.capture.preview", error);
    return NextResponse.json({ error: "No se pudo analizar el PDF." }, { status: 500 });
  }
}
