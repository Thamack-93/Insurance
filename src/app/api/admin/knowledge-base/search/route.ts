import { NextResponse } from "next/server";
import { requireOrganizationRole } from "@/lib/organization-context";
import { buildGmmPrivacyReply, evaluateGmmPrivacy } from "@/lib/assistant-guardrails";
import { previewInternalKnowledgeSource } from "@/lib/knowledge-base";

export async function GET(request: Request) {
  try {
    const context = await requireOrganizationRole(["OWNER", "ADMIN"]);
    const url = new URL(request.url);
    const question = url.searchParams.get("q")?.trim() ?? "";
    if (!question) return NextResponse.json({ error: "q es obligatorio." }, { status: 400 });
    if (!evaluateGmmPrivacy(question, false).allowed) return NextResponse.json({ error: buildGmmPrivacyReply(), blocked: true }, { status: 422 });
    const parsedLimit = Number(url.searchParams.get("limit") ?? 5);
    const result = await previewInternalKnowledgeSource({
      organizationId: context.organizationId,
      question,
      sourceId: url.searchParams.get("sourceId"),
      limit: Number.isFinite(parsedLimit) ? parsedLimit : 5,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo buscar la base de conocimiento." }, { status: 403 });
  }
}
