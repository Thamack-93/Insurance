import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { purgeExpiredBonusRuns } from "@/lib/bonus-run-retention";
import { withPlatformCronAdmission } from "@/lib/platform-cron-admission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function hasValidCronSecret(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  const authorization = request.headers.get("authorization");
  if (!secret || !authorization) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(authorization);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export async function GET(request: Request) {
  if (!hasValidCronSecret(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return withPlatformCronAdmission(async () => {
    try {
      const result = await purgeExpiredBonusRuns();
      return NextResponse.json({ ok: result.failedOrganizations === 0, ...result }, { status: result.failedOrganizations ? 207 : 200 });
    } catch {
      return NextResponse.json({ ok: false, error: "Bonus run retention failed." }, { status: 500 });
    }
  }, "bonus-run-retention");
}

export const POST = GET;
