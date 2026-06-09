import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/auth";
import { logError } from "@/lib/logger";
import { assertSameOrigin, checkRateLimit, getRequestIp } from "@/lib/request-guards";
import {
  PolicyPdfCaptureError,
  buildPolicyPdfCapturePreview,
} from "@/lib/policy-pdf-capture";
import {
  recordSecurityAccessDenied,
  recordSecurityRateLimit,
  SECURITY_EVENT_TYPES,
} from "@/lib/security-events";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    try {
      await requireUser();
    } catch (error) {
      if (error instanceof AuthError) {
        await recordSecurityAccessDenied({
          alertType: SECURITY_EVENT_TYPES.accessDenied,
          title: "Vista previa de captura sin sesión válida",
          description: "Se intentó analizar un PDF de póliza sin sesión válida.",
          severity: "WARNING",
          entityType: "SecurityEvent",
          entityId: "policy-capture-preview:auth",
        });
        return NextResponse.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }

    try {
      assertSameOrigin(request, "policy pdf capture preview");
    } catch {
      await recordSecurityAccessDenied({
        alertType: SECURITY_EVENT_TYPES.sameOriginBlocked,
        title: "Vista previa de captura bloqueada por same-origin",
        description: "Se intentó analizar un PDF de póliza desde un origen no permitido.",
        severity: "WARNING",
        entityType: "SecurityEvent",
        entityId: "policy-capture-preview:same-origin",
      });
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
    const rateLimit = checkRateLimit(`policy-pdf-preview:${getRequestIp(request)}`, {
      limit: 8,
      windowMs: 15 * 60 * 1000,
    });
    if (!rateLimit.allowed) {
      await recordSecurityRateLimit({
        alertType: SECURITY_EVENT_TYPES.rateLimitedRequest,
        title: "Límite de análisis de PDF alcanzado",
        description: "Se bloqueó la vista previa de captura por exceso de intentos.",
        severity: "WARNING",
        entityType: "SecurityEvent",
        entityId: "policy-capture-preview:rate-limit",
      });
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

    try {
      const preview = await buildPolicyPdfCapturePreview(new Uint8Array(await file.arrayBuffer()));
      return NextResponse.json({ success: true, preview });
    } catch (error) {
      if (error instanceof PolicyPdfCaptureError) {
        const status = error.code === "INVALID_PDF" ? 400 : error.code === "NO_TEXT" ? 422 : 500;
        return NextResponse.json({ error: error.message, code: error.code }, { status });
      }
      throw error;
    }
  } catch (error) {
    logError("api.policies.capture.preview", error);
    return NextResponse.json(
      { error: "No se pudo analizar el PDF. Intenta con otra versión o revisa que el archivo sea legible." },
      { status: 500 },
    );
  }
}
