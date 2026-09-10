import { NextRequest, NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth";
import { requireOrganizationContext } from "@/lib/organization-context";
import { resolveOrganizationCapability } from "@/lib/organization-capabilities";
import { assertSameOrigin, readJsonBody } from "@/lib/request-guards";
import { isNoraPolicyPdfPathname } from "@/lib/nora-pdf-storage.shared";
import { cleanupExpiredNoraCaptureHandoffs } from "@/lib/nora-capture-handoff-storage";

export const runtime = "nodejs";

const cleanupSchema = z.object({ url: z.string().url() });

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const organization = await requireOrganizationContext();
    const noraCapability = await resolveOrganizationCapability(organization.organizationId, "NORA");
    if (!noraCapability.enabled) return NextResponse.json({ error: "Nora no está habilitada para esta organización." }, { status: 403 });
    assertSameOrigin(request, "nora policy pdf cleanup");
    const payload = cleanupSchema.parse(await readJsonBody(request, 8 * 1024));
    const url = new URL(payload.url);
    if (!isNoraPolicyPdfPathname(url.pathname.replace(/^\/+/, ""), user.id, organization.organizationId)) {
      return NextResponse.json({ error: "La referencia temporal no pertenece a tu sesión." }, { status: 403 });
    }
    await del(payload.url);
    await cleanupExpiredNoraCaptureHandoffs(user.id).catch(() => undefined);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ error: "La referencia temporal no es válida." }, { status: 400 });
    return NextResponse.json({ error: "No se pudo limpiar el PDF temporal." }, { status: 500 });
  }
}
