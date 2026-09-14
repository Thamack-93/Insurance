import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db";
import { evaluateProductionEnv } from "@/lib/production-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Protected by deployment networking or an external monitor credential. */
function authorized(request: Request) {
  const expected = process.env.MONITOR_TOKEN?.trim();
  if (!expected) return process.env.NODE_ENV !== "production";
  const received = request.headers.get("authorization") ?? "";
  const expectedBytes = Buffer.from(`Bearer ${expected}`);
  const receivedBytes = Buffer.from(received);
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const productionRuntime = process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
  const configuration = evaluateProductionEnv(process.env, "runtime");
  const checks = {
    database: false,
    sessionSecret: Boolean(process.env.SESSION_SECRET || process.env.AUTH_SECRET),
    blob: process.env.ENABLE_DOCUMENT_FILES === "false" || Boolean(process.env.BLOB_READ_WRITE_TOKEN),
    configuration: !productionRuntime || configuration.failures.length === 0,
  };
  try {
    await getDb().$queryRaw`SELECT 1`;
    checks.database = true;
  } catch {}
  const ready = Object.values(checks).every(Boolean);
  return NextResponse.json({ ok: ready, service: "policydesk", checks, configurationFailureCount: productionRuntime ? configuration.failures.length : 0, timestamp: new Date().toISOString() }, { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store, max-age=0" } });
}
