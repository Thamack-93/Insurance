import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runBackupJob } from "@/lib/backup-job";
import { logError } from "@/lib/logger";
import { acquireDistributedLock, checkDistributedRateLimit, securityFingerprint } from "@/lib/request-guards";
import { rateLimitResponse } from "@/lib/api-security";

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

async function handleBackupRequest(request: Request) {
  if (!hasValidCronSecret(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const caller = securityFingerprint(request.headers.get("user-agent") ?? "cron");
  const rateLimit = await checkDistributedRateLimit(`backup:${caller}`, {
    limit: 2,
    windowMs: 15 * 60 * 1000,
    requireDistributed: true,
  });
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit, "El backup está temporalmente limitado.");

  const lock = await acquireDistributedLock("backup-job", 5 * 60 * 1000, true);
  if (!lock.acquired) {
    return lock.backend === "unavailable"
      ? NextResponse.json({ ok: false, error: "El control de ejecución no está disponible." }, { status: 503 })
      : NextResponse.json({ ok: false, error: "Ya existe un backup en ejecución." }, { status: 409 });
  }
  try {
    return NextResponse.json(await runBackupJob());
  } catch (error) {
    logError("api.jobs.backup", error);
    return NextResponse.json({ ok: false, error: "Backup failed" }, { status: 500 });
  } finally {
    await lock.release();
  }
}

export async function POST(request: Request) {
  return handleBackupRequest(request);
}

export async function GET(request: Request) {
  return handleBackupRequest(request);
}
