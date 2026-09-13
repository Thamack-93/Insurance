import { NextResponse } from "next/server";
import { requireOrganizationRole, withTenantTransaction } from "@/lib/organization-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function expectedRunAt(type: string, now = new Date()) {
  const expected = new Date(now);
  if (type === "RENEWAL_FOLLOWUP") expected.setUTCHours(13, 30, 0, 0);
  else expected.setUTCHours(14, 0, 0, 0);
  if (expected > now) expected.setUTCDate(expected.getUTCDate() - 1);
  return expected;
}

export async function GET() {
  try {
    const context = await requireOrganizationRole(["OWNER", "ADMIN"]);
    const runs = await withTenantTransaction(context, (db) => db.maintenanceRun.findMany({ where: { organizationId: context.organizationId }, orderBy: { startedAt: "desc" }, take: 20, select: { id: true, type: true, status: true, startedAt: true, completedAt: true, summaryJson: true } }));
    const now = new Date();
    const latestByType = new Map<string, (typeof runs)[number]>();
    for (const run of runs) if (!latestByType.has(run.type)) latestByType.set(run.type, run);
    const monitoredTypes = ["CLAIM_FOLLOWUP", "COLLECTION_FOLLOWUP", "RENEWAL_FOLLOWUP"];
    const missed = monitoredTypes.filter((type) => {
      const latest = latestByType.get(type);
      const expected = expectedRunAt(type, now);
      const thresholdReached = now.getTime() >= expected.getTime() + 2 * 60 * 60 * 1000;
      return thresholdReached && (!latest || latest.startedAt < expected || latest.status === "FAILED");
    });
    return NextResponse.json({ ok: missed.length === 0, runs, missed, missedThresholdHours: 2 });
  } catch {
    return NextResponse.json({ ok: false, error: "No autorizado." }, { status: 403 });
  }
}
