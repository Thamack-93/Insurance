import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { policyRiskBackfillReviewedHash, type PolicyRiskBackfillManifest } from "../src/lib/policy-risk-backfill-manifest.ts";
import { Prisma, PrismaClient } from "../src/generated/prisma/client.ts";
import { cleanupPolicyFixture, getTestDb, seedPolicyFixture } from "../tests/helpers/db.ts";
import { assertDisposableCertificationTarget } from "./tenant-certification-target.mjs";

const ORGANIZATION_ID = "org_legacy_singleton_0001";
const SOURCE_TEXT = "Toyota, Corolla, 2020, LE";
const VIN = "2T1BURHE0LC123456";

async function withOrganizationContext<T>(
  db: PrismaClient,
  organizationId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT set_config('app.organization_id', ${organizationId}, true)`);
    return work(tx);
  });
}

type BackfillReport = {
  mode: "dry-run" | "production-read-only-preview" | "apply";
  readOnly?: boolean;
  organizationId: string;
  reportFile?: string;
  resultFile?: string;
  manifestSha256?: string;
  runId?: string;
  maintenanceRunId?: string;
  scanned: number;
  converted: number;
  review: number;
  deferred?: number;
  empty: number;
  alreadyApplied?: number;
};

type RunBackfillOptions = { apply?: boolean; productionApply?: boolean; productionPreview?: boolean; readonlyDatabaseUrl?: string; writerDatabaseUrl?: string; productionHost?: string; productionDatabase?: string; batchSize?: number; printReviewedDigest?: boolean; reportFile: string; manifestSha256?: string; previewSha256?: string; reviewer?: string; failAfterAppliedBatches?: number; failWithinBatchAfterAppliedRows?: number; mutatePolicyBeforeBatch?: string };

function runBackfill(options: RunBackfillOptions & { printReviewedDigest: true }): { reviewedManifestSha256: string };
function runBackfill(options: RunBackfillOptions & { printReviewedDigest?: false | undefined }): BackfillReport;
function runBackfill(options: RunBackfillOptions): BackfillReport | { reviewedManifestSha256: string } {
  const args = [
    "--import",
    "tsx",
    "scripts/backfill-policy-risk-details.ts",
    `--organization-id=${ORGANIZATION_ID}`,
    ...(options.productionPreview ? ["--production-preview"] : []),
    ...(options.printReviewedDigest ? ["--print-reviewed-digest", `--reviewed-report=${options.reportFile}`, `--reviewed-by=${options.reviewer}`, `--preview-sha256=${options.previewSha256}`] : options.apply ? ["--apply", ...(options.productionApply ? ["--production-apply", "--confirm-production-apply=APPLY_POLICY_RISK_BACKFILL_TO_PRODUCTION"] : []), `--reviewed-report=${options.reportFile}`, `--reviewed-by=${options.reviewer}`, `--manifest-sha256=${options.manifestSha256}`, `--batch-size=${options.batchSize ?? 50}`, "--confirm-apply=APPLY_POLICY_RISK_BACKFILL"] : [`--report-file=${options.reportFile}`]),
  ];
  const stdout = execFileSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "test",
      TENANT_ISOLATION_TEST_DB: "1",
      PLAYWRIGHT_ENFORCE_DISPOSABLE_DB: "1",
      ...(options.productionPreview ? {
        POLICY_RISK_BACKFILL_READONLY_DATABASE_URL: options.readonlyDatabaseUrl,
        POLICY_RISK_BACKFILL_READONLY_ROLE: "policydesk_readonly",
        POLICY_RISK_BACKFILL_PRODUCTION_HOST: options.productionHost,
        POLICY_RISK_BACKFILL_PRODUCTION_DATABASE: options.productionDatabase,
      } : {}),
      ...(options.productionApply ? {
        POLICY_RISK_BACKFILL_PRODUCTION_APPLY_DATABASE_URL: options.writerDatabaseUrl,
        POLICY_RISK_BACKFILL_PRODUCTION_APPLY_ROLE: "policydesk_backfill",
        POLICY_RISK_BACKFILL_PRODUCTION_HOST: options.productionHost,
        POLICY_RISK_BACKFILL_PRODUCTION_DATABASE: options.productionDatabase,
      } : {}),
      ...(options.failAfterAppliedBatches ? { POLICY_RISK_BACKFILL_TEST_FAIL_AFTER_APPLIED_BATCHES: String(options.failAfterAppliedBatches) } : {}),
      ...(options.failWithinBatchAfterAppliedRows ? { POLICY_RISK_BACKFILL_TEST_FAIL_WITHIN_BATCH_AFTER_APPLIED_ROWS: String(options.failWithinBatchAfterAppliedRows) } : {}),
      ...(options.mutatePolicyBeforeBatch ? { POLICY_RISK_BACKFILL_TEST_MUTATE_POLICY_ID_BEFORE_BATCH: options.mutatePolicyBeforeBatch } : {}),
    },
    maxBuffer: 1024 * 1024,
  });
  return JSON.parse(stdout) as BackfillReport;
}

function temporaryReportPath() {
  return path.join(tmpdir(), `policy-risk-backfill-${randomUUID()}.json`);
}

async function main() {
  if (process.env.NODE_ENV !== "test" || process.env.TENANT_ISOLATION_TEST_DB !== "1" || process.env.PLAYWRIGHT_ENFORCE_DISPOSABLE_DB !== "1") {
    throw new Error("POLICY_RISK_BACKFILL_INTEGRATION_REQUIRES_DISPOSABLE_POSTGRES");
  }

  const adminDatabaseUrl = process.env.DATABASE_ADMIN_URL?.trim() || process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();
  if (!adminDatabaseUrl) throw new Error("POLICY_RISK_BACKFILL_INTEGRATION_ADMIN_DATABASE_URL_REQUIRED");
  assertDisposableCertificationTarget(adminDatabaseUrl, process.env, "source");
  const adminTarget = new URL(adminDatabaseUrl);
  if (!["localhost", "127.0.0.1", "::1"].includes(adminTarget.hostname.toLowerCase())) {
    throw new Error("POLICY_RISK_BACKFILL_INTEGRATION_REQUIRES_LOCAL_DISPOSABLE_POSTGRES");
  }
  // Seed and cleanup use the disposable database owner, even in post-cutover
  // CI where the application connection is restricted.
  process.env.DATABASE_URL = adminDatabaseUrl;
  process.env.DATABASE_URL_UNPOOLED = adminDatabaseUrl;

  const readOnlyApplyAttempt = spawnSync(process.execPath, [
    "--import", "tsx", "scripts/backfill-policy-risk-details.ts",
    `--organization-id=${ORGANIZATION_ID}`, "--production-preview", "--apply",
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, POLICY_RISK_BACKFILL_READONLY_DATABASE_URL: "", POLICY_RISK_BACKFILL_READONLY_ROLE: "" },
  });
  assert.equal(readOnlyApplyAttempt.status, 1);
  assert.match(readOnlyApplyAttempt.stderr, /POLICY_RISK_BACKFILL_PRODUCTION_PREVIEW_IS_READ_ONLY/);

  const db = getTestDb();
  const rlsTestEnabled = process.env.POLICY_RISK_BACKFILL_TEST_RLS_ENABLED === "1";
  let disposableRoleTenantContextConfigured = false;
  if (rlsTestEnabled) {
    // This job is explicitly disposable. Keep the legacy auth fixture and
    // its User-to-membership trigger under the same tenant context after RLS
    // is forced; production/app credentials never receive this role setting.
    await db.$executeRawUnsafe(`ALTER ROLE CURRENT_USER SET "app.organization_id" TO '${ORGANIZATION_ID}'`);
    disposableRoleTenantContextConfigured = true;
    // Role defaults apply at connection startup, so recycle Prisma's pool
    // before seeding helpers that issue their own root-client queries.
    await db.$disconnect();
    await db.$connect();
  }
  let fixture: Awaited<ReturnType<typeof seedPolicyFixture>> | null = null;
  let ambiguousFixture: Awaited<ReturnType<typeof seedPolicyFixture>> | null = null;
  let partyFixture: Awaited<ReturnType<typeof seedPolicyFixture>> | null = null;
  let productionFixture: Awaited<ReturnType<typeof seedPolicyFixture>> | null = null;
  let readonlyRoleCreated = false;
  let writerRoleCreated = false;
  let secondOrganizationId: string | null = null;
  let secondOrganizationClientId: string | null = null;
  let secondOrganizationInsurerId: string | null = null;
  let secondOrganizationPolicyId: string | null = null;
  let reportFile: string | null = null;
  const reportFiles: string[] = [];
  const resultFiles: string[] = [];
  const maintenanceRunIds: string[] = [];
  try {
    const backfillFixture = fixture = await seedPolicyFixture("POLICY-RISK-BACKFILL");
    const reviewFixture = ambiguousFixture = await seedPolicyFixture("POLICY-RISK-REVIEW");
    const insuredPartyFixture = partyFixture = await seedPolicyFixture("POLICY-RISK-PARTY");
    await db.policy.update({
      where: { id: backfillFixture.policyId },
      data: {
        insuredObject: SOURCE_TEXT,
        riskDetails: Prisma.DbNull,
        riskDetailsReviewRequired: false,
      },
    });
    await db.policyInsuredAsset.create({
      data: {
        organizationId: ORGANIZATION_ID,
        policyId: backfillFixture.policyId,
        assetType: "AUTO",
        description: "Toyota Corolla, descripción histórica",
        serialNumber: VIN,
        isPrimary: true,
      },
    });
    await db.policy.update({
      where: { id: reviewFixture.policyId },
      data: { insuredObject: "Texto libre que requiere revisión", riskDetails: Prisma.DbNull, riskDetailsReviewRequired: false },
    });
    await db.policy.update({
      where: { id: insuredPartyFixture.policyId },
      data: { policyType: "VIDA", beneficiaryInfo: null, riskDetails: Prisma.DbNull, riskDetailsReviewRequired: false },
    });
    const legacyParty = await db.policyInsuredParty.create({
      data: { organizationId: ORGANIZATION_ID, policyId: insuredPartyFixture.policyId, fullName: "Backfill Insured Person", isPrimary: false, sourceLabel: "Legacy import" },
    });

    const existingReadonlyRole = await db.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'policydesk_readonly') AS "exists"`);
    if (existingReadonlyRole[0]?.exists) throw new Error("POLICY_RISK_BACKFILL_TEST_READONLY_ROLE_ALREADY_EXISTS");
    const readonlyPassword = randomUUID().replaceAll("-", "");
    await db.$executeRawUnsafe(`CREATE ROLE policydesk_readonly LOGIN NOINHERIT NOBYPASSRLS PASSWORD '${readonlyPassword}'`);
    readonlyRoleCreated = true;
    await db.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO policydesk_readonly');
    await db.$executeRawUnsafe('GRANT SELECT ON TABLE "Organization", "Policy", "PolicyInsuredAsset", "PolicyInsuredParty" TO policydesk_readonly');
    const readonlyUrl = new URL(process.env.DATABASE_URL!);
    readonlyUrl.username = "policydesk_readonly";
    readonlyUrl.password = readonlyPassword;
    const writerPassword = randomUUID().replaceAll("-", "");
    const existingWriterRole = await db.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'policydesk_backfill') AS "exists"`);
    if (existingWriterRole[0]?.exists) throw new Error("POLICY_RISK_BACKFILL_TEST_WRITER_ROLE_ALREADY_EXISTS");
    await db.$executeRawUnsafe(`CREATE ROLE policydesk_backfill LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${writerPassword}'`);
    writerRoleCreated = true;
    await db.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO policydesk_backfill');
    await db.$executeRawUnsafe('GRANT SELECT ("id", "organizationId", "policyNumber", "policyType", "insuredObject", "beneficiaryInfo", "riskDetails") ON TABLE "Policy" TO policydesk_backfill');
    await db.$executeRawUnsafe('GRANT UPDATE ("riskDetails", "insuredObject", "riskDetailsReviewRequired", "updatedAt") ON TABLE "Policy" TO policydesk_backfill');
    await db.$executeRawUnsafe('GRANT SELECT ("id", "organizationId", "policyId", "assetType", "description", "serialNumber", "isPrimary", "createdAt") ON TABLE "PolicyInsuredAsset" TO policydesk_backfill');
    await db.$executeRawUnsafe('GRANT INSERT ("id", "organizationId", "policyId", "assetType", "description", "serialNumber", "isPrimary", "updatedAt") ON TABLE "PolicyInsuredAsset" TO policydesk_backfill');
    await db.$executeRawUnsafe('GRANT SELECT ("id", "organizationId", "policyId", "fullName", "isPrimary", "sourceLabel", "createdAt") ON TABLE "PolicyInsuredParty" TO policydesk_backfill');
    await db.$executeRawUnsafe('GRANT INSERT ("id", "organizationId", "policyId", "fullName", "isPrimary", "sourceLabel", "updatedAt") ON TABLE "PolicyInsuredParty" TO policydesk_backfill');
    await db.$executeRawUnsafe('GRANT SELECT ("id") ON TABLE "MaintenanceRun" TO policydesk_backfill');
    await db.$executeRawUnsafe('GRANT INSERT ("id", "organizationId", "type", "status", "summaryJson", "updatedAt") ON TABLE "MaintenanceRun" TO policydesk_backfill');
    await db.$executeRawUnsafe('GRANT UPDATE ("status", "completedAt", "summaryJson", "updatedAt") ON TABLE "MaintenanceRun" TO policydesk_backfill');
    const writerUrl = new URL(process.env.DATABASE_URL!);
    writerUrl.username = "policydesk_backfill";
    writerUrl.password = writerPassword;
    const productionHost = readonlyUrl.hostname.toLowerCase();
    const productionDatabase = decodeURIComponent(readonlyUrl.pathname.replace(/^\//, "").split("?")[0]);
    const readonlyReportFile = temporaryReportPath();
    reportFiles.push(readonlyReportFile);
    const productionPreview = runBackfill({ productionPreview: true, readonlyDatabaseUrl: readonlyUrl.toString(), productionHost, productionDatabase, reportFile: readonlyReportFile });
    assert.equal(productionPreview.mode, "production-read-only-preview");
    assert.equal(productionPreview.readOnly, true);
    const readonlyManifest = JSON.parse(readFileSync(productionPreview.reportFile!, "utf8")) as PolicyRiskBackfillManifest;
    assert.equal(readonlyManifest.sourceMode, "PRODUCTION_READ_ONLY_PREVIEW");
    assert.ok(readonlyManifest.candidates.some((row) => row.policyId === backfillFixture.policyId));
    assert.ok(readonlyManifest.candidates.some((row) => row.policyId === reviewFixture.policyId));
    assert.ok(readonlyManifest.candidates.some((row) => row.policyId === insuredPartyFixture.policyId));

    reportFile = temporaryReportPath();
    reportFiles.push(reportFile);
    const preview = runBackfill({ reportFile });
    assert.equal(preview.mode, "dry-run");
    assert.equal(preview.organizationId, ORGANIZATION_ID);
    assert.ok(preview.scanned >= 1);
    assert.ok(preview.converted >= 1);
    assert.ok(preview.manifestSha256);
    assert.equal(preview.reportFile, reportFile);
    assert.equal(statSync(reportFile).mode & 0o777, 0o600);
    const manifest = JSON.parse(readFileSync(reportFile, "utf8")) as PolicyRiskBackfillManifest;
    assert.equal(manifest.sourceMode, "DISPOSABLE_DRY_RUN");
    assert.equal(preview.review, 1);
    assert.equal(preview.review, manifest.candidates.filter((row) => row.classification === "REVIEW").length);
    const fixtureCandidate = manifest.candidates.find((row) => row.policyId === backfillFixture.policyId);
    assert.ok(fixtureCandidate);
    assert.equal(fixtureCandidate.source.insuredObject, SOURCE_TEXT);
    const ambiguousCandidate = manifest.candidates.find((row) => row.policyId === reviewFixture.policyId);
    assert.ok(ambiguousCandidate);
    assert.equal(ambiguousCandidate.classification, "REVIEW");
    assert.equal(ambiguousCandidate.source.insuredObject, "Texto libre que requiere revisión");

    const unchanged = await db.policy.findUniqueOrThrow({
      where: { id: backfillFixture.policyId },
      select: { insuredObject: true, riskDetails: true, riskDetailsReviewRequired: true },
    });
    assert.equal(unchanged.insuredObject, SOURCE_TEXT);
    assert.equal(unchanged.riskDetails, null);
    assert.equal(unchanged.riskDetailsReviewRequired, false);
    const assetsBeforeApply = await db.policyInsuredAsset.findMany({ where: { organizationId: ORGANIZATION_ID, policyId: backfillFixture.policyId }, orderBy: { id: "asc" }, select: { id: true, description: true, serialNumber: true } });

    manifest.reviewedBy = "integration-reviewer";
    manifest.reviewedAt = new Date().toISOString();
    writeFileSync(reportFile, `${JSON.stringify(manifest, null, 2)}\n`);
    const incompleteReviewedDigest = policyRiskBackfillReviewedHash(manifest);
    assert.throws(
      () => runBackfill({ apply: true, reportFile: reportFile as string, manifestSha256: incompleteReviewedDigest, reviewer: "integration-reviewer", batchSize: 1 }),
      (error: unknown) => error instanceof Error && String((error as NodeJS.ErrnoException & { stderr?: Buffer }).stderr ?? error).includes(`POLICY_RISK_BACKFILL_REVIEW_DECISION_REQUIRED:${reviewFixture.policyId}`),
    );
    const stillAmbiguous = await db.policy.findUniqueOrThrow({ where: { id: reviewFixture.policyId }, select: { insuredObject: true, riskDetails: true, riskDetailsReviewRequired: true } });
    assert.equal(stillAmbiguous.insuredObject, "Texto libre que requiere revisión");
    assert.equal(stillAmbiguous.riskDetails, null);
    assert.equal(stillAmbiguous.riskDetailsReviewRequired, false);

    ambiguousCandidate.decision = "DEFER";
    writeFileSync(reportFile, `${JSON.stringify(manifest, null, 2)}\n`);
    const reviewedDigestAfterDecision = runBackfill({ printReviewedDigest: true, reportFile, previewSha256: preview.manifestSha256, reviewer: "integration-reviewer" });
    assert.ok("reviewedManifestSha256" in reviewedDigestAfterDecision);
    assert.notEqual(incompleteReviewedDigest, reviewedDigestAfterDecision.reviewedManifestSha256);
    assert.throws(
      () => runBackfill({ apply: true, reportFile: reportFile as string, manifestSha256: incompleteReviewedDigest, reviewer: "integration-reviewer", batchSize: 1 }),
      (error: unknown) => error instanceof Error && String((error as NodeJS.ErrnoException & { stderr?: Buffer }).stderr ?? error).includes("POLICY_RISK_BACKFILL_REVIEWED_DIGEST_MISMATCH"),
    );

    assert.throws(
      () => runBackfill({ apply: true, reportFile: reportFile as string, manifestSha256: reviewedDigestAfterDecision.reviewedManifestSha256, reviewer: "integration-reviewer", batchSize: 1, mutatePolicyBeforeBatch: backfillFixture.policyId }),
      (error: unknown) => error instanceof Error && String((error as NodeJS.ErrnoException & { stderr?: Buffer }).stderr ?? error).includes(`POLICY_RISK_BACKFILL_STALE_INPUT:${backfillFixture.policyId}`),
    );
    const staleInputRun = await db.maintenanceRun.findFirst({
      where: { organizationId: ORGANIZATION_ID, type: "POLICY_RISK_BACKFILL", summaryJson: { contains: "POLICY_RISK_BACKFILL_STALE_INPUT" } },
      select: { id: true, status: true, summaryJson: true },
    });
    assert.ok(staleInputRun);
    maintenanceRunIds.push(staleInputRun.id);
    assert.equal(staleInputRun.status, "FAILED");
    const staleInputReportFile = `${reportFile}.${staleInputRun.id}.results.json`;
    assert.ok(existsSync(staleInputReportFile));
    resultFiles.push(staleInputReportFile);
    const staleInputReport = JSON.parse(readFileSync(staleInputReportFile, "utf8")) as { applied: number; outcomes: Array<{ outcome: string }> };
    assert.equal(staleInputReport.applied, 0);
    assert.ok(!staleInputReport.outcomes.some((row) => row.outcome === "APPLIED"));
    await db.policy.update({ where: { id: backfillFixture.policyId }, data: { insuredObject: SOURCE_TEXT } });

    assert.throws(
      () => runBackfill({ apply: true, reportFile: reportFile as string, manifestSha256: reviewedDigestAfterDecision.reviewedManifestSha256, reviewer: "integration-reviewer", batchSize: 1, failWithinBatchAfterAppliedRows: 1 }),
      (error: unknown) => error instanceof Error && String((error as NodeJS.ErrnoException & { stderr?: Buffer }).stderr ?? error).includes("POLICY_RISK_BACKFILL_TEST_ROLLBACK_WITHIN_BATCH"),
    );
    const rollbackRun = await db.maintenanceRun.findFirst({
      where: { organizationId: ORGANIZATION_ID, type: "POLICY_RISK_BACKFILL", summaryJson: { contains: "POLICY_RISK_BACKFILL_TEST_ROLLBACK_WITHIN_BATCH" } },
      select: { id: true, status: true, summaryJson: true },
    });
    assert.ok(rollbackRun);
    maintenanceRunIds.push(rollbackRun.id);
    assert.equal(rollbackRun.status, "FAILED");
    const rollbackSummary = JSON.parse(rollbackRun.summaryJson ?? "{}") as { applied?: number; reviewedManifestSha256?: string };
    assert.equal(rollbackSummary.applied, 0);
    assert.equal(rollbackSummary.reviewedManifestSha256, reviewedDigestAfterDecision.reviewedManifestSha256);
    const rollbackResultFile = `${reportFile}.${rollbackRun.id}.results.json`;
    assert.ok(existsSync(rollbackResultFile));
    resultFiles.push(rollbackResultFile);
    const rollbackReport = JSON.parse(readFileSync(rollbackResultFile, "utf8")) as { applied: number; outcomes: Array<{ outcome: string }> };
    assert.equal(rollbackReport.applied, 0);
    assert.ok(!rollbackReport.outcomes.some((row) => row.outcome === "APPLIED"));
    const afterRollback = await db.policy.findUniqueOrThrow({ where: { id: backfillFixture.policyId }, select: { insuredObject: true, riskDetails: true } });
    assert.equal(afterRollback.insuredObject, SOURCE_TEXT);
    assert.equal(afterRollback.riskDetails, null);
    const assetsAfterRollback = await db.policyInsuredAsset.findMany({ where: { organizationId: ORGANIZATION_ID, policyId: backfillFixture.policyId }, orderBy: { id: "asc" }, select: { id: true, description: true, serialNumber: true } });
    assert.deepEqual(assetsAfterRollback, assetsBeforeApply);

    assert.throws(
      () => runBackfill({ apply: true, reportFile: reportFile as string, manifestSha256: reviewedDigestAfterDecision.reviewedManifestSha256, reviewer: "integration-reviewer", batchSize: 1, failAfterAppliedBatches: 1 }),
      (error: unknown) => error instanceof Error && String((error as NodeJS.ErrnoException & { stderr?: Buffer }).stderr ?? error).includes("POLICY_RISK_BACKFILL_TEST_INTERRUPTED_AFTER_COMMIT"),
    );
    const failedRun = await db.maintenanceRun.findFirst({
      where: { organizationId: ORGANIZATION_ID, type: "POLICY_RISK_BACKFILL", summaryJson: { contains: "POLICY_RISK_BACKFILL_TEST_INTERRUPTED_AFTER_COMMIT" } },
      select: { id: true, status: true, summaryJson: true },
    });
    assert.ok(failedRun);
    maintenanceRunIds.push(failedRun.id);
    assert.equal(failedRun.status, "FAILED");
    const failedSummary = JSON.parse(failedRun.summaryJson ?? "{}") as { applied?: number; reviewedManifestSha256?: string };
    assert.ok((failedSummary.applied ?? 0) >= 1);
    assert.equal(failedSummary.reviewedManifestSha256, reviewedDigestAfterDecision.reviewedManifestSha256);
    const failedResultFile = `${reportFile}.${failedRun.id}.results.json`;
    assert.ok(existsSync(failedResultFile));
    resultFiles.push(failedResultFile);
    const failedReport = JSON.parse(readFileSync(failedResultFile, "utf8")) as { applied: number; status: string; outcomes: Array<{ outcome: string }> };
    assert.equal(failedReport.status, "FAILED");
    assert.ok(failedReport.applied >= 1);
    assert.ok(failedReport.outcomes.some((row) => row.outcome === "APPLIED"));

    const applied = runBackfill({ apply: true, reportFile, manifestSha256: reviewedDigestAfterDecision.reviewedManifestSha256, reviewer: "integration-reviewer", batchSize: 1 });
    assert.ok("mode" in applied);
    assert.equal(applied.mode, "apply");
    assert.ok(applied.converted <= 1);
    assert.ok((applied.alreadyApplied ?? 0) >= 1);
    assert.ok(applied.runId);
    assert.equal(applied.deferred, 1);
    if (applied.maintenanceRunId) maintenanceRunIds.push(applied.maintenanceRunId);
    assert.ok(applied.resultFile);
    resultFiles.push(applied.resultFile);
    assert.ok(applied.maintenanceRunId);
    const completedRun = await db.maintenanceRun.findUniqueOrThrow({ where: { id: applied.maintenanceRunId }, select: { summaryJson: true } });
    const completedSummary = JSON.parse(completedRun.summaryJson ?? "{}") as { reviewedManifestSha256?: string };
    assert.equal(completedSummary.reviewedManifestSha256, reviewedDigestAfterDecision.reviewedManifestSha256);
    const resultReport = JSON.parse(readFileSync(applied.resultFile, "utf8")) as { outcomes: Array<{ policyId: string; outcome: string }> };
    assert.ok(resultReport.outcomes.some((row) => row.policyId === backfillFixture.policyId && ["APPLIED", "ALREADY_APPLIED"].includes(row.outcome)));
    assert.ok(resultReport.outcomes.some((row) => row.policyId === reviewFixture.policyId && row.outcome === "DEFERRED"));
    assert.ok(resultReport.outcomes.some((row) => row.policyId === insuredPartyFixture.policyId && ["APPLIED", "ALREADY_APPLIED"].includes(row.outcome)));

    const converted = await db.policy.findUniqueOrThrow({
      where: { id: backfillFixture.policyId },
      select: { insuredObject: true, riskDetails: true, riskDetailsReviewRequired: true },
    });
    assert.equal(converted.insuredObject, `Toyota Corolla 2020 LE Serie ${VIN}`);
    assert.equal(converted.riskDetailsReviewRequired, false);
    assert.ok(converted.riskDetails && typeof converted.riskDetails === "object");
    assert.equal((converted.riskDetails as { sourceText?: unknown }).sourceText, SOURCE_TEXT);
    assert.equal((converted.riskDetails as { policyType?: unknown }).policyType, "AUTO");

    const assetsAfterApply = await db.policyInsuredAsset.findMany({
      where: { organizationId: ORGANIZATION_ID, policyId: backfillFixture.policyId },
      orderBy: [{ description: "asc" }],
      select: { assetType: true, description: true, serialNumber: true },
    });
    assert.equal(assetsAfterApply.length, 2);
    assert.deepEqual(
      assetsAfterApply.map((asset) => asset.description).sort(),
      ["Toyota Corolla 2020 LE", "Toyota Corolla, descripción histórica"].sort(),
    );
    assert.ok(assetsAfterApply.every((asset) => asset.assetType === "AUTO" && asset.serialNumber === VIN));
    const reconciledParty = await db.policyInsuredParty.findUniqueOrThrow({ where: { id: legacyParty.id }, select: { fullName: true, isPrimary: true, sourceLabel: true } });
    assert.deepEqual(reconciledParty, { fullName: "Backfill Insured Person", isPrimary: false, sourceLabel: "Legacy import" });
    const deferred = await db.policy.findUniqueOrThrow({ where: { id: reviewFixture.policyId }, select: { insuredObject: true, riskDetails: true, riskDetailsReviewRequired: true } });
    assert.equal(deferred.insuredObject, "Texto libre que requiere revisión");
    assert.equal(deferred.riskDetails, null);
    assert.equal(deferred.riskDetailsReviewRequired, false);

    const resumed = runBackfill({ apply: true, reportFile, manifestSha256: reviewedDigestAfterDecision.reviewedManifestSha256, reviewer: "integration-reviewer", batchSize: 1 });
    assert.ok("mode" in resumed);
    assert.equal(resumed.mode, "apply");
    assert.ok((resumed.alreadyApplied ?? 0) >= 1);
    assert.ok(resumed.resultFile);
    if (resumed.maintenanceRunId) maintenanceRunIds.push(resumed.maintenanceRunId);
    resultFiles.push(resumed.resultFile);
    const resumeReport = JSON.parse(readFileSync(resumed.resultFile, "utf8")) as { outcomes: Array<{ policyId: string; outcome: string }> };
    assert.ok(resumeReport.outcomes.some((row) => row.policyId === backfillFixture.policyId && row.outcome === "ALREADY_APPLIED"));
    assert.ok(resumeReport.outcomes.some((row) => row.policyId === insuredPartyFixture.policyId && row.outcome === "ALREADY_APPLIED"));
    const preservedExtraParty = await db.policyInsuredParty.create({
      data: { organizationId: ORGANIZATION_ID, policyId: insuredPartyFixture.policyId, fullName: "Unrelated Existing Party", isPrimary: false, sourceLabel: "Operator-maintained" },
    });
    const partyResume = runBackfill({ apply: true, reportFile, manifestSha256: reviewedDigestAfterDecision.reviewedManifestSha256, reviewer: "integration-reviewer", batchSize: 1 });
    assert.ok("mode" in partyResume);
    assert.equal(partyResume.mode, "apply");
    assert.ok(partyResume.resultFile);
    if (partyResume.maintenanceRunId) maintenanceRunIds.push(partyResume.maintenanceRunId);
    resultFiles.push(partyResume.resultFile);
    const extraPartyAfterResume = await db.policyInsuredParty.findUniqueOrThrow({ where: { id: preservedExtraParty.id }, select: { fullName: true, isPrimary: true, sourceLabel: true } });
    assert.deepEqual(extraPartyAfterResume, { fullName: "Unrelated Existing Party", isPrimary: false, sourceLabel: "Operator-maintained" });

    if (process.env.POLICY_RISK_BACKFILL_TEST_RLS_ENABLED === "1") {
    const rlsState = await db.$queryRaw<Array<{ tableName: string; enabled: boolean; forced: boolean }>>(Prisma.sql`
      SELECT relation.relname AS "tableName", relation.relrowsecurity AS "enabled", relation.relforcerowsecurity AS "forced"
      FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public' AND relation.relname IN ('Policy', 'PolicyInsuredAsset', 'PolicyInsuredParty', 'MaintenanceRun')
    `);
    if (rlsState.length !== 4 || rlsState.some((row) => !row.enabled || !row.forced)) {
      throw new Error("POLICY_RISK_BACKFILL_WRITER_TEST_REQUIRES_FORCED_RLS");
    }
    const secondOrganization = await db.organization.create({
      data: {
        id: `org_policy_backfill_rls_${randomUUID().replaceAll("-", "")}`,
        slug: `policy-backfill-rls-${randomUUID().replaceAll("-", "")}`,
        name: "Policy Risk Backfill RLS Test Tenant",
        kind: "CUSTOMER",
        status: "ACTIVE",
      },
      select: { id: true },
    });
    secondOrganizationId = secondOrganization.id;
    const secondFixture = await withOrganizationContext(db, secondOrganization.id, async (tx) => {
      const insurer = await tx.insurer.create({
        data: { organizationId: secondOrganization.id, name: `Policy Risk Backfill Insurer ${randomUUID()}`, status: "ACTIVE" },
        select: { id: true },
      });
      const client = await tx.client.create({
        data: { organizationId: secondOrganization.id, fullName: "Second Organization Private Client", type: "PERSON", status: "ACTIVE" },
        select: { id: true },
      });
      const policy = await tx.policy.create({
        data: {
          organizationId: secondOrganization.id,
          policyNumber: `POLICY-BACKFILL-ORG-B-${randomUUID()}`,
          clientId: client.id,
          insurerId: insurer.id,
          policyType: "AUTO",
          status: "ACTIVE",
          paymentFrequency: "ANNUAL",
          startDate: new Date("2026-01-01T00:00:00.000Z"),
          endDate: new Date("2027-01-01T00:00:00.000Z"),
          premiumAmount: 1500,
          currency: "MXN",
          insuredObject: "Second organization original text",
        },
        select: { id: true },
      });
      await tx.policyInsuredAsset.create({
        data: { organizationId: secondOrganization.id, policyId: policy.id, assetType: "AUTO", description: "Second organization private asset", serialNumber: "ORG-B-PRIVATE-VIN", isPrimary: true },
      });
      await tx.policyInsuredParty.create({
        data: { organizationId: secondOrganization.id, policyId: policy.id, fullName: "Second Organization Private Insured", isPrimary: true, sourceLabel: "RLS test fixture" },
      });
      return { insurer, client, policy };
    });
    secondOrganizationInsurerId = secondFixture.insurer.id;
    secondOrganizationClientId = secondFixture.client.id;
    secondOrganizationPolicyId = secondFixture.policy.id;
    const secondPolicy = secondFixture.policy;

    const productionBackfillFixture = productionFixture = await seedPolicyFixture("POLICY-RISK-PRODUCTION-WRITER");
    await db.policy.update({
      where: { id: productionBackfillFixture.policyId },
      data: { insuredObject: SOURCE_TEXT, riskDetails: Prisma.DbNull, riskDetailsReviewRequired: false },
    });
    const writerPreviewFile = temporaryReportPath();
    reportFiles.push(writerPreviewFile);
    const writerPreview = runBackfill({
      productionPreview: true,
      readonlyDatabaseUrl: readonlyUrl.toString(),
      productionHost,
      productionDatabase,
      reportFile: writerPreviewFile,
    });
    assert.equal(writerPreview.mode, "production-read-only-preview");
    const writerManifest = JSON.parse(readFileSync(writerPreview.reportFile!, "utf8")) as PolicyRiskBackfillManifest;
    assert.equal(writerManifest.sourceMode, "PRODUCTION_READ_ONLY_PREVIEW");
    assert.ok(writerManifest.candidates.some((row) => row.policyId === productionBackfillFixture.policyId));
    assert.ok(writerManifest.candidates.every((row) => row.policyId !== secondPolicy.id), "organization A preview must exclude organization B candidates");
    for (const row of writerManifest.candidates) if (row.classification === "REVIEW") row.decision = "DEFER";
    writerManifest.reviewedBy = "integration-production-reviewer";
    writerManifest.reviewedAt = new Date().toISOString();
    writeFileSync(writerPreview.reportFile!, `${JSON.stringify(writerManifest, null, 2)}\n`);
    const writerReviewedDigest = runBackfill({
      printReviewedDigest: true,
      reportFile: writerPreview.reportFile!,
      previewSha256: writerPreview.manifestSha256,
      reviewer: "integration-production-reviewer",
    });
    assert.ok("reviewedManifestSha256" in writerReviewedDigest);

    const writerClient = new PrismaClient({ adapter: new PrismaPg({ connectionString: writerUrl.toString() }) });
    try {
      const visibleToA = await writerClient.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT set_config('app.organization_id', ${ORGANIZATION_ID}, true)`);
        return tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "Policy" WHERE "id" IN (${productionBackfillFixture.policyId}, ${secondPolicy.id}) ORDER BY "id"`);
      });
      assert.deepEqual(visibleToA.map((row) => row.id), [productionBackfillFixture.policyId]);
      const visibleToB = await writerClient.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT set_config('app.organization_id', ${secondOrganization.id}, true)`);
        return tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT "id" FROM "Policy" WHERE "id" IN (${productionBackfillFixture.policyId}, ${secondPolicy.id}) ORDER BY "id"`);
      });
      assert.deepEqual(visibleToB.map((row) => row.id), [secondPolicy.id]);
      const crossTenantUpdateCount = await writerClient.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT set_config('app.organization_id', ${ORGANIZATION_ID}, true)`);
        return tx.$executeRaw(Prisma.sql`UPDATE "Policy" SET "insuredObject" = 'must remain unchanged' WHERE "id" = ${secondPolicy.id}`);
      });
      assert.equal(crossTenantUpdateCount, 0, "RLS USING must prevent organization A from updating organization B");
      const reverseCrossTenantUpdateCount = await writerClient.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT set_config('app.organization_id', ${secondOrganization.id}, true)`);
        return tx.$executeRaw(Prisma.sql`UPDATE "Policy" SET "insuredObject" = 'must remain unchanged' WHERE "id" = ${productionBackfillFixture.policyId}`);
      });
      assert.equal(reverseCrossTenantUpdateCount, 0, "RLS USING must prevent organization B from updating organization A");
      await assert.rejects(
        writerClient.$transaction(async (tx) => {
          await tx.$queryRaw(Prisma.sql`SELECT set_config('app.organization_id', ${ORGANIZATION_ID}, true)`);
          await tx.policyInsuredAsset.create({
            data: {
              organizationId: secondOrganization.id,
              policyId: secondPolicy.id,
              assetType: "AUTO",
              description: "Cross-tenant insert must be rejected",
              serialNumber: null,
              isPrimary: false,
            },
          });
        }),
        /row-level security|tenant context|organization context/i,
      );
      await assert.rejects(
        writerClient.$transaction(async (tx) => {
          await tx.$queryRaw(Prisma.sql`SELECT set_config('app.organization_id', ${secondOrganization.id}, true)`);
          await tx.policyInsuredAsset.create({
            data: {
              organizationId: ORGANIZATION_ID,
              policyId: productionBackfillFixture.policyId,
              assetType: "AUTO",
              description: "Reverse cross-tenant insert must be rejected",
              serialNumber: null,
              isPrimary: false,
            },
          });
        }),
        /row-level security|tenant context|organization context/i,
      );
    } finally {
      await writerClient.$disconnect();
    }

    const assertWriterRejected = (needle: string, overrides: Partial<RunBackfillOptions> = {}) => assert.throws(
      () => runBackfill({
        ...overrides,
        apply: true,
        productionApply: true,
        writerDatabaseUrl: writerUrl.toString(),
        productionHost: overrides.productionHost ?? productionHost,
        productionDatabase: overrides.productionDatabase ?? productionDatabase,
        reportFile: overrides.reportFile ?? writerPreview.reportFile!,
        manifestSha256: overrides.manifestSha256 ?? writerReviewedDigest.reviewedManifestSha256,
        reviewer: overrides.reviewer ?? "integration-production-reviewer",
        batchSize: overrides.batchSize ?? 1,
        printReviewedDigest: false,
      }),
      (error: unknown) => error instanceof Error && String((error as NodeJS.ErrnoException & { stderr?: Buffer }).stderr ?? error).includes(needle),
    );
    assertWriterRejected("POLICY_RISK_BACKFILL_PRODUCTION_HOST_MISMATCH", { productionHost: "wrong.invalid" });
    assertWriterRejected("POLICY_RISK_BACKFILL_PRODUCTION_DATABASE_MISMATCH", { productionDatabase: `${productionDatabase}_wrong` });
    assertWriterRejected("POLICY_RISK_BACKFILL_BATCH_SIZE_MUST_BE_1_TO_50", { batchSize: 51 });
    assertWriterRejected("POLICY_RISK_BACKFILL_PRODUCTION_APPLY_REQUIRES_PRODUCTION_PREVIEW_MANIFEST", {
      reportFile,
      manifestSha256: reviewedDigestAfterDecision.reviewedManifestSha256,
    });

    await db.$executeRawUnsafe('GRANT DELETE ON TABLE "Policy" TO policydesk_backfill');
    assertWriterRejected("POLICY_RISK_BACKFILL_PRODUCTION_APPLY_ROLE_HAS_TABLE_LEVEL_PRIVILEGES");
    await db.$executeRawUnsafe('REVOKE DELETE ON TABLE "Policy" FROM policydesk_backfill');
    await db.$executeRawUnsafe("ALTER ROLE policydesk_backfill BYPASSRLS");
    assertWriterRejected("POLICY_RISK_BACKFILL_PRODUCTION_APPLY_ROLE_NOT_RESTRICTED");
    await db.$executeRawUnsafe("ALTER ROLE policydesk_backfill NOBYPASSRLS");

    const productionFixtureBefore = await db.policy.findUniqueOrThrow({ where: { id: productionBackfillFixture.policyId }, select: { insuredObject: true, riskDetails: true } });
    assert.equal(productionFixtureBefore.insuredObject, SOURCE_TEXT);
    assert.equal(productionFixtureBefore.riskDetails, null);
    const productionAssetsBefore = await db.policyInsuredAsset.count({ where: { organizationId: ORGANIZATION_ID, policyId: productionBackfillFixture.policyId } });
    assert.throws(
      () => runBackfill({
        apply: true,
        productionApply: true,
        writerDatabaseUrl: writerUrl.toString(),
        productionHost,
        productionDatabase,
        reportFile: writerPreview.reportFile!,
        manifestSha256: writerReviewedDigest.reviewedManifestSha256,
        reviewer: "integration-production-reviewer",
        batchSize: 1,
        failWithinBatchAfterAppliedRows: 1,
      }),
      (error: unknown) => error instanceof Error && String((error as NodeJS.ErrnoException & { stderr?: Buffer }).stderr ?? error).includes("POLICY_RISK_BACKFILL_TEST_ROLLBACK_WITHIN_BATCH"),
    );
    const writerRollbackRun = await db.maintenanceRun.findFirst({
      where: { organizationId: ORGANIZATION_ID, type: "POLICY_RISK_BACKFILL", summaryJson: { contains: "POLICY_RISK_BACKFILL_TEST_ROLLBACK_WITHIN_BATCH" } },
      select: { id: true },
    });
    assert.ok(writerRollbackRun);
    maintenanceRunIds.push(writerRollbackRun.id);
    const writerRollbackResult = `${writerPreview.reportFile}.${writerRollbackRun.id}.results.json`;
    assert.ok(existsSync(writerRollbackResult));
    resultFiles.push(writerRollbackResult);
    assert.equal((await db.policy.findUniqueOrThrow({ where: { id: productionBackfillFixture.policyId }, select: { riskDetails: true } })).riskDetails, null);
    assert.equal(await db.policyInsuredAsset.count({ where: { organizationId: ORGANIZATION_ID, policyId: productionBackfillFixture.policyId } }), productionAssetsBefore);

    assert.throws(
      () => runBackfill({
        apply: true,
        productionApply: true,
        writerDatabaseUrl: writerUrl.toString(),
        productionHost,
        productionDatabase,
        reportFile: writerPreview.reportFile!,
        manifestSha256: writerReviewedDigest.reviewedManifestSha256,
        reviewer: "integration-production-reviewer",
        batchSize: 1,
        failAfterAppliedBatches: 1,
      }),
      (error: unknown) => error instanceof Error && String((error as NodeJS.ErrnoException & { stderr?: Buffer }).stderr ?? error).includes("POLICY_RISK_BACKFILL_TEST_INTERRUPTED_AFTER_COMMIT"),
    );
    const writerInterruptedRun = await db.maintenanceRun.findFirst({
      where: { organizationId: ORGANIZATION_ID, type: "POLICY_RISK_BACKFILL", summaryJson: { contains: "POLICY_RISK_BACKFILL_TEST_INTERRUPTED_AFTER_COMMIT" } },
      select: { id: true },
    });
    assert.ok(writerInterruptedRun);
    maintenanceRunIds.push(writerInterruptedRun.id);
    const writerInterruptedResult = `${writerPreview.reportFile}.${writerInterruptedRun.id}.results.json`;
    assert.ok(existsSync(writerInterruptedResult));
    resultFiles.push(writerInterruptedResult);
    const writerInterruptedReport = JSON.parse(readFileSync(writerInterruptedResult, "utf8")) as { applied: number; outcomes: Array<{ outcome: string }> };
    assert.equal(writerInterruptedReport.applied, 1);
    assert.ok(writerInterruptedReport.outcomes.some((row) => row.outcome === "APPLIED"));

    const writerResume = runBackfill({
      apply: true,
      productionApply: true,
      writerDatabaseUrl: writerUrl.toString(),
      productionHost,
      productionDatabase,
      reportFile: writerPreview.reportFile!,
      manifestSha256: writerReviewedDigest.reviewedManifestSha256,
      reviewer: "integration-production-reviewer",
      batchSize: 1,
    });
    assert.ok("mode" in writerResume);
    assert.equal(writerResume.mode, "apply");
    assert.ok((writerResume.alreadyApplied ?? 0) >= 1);
    assert.ok(writerResume.maintenanceRunId);
    maintenanceRunIds.push(writerResume.maintenanceRunId);
    const writerAuditRun = await db.maintenanceRun.findUniqueOrThrow({ where: { id: writerResume.maintenanceRunId }, select: { summaryJson: true } });
    const writerAudit = JSON.parse(writerAuditRun.summaryJson ?? "{}") as { mode?: string; writerRole?: string; endpointHost?: string; database?: string; batchSize?: number };
    assert.equal(writerAudit.mode, "production-apply");
    assert.equal(writerAudit.writerRole, "policydesk_backfill");
    assert.equal(writerAudit.endpointHost, productionHost);
    assert.equal(writerAudit.database, productionDatabase);
    assert.equal(writerAudit.batchSize, 1);
    assert.ok(writerResume.resultFile);
    resultFiles.push(writerResume.resultFile);
    const writerResumeReport = JSON.parse(readFileSync(writerResume.resultFile, "utf8")) as { outcomes: Array<{ policyId: string; outcome: string }> };
    assert.ok(writerResumeReport.outcomes.some((row) => row.policyId === productionBackfillFixture.policyId && ["APPLIED", "ALREADY_APPLIED"].includes(row.outcome)));
    assert.ok(writerResumeReport.outcomes.some((row) => row.outcome === "ALREADY_APPLIED"));
    const writerCompleted = await db.policy.findUniqueOrThrow({ where: { id: productionBackfillFixture.policyId }, select: { riskDetails: true, insuredObject: true } });
    assert.ok(writerCompleted.riskDetails && typeof writerCompleted.riskDetails === "object");
    assert.equal((writerCompleted.riskDetails as { sourceText?: unknown }).sourceText, SOURCE_TEXT);
    assert.equal(writerCompleted.insuredObject, `Toyota Corolla 2020 LE Serie ${VIN}`);
    const secondTenantState = await withOrganizationContext(db, secondOrganization.id, async (tx) => ({
      policy: await tx.policy.findUniqueOrThrow({
        where: { id: secondPolicy.id },
        select: { organizationId: true, insuredObject: true, riskDetails: true },
      }),
      assets: await tx.policyInsuredAsset.findMany({
        where: { organizationId: secondOrganization.id, policyId: secondPolicy.id },
        select: { description: true, serialNumber: true, isPrimary: true },
      }),
      parties: await tx.policyInsuredParty.findMany({
        where: { organizationId: secondOrganization.id, policyId: secondPolicy.id },
        select: { fullName: true, isPrimary: true, sourceLabel: true },
      }),
    }));
    assert.equal(secondTenantState.policy.organizationId, secondOrganization.id);
    assert.equal(secondTenantState.policy.insuredObject, "Second organization original text");
    assert.equal(secondTenantState.policy.riskDetails, null);
    assert.deepEqual(secondTenantState.assets, [{ description: "Second organization private asset", serialNumber: "ORG-B-PRIVATE-VIN", isPrimary: true }]);
    assert.deepEqual(secondTenantState.parties, [{ fullName: "Second Organization Private Insured", isPrimary: true, sourceLabel: "RLS test fixture" }]);
    }

    const secondReportPath = temporaryReportPath();
    reportFiles.push(secondReportPath);
    const secondPreview = runBackfill({ reportFile: secondReportPath });
    assert.equal(secondPreview.mode, "dry-run");
    assert.equal(secondPreview.scanned, 1);
    assert.equal(secondPreview.review, 1);

    const assetsAfterRepeat = await db.policyInsuredAsset.findMany({
      where: { organizationId: ORGANIZATION_ID, policyId: backfillFixture.policyId },
      orderBy: [{ description: "asc" }],
      select: { assetType: true, description: true, serialNumber: true },
    });
    assert.deepEqual(assetsAfterRepeat, assetsAfterApply);
  } finally {
    const cleanupFailures: string[] = [];
    const attemptCleanup = async (label: string, action: () => Promise<unknown> | unknown) => {
      try {
        await action();
      } catch (error) {
        cleanupFailures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    if (maintenanceRunIds.length) await attemptCleanup("maintenance-runs", () => db.maintenanceRun.deleteMany({ where: { organizationId: ORGANIZATION_ID, id: { in: maintenanceRunIds } } }));
    for (const file of reportFiles) await attemptCleanup(`manifest:${path.basename(file)}`, () => rmSync(file, { force: true }));
    for (const file of resultFiles) await attemptCleanup(`result:${path.basename(file)}`, () => rmSync(file, { force: true }));
    for (const item of [fixture, ambiguousFixture, partyFixture, productionFixture]) {
      if (item) await attemptCleanup(`policy-fixture:${item.policyId}`, () => cleanupPolicyFixture(item));
    }
    if (secondOrganizationId) {
      await attemptCleanup("second-org-tenant-rows", () => withOrganizationContext(db, secondOrganizationId!, async (tx) => {
        if (secondOrganizationPolicyId) {
          await tx.policyInsuredAsset.deleteMany({ where: { organizationId: secondOrganizationId!, policyId: secondOrganizationPolicyId! } });
          await tx.policyInsuredParty.deleteMany({ where: { organizationId: secondOrganizationId!, policyId: secondOrganizationPolicyId! } });
          await tx.policy.deleteMany({ where: { id: secondOrganizationPolicyId!, organizationId: secondOrganizationId! } });
        }
        if (secondOrganizationClientId) await tx.client.deleteMany({ where: { id: secondOrganizationClientId!, organizationId: secondOrganizationId! } });
        if (secondOrganizationInsurerId) await tx.insurer.deleteMany({ where: { id: secondOrganizationInsurerId!, organizationId: secondOrganizationId! } });
      }));
    }
    if (secondOrganizationId) await attemptCleanup("second-organization", () => db.organization.deleteMany({ where: { id: secondOrganizationId! } }));
    if (readonlyRoleCreated) {
      await attemptCleanup("readonly-role-grants", () => db.$executeRawUnsafe("REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM policydesk_readonly"));
      await attemptCleanup("readonly-role-schema-grant", () => db.$executeRawUnsafe("REVOKE ALL PRIVILEGES ON SCHEMA public FROM policydesk_readonly"));
      await attemptCleanup("readonly-role-owned-privileges", () => db.$executeRawUnsafe("DROP OWNED BY policydesk_readonly"));
      await attemptCleanup("readonly-role-drop", () => db.$executeRawUnsafe("DROP ROLE policydesk_readonly"));
    }
    if (writerRoleCreated) {
      await attemptCleanup("writer-role-grants", () => db.$executeRawUnsafe("REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM policydesk_backfill"));
      await attemptCleanup("writer-role-schema-grant", () => db.$executeRawUnsafe("REVOKE ALL PRIVILEGES ON SCHEMA public FROM policydesk_backfill"));
      await attemptCleanup("writer-role-owned-privileges", () => db.$executeRawUnsafe("DROP OWNED BY policydesk_backfill"));
      await attemptCleanup("writer-role-drop", () => db.$executeRawUnsafe("DROP ROLE policydesk_backfill"));
    }
    if (disposableRoleTenantContextConfigured) {
      await attemptCleanup("reset-disposable-role-tenant-context", async () => {
        await db.$executeRawUnsafe('ALTER ROLE CURRENT_USER RESET "app.organization_id"');
      });
    }
    await attemptCleanup("database-disconnect", () => db.$disconnect());
    if (cleanupFailures.length) throw new Error(`POLICY_RISK_BACKFILL_TEST_CLEANUP_FAILED\n${cleanupFailures.join("\n")}`);
  }
}

main().then(
  () => console.log(process.env.POLICY_RISK_BACKFILL_TEST_RLS_ENABLED === "1"
    ? "Policy risk backfill disposable integration, including forced-RLS writer: PASS"
    : "Policy risk backfill singleton disposable integration: PASS; forced-RLS writer cases not requested"),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : "POLICY_RISK_BACKFILL_INTEGRATION_FAILED");
    process.exitCode = 1;
  },
);
