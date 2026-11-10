import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { cleanupExpiredNoraTemporaryBlobs } from "@/lib/nora-temporary-blob-ledger";
import { logError } from "@/lib/logger";
import { acquireDistributedLock } from "@/lib/request-guards";
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
    const lock = await acquireDistributedLock("nora-temporary-blob-cleanup", 14 * 60_000, true);
    if (!lock.acquired) return NextResponse.json({ ok: false, error: "Nora Blob cleanup is already running." }, { status: 409 });
    try {
      const result = await cleanupExpiredNoraTemporaryBlobs();
      return NextResponse.json({ ok: result.failed === 0, ...result }, { status: result.failed === 0 ? 200 : 500 });
    } catch (error) {
      logError("api.jobs.noraBlobCleanup", error);
      return NextResponse.json({ ok: false, error: "Nora Blob cleanup failed." }, { status: 500 });
    } finally {
      await lock.release();
    }
  }, "policydesk:nora-temporary-blob-cleanup");
}

export const POST = GET;
