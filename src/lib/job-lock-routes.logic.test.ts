import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const withPlatformCronAdmission = vi.hoisted(() => vi.fn());
const runNonPaymentCancellationJob = vi.hoisted(() => vi.fn());
const runBackupJob = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/platform-cron-admission", () => ({ withPlatformCronAdmission }));
vi.mock("@/lib/nonpayment-cancellation", () => ({ runNonPaymentCancellationJob }));
vi.mock("@/lib/backup-job", () => ({ runBackupJob }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import { GET as runNonpayment } from "@/app/api/jobs/nonpayment-cancellation/route";
import { GET as runBackup } from "@/app/api/jobs/backup/route";

function request() {
  return new Request("http://localhost/api/jobs/test", { headers: { authorization: "Bearer test-cron" } });
}

describe("PostgreSQL cron advisory locks", () => {
  const originalSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-cron";
    withPlatformCronAdmission.mockImplementation((work: () => Promise<Response>) => work());
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it("returns 409 when non-payment cancellation is already running", async () => {
    withPlatformCronAdmission.mockResolvedValueOnce(new Response(null, { status: 409 }));
    expect((await runNonpayment(request() as never)).status).toBe(409);
    expect(runNonPaymentCancellationJob).not.toHaveBeenCalled();
  });

  it("returns 409 when a backup is already running", async () => {
    withPlatformCronAdmission.mockResolvedValueOnce(new Response(null, { status: 409 }));
    expect((await runBackup(request())).status).toBe(409);
    expect(runBackupJob).not.toHaveBeenCalled();
  });

  it("keeps unauthorized requests outside the platform maintenance gate", async () => {
    process.env.CRON_SECRET = "different-secret";
    expect((await runBackup(request())).status).toBe(401);
    expect(withPlatformCronAdmission).not.toHaveBeenCalled();
    expect(runBackupJob).not.toHaveBeenCalled();
  });

  it("returns a failing cron status for partial backup failures", async () => {
    runBackupJob.mockResolvedValue({ ok: false, failures: 1 });
    expect((await runBackup(request())).status).toBe(500);
    expect(runBackupJob).toHaveBeenCalledOnce();
  });
});
