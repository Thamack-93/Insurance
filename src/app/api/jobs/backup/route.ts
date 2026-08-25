import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runBackupJob } from "@/lib/backup-job";
import { logError } from "@/lib/logger";
import { acquirePostgresAdvisoryLock } from "@/lib/postgres-advisory-lock";

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

  const lock = await acquirePostgresAdvisoryLock("policydesk:backup-job");
  if (!lock.acquired) {
    return lock.backend === "unavailable"
      ? NextResponse.json({ ok: false, error: "El control de ejecución no está disponible." }, { status: 503 })
      : NextResponse.json({ ok: false, error: "Ya existe un backup en ejecución." }, { status: 409 });
  }
  try {
    const result = await runBackupJob();
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
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
