import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, statSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { policyRiskBackfillReviewedHash, type PolicyRiskBackfillManifest } from "../src/lib/policy-risk-backfill-manifest.ts";
import { Prisma } from "../src/generated/prisma/client.ts";
import { cleanupPolicyFixture, getTestDb, seedPolicyFixture } from "../tests/helpers/db.ts";

const ORGANIZATION_ID = "org_legacy_singleton_0001";
const SOURCE_TEXT = "Toyota, Corolla, 2020, LE";
const VIN = "2T1BURHE0LC123456";

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

type RunBackfillOptions = { apply?: boolean; productionPreview?: boolean; readonlyDatabaseUrl?: string; printReviewedDigest?: boolean; reportFile: string; manifestSha256?: string; previewSha256?: string; reviewer?: string; batchSize?: number; failAfterAppliedBatches?: number; failWithinBatchAfterAppliedRows?: number; mutatePolicyBeforeBatch?: string };

function runBackfill(options: RunBackfillOptions & { printReviewedDigest: true }): { reviewedManifestSha256: string };
function runBackfill(options: RunBackfillOptions & { printReviewedDigest?: false | undefined }): BackfillReport;
function runBackfill(options: RunBackfillOptions): BackfillReport | { reviewedManifestSha256: string } {
  const args = [
    "--import",
    "tsx",
    "scripts/backfill-policy-risk-details.ts",
    `--organization-id=${ORGANIZATION_ID}`,
    ...(options.productionPreview ? ["--production-preview"] : []),
    ...(options.printReviewedDigest ? ["--print-reviewed-digest", `--reviewed-report=${options.reportFile}`, `--reviewed-by=${options.reviewer}`, `--preview-sha256=${options.previewSha256}`] : options.apply ? ["--apply", `--reviewed-report=${options.reportFile}`, `--reviewed-by=${options.reviewer}`, `--manifest-sha256=${options.manifestSha256}`, `--batch-size=${options.batchSize ?? 50}`, "--confirm-apply=APPLY_POLICY_RISK_BACKFILL"] : [`--report-file=${options.reportFile}`]),
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
  let fixture: Awaited<ReturnType<typeof seedPolicyFixture>> | null = null;
  let ambiguousFixture: Awaited<ReturnType<typeof seedPolicyFixture>> | null = null;
  let partyFixture: Awaited<ReturnType<typeof seedPolicyFixture>> | null = null;
  let readonlyRoleCreated = false;
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
    const readonlyReportFile = temporaryReportPath();
    reportFiles.push(readonlyReportFile);
    const productionPreview = runBackfill({ productionPreview: true, readonlyDatabaseUrl: readonlyUrl.toString(), reportFile: readonlyReportFile });
    assert.equal(productionPreview.mode, "production-read-only-preview");
    assert.equal(productionPreview.readOnly, true);
    const readonlyManifest = JSON.parse(readFileSync(productionPreview.reportFile!, "utf8")) as PolicyRiskBackfillManifest;
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
    assert.deepEqual(reconciledParty, { fullName: "Backfill Insured Person", isPrimary: true, sourceLabel: "Datos estructurados de póliza" });
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
    if (maintenanceRunIds.length) await db.maintenanceRun.deleteMany({ where: { id: { in: maintenanceRunIds } } });
    for (const file of reportFiles) rmSync(file, { force: true });
    for (const file of resultFiles) rmSync(file, { force: true });
    await Promise.allSettled([fixture, ambiguousFixture, partyFixture].filter((item): item is NonNullable<typeof item> => item !== null).map(cleanupPolicyFixture));
    if (readonlyRoleCreated) {
      await db.$executeRawUnsafe('DROP OWNED BY policydesk_readonly');
      await db.$executeRawUnsafe('DROP ROLE policydesk_readonly');
    }
  }
}

main().then(
  () => console.log("Policy risk backfill disposable integration: PASS"),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : "POLICY_RISK_BACKFILL_INTEGRATION_FAILED");
    process.exitCode = 1;
  },
);
