import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth";
import { logError } from "@/lib/logger";
import { assertSameOrigin, checkRateLimit, getRequestIp } from "@/lib/request-guards";
import { buildPolicyPdfCapturePreviewFromText } from "@/lib/policy-pdf-capture-preview";
import type { AssistantUser } from "@/lib/assistant-types";
import {
  recordSecurityAccessDenied,
  recordSecurityRateLimit,
  SECURITY_EVENT_TYPES,
} from "@/lib/security-events";

export const runtime = "nodejs";

const previewRequestSchema = z.object({
  text: z.string().min(1),
  fileName: z.string().trim().max(255).optional().nullable(),
});

export async function POST(request: NextRequest) {
  try {
    let user: Awaited<ReturnType<typeof requireUser>> | null = null;
    try {
      user = await requireUser();
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

    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return NextResponse.json(
        { error: "Esta versión del lector requiere actualizar la página para analizar PDFs." },
        { status: 415 },
      );
    }

    let payload: z.infer<typeof previewRequestSchema>;
    try {
      payload = previewRequestSchema.parse(await request.json());
    } catch {
      return NextResponse.json({ error: "El payload de análisis no es válido." }, { status: 400 });
    }

    const extractedText = payload.text.trim();
    if (!extractedText) {
      return NextResponse.json(
        {
          error: "No pudimos extraer texto del PDF. Puede ser una imagen, un escaneo o un archivo sin capa de texto.",
          code: "NO_TEXT",
        },
        { status: 422 },
      );
    }

    const assistantUser: AssistantUser | null = user
      ? { id: user.id, role: user.role === "ADMIN" ? "ADMIN" : "AGENT" }
      : null;
    const preview = await buildPolicyPdfCapturePreviewFromText(extractedText, undefined, assistantUser);
    return NextResponse.json({ success: true, preview });
  } catch (error) {
    logError("api.policies.capture.preview", error);
    return NextResponse.json(
      { error: "No se pudo analizar el PDF. Intenta con otra versión o revisa que el archivo sea legible." },
      { status: 500 },
    );
  }
}
