import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/request-guards";
import { recordSecurityAccessDenied, SECURITY_EVENT_TYPES } from "@/lib/security-events";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request, "logout");
  } catch {
    await recordSecurityAccessDenied({
      alertType: SECURITY_EVENT_TYPES.sameOriginBlocked,
      title: "Logout bloqueado por same-origin",
      description: "Se intentó cerrar sesión desde un origen no permitido.",
      severity: "INFO",
      entityType: "SecurityEvent",
      entityId: "logout:same-origin",
    });
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  await clearSessionCookie();
  const url = new URL("/login", request.url);
  return NextResponse.redirect(url, { status: 303 });
}
