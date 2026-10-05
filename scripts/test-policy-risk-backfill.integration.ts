import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Prisma } from "../src/generated/prisma/client.ts";
import { cleanupPolicyFixture, getTestDb, seedPolicyFixture } from "../tests/helpers/db.ts";

const ORGANIZATION_ID = "org_legacy_singleton_0001";
const SOURCE_TEXT = "Toyota, Corolla, 2020, LE";
const VIN = "2T1BURHE0LC123456";

type BackfillReport = {
  mode: "dry-run" | "apply";
  organizationId: string;
  reportFile?: string;
  resultFile?: string;
  manifestSha256?: string;
  runId?: string;
  scanned: number;
  converted: number;
  review: number;
  empty: number;
  alreadyApplied?: number;
};

function runBackfill(options: { apply?: boolean; reportFile: string; manifestSha256?: string; reviewer?: string } ): BackfillReport {
  const args = [
    "--import",
    "tsx",
    "scripts/backfill-policy-risk-details.ts",
    `--organization-id=${ORGANIZATION_ID}`,
    ...(options.apply ? ["--apply", `--reviewed-report=${options.reportFile}`, `--reviewed-by=${options.reviewer}`, `--manifest-sha256=${options.manifestSha256}`, "--confirm-apply=APPLY_POLICY_RISK_BACKFILL"] : [`--report-file=${options.reportFile}`]),
  ];
  const stdout = execFileSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      NODE_ENV: "test",
      TENANT_ISOLATION_TEST_DB: "1",
      PLAYWRIGHT_ENFORCE_DISPOSABLE_DB: "1",
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

  const db = getTestDb();
  const fixture = await seedPolicyFixture("POLICY-RISK-BACKFILL");
  try {
    await db.policy.update({
      where: { id: fixture.policyId },
      data: {
        insuredObject: SOURCE_TEXT,
        riskDetails: Prisma.DbNull,
        riskDetailsReviewRequired: false,
      },
    });
    await db.policyInsuredAsset.create({
      data: {
        organizationId: ORGANIZATION_ID,
        policyId: fixture.policyId,
        assetType: "AUTO",
        description: "Toyota Corolla, descripción histórica",
        serialNumber: VIN,
        isPrimary: true,
      },
    });

    const reportFile = temporaryReportPath();
    const preview = runBackfill({ reportFile });
    assert.equal(preview.mode, "dry-run");
    assert.equal(preview.organizationId, ORGANIZATION_ID);
    assert.ok(preview.scanned >= 1);
    assert.ok(preview.converted >= 1);
    assert.ok(preview.manifestSha256);
    assert.equal(preview.reportFile, reportFile);
    const manifest = JSON.parse(readFileSync(reportFile, "utf8")) as {
      candidates: Array<{ policyId: string; classification: string; source: { insuredObject: string | null } }>;
      reviewedBy: string | null;
      reviewedAt: string | null;
    };
    assert.equal(preview.review, manifest.candidates.filter((row) => row.classification === "REVIEW").length);
    const fixtureCandidate = manifest.candidates.find((row) => row.policyId === fixture.policyId);
    assert.ok(fixtureCandidate);
    assert.equal(fixtureCandidate.source.insuredObject, SOURCE_TEXT);

    const unchanged = await db.policy.findUniqueOrThrow({
      where: { id: fixture.policyId },
      select: { insuredObject: true, riskDetails: true, riskDetailsReviewRequired: true },
    });
    assert.equal(unchanged.insuredObject, SOURCE_TEXT);
    assert.equal(unchanged.riskDetails, null);
    assert.equal(unchanged.riskDetailsReviewRequired, false);

    manifest.reviewedBy = "integration-reviewer";
    manifest.reviewedAt = new Date().toISOString();
    writeFileSync(reportFile, `${JSON.stringify(manifest, null, 2)}\n`);
    const applied = runBackfill({ apply: true, reportFile, manifestSha256: preview.manifestSha256, reviewer: "integration-reviewer" });
    assert.equal(applied.mode, "apply");
    assert.ok(applied.converted >= 1);
    assert.ok(applied.runId);
    assert.ok(applied.resultFile);
    const resultReport = JSON.parse(readFileSync(applied.resultFile, "utf8")) as { outcomes: Array<{ policyId: string; outcome: string }> };
    assert.ok(resultReport.outcomes.some((row) => row.policyId === fixture.policyId && row.outcome === "APPLIED"));

    const converted = await db.policy.findUniqueOrThrow({
      where: { id: fixture.policyId },
      select: { insuredObject: true, riskDetails: true, riskDetailsReviewRequired: true },
    });
    assert.equal(converted.insuredObject, `Toyota Corolla 2020 LE Serie ${VIN}`);
    assert.equal(converted.riskDetailsReviewRequired, false);
    assert.ok(converted.riskDetails && typeof converted.riskDetails === "object");
    assert.equal((converted.riskDetails as { sourceText?: unknown }).sourceText, SOURCE_TEXT);
    assert.equal((converted.riskDetails as { policyType?: unknown }).policyType, "AUTO");

    const assetsAfterApply = await db.policyInsuredAsset.findMany({
      where: { organizationId: ORGANIZATION_ID, policyId: fixture.policyId },
      orderBy: [{ description: "asc" }],
      select: { assetType: true, description: true, serialNumber: true },
    });
    assert.equal(assetsAfterApply.length, 2);
    assert.deepEqual(
      assetsAfterApply.map((asset) => asset.description).sort(),
      ["Toyota Corolla 2020 LE", "Toyota Corolla, descripción histórica"].sort(),
    );
    assert.ok(assetsAfterApply.every((asset) => asset.assetType === "AUTO" && asset.serialNumber === VIN));

    const resumed = runBackfill({ apply: true, reportFile, manifestSha256: preview.manifestSha256, reviewer: "integration-reviewer" });
    assert.equal(resumed.mode, "apply");
    assert.ok((resumed.alreadyApplied ?? 0) >= 1);
    assert.ok(resumed.resultFile);
    const resumeReport = JSON.parse(readFileSync(resumed.resultFile, "utf8")) as { outcomes: Array<{ policyId: string; outcome: string }> };
    assert.ok(resumeReport.outcomes.some((row) => row.policyId === fixture.policyId && row.outcome === "ALREADY_APPLIED"));

    const secondReportPath = temporaryReportPath();
    const secondPreview = runBackfill({ reportFile: secondReportPath });
    assert.equal(secondPreview.mode, "dry-run");
    assert.equal(secondPreview.scanned, 0);

    const assetsAfterRepeat = await db.policyInsuredAsset.findMany({
      where: { organizationId: ORGANIZATION_ID, policyId: fixture.policyId },
      orderBy: [{ description: "asc" }],
      select: { assetType: true, description: true, serialNumber: true },
    });
    assert.deepEqual(assetsAfterRepeat, assetsAfterApply);
  } finally {
    await cleanupPolicyFixture(fixture);
  }
}

main().then(
  () => console.log("Policy risk backfill disposable integration: PASS"),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : "POLICY_RISK_BACKFILL_INTEGRATION_FAILED");
    process.exitCode = 1;
  },
);
