import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth";
import { buildAssistantReply, getAssistantHomeSnapshot } from "@/lib/assistant";
import { logError } from "@/lib/logger";
import { assertSameOrigin } from "@/lib/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const messageSchema = z.object({
  message: z.string().trim().min(1).max(2_000),
});

export async function GET() {
  const startedAt = Date.now();
  try {
    const user = await requireUser();
    console.log(
      JSON.stringify({
        level: "info",
        msg: "assistant.get.start",
        route: "/api/assistant",
        requestId: null,
        userId: user.id,
      }),
    );
    const snapshot = await getAssistantHomeSnapshot({
      id: user.id,
      role: user.role === "ADMIN" ? "ADMIN" : "AGENT",
    });
    console.log(
      JSON.stringify({
        level: "info",
        msg: "assistant.get.done",
        route: "/api/assistant",
        durationMs: Date.now() - startedAt,
        userId: user.id,
      }),
    );
    return NextResponse.json({ success: true, snapshot });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logError("api.assistant.get", error);
    return NextResponse.json({ error: "No se pudo cargar el asistente." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  try {
    const user = await requireUser();
    const requestId = request.headers.get("x-vercel-id");
    console.log(
      JSON.stringify({
        level: "info",
        msg: "assistant.post.start",
        route: "/api/assistant",
        requestId,
        userId: user.id,
      }),
    );
    try {
      assertSameOrigin(request, "assistant request");
    } catch {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }

    let payload: z.infer<typeof messageSchema>;
    try {
      payload = messageSchema.parse(await request.json());
    } catch {
      return NextResponse.json({ error: "El mensaje no es válido." }, { status: 400 });
    }

    const response = await buildAssistantReply({
      id: user.id,
      role: user.role === "ADMIN" ? "ADMIN" : "AGENT",
    }, payload.message);

    console.log(
      JSON.stringify({
        level: "info",
        msg: "assistant.post.done",
        route: "/api/assistant",
        requestId,
        durationMs: Date.now() - startedAt,
        userId: user.id,
        source: response.source,
        aiRunId: response.aiRunId,
        aiTier: response.aiTier,
        aiModel: response.aiModel,
        aiAttempts: response.aiAttempts,
        reportId: response.reportId,
      }),
    );

    return NextResponse.json({ success: true, response });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logError("api.assistant.post", error, { durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "No se pudo responder la consulta." }, { status: 500 });
  }
}
