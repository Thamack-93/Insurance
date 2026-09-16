import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { logError } from "@/lib/logger";
import { runRenewalFollowUpScan } from "@/lib/renewal-followups";
import { getDb } from "@/lib/db";
import { checkDistributedRateLimit, securityFingerprint } from "@/lib/request-guards";
import { rateLimitResponse } from "@/lib/api-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function hasValidCronSecret(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization");
  if (!secret || !authorization) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(authorization);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

/**
 * Barrido diario del tablero de renovaciones: deja un pendiente y un aviso por
 * cada renovación que lleva demasiados días sin avanzar. La deduplicación es
 * semanal, así que ejecutarlo de más no genera ruido.
 */
export async function GET(request: NextRequest) {
  if (!hasValidCronSecret(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = await checkDistributedRateLimit(
    `cron:renewal-followups:${securityFingerprint("renewal-followups")}`,
    { limit: 2, windowMs: 15 * 60 * 1000, requireDistributed: true },
  );
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit, "Este job ya fue ejecutado recientemente.");

  try {
    const startedAt = Date.now();
    const organizations = await getDb().organization.findMany({
      where: { status: "ACTIVE" },
      select: { id: true },
    });
    const summaries: Array<Awaited<ReturnType<typeof runRenewalFollowUpScan>>> = [];
    const failures: Array<{ organizationId: string; error: string }> = [];
    for (let index = 0; index < organizations.length; index += 3) {
      const batch = await Promise.allSettled(
        organizations.slice(index, index + 3).map(async ({ id }) => ({
          id,
          summary: await runRenewalFollowUpScan(id),
        })),
      );
      for (const [batchIndex, result] of batch.entries()) {
        if (result.status === "fulfilled") summaries.push(result.value.summary);
        else failures.push({ organizationId: organizations[index + batchIndex]?.id ?? "unknown", error: String(result.reason) });
      }
    }
    const summary = summaries.reduce(
      (total, item) => ({
        scanned: total.scanned + item.scanned,
        stalled: total.stalled + item.stalled,
        workItemsUpserted: total.workItemsUpserted + item.workItemsUpserted,
        workItemsClosed: total.workItemsClosed + item.workItemsClosed,
        notificationsCreated: total.notificationsCreated + item.notificationsCreated,
      }),
      { scanned: 0, stalled: 0, workItemsUpserted: 0, workItemsClosed: 0, notificationsCreated: 0 },
    );
    return NextResponse.json({
      ok: failures.length === 0,
      organizations: summaries.length,
      rowsProcessed: summary.scanned,
      partialErrors: failures.length,
      retries: 0,
      durationMs: Date.now() - startedAt,
      failures,
      ...summary,
    }, { status: failures.length === 0 ? 200 : 207 });
  } catch (error) {
    logError("api.jobs.renewal-followups", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
