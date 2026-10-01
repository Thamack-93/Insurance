import type { Prisma } from "@/generated/prisma/client";

export const MISSING_POLICY_OBJECT_LABEL = "Sin objeto asegurado descrito";

export type PolicyObjectSource = {
  insuredObject?: string | null;
  insuredAssets?: ReadonlyArray<{
    description?: string | null;
    isPrimary?: boolean;
  }>;
};

/** Returns the most useful human-readable description already stored on a policy. */
export function getPolicyObjectDescription(
  policy: PolicyObjectSource,
  missingLabel = MISSING_POLICY_OBJECT_LABEL,
): string {
  const insuredObject = policy.insuredObject?.trim();
  if (insuredObject) return insuredObject;

  const descriptions = (policy.insuredAssets ?? [])
    .filter((asset) => asset.description?.trim())
    .sort((left, right) => Number(Boolean(right.isPrimary)) - Number(Boolean(left.isPrimary)))
    .map((asset) => asset.description!.trim())
    .filter((description, index, all) =>
      all.findIndex((candidate) => candidate.toLocaleLowerCase() === description.toLocaleLowerCase()) === index,
    );

  if (!descriptions.length) return missingLabel;
  return descriptions.length === 1 ? descriptions[0] : `${descriptions[0]} y ${descriptions.length - 1} más`;
}

export function getPolicyOptionLabel(
  policy: PolicyObjectSource & { policyNumber: string },
  suffixes: Array<string | null | undefined> = [],
): string {
  const description = getPolicyObjectDescription(policy, "");
  return [policy.policyNumber, description, ...suffixes].map((value) => value?.trim()).filter(Boolean).join(" · ");
}

/** Search terms shared by policy lists that expose descriptive identity. */
export function policyObjectSearchTerms(query: string): Prisma.PolicyWhereInput[] {
  return [
    { insuredObject: { contains: query, mode: "insensitive" } },
    { insuredAssets: { some: { description: { contains: query, mode: "insensitive" } } } },
  ];
}
