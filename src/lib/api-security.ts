import { NextResponse } from "next/server";
import { AuthError } from "@/lib/auth";
import { RequestGuardError, type RateLimitResult } from "@/lib/request-guards";

export type ApiSecurityClass = "public-health" | "authenticated" | "admin" | "cron-secret" | "telegram-webhook";

export const API_SECURITY_MANIFEST = {
  "/api/health": "public-health",
  "/api/ready": "public-health",
  "/api/jobs/status": "admin",
  "/api/auth/logout": "authenticated",
  "/api/assistant": "authenticated",
  "/api/assistant/actions/confirm": "authenticated",
  "/api/admin/assistant/health": "admin",
  "/api/admin/knowledge-base/search": "admin",
  "/api/backups/artifacts/[artifactId]/download": "admin",
  "/api/backups/[filename]/download": "admin",
  "/api/commissions/stats": "authenticated",
  "/api/commissions/statements/import": "authenticated",
  "/api/commissions/[id]/status": "authenticated",
  "/api/documents/upload": "authenticated",
  "/api/documents/[id]/download": "authenticated",
  "/api/export/[dataset]": "authenticated",
  "/api/exports/clients": "authenticated",
  "/api/integrations/telegram/webhook": "telegram-webhook",
  "/api/jobs/backup": "cron-secret",
  "/api/jobs/nonpayment-cancellation": "cron-secret",
  "/api/jobs/telegram-digest": "cron-secret",
  "/api/jobs/telegram-birthdays": "cron-secret",
  "/api/jobs/renewal-followups": "cron-secret",
  "/api/jobs/operational-followups": "cron-secret",
  "/api/jobs/demo-retention": "cron-secret",
  "/api/nora/policy-pdf/upload": "authenticated",
  "/api/nora/policy-pdf/analyze": "authenticated",
  "/api/nora/policy-pdf/correct": "authenticated",
  "/api/nora/policy-pdf/cleanup": "authenticated",
  "/api/nora/policy-pdf/handoff": "authenticated",
  "/api/nora/reports": "authenticated",
  "/api/payments/quick": "authenticated",
  "/api/policies/capture/clients": "authenticated",
  "/api/policies/capture/confirm": "authenticated",
  "/api/policies/capture/lookup": "authenticated",
  "/api/policies/capture/preview": "authenticated",
  "/api/search": "authenticated",
} as const satisfies Record<string, ApiSecurityClass>;

export function guardErrorResponse(error: unknown, fallback = "La petición no es válida.") {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof RequestGuardError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return NextResponse.json({ error: fallback }, { status: 400 });
}

export function rateLimitResponse(result: RateLimitResult, message = "Demasiados intentos. Intenta de nuevo en un momento.") {
  return NextResponse.json(
    { error: result.backend === "unavailable" ? "El control de seguridad no está disponible." : message },
    {
      status: result.backend === "unavailable" ? 503 : 429,
      headers: { "Retry-After": String(Math.max(1, Math.ceil(result.retryAfterMs / 1000))) },
    },
  );
}
