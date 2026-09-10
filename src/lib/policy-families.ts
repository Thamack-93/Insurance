import { toNumber } from "@/lib/money";
import { buildPolicyNumberSearchVariants } from "@/lib/policy-number";
import { requireOrganizationContext, withTenantTransaction, type TenantDb } from "@/lib/organization-context";

type PolicyFamilyPolicy = {
  id: string;
  policyNumber: string;
  startDate: Date;
  endDate: Date;
  status: string;
  premiumAmount: unknown;
  currency: string;
  client: { id: string; fullName: string };
  insurer: { id: string; name: string };
  _count: {
    receipts: number;
    payments: number;
    commissions: number;
  };
};

export async function resolvePolicyFamilyRootId(input: {
  organizationId: string;
  policyNumber: string;
  clientId: string;
  insurerId: string;
  excludePolicyId?: string;
}, client?: TenantDb): Promise<string | null> {
  if (!client) {
    const context = await requireOrganizationContext();
    if (context.organizationId !== input.organizationId) throw new Error("ORGANIZATION_CONTEXT_MISMATCH");
    return withTenantTransaction(context, (tx) => resolvePolicyFamilyRootId(input, tx));
  }
  const policyNumberVariants = buildPolicyNumberSearchVariants(input.policyNumber);
  const existing = await client.policy.findFirst({
    where: {
      organizationId: input.organizationId,
      OR: policyNumberVariants.map((variant) => ({ policyNumber: variant })),
      clientId: input.clientId,
      insurerId: input.insurerId,
      ...(input.excludePolicyId ? { id: { not: input.excludePolicyId } } : {}),
    },
    orderBy: [{ startDate: "asc" }, { createdAt: "asc" }],
    select: { id: true, familyRootId: true },
  });

  if (!existing) {
    return null;
  }

  return existing.familyRootId ?? existing.id;
}

export async function getPolicyFamilyPolicies(policyId: string, organizationId?: string, client?: TenantDb): Promise<{ familyRootId: string; policies: Array<PolicyFamilyPolicy & { premiumAmount: number }> } | null> {
  if (!client) {
    const context = await requireOrganizationContext();
    if (organizationId && organizationId !== context.organizationId) throw new Error("ORGANIZATION_CONTEXT_MISMATCH");
    return withTenantTransaction(context, (tx) => getPolicyFamilyPolicies(policyId, context.organizationId, tx));
  }
  const current = await client.policy.findFirst({
    where: { id: policyId, ...(organizationId ? { organizationId } : {}) },
    select: { id: true, familyRootId: true },
  });

  if (!current) {
    return null;
  }

  const familyRootId = current.familyRootId ?? current.id;
  const policies = await client.policy.findMany({
    where: {
      OR: [{ id: familyRootId }, { familyRootId }],
      ...(organizationId ? { organizationId } : {}),
    },
    include: {
      client: { select: { id: true, fullName: true } },
      insurer: { select: { id: true, name: true } },
      _count: {
        select: {
          receipts: true,
          payments: { where: { status: "POSTED" } },
          commissions: true,
        },
      },
    },
    orderBy: [{ startDate: "asc" }, { endDate: "asc" }, { createdAt: "asc" }],
  });

  return {
    familyRootId,
    policies: policies.map((policy) => ({
      ...policy,
      premiumAmount: toNumber(policy.premiumAmount),
    })) as Array<PolicyFamilyPolicy & { premiumAmount: number }>,
  };
}
