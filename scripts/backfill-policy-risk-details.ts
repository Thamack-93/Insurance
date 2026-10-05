import "dotenv/config";

import { randomUUID, createHash } from "node:crypto";
import { chmod, mkdir, open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma } from "../src/generated/prisma/client.ts";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { assertDisposableCertificationTarget } from "./tenant-certification-target.mjs";
import {
  assertReviewedPolicyRiskBackfillManifest,
  POLICY_RISK_BACKFILL_MANIFEST_VERSION,
  POLICY_RISK_BACKFILL_PROCESSOR_VERSION,
  policyRiskBackfillInputHash,
  policyRiskBackfillManifestContentHash,
  policyRiskBackfillReviewedHash,
  type PolicyRiskBackfillManifest,
  type PolicyRiskBackfillManifestRow,
} from "../src/lib/policy-risk-backfill-manifest.ts";
import { convertLegacyPolicyDescription, hasPolicyRiskData, projectPolicyRiskRelations, riskDetailsFromExisting, summarizePolicyRiskDetails } from "../src/lib/policy-risk-details.ts";

const PAGE_SIZE = 200;
const MAX_BATCH_SIZE = 500;
const APPLY_CONFIRMATION = "APPLY_POLICY_RISK_BACKFILL";

function arg(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function candidateSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("POLICY_RISK_BACKFILL_GIT_SHA_REQUIRED");
  }
}

async function processorSha256() {
  const digest = createHash("sha256");
  for (const file of ["scripts/backfill-policy-risk-details.ts", "src/lib/policy-risk-details.ts", "src/lib/policy-risk-backfill-manifest.ts"]) {
    digest.update(file).update("\0").update(await readFile(path.resolve(file)));
  }
  return digest.digest("hex");
}

function planPolicy(policy: {
  id: string;
  policyNumber: string;
  policyType: string;
  insuredObject: string | null;
  beneficiaryInfo: string | null;
  insuredAssets: Array<{ description: string; serialNumber: string | null; isPrimary: boolean }>;
  insuredParties: Array<{ fullName: string }>;
}): PolicyRiskBackfillManifestRow {
  const sourceDescription = policy.insuredObject?.trim() || policy.insuredAssets.map((asset) => asset.description.trim()).filter(Boolean).join("; ") || null;
  const result = convertLegacyPolicyDescription(policy.policyType, sourceDescription, policy.insuredAssets[0]?.serialNumber ?? null, policy.insuredAssets.map((asset) => asset.serialNumber));
  const relationBasedRisk = !result.riskDetails && ["GMM", "VIDA", "ACCIDENTES", "FIANZAS"].includes(policy.policyType) && (policy.insuredParties.length > 0 || (["VIDA", "FIANZAS"].includes(policy.policyType) && Boolean(policy.beneficiaryInfo?.trim())))
    ? riskDetailsFromExisting(policy.policyType, null, null, [], policy.insuredParties, policy.beneficiaryInfo)
    : null;
  const riskDetails = result.riskDetails
    ? riskDetailsFromExisting(policy.policyType, result.riskDetails, sourceDescription, policy.insuredAssets, policy.insuredParties, policy.beneficiaryInfo) ?? result.riskDetails
    : relationBasedRisk;
  const hasStructuredData = hasPolicyRiskData(riskDetails);
  const classification = result.status === "REVIEW" ? "REVIEW" : hasStructuredData ? "CONVERTED" : "EMPTY";
  const proposedRelations = projectPolicyRiskRelations(riskDetails);
  const source = {
    insuredObject: policy.insuredObject,
    beneficiaryInfo: policy.beneficiaryInfo,
    assets: policy.insuredAssets,
    insuredParties: policy.insuredParties,
  };
  return {
    policyId: policy.id,
    policyNumber: policy.policyNumber,
    policyType: policy.policyType,
    inputHash: policyRiskBackfillInputHash({ policyId: policy.id, policyNumber: policy.policyNumber, policyType: policy.policyType, ...source }),
    classification,
    reason: result.reason,
    source,
    proposed: {
      riskDetails,
      insuredObject: summarizePolicyRiskDetails(riskDetails),
      assets: proposedRelations.assets,
      insuredParties: proposedRelations.insuredParties,
    },
    decision: null,
  };
}

