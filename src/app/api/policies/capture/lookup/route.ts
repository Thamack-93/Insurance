import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError } from "@/lib/auth";
import { logError } from "@/lib/logger";
import { checkDistributedRateLimit, getRequestIp, securityFingerprint } from "@/lib/request-guards";
import { rateLimitResponse } from "@/lib/api-security";
import { requireOrganizationPortfolioReadScope } from "@/lib/portfolio-access";
import { searchPolicyCaptureEntities } from "@/lib/policy-capture-search";

export const runtime = "nodejs";

const lookupSchema = z.object({
  q: z.string().trim().optional().default(""),
  kind: z.enum(["client", "insurer", "policy"]).default("client"),
  clientId: z.string().trim().optional().nullable(),
  insurerId: z.string().trim().optional().nullable(),
});

export async function GET(request: NextRequest) {
  let query = "";
  try {
    const scope = await requireOrganizationPortfolioReadScope();
    const { searchParams } = new URL(request.url);
    const payload = lookupSchema.parse({
      q: searchParams.get("q") ?? "",
      kind: searchParams.get("kind") ?? "client",
      clientId: searchParams.get("clientId"),
      insurerId: searchParams.get("insurerId"),
    });
    query = payload.q;
    const rateLimit = await checkDistributedRateLimit(`policy-capture-lookup:${securityFingerprint(`ip:${getRequestIp(request)}`)}:${scope.id}`, {
      limit: 60,
      windowMs: 60 * 1000,
      requireDistributed: true,
    });
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit, "Demasiadas búsquedas. Intenta de nuevo en un momento.");

    const items = await searchPolicyCaptureEntities(payload.kind, payload.q, {
      clientId: payload.clientId,
      insurerId: payload.insurerId,
      portfolioOwnerId: scope.portfolioOwnerId,
      organizationId: scope.organizationId,
    });
    return NextResponse.json({ items });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: "No autorizado." }, { status: error.status });
    }
    logError("api.policies.capture.lookup", error, { query });
    return NextResponse.json({ error: "No se pudo buscar en la base." }, { status: 500 });
  }
}
