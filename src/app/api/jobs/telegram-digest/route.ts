import { NextRequest, NextResponse } from "next/server";
import { logError } from "@/lib/logger";
import { sendDailyTelegramDigests } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Vercel runs this route once per day. The handler sends the daily summary for any
// connected channel that has not already been sent today.
function hasValidCronSecret(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!hasValidCronSecret(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await sendDailyTelegramDigests();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    logError("api.jobs.telegram-digest", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
