import { NextResponse } from "next/server";
import { gateway, generateText } from "ai";
import { requireUser } from "@/lib/auth";
import { getAssistantAiConnectionStatus, getAssistantStructuredModel } from "@/lib/assistant-ai";
import { logError } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireUser();
    if (user.role !== "ADMIN") {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const configured = getAssistantAiConnectionStatus();
    if (!configured.available) {
      return NextResponse.json({ ok: false, status: configured, error: "El gateway no está configurado." }, { status: 503 });
    }

    const startedAt = Date.now();
    const result = await generateText({
      model: gateway(getAssistantStructuredModel()),
      prompt: "Responde únicamente OK.",
      temperature: 0,
      maxOutputTokens: 8,
      abortSignal: AbortSignal.timeout(8_000),
      providerOptions: { gateway: { user: user.id, tags: ["feature:assistant-health", "surface:admin"] } },
    });

    return NextResponse.json({
      ok: true,
      status: { ...configured, connectionState: "verified" },
      model: getAssistantStructuredModel(),
      response: result.text.trim().slice(0, 32),
      latencyMs: Date.now() - startedAt,
    });
  } catch (error) {
    logError("api.admin.assistant.health", error);
    return NextResponse.json({ ok: false, error: "El gateway no respondió la prueba de conexión." }, { status: 502 });
  }
}
