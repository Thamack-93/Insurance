import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runBackupJob } from "@/lib/backup-job";
import { logError } from "@/lib/logger";

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
  try {
    const force = new URL(request.url).searchParams.get("force") === "1";
    return NextResponse.json(await runBackupJob({ force }));
  } catch (error) {
    logError("api.jobs.backup", error);
    return NextResponse.json({ ok: false, error: "Backup failed" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handleBackupRequest(request);
}

export async function POST(request: Request) {
  return handleBackupRequest(request);
}
