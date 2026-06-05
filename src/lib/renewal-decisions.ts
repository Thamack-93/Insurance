import type { Prisma } from "@/generated/prisma/client";

export const ACTIVE_RENEWAL_POLICY_WHERE: Prisma.PolicyWhereInput = {
  status: "ACTIVE",
  sourceRenewalSuggestions: {
    none: {
      status: "DECLINED",
    },
  },
};
