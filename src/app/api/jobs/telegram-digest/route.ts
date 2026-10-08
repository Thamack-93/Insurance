import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { logError } from "@/lib/logger";
import { sendDailyTelegramDigests } from "@/lib/telegram";
import { checkDistributedRateLimit, securityFingerprint } from "@/lib/request-guards";
import { rateLimitResponse } from "@/lib/api-security";
import { withPlatformCronAdmission } from "@/lib/platform-cron-admission";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Vercel invokes this route once daily at the fixed delivery time configured in
// vercel.json. Duplicate protection remains local-date based per user.
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

  return withPlatformCronAdmission(async () => {
    const rateLimit = await checkDistributedRateLimit(`cron:telegram-digest:${securityFingerprint("telegram-digest")}`, {
      limit: 2,
      windowMs: 15 * 60 * 1000,
      requireDistributed: true,
    });
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit, "Este job ya fue ejecutado recientemente.");

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
  });
}
