import type { Prisma } from "@/generated/prisma/client";

export const MISSING_POLICY_OBJECT_LABEL = "Sin objeto asegurado descrito";

export type PolicyObjectSource = {
  insuredObject?: string | null;
  insuredAssets?: ReadonlyArray<{
    description?: string | null;
    isPrimary?: boolean;
  }>;
};

const NON_DESCRIPTIVE_VALUES = new Set([
  "NO ESPECIFICADA",
  "NO ESPECIFICADO",
  "SIN ESPECIFICAR",
  "NO DECLARADA",
  "NO DECLARADO",
  "NO APLICA",
  "N/A",
  "N/D",
]);

function normalizeDescriptionFragment(value: string) {
  return value.replace(/\s+/g, " ").replace(/^[\s,;|.-]+|[\s,;|.-]+$/g, "").trim();
}

function isNonDescriptiveValue(value: string) {
  return NON_DESCRIPTIVE_VALUES.has(value.toLocaleUpperCase("es-MX").replace(/\.+$/g, ""));
}

function presentCasing(value: string) {
  if (value !== value.toLocaleUpperCase("es-MX")) return value;

  return value
    .toLocaleLowerCase("es-MX")
    .replace(/(^|\s)([^\s]+)/g, (_match, space: string, token: string) => {
      const readableToken = /\d/.test(token)
        ? token.toLocaleUpperCase("es-MX")
        : token.charAt(0).toLocaleUpperCase("es-MX") + token.slice(1);
      return `${space}${readableToken}`;
    });
}

/** Cleans registry-style free text for display without changing the stored value. */
export function cleanPolicyObjectDescription(value?: string | null) {
  if (!value?.trim()) return "";

  const fragments = value
    .split(/[,;|·\n]+/)
    .map(normalizeDescriptionFragment)
    .filter((fragment) => fragment && !isNonDescriptiveValue(fragment))
    .filter((fragment, index, all) => {
      const normalized = fragment.toLocaleLowerCase("es-MX");
      const modelValue = fragment.match(/^modelo\s+(.+)$/i)?.[1]?.toLocaleLowerCase("es-MX");
      const duplicatesExistingValue = modelValue && all.some((candidate) => candidate.toLocaleLowerCase("es-MX") === modelValue);
      return all.findIndex((candidate) => candidate.toLocaleLowerCase("es-MX") === normalized) === index
        && !duplicatesExistingValue;
    });

  if (!fragments.length) return "";

  const yearIndex = fragments.findIndex((fragment) => /^(?:19|20)\d{2}$/.test(fragment));
  const formatted = yearIndex > 0 && fragments.length >= 3
    ? [fragments.slice(0, yearIndex).join(" "), ...fragments.slice(yearIndex)].join(" · ")
    : fragments.join(", ");

  return formatted.split(" · ").map(presentCasing).join(" · ");
}

/** Returns the most useful human-readable description already stored on a policy. */
export function getPolicyObjectDescription(
  policy: PolicyObjectSource,
  missingLabel = MISSING_POLICY_OBJECT_LABEL,
): string {
  const insuredObject = cleanPolicyObjectDescription(policy.insuredObject);
  if (insuredObject) return insuredObject;

  const descriptions = (policy.insuredAssets ?? [])
    .map((asset) => ({ ...asset, cleanedDescription: cleanPolicyObjectDescription(asset.description) }))
    .filter((asset) => asset.cleanedDescription)
    .sort((left, right) => Number(Boolean(right.isPrimary)) - Number(Boolean(left.isPrimary)))
    .map((asset) => asset.cleanedDescription)
    .filter((description, index, all) =>
      all.findIndex((candidate) => candidate.toLocaleLowerCase("es-MX") === description.toLocaleLowerCase("es-MX")) === index,
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
