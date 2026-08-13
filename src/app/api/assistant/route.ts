import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth";
import { buildAssistantReply, getAssistantHomeSnapshot } from "@/lib/assistant";
import { logError } from "@/lib/logger";
import { assertSameOrigin, checkDistributedRateLimit, getRequestIp, readJsonBody, RequestGuardError } from "@/lib/request-guards";
import { noraContextRefSchema, resolveAuthorizedNoraContext } from "@/lib/nora-context";
import { requirePortfolioReadScope } from "@/lib/portfolio-access";
import { rateLimitResponse, guardErrorResponse } from "@/lib/api-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const messageSchema = z.object({
  message: z.string().trim().min(1).max(2_000),
  context: noraContextRefSchema.nullish(),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(2_000) })).max(6).optional(),
}).superRefine((value, context) => {
  const historyLength = (value.history ?? []).reduce((total, message) => total + message.content.length, 0);
  if (historyLength > 6_000) context.addIssue({ code: "custom", path: ["history"], message: "El historial excede el límite permitido." });
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

    const rateLimit = await checkDistributedRateLimit(`assistant:${user.id}:${getRequestIp(request)}`, {
      limit: 20,
      windowMs: 15 * 60 * 1000,
      requireDistributed: true,
    });
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit, "Demasiadas consultas al asistente.");

    let payload: z.infer<typeof messageSchema>;
    try {
      payload = messageSchema.parse(await readJsonBody(request, 16 * 1024));
    } catch {
      return NextResponse.json({ error: "El mensaje no es válido." }, { status: 400 });
    }

    let contextText: string | null = null;
    let gmmMetadataOnly = false;
    if (payload.context) {
      const scope = await requirePortfolioReadScope();
      const context = await resolveAuthorizedNoraContext(payload.context, scope.portfolioOwnerId);
      if (!context) {
        return NextResponse.json({ error: "El contexto de Nora no existe o no está autorizado." }, { status: 400 });
      }
      contextText = `${context.type} ${context.label}`;
      gmmMetadataOnly = "policyType" in context && context.policyType === "GMM";
    }

    const response = await buildAssistantReply({
      id: user.id,
      role: user.role === "ADMIN" ? "ADMIN" : "AGENT",
    }, payload.message, { history: payload.history, contextText, gmmMetadataOnly });

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
    if (error instanceof RequestGuardError) return guardErrorResponse(error, "No se pudo procesar la consulta.");
    logError("api.assistant.post", error, { durationMs: Date.now() - startedAt });
    return NextResponse.json({ error: "No se pudo responder la consulta." }, { status: 500 });
  }
}
