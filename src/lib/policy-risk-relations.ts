import type { Prisma } from "@/generated/prisma/client";
import { policyRiskDetailsSchema, projectPolicyRiskRelations } from "@/lib/policy-risk-details";

/** Replaces both projected relation sets so changing ramo cannot leave stale rows. */
export async function syncPolicyRiskRelations(
  tx: Prisma.TransactionClient,
  organizationId: string,
  policyId: string,
  riskDetails: unknown,
) {
  if (!policyRiskDetailsSchema.safeParse(riskDetails).success) return;
  const projected = projectPolicyRiskRelations(riskDetails);

  await tx.policyInsuredAsset.deleteMany({ where: { organizationId, policyId } });
  await tx.policyInsuredParty.deleteMany({ where: { organizationId, policyId } });

  if (projected.assets.length) {
    await tx.policyInsuredAsset.createMany({ data: projected.assets.map((asset) => ({ ...asset, organizationId, policyId })) });
  }
  if (projected.insuredParties.length) {
    await tx.policyInsuredParty.createMany({ data: projected.insuredParties.map((party) => ({ ...party, organizationId, policyId })) });
  }
}
