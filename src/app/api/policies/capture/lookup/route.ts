import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth";
import { logError } from "@/lib/logger";
import { checkRateLimit, getRequestIp } from "@/lib/request-guards";
import { getPortfolioOwnerIdForRead } from "@/lib/portfolio-access";
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
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const payload = lookupSchema.parse({
      q: searchParams.get("q") ?? "",
      kind: searchParams.get("kind") ?? "client",
      clientId: searchParams.get("clientId"),
      insurerId: searchParams.get("insurerId"),
    });
    query = payload.q;
    const portfolioOwnerId = getPortfolioOwnerIdForRead(user);

    const rateLimit = checkRateLimit(`policy-capture-lookup:${getRequestIp(request)}`, {
      limit: 60,
      windowMs: 60 * 1000,
    });
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: "Demasiadas búsquedas. Intenta de nuevo en un momento." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000))) },
        },
      );
    }

    const items = await searchPolicyCaptureEntities(payload.kind, payload.q, {
      clientId: payload.clientId,
      insurerId: payload.insurerId,
      portfolioOwnerId,
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
