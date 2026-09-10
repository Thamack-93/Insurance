import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runDemoRetention } from "@/lib/demo-retention";
import { acquireDistributedLock } from "@/lib/request-guards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const lock = await acquireDistributedLock("demo-retention", 15 * 60_000, true);
  if (!lock.acquired) return NextResponse.json({ ok: false, error: "Retention job already running." }, { status: 409 });
  try {
    return NextResponse.json({ ok: true, ...(await runDemoRetention()) });
  } catch {
    return NextResponse.json({ ok: false, error: "Demo retention failed." }, { status: 500 });
  } finally {
    await lock.release();
  }
}

export const POST = GET;