async function scanAll(prisma: PrismaClient, organizationId: string) {
  const candidates: PolicyRiskBackfillManifestRow[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.policy.findMany({
      where: { organizationId, riskDetails: { equals: Prisma.DbNull }, ...(cursor ? { id: { gt: cursor } } : {}) },
      select: {
        id: true,
        policyNumber: true,
        policyType: true,
        insuredObject: true,
        beneficiaryInfo: true,
        insuredAssets: { select: { description: true, serialNumber: true, isPrimary: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
        insuredParties: { select: { fullName: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
    });
    if (!page.length) break;
    candidates.push(...page.map(planPolicy));
    cursor = page[page.length - 1].id;
    if (page.length < PAGE_SIZE) break;
  }
  return candidates;
}

async function writePrivateManifest(file: string, manifest: unknown) {
  const resolved = path.resolve(file);
  if (!path.isAbsolute(file)) throw new Error("POLICY_RISK_BACKFILL_REPORT_PATH_MUST_BE_ABSOLUTE");
  if (!path.relative(process.cwd(), resolved).startsWith("..") && !path.isAbsolute(path.relative(process.cwd(), resolved))) {
    throw new Error("POLICY_RISK_BACKFILL_REPORT_MUST_BE_OUTSIDE_REPOSITORY");
  }
  const directory = path.dirname(resolved);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const handle = await open(resolved, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(resolved, 0o600);
  return resolved;
}

async function readReviewedManifest(file: string): Promise<PolicyRiskBackfillManifest> {
  const resolved = path.resolve(file);
  if (!path.isAbsolute(file)) throw new Error("POLICY_RISK_BACKFILL_REPORT_PATH_MUST_BE_ABSOLUTE");
  if (!path.relative(process.cwd(), resolved).startsWith("..") && !path.isAbsolute(path.relative(process.cwd(), resolved))) {
    throw new Error("POLICY_RISK_BACKFILL_REPORT_MUST_BE_OUTSIDE_REPOSITORY");
  }
  const metadata = await stat(resolved);
  if ((metadata.mode & 0o077) !== 0) throw new Error("POLICY_RISK_BACKFILL_REPORT_PERMISSIONS_MUST_BE_0600");
  return JSON.parse(await readFile(resolved, "utf8")) as PolicyRiskBackfillManifest;
}

async function main() {
  const organizationId = arg("organization-id")?.trim();
  if (!organizationId) throw new Error("Indica una organización explícita con --organization-id=ID.");
  if (process.argv.includes("--print-reviewed-digest")) {
    const reviewedFile = arg("reviewed-report");
    const reviewer = arg("reviewed-by")?.trim();
    const previewSha = arg("preview-sha256")?.trim();
    if (!reviewedFile || !reviewer || !previewSha) throw new Error("REVIEW_DIGEST_REQUIRES_REPORT_REVIEWER_AND_PREVIEW_SHA");
    const manifest = await readReviewedManifest(reviewedFile);
    if (manifest.contentSha256 !== previewSha) throw new Error("POLICY_RISK_BACKFILL_MANIFEST_DIGEST_MISMATCH");
    if (manifest.reviewedBy?.trim() !== reviewer || !manifest.reviewedAt) throw new Error("POLICY_RISK_BACKFILL_REVIEWER_MISMATCH");
    assertReviewedPolicyRiskBackfillManifest(manifest, { organizationId, candidateSha: candidateSha(), processorSha256: await processorSha256() });
    process.stdout.write(`${JSON.stringify({ reviewedManifestSha256: policyRiskBackfillReviewedHash(manifest) })}\n`);
    return;
  }
  if (process.env.NODE_ENV !== "test" || process.env.TENANT_ISOLATION_TEST_DB !== "1" || process.env.PLAYWRIGHT_ENFORCE_DISPOSABLE_DB !== "1") {
    throw new Error("La conversión requiere NODE_ENV=test, TENANT_ISOLATION_TEST_DB=1 y PLAYWRIGHT_ENFORCE_DISPOSABLE_DB=1.");
  }
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL es obligatorio para la base desechable.");
  assertDisposableCertificationTarget(connectionString, process.env, "source");

  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const sha = candidateSha();
    const processor = await processorSha256();
    if (!apply) {
      const candidates = await scanAll(prisma, organizationId);
      const manifest: PolicyRiskBackfillManifest = {
        schemaVersion: POLICY_RISK_BACKFILL_MANIFEST_VERSION,
        processorVersion: POLICY_RISK_BACKFILL_PROCESSOR_VERSION,
        processorSha256: processor,
        runId: randomUUID(),
        createdAt: new Date().toISOString(),
        organizationId,
        candidateSha: sha,
        scanned: candidates.length,
        candidates,
        contentSha256: "",
        reviewedBy: null,
        reviewedAt: null,
      };
      manifest.contentSha256 = policyRiskBackfillManifestContentHash(manifest);
      const reportFile = arg("report-file") ?? `/private/tmp/policy-risk-backfill-${organizationId}-${manifest.runId}.json`;
      const reportPath = await writePrivateManifest(reportFile, manifest);
      const review = candidates.filter((row) => row.classification === "REVIEW").length;
      const converted = candidates.filter((row) => row.classification === "CONVERTED").length;
      const empty = candidates.filter((row) => row.classification === "EMPTY").length;
      process.stdout.write(`${JSON.stringify({ mode: "dry-run", organizationId, runId: manifest.runId, candidateSha: sha, scanned: candidates.length, converted, review, empty, manifestSha256: manifest.contentSha256, reportFile: reportPath }, null, 2)}\n`);
      return;
    }

    const reviewedFile = arg("reviewed-report");
    const reviewer = arg("reviewed-by")?.trim();
    const expectedManifestSha = arg("manifest-sha256")?.trim();
    if (!reviewedFile || !reviewer || !expectedManifestSha || arg("confirm-apply") !== APPLY_CONFIRMATION) {
      throw new Error(`APPLY_REQUIRES_--reviewed-report, --reviewed-by, --manifest-sha256, and --confirm-apply=${APPLY_CONFIRMATION}`);
    }
    const manifest = await readReviewedManifest(reviewedFile);
    if (policyRiskBackfillReviewedHash(manifest) !== expectedManifestSha) throw new Error("POLICY_RISK_BACKFILL_REVIEWED_DIGEST_MISMATCH");
    if (manifest.reviewedBy?.trim() !== reviewer || !manifest.reviewedAt) throw new Error("POLICY_RISK_BACKFILL_REVIEWER_MISMATCH");
    assertReviewedPolicyRiskBackfillManifest(manifest, { organizationId, candidateSha: sha, processorSha256: processor });

    const current = await scanAll(prisma, organizationId);
    const expectedById = new Map(manifest.candidates.map((row) => [row.policyId, row]));
    for (const row of current) {
      const expected = expectedById.get(row.policyId);
      if (!expected || expected.inputHash !== row.inputHash) throw new Error(`POLICY_RISK_BACKFILL_STALE_INPUT:${row.policyId}`);
    }
    const currentIds = new Set(current.map((row) => row.policyId));
    const alreadyAppliedRows = manifest.candidates.filter((row) => !currentIds.has(row.policyId));
    const alreadyApplied = alreadyAppliedRows.length
      ? await prisma.policy.findMany({
        where: { organizationId, id: { in: alreadyAppliedRows.map((row) => row.policyId) } },
        select: {
          id: true,
          insuredObject: true,
          riskDetails: true,
          insuredAssets: { select: { assetType: true, description: true, serialNumber: true, isPrimary: true } },
          insuredParties: { select: { fullName: true, isPrimary: true, sourceLabel: true } },
        },
      })
      : [];
    const appliedById = new Map(alreadyApplied.map((row) => [row.id, row]));
    for (const row of alreadyAppliedRows) {
      const saved = appliedById.get(row.policyId);
      const detailsMatch = saved?.riskDetails != null && policyRiskBackfillInputHash(saved.riskDetails) === policyRiskBackfillInputHash(row.proposed.riskDetails);
      const summaryMatch = !row.proposed.insuredObject || saved?.insuredObject === row.proposed.insuredObject;
      const assetsMatch = row.proposed.assets.every((asset) => saved?.insuredAssets.some((actual) => actual.assetType === asset.assetType && actual.description === asset.description && actual.serialNumber === asset.serialNumber && actual.isPrimary === asset.isPrimary));
      const partiesMatch = row.proposed.insuredParties.every((party) => saved?.insuredParties.some((actual) => actual.fullName === party.fullName && actual.isPrimary === party.isPrimary && actual.sourceLabel === party.sourceLabel));
      if (!detailsMatch || !summaryMatch || !assetsMatch || !partiesMatch) throw new Error(`POLICY_RISK_BACKFILL_PARTIAL_APPLY_CONFLICT:${row.policyId}`);
    }

    const mutatePolicyBeforeBatch = process.env.POLICY_RISK_BACKFILL_TEST_MUTATE_POLICY_ID_BEFORE_BATCH;
    if (process.env.NODE_ENV === "test" && mutatePolicyBeforeBatch) {
      await prisma.policy.updateMany({
        where: { id: mutatePolicyBeforeBatch, organizationId, riskDetails: { equals: Prisma.DbNull } },
        data: { insuredObject: "Concurrent source edit injected by disposable integration test" },
      });
    }

    const requestedBatchSize = Number(arg("batch-size") ?? "50");
    if (!Number.isInteger(requestedBatchSize) || requestedBatchSize < 1 || requestedBatchSize > MAX_BATCH_SIZE) {
      throw new Error(`POLICY_RISK_BACKFILL_BATCH_SIZE_MUST_BE_1_TO_${MAX_BATCH_SIZE}`);
    }
    const run = await prisma.maintenanceRun.create({
      data: {
        organizationId,
        type: "POLICY_RISK_BACKFILL",
        status: "RUNNING",
        summaryJson: JSON.stringify({ runId: manifest.runId, candidateSha: sha, manifestSha256: createHash("sha256").update(JSON.stringify(manifest)).digest("hex"), reviewer, scanned: manifest.scanned }),
      },
      select: { id: true },
    });
    let converted = 0;
    let deferred = 0;
    let empty = 0;
    let applied = 0;
    let alreadyAppliedCount = 0;
    let committedAppliedBatches = 0;
    const outcomes: Array<{ policyId: string; policyNumber: string; inputHash: string; outcome: "APPLIED" | "ALREADY_APPLIED" | "DEFERRED" | "EMPTY" }> = [];
    const resultFile = `${reviewedFile}.${run.id}.results.json`;
    try {
      for (let offset = 0; offset < manifest.candidates.length; offset += requestedBatchSize) {
        const batch = manifest.candidates.slice(offset, offset + requestedBatchSize);
        const batchOutcomes: typeof outcomes = [];
        const batchCounts = { converted: 0, deferred: 0, empty: 0, applied: 0, alreadyApplied: 0 };
        await prisma.$transaction(async (tx) => {
          for (const row of batch) {
            if (!currentIds.has(row.policyId)) {
              batchCounts.alreadyApplied += 1;
              batchOutcomes.push({ policyId: row.policyId, policyNumber: row.policyNumber, inputHash: row.inputHash, outcome: "ALREADY_APPLIED" });
              continue;
            }
            if (row.classification === "EMPTY") {
              batchCounts.empty += 1;
              batchOutcomes.push({ policyId: row.policyId, policyNumber: row.policyNumber, inputHash: row.inputHash, outcome: "EMPTY" });
              continue;
            }
            if (row.classification === "REVIEW" && row.decision === "DEFER") {
              batchCounts.deferred += 1;
              batchOutcomes.push({ policyId: row.policyId, policyNumber: row.policyNumber, inputHash: row.inputHash, outcome: "DEFERRED" });
              continue;
            }
            const approvedReview = row.classification === "REVIEW";
            if (approvedReview && !hasPolicyRiskData(row.proposed.riskDetails)) {
              batchCounts.deferred += 1;
              batchOutcomes.push({ policyId: row.policyId, policyNumber: row.policyNumber, inputHash: row.inputHash, outcome: "DEFERRED" });
              continue;
            }
            const lockedPolicy = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
              SELECT "id" FROM "Policy"
              WHERE "id" = ${row.policyId} AND "organizationId" = ${organizationId} AND "riskDetails" IS NULL
              FOR UPDATE
            `);
            if (!lockedPolicy.length) throw new Error(`POLICY_RISK_BACKFILL_WRITE_CONFLICT:${row.policyId}`);
            await tx.$queryRaw(Prisma.sql`
              SELECT "id" FROM "PolicyInsuredAsset"
              WHERE "organizationId" = ${organizationId} AND "policyId" = ${row.policyId}
              ORDER BY "id" FOR UPDATE
            `);
            await tx.$queryRaw(Prisma.sql`
              SELECT "id" FROM "PolicyInsuredParty"
              WHERE "organizationId" = ${organizationId} AND "policyId" = ${row.policyId}
              ORDER BY "id" FOR UPDATE
            `);
            const freshPolicy = await tx.policy.findFirst({
              where: { id: row.policyId, organizationId, riskDetails: { equals: Prisma.DbNull } },
              select: {
                id: true,
                policyNumber: true,
                policyType: true,
                insuredObject: true,
                beneficiaryInfo: true,
                insuredAssets: { select: { description: true, serialNumber: true, isPrimary: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
                insuredParties: { select: { fullName: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
              },
            });
            if (!freshPolicy || planPolicy(freshPolicy).inputHash !== row.inputHash) {
              throw new Error(`POLICY_RISK_BACKFILL_STALE_INPUT:${row.policyId}`);
            }
            const updated = await tx.policy.updateMany({
              where: { id: row.policyId, organizationId, riskDetails: { equals: Prisma.DbNull } },
              data: {
                ...(hasPolicyRiskData(row.proposed.riskDetails) ? { riskDetails: row.proposed.riskDetails as Prisma.InputJsonValue } : {}),
                ...(row.proposed.insuredObject ? { insuredObject: row.proposed.insuredObject } : {}),
                riskDetailsReviewRequired: false,
              },
            });
            if (!updated.count) throw new Error(`POLICY_RISK_BACKFILL_WRITE_CONFLICT:${row.policyId}`);
            if (row.proposed.assets.length) {
              await tx.policyInsuredAsset.createMany({ data: row.proposed.assets.map((asset) => ({ ...asset, organizationId, policyId: row.policyId })), skipDuplicates: true });
            }
            if (row.proposed.insuredParties.length) {
              await tx.policyInsuredParty.createMany({ data: row.proposed.insuredParties.map((party) => ({ ...party, organizationId, policyId: row.policyId })), skipDuplicates: true });
            }
            batchCounts.converted += 1;
            batchCounts.applied += 1;
            batchOutcomes.push({ policyId: row.policyId, policyNumber: row.policyNumber, inputHash: row.inputHash, outcome: "APPLIED" });
            const failInsideBatchAfter = Number(process.env.POLICY_RISK_BACKFILL_TEST_FAIL_WITHIN_BATCH_AFTER_APPLIED_ROWS ?? "0");
            if (process.env.NODE_ENV === "test" && failInsideBatchAfter > 0 && batchCounts.applied === failInsideBatchAfter) {
              throw new Error("POLICY_RISK_BACKFILL_TEST_ROLLBACK_WITHIN_BATCH");
            }
          }
        });
        converted += batchCounts.converted;
        deferred += batchCounts.deferred;
        empty += batchCounts.empty;
        applied += batchCounts.applied;
        alreadyAppliedCount += batchCounts.alreadyApplied;
        outcomes.push(...batchOutcomes);
        if (batchCounts.applied > 0) {
          committedAppliedBatches += 1;
          const failAfter = Number(process.env.POLICY_RISK_BACKFILL_TEST_FAIL_AFTER_APPLIED_BATCHES ?? "0");
          if (process.env.NODE_ENV === "test" && failAfter > 0 && committedAppliedBatches === failAfter) {
            throw new Error("POLICY_RISK_BACKFILL_TEST_INTERRUPTED_AFTER_COMMIT");
          }
        }
      }
      const summary = { runId: manifest.runId, candidateSha: sha, reviewer, scanned: manifest.scanned, converted, deferred, empty, applied, alreadyApplied: alreadyAppliedCount };
      await prisma.maintenanceRun.update({ where: { id: run.id }, data: { status: deferred ? "REVIEW_REQUIRED" : "COMPLETED", completedAt: new Date(), summaryJson: JSON.stringify(summary) } });
      await writePrivateManifest(resultFile, { ...summary, organizationId, manifestSha256: manifest.contentSha256, maintenanceRunId: run.id, status: deferred ? "REVIEW_REQUIRED" : "COMPLETED", outcomes });
      process.stdout.write(`${JSON.stringify({ mode: "apply", organizationId, ...summary, maintenanceRunId: run.id, resultFile }, null, 2)}\n`);
    } catch (error) {
      await prisma.maintenanceRun.update({ where: { id: run.id }, data: { status: "FAILED", completedAt: new Date(), summaryJson: JSON.stringify({ runId: manifest.runId, candidateSha: sha, reviewer, scanned: manifest.scanned, converted, deferred, empty, applied, alreadyApplied: alreadyAppliedCount, errorCode: error instanceof Error ? error.message.split(":")[0] : "UNKNOWN" }) } });
      await writePrivateManifest(resultFile, { organizationId, manifestSha256: manifest.contentSha256, maintenanceRunId: run.id, status: "FAILED", converted, deferred, empty, applied, alreadyApplied: alreadyAppliedCount, errorCode: error instanceof Error ? error.message.split(":")[0] : "UNKNOWN", outcomes });
      throw error;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "POLICY_RISK_BACKFILL_FAILED"}\n`);
  process.exitCode = 1;
});
