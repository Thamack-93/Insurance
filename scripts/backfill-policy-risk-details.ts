import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma } from "../src/generated/prisma/client.ts";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { assertDisposableCertificationTarget } from "./tenant-certification-target.mjs";
import { convertLegacyPolicyDescription, hasPolicyRiskData, projectPolicyRiskRelations, riskDetailsFromExisting, summarizePolicyRiskDetails } from "../src/lib/policy-risk-details.ts";

function arg(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

async function main() {
  const organizationId = arg("organization-id")?.trim();
  if (!organizationId) throw new Error("Indica una organización explícita con --organization-id=ID.");
  if (process.env.TENANT_ISOLATION_TEST_DB !== "1" || process.env.PLAYWRIGHT_ENFORCE_DISPOSABLE_DB !== "1") {
    throw new Error("La conversión requiere TENANT_ISOLATION_TEST_DB=1 y PLAYWRIGHT_ENFORCE_DISPOSABLE_DB=1.");
  }
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new Error("DATABASE_URL es obligatorio para la base desechable.");
  assertDisposableCertificationTarget(connectionString, process.env, "source");

  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const policies = await prisma.policy.findMany({
      where: { organizationId, riskDetails: { equals: Prisma.DbNull } },
      select: {
        id: true,
        policyNumber: true,
        policyType: true,
        insuredObject: true,
        beneficiaryInfo: true,
        insuredAssets: { select: { description: true, serialNumber: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
        insuredParties: { select: { fullName: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      },
      orderBy: [{ policyNumber: "asc" }, { id: "asc" }],
    });

    const report = { mode: apply ? "apply" : "dry-run", organizationId, scanned: policies.length, converted: 0, review: 0, empty: 0, errors: 0, reviewSamples: [] as Array<{ id: string; policyNumber: string; reason: string | null }> };
    for (const policy of policies) {
      try {
        const assetDescriptions = policy.insuredAssets.map((asset) => asset.description.trim()).filter(Boolean);
        const sourceDescription = policy.insuredObject?.trim() || assetDescriptions.join("; ") || null;
        const result = convertLegacyPolicyDescription(policy.policyType, sourceDescription, policy.insuredAssets[0]?.serialNumber ?? null, policy.insuredAssets.map((asset) => asset.serialNumber));
        const relationBasedRisk = !result.riskDetails && ["GMM", "VIDA", "ACCIDENTES", "FIANZAS"].includes(policy.policyType) && (policy.insuredParties.length > 0 || (["VIDA", "FIANZAS"].includes(policy.policyType) && Boolean(policy.beneficiaryInfo?.trim())))
          ? riskDetailsFromExisting(policy.policyType, null, null, [], policy.insuredParties, policy.beneficiaryInfo)
          : null;
        const riskDetails = result.riskDetails
          ? riskDetailsFromExisting(policy.policyType, result.riskDetails, sourceDescription, policy.insuredAssets, policy.insuredParties, policy.beneficiaryInfo) ?? result.riskDetails
          : relationBasedRisk;
        const hasStructuredData = hasPolicyRiskData(riskDetails);
        const needsReview = result.status === "REVIEW";
        const summary = summarizePolicyRiskDetails(riskDetails);
        if (hasStructuredData || needsReview) {
          if (result.status === "CONVERTED" || (!sourceDescription && hasStructuredData)) report.converted += 1;
          else if (needsReview) {
            report.review += 1;
            if (report.reviewSamples.length < 20) report.reviewSamples.push({ id: policy.id, policyNumber: policy.policyNumber, reason: result.reason });
          } else report.converted += 1;
          if (apply) {
            const relations = projectPolicyRiskRelations(riskDetails);
            await prisma.$transaction(async (tx) => {
              const updated = await tx.policy.updateMany({
                where: { id: policy.id, organizationId, riskDetails: { equals: Prisma.DbNull } },
                data: {
                  ...(hasStructuredData ? { riskDetails: riskDetails as Prisma.InputJsonValue } : {}),
                  ...(summary ? { insuredObject: summary } : {}),
                  riskDetailsReviewRequired: needsReview,
                },
              });
              if (updated.count === 0) return;
              if (relations.assets.length) {
                await tx.policyInsuredAsset.createMany({ data: relations.assets.map((asset) => ({ ...asset, organizationId, policyId: policy.id })), skipDuplicates: true });
              }
              if (relations.insuredParties.length) {
                await tx.policyInsuredParty.createMany({ data: relations.insuredParties.map((party) => ({ ...party, organizationId, policyId: policy.id })), skipDuplicates: true });
              }
            });
          }
        } else {
          report.empty += 1;
        }
      } catch {
        report.errors += 1;
      }
    }
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.errors > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "POLICY_RISK_BACKFILL_FAILED"}\n`);
  process.exitCode = 1;
});
