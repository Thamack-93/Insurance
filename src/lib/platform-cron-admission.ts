import "server-only";

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { MULTI_ORG_TRANSITION_LOCK } from "@/lib/tenant-cutover-lock";
import { runWithPlatformCronAdmission } from "@/lib/platform-cron-admission.logic";

const retryHeaders = { "Retry-After": "60" };
// Scheduled routes are capped at five minutes. Keep the PostgreSQL idle and
// Prisma transaction limits beyond that ceiling so they cannot release the
// cutover lock while a valid Vercel invocation is still running.
const CRON_ADMISSION_TRANSACTION_TIMEOUT_MS = 600_000;

/**
 * Keep cron work inside an interactive transaction that owns the shared
 * transaction-level advisory lock. This uses the restricted pooled runtime
 * connection and keeps lock ownership pinned for the whole job.
 */
export async function withPlatformCronAdmission(work: () => Promise<Response>, jobLockKey?: string): Promise<Response> {
  const result = await runWithPlatformCronAdmission(work, {
    withSharedLock: async (run) => getDb().$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL idle_in_transaction_session_timeout = '600s'`;
      const lockRows = await tx.$queryRaw<Array<{ acquired: boolean }>>`
        SELECT pg_try_advisory_xact_lock_shared(hashtext(${MULTI_ORG_TRANSITION_LOCK})) AS acquired
      `;
      if (lockRows[0]?.acquired !== true) return { acquired: false as const };
      if (jobLockKey) {
        const jobLockRows = await tx.$queryRaw<Array<{ acquired: boolean }>>`
          SELECT pg_try_advisory_xact_lock(hashtext(${jobLockKey})) AS acquired
        `;
        if (jobLockRows[0]?.acquired !== true) return { acquired: true as const, failure: "busy" as const };
      }
      const value = await run(async () => {
        const state = await tx.platformRuntimeState.findUnique({
          where: { id: 1 },
          select: { writeMode: true },
        });
        return state?.writeMode ?? null;
      });
      return { acquired: true as const, value };
    }, { maxWait: 10_000, timeout: CRON_ADMISSION_TRANSACTION_TIMEOUT_MS }),
  });

  if (result.kind === "completed") return result.value;
  if (result.kind === "blocked") {
    return NextResponse.json({ ok: false, error: "maintenance" }, { status: 503, headers: retryHeaders });
  }
  if (result.kind === "busy") {
    return NextResponse.json({ ok: false, error: "job_already_running" }, { status: 409 });
  }
  return NextResponse.json({ ok: false, error: "maintenance_gate_unavailable" }, { status: 503, headers: retryHeaders });
}
