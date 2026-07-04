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
  try {
    const user = await requireUser();
    const snapshot = await getAssistantHomeSnapshot({
      id: user.id,
      role: user.role === "ADMIN" ? "ADMIN" : "AGENT",
    });
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
  try {
    const user = await requireUser();
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

    return NextResponse.json({ success: true, response });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    logError("api.assistant.post", error);
    return NextResponse.json({ error: "No se pudo responder la consulta." }, { status: 500 });
  }
}
