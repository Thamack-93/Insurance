import { describe, expect, it } from "vitest";
import { ACTIVE_RENEWAL_POLICY_WHERE, UNRESOLVED_RENEWAL_POLICY_WHERE } from "./renewal-decisions";

describe("renewal decision query", () => {
  it("uses the unresolved renewal rule for every active-renewal consumer", () => {
    expect(ACTIVE_RENEWAL_POLICY_WHERE).toBe(UNRESOLVED_RENEWAL_POLICY_WHERE);
    expect(UNRESOLVED_RENEWAL_POLICY_WHERE).toMatchObject({
      status: "ACTIVE",
      renewals: { none: {} },
      sourceRenewalSuggestions: {
        none: { status: { in: ["ACCEPTED", "DECLINED"] } },
      },
    });
  });
});
