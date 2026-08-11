import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth";
import { logError } from "@/lib/logger";
import { assertSameOrigin, checkDistributedRateLimit, getRequestIp, readJsonBody } from "@/lib/request-guards";
import { confirmAssistantActionDraft } from "@/lib/assistant-actions";
import { rateLimitResponse, guardErrorResponse } from "@/lib/api-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const confirmSchema = z.object({
  draftId: z.string().trim().min(1).max(255),
});

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();

    try {
      assertSameOrigin(request, "assistant action confirm");
    } catch {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }

    const rateLimit = await checkDistributedRateLimit(`assistant-action-confirm:${getRequestIp(request)}:${user.id}`, {
      limit: 12,
      windowMs: 60 * 1000,
      requireDistributed: true,
    });
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

    let payload: z.infer<typeof confirmSchema>;
    try {
      payload = confirmSchema.parse(await readJsonBody(request, 16 * 1024));
    } catch {
      return NextResponse.json({ error: "La propuesta no es válida." }, { status: 400 });
    }

    const result = await confirmAssistantActionDraft(payload.draftId, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, result }, { status: 400 });
    }

    return NextResponse.json({ success: true, result });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, { status: error.status });
    }
    if (error instanceof Error && (error.message.includes("cuerpo") || error.message.includes("requiere un payload"))) {
      return guardErrorResponse(error);
    }
    logError("api.assistant.actions.confirm", error);
    return NextResponse.json({ error: "No se pudo confirmar la propuesta." }, { status: 500 });
  }
}
