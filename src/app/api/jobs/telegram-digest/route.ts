import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { logError } from "@/lib/logger";
import { sendDailyTelegramDigests } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel runs this route once per day. The handler sends the daily Telegram summary
// for any connected channel that has not already been sent today.
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

  try {
    const telegram = await sendDailyTelegramDigests();
    return NextResponse.json(
      {
        ok: true,
        telegram,
      },
      { status: 200 },
    );
  } catch (error) {
    logError("api.jobs.telegram-digest", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
