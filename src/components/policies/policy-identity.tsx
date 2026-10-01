import { getPolicyObjectDescription, type PolicyObjectSource } from "@/lib/policy-identity";

export function PolicyIdentity({
  policyNumber,
  policy,
  className = "",
}: {
  policyNumber: string;
  policy: PolicyObjectSource;
  className?: string;
}) {
  const description = getPolicyObjectDescription(policy);

  return (
    <span className={`block min-w-0 ${className}`}>
      <span className="block truncate font-medium text-foreground">{policyNumber}</span>
      <span className="block max-w-64 truncate text-xs font-normal text-muted-foreground" title={description}>
        {description}
      </span>
    </span>
  );
}
