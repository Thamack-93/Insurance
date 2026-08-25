import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const acquirePostgresAdvisoryLock = vi.hoisted(() => vi.fn());
const runNonPaymentCancellationJob = vi.hoisted(() => vi.fn());
const runBackupJob = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));
vi.mock("@/lib/postgres-advisory-lock", () => ({ acquirePostgresAdvisoryLock }));
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
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalSecret;
  });

  it("returns 409 when non-payment cancellation is already running", async () => {
    acquirePostgresAdvisoryLock.mockResolvedValue({ acquired: false, backend: "postgres", release: vi.fn() });
    expect((await runNonpayment(request() as never)).status).toBe(409);
    expect(runNonPaymentCancellationJob).not.toHaveBeenCalled();
  });

  it("returns 503 when the backup lock cannot be established", async () => {
    acquirePostgresAdvisoryLock.mockResolvedValue({ acquired: false, backend: "unavailable", release: vi.fn() });
    expect((await runBackup(request())).status).toBe(503);
    expect(runBackupJob).not.toHaveBeenCalled();
  });

  it("releases the backup lock and returns a failing cron status for partial failures", async () => {
    const release = vi.fn();
    acquirePostgresAdvisoryLock.mockResolvedValue({ acquired: true, backend: "postgres", release });
    runBackupJob.mockResolvedValue({ ok: false, failures: 1 });
    expect((await runBackup(request())).status).toBe(500);
    expect(release).toHaveBeenCalledTimes(1);
  });
});
