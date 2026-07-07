function compactPolicyNumber(value: string) {
  return value.replace(/\s+/g, "").trim().toUpperCase();
}

export function normalizePolicyNumber(value: string) {
  return compactPolicyNumber(value).replace(/^0+(?=\d)/, "");
}

export function buildPolicyNumberSearchVariants(value: string) {
  const compact = compactPolicyNumber(value);
  if (!compact) return [];

  const variants = new Set<string>();
  variants.add(compact);

  const normalized = normalizePolicyNumber(compact);
  if (normalized) {
    variants.add(normalized);
  }

  return [...variants];
}
