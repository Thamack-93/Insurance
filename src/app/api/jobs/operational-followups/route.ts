import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/logger";
import { runClaimFollowUpScan } from "@/lib/claim-followups";
import { runCollectionFollowUpScan } from "@/lib/collection-followups";
import { runQualitasReceiptMonitorScan } from "@/lib/qualitas-receipt-monitor";
import { checkDistributedRateLimit, securityFingerprint } from "@/lib/request-guards";
import { rateLimitResponse } from "@/lib/api-security";
import { withPlatformCronAdmission } from "@/lib/platform-cron-admission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  const value = request.headers.get("authorization");
  if (!secret || !value) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(value);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return withPlatformCronAdmission(async () => {
    const limited = await checkDistributedRateLimit(`cron:operational-followups:${securityFingerprint("operational-followups")}`, { limit: 2, windowMs: 15 * 60 * 1000, requireDistributed: true });
    if (!limited.allowed) return rateLimitResponse(limited, "Este job ya fue ejecutado recientemente.");
    try {
      const organizations = await getDb().organization.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
      const results: Array<{ claims: Awaited<ReturnType<typeof runClaimFollowUpScan>>; collections: Awaited<ReturnType<typeof runCollectionFollowUpScan>>; qualitas: Awaited<ReturnType<typeof runQualitasReceiptMonitorScan>> }> = [];
      const failures: string[] = [];
      for (let index = 0; index < organizations.length; index += 3) {
        const batch = await Promise.allSettled(organizations.slice(index, index + 3).map(async ({ id }) => ({ id, claims: await runClaimFollowUpScan(id), collections: await runCollectionFollowUpScan(id), qualitas: await runQualitasReceiptMonitorScan(id) })));
        for (const result of batch) {
          if (result.status === "fulfilled") results.push(result.value);
          else failures.push(String(result.reason));
        }
      }
      return NextResponse.json({ ok: failures.length === 0, organizations: results.length, failures: failures.length, claims: results.reduce((n, item) => n + item.claims.scanned, 0), overdue: results.reduce((n, item) => n + item.claims.overdue, 0), escalated: results.reduce((n, item) => n + item.claims.escalated, 0), collections: results.reduce((n, item) => n + item.collections.scanned, 0), brokenPromises: results.reduce((n, item) => n + item.collections.brokenPromises, 0), qualitasPolicies: results.reduce((n, item) => n + item.qualitas.scanned, 0), qualitasAdvanced: results.reduce((n, item) => n + item.qualitas.advanced, 0), qualitasInconclusive: results.reduce((n, item) => n + item.qualitas.inconclusive, 0), qualitasAlertsCreated: results.reduce((n, item) => n + item.qualitas.alertsCreated, 0), notificationsCreated: results.reduce((n, item) => n + item.claims.notificationsCreated + item.collections.notificationsCreated + item.qualitas.alertsCreated, 0) }, { status: failures.length === 0 ? 200 : 207 });
    } catch (error) {
      logError("api.jobs.operational-followups", error);
      return NextResponse.json({ ok: false }, { status: 500 });
    }
  });
}
