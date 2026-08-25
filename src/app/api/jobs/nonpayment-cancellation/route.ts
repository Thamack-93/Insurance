import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { logError } from "@/lib/logger";
import { runNonPaymentCancellationJob } from "@/lib/nonpayment-cancellation";
import { acquirePostgresAdvisoryLock } from "@/lib/postgres-advisory-lock";

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

export async function GET(request: NextRequest) {
  if (!hasValidCronSecret(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const lock = await acquirePostgresAdvisoryLock("policydesk:nonpayment-cancellation");
  if (!lock.acquired) {
    return lock.backend === "unavailable"
      ? NextResponse.json({ ok: false, error: "El control de ejecución no está disponible." }, { status: 503 })
      : NextResponse.json({ ok: false, error: "La cancelación por impago ya está en ejecución." }, { status: 409 });
  }

  try {
    return NextResponse.json(await runNonPaymentCancellationJob());
  } catch (error) {
    logError("api.jobs.nonpayment-cancellation", error);
    return NextResponse.json({ ok: false, error: "Non-payment cancellation failed" }, { status: 500 });
  } finally {
    await lock.release();
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
