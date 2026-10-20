import type { Prisma } from "@/generated/prisma/client";
import { policyRiskDetailsSchema, projectPolicyRiskRelations } from "@/lib/policy-risk-details";

/** Synchronizes projected relations while preserving asset IDs used by receipt unit breakdowns. */
export async function syncPolicyRiskRelations(
  tx: Prisma.TransactionClient,
  organizationId: string,
  policyId: string,
  riskDetails: unknown,
) {
  if (!policyRiskDetailsSchema.safeParse(riskDetails).success) return;
  const projected = projectPolicyRiskRelations(riskDetails);

  const existingAssets = await tx.policyInsuredAsset.findMany({
    where: { organizationId, policyId },
    select: { id: true, assetType: true, description: true, serialNumber: true },
    orderBy: { id: "asc" },
  });
  const unmatched = new Set(existingAssets.map((asset) => asset.id));
  const normalized = (value: string | null) => value?.trim().toUpperCase() ?? "";

  for (const asset of projected.assets) {
    const exact = existingAssets.find((existing) => {
      if (!unmatched.has(existing.id) || existing.assetType !== asset.assetType) return false;
      if (asset.serialNumber) return normalized(existing.serialNumber) === normalized(asset.serialNumber);
      return !existing.serialNumber && normalized(existing.description) === normalized(asset.description);
    });
    const fallback = exact ?? existingAssets.find((existing) => unmatched.has(existing.id) && existing.assetType === asset.assetType);
    if (fallback) {
      unmatched.delete(fallback.id);
      await tx.policyInsuredAsset.update({
        where: { id: fallback.id, organizationId, policyId },
        data: { ...asset, organizationId, policyId },
      });
    } else {
      await tx.policyInsuredAsset.create({ data: { ...asset, organizationId, policyId } });
    }
  }

  if (unmatched.size) await tx.policyInsuredAsset.deleteMany({ where: { organizationId, policyId, id: { in: [...unmatched] } } });
  await tx.policyInsuredParty.deleteMany({ where: { organizationId, policyId } });
  if (projected.insuredParties.length) {
    await tx.policyInsuredParty.createMany({ data: projected.insuredParties.map((party) => ({ ...party, organizationId, policyId })) });
  }
}
