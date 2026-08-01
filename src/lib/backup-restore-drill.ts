import type { BackupManifest } from "@/lib/backup-logic";
import type { RestoreFailureCode } from "@/lib/backup-restore-errors";
import { RestoreStageError, type RestoreResult } from "@/lib/backup-restore";
import { runRestoreApplicationReads, type RestoreApplicationReadResult } from "@/lib/backup-restore-smoke";
import {
  createEmptyDrillReport,
  sanitizeRestoreDrillError,
  type DrillStage,
  type RestoreDrillReport,
} from "@/lib/backup-restore-report";

export type FixtureLifecycleResult = {
  enabled: boolean;
  created: boolean;
  cleanupAttempted: boolean;
  cleanupVerified: boolean;
  ok: boolean;
};

export type PlaywrightSmokeResult = {
  ok: boolean;
  skipped?: boolean;
  failureCode?: "APP_SMOKE_FAILED" | "FIXTURE_CREATION_FAILED" | "FIXTURE_CLEANUP_FAILED";
  sanitizedError?: string;
};

export class RestoreDrillOrchestrationError extends Error {
  constructor(
    message: string,
    readonly code: RestoreFailureCode,
    readonly stage: DrillStage = "post-commit-smoke",
  ) {
    super(message);
    this.name = "RestoreDrillOrchestrationError";
  }
}

export type RestoreDrillDependencies = {
  preflight?: () => Promise<unknown>;
  applyMigrations: () => Promise<unknown>;
  restore: () => Promise<RestoreResult>;
  applicationReads?: (targetDatabaseUrl: string) => Promise<RestoreApplicationReadResult>;
  workItemAudit: () => Promise<{ status?: string; [key: string]: unknown }>;
  migrationDrift: () => Promise<unknown>;
  appSmoke?: () => Promise<{
    playwrightSmoke: PlaywrightSmokeResult;
    fixtureLifecycle: FixtureLifecycleResult;
  }>;
  writeReport: (report: RestoreDrillReport) => Promise<string>;
};

export type RestoreDrillExecutionInput = {
  backupFilename: string;
  targetDatabaseUrl: string;
  manifest: BackupManifest;
  startedAt?: Date;
  appSmokeEnabled: boolean;
  dependencies: RestoreDrillDependencies;
};

export async function runBackupRestoreDrill(input: RestoreDrillExecutionInput) {
  const startedAt = input.startedAt ?? new Date();
  const report = createEmptyDrillReport({
    backupFilename: input.backupFilename,
    startedAt: startedAt.toISOString(),
    backupCreatedAt: input.manifest.createdAt,
    keyVersion: input.manifest.encryption.keyVersion,
  });
  let stage: DrillStage = "preflight";

  try {
    if (input.dependencies.preflight) await input.dependencies.preflight();
    report.migrationResult = await input.dependencies.applyMigrations();
    stage = "insertion";
    const restored = await input.dependencies.restore();
    report.restoreIntegrity = {
      ok: true,
      targetFingerprint: restored.targetFingerprint,
      tableCounts: restored.tableCounts,
      foreignKeys: restored.foreignKeys,
      domainChecks: restored.domainChecks,
      sequences: restored.sequences,
    };
    report.tableCounts = restored.tableCounts.tables;
    report.totalRows = restored.tableCounts.totalRows;
    report.fkChecks = restored.foreignKeys;
    report.domainChecks = restored.domainChecks;

    stage = "post-commit-smoke";
    let applicationReads: RestoreApplicationReadResult;
    try {
      applicationReads = await (input.dependencies.applicationReads ?? runRestoreApplicationReads)(input.targetDatabaseUrl);
    } catch (error) {
      throw new RestoreDrillOrchestrationError(sanitizeRestoreDrillError(error), "APPLICATION_READ_FAILED");
    }
    report.applicationReads = applicationReads;
    if (!applicationReads.ok) {
      throw new RestoreDrillOrchestrationError("Las lecturas de aplicación no pasaron.", "APPLICATION_READ_FAILED");
    }

    let workItemAudit: Awaited<ReturnType<RestoreDrillDependencies["workItemAudit"]>>;
    try {
      workItemAudit = await input.dependencies.workItemAudit();
    } catch (error) {
      throw new RestoreDrillOrchestrationError(sanitizeRestoreDrillError(error), "WORKITEM_AUDIT_FAILED");
    }
    report.workItemAudit = workItemAudit;
    if (workItemAudit.status !== "PASS") {
      throw new RestoreDrillOrchestrationError("La auditoría WorkItem no pasó.", "WORKITEM_AUDIT_FAILED");
    }

    let migrationDrift: unknown;
    try {
      migrationDrift = await input.dependencies.migrationDrift();
    } catch (error) {
      throw new RestoreDrillOrchestrationError(sanitizeRestoreDrillError(error), "PRISMA_DRIFT_FAILED");
    }
    report.migrationResult = { deploy: report.migrationResult, drift: migrationDrift };

    if (!input.appSmokeEnabled || !input.dependencies.appSmoke) {
      report.playwrightSmoke = { ok: true, skipped: true };
      report.fixtureLifecycle = { enabled: false, created: false, cleanupAttempted: false, cleanupVerified: false, ok: true };
    } else {
      type AppSmokeResult = Awaited<ReturnType<NonNullable<RestoreDrillDependencies["appSmoke"]>>>;
      let smoke: AppSmokeResult;
      try {
        smoke = await input.dependencies.appSmoke();
      } catch (error) {
        throw new RestoreDrillOrchestrationError(sanitizeRestoreDrillError(error), "APP_SMOKE_FAILED");
      }
      report.playwrightSmoke = smoke.playwrightSmoke;
      report.fixtureLifecycle = smoke.fixtureLifecycle;
      if (!smoke.playwrightSmoke.ok || !smoke.fixtureLifecycle.ok) {
        throw new RestoreDrillOrchestrationError(
          smoke.playwrightSmoke.sanitizedError ?? "El smoke de aplicación no pasó.",
          smoke.fixtureLifecycle.cleanupAttempted && !smoke.fixtureLifecycle.cleanupVerified
            ? "FIXTURE_CLEANUP_FAILED"
            : smoke.playwrightSmoke.failureCode ?? "APP_SMOKE_FAILED",
        );
      }
    }

    report.finalStatus = "PASS";
    report.failureCode = null;
    report.failureStage = null;
  } catch (error) {
    report.finalStatus = "FAIL";
    report.failureStage = error instanceof RestoreStageError ? error.stage : stage;
    report.failureCode = error instanceof RestoreStageError
      ? error.code
      : error instanceof RestoreDrillOrchestrationError
        ? error.code
        : "UNKNOWN";
    report.sanitizedError = sanitizeRestoreDrillError(error);
  } finally {
    const completedAt = new Date();
    report.completedAt = completedAt.toISOString();
    report.durationMs = completedAt.getTime() - startedAt.getTime();
    await input.dependencies.writeReport(report);
  }

  return report;
}
