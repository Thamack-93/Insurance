import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RestoreFailureCode } from "@/lib/backup-restore-errors";

export type DrillStage = "preflight" | "backup-verification" | "insertion" | "integrity" | "post-commit-smoke";
export type DrillStatus = "PASS" | "FAIL";

export type RestoreDrillReport = {
  drillVersion: 1;
  backupFilename: string;
  backupCreatedAt: string | null;
  keyVersion: string | null;
  manifestHash: string | null;
  sanitizedTargetFingerprint: string | null;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  tableCounts: unknown;
  totalRows: unknown;
  migrationResult: unknown;
  fkChecks: unknown;
  domainChecks: unknown;
  workItemAudit: unknown;
  restoreIntegrity: unknown;
  applicationReads: unknown;
  playwrightSmoke: unknown;
  fixtureLifecycle: unknown;
  finalStatus: DrillStatus;
  failureStage: DrillStage | null;
  failureCode: RestoreFailureCode | null;
  sanitizedError: string | null;
};

const REPORT_DIRECTORY = path.join(process.cwd(), "artifacts", "restore-drills");

export function sanitizeRestoreDrillError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, "postgresql://[redacted]")
    .replace(/(DATABASE_URL|RESTORE_DATABASE_URL|DIRECT_URL|POOLER_URL|PRISMA_DIRECT_URL)\s*=\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/(BACKUP_ENCRYPTION_KEY(?:_[A-Z0-9._-]+)?|CRON_SECRET|SESSION_SECRET)\s*=\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/(password|token|secret|credential|key)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 1000);
}

export function createEmptyDrillReport(input: {
  backupFilename: string;
  startedAt: string;
  backupCreatedAt?: string | null;
  keyVersion?: string | null;
  manifestHash?: string | null;
  targetFingerprint?: string | null;
}): RestoreDrillReport {
  return {
    drillVersion: 1,
    backupFilename: input.backupFilename,
    backupCreatedAt: input.backupCreatedAt ?? null,
    keyVersion: input.keyVersion ?? null,
    manifestHash: input.manifestHash ?? null,
    sanitizedTargetFingerprint: input.targetFingerprint ?? null,
    startedAt: input.startedAt,
    completedAt: input.startedAt,
    durationMs: 0,
    tableCounts: null,
    totalRows: null,
    migrationResult: null,
    fkChecks: null,
    domainChecks: null,
    workItemAudit: null,
    restoreIntegrity: null,
    applicationReads: null,
    playwrightSmoke: null,
    fixtureLifecycle: null,
    finalStatus: "FAIL",
    failureStage: null,
    failureCode: null,
    sanitizedError: null,
  };
}

export async function writeRestoreDrillReport(report: RestoreDrillReport) {
  await mkdir(REPORT_DIRECTORY, { recursive: true });
  const timestamp = report.startedAt.replace(/[^0-9]/g, "").slice(0, 14) || String(Date.now());
  const safeName = report.backupFilename.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
  const reportPath = path.join(REPORT_DIRECTORY, `${timestamp}-${safeName}.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return reportPath;
}
