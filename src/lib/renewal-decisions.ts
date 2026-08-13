import type { Prisma } from "@/generated/prisma/client";

/**
 * A policy is an unresolved renewal candidate only while it is still active,
 * has no successor policy, and has no explicit accepted/declined decision.
 * Keep this structural predicate separate from the date window used by each
 * page so the dashboard, reports, Telegram and operations list cannot drift
 * apart.
 */
export const UNRESOLVED_RENEWAL_POLICY_WHERE: Prisma.PolicyWhereInput = {
  status: "ACTIVE",
  renewals: {
    none: {},
  },
  sourceRenewalSuggestions: {
    none: {
      status: { in: ["ACCEPTED", "DECLINED"] },
    },
  },
};

/**
 * Backwards-compatible name used by older renewal consumers. Every surface
 * that presents a policy as needing renewal must use the unresolved rule.
 */
export const ACTIVE_RENEWAL_POLICY_WHERE = UNRESOLVED_RENEWAL_POLICY_WHERE;
