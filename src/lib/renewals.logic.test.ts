import { addDays } from "date-fns";
import { describe, expect, it } from "vitest";
import {
  calculateRenewalPriority,
  calculateRenewalStats,
  createRenewalTaskDescription,
  createRenewalTaskTitle,
  filterRenewalsByTimeRange,
  shouldIncludeInRenewals,
  sortRenewalsByPriority,
  type RenewalInfo,
} from "./renewals.logic";

function makeRenewal(partial: Partial<RenewalInfo> & Pick<RenewalInfo, "policyId" | "renewalDate" | "priority">): RenewalInfo {
  return {
    policyNumber: "POL-1",
    clientId: "c1",
    clientName: "Client",
    insurerId: "i1",
    insurerName: "Insurer",
    daysUntilRenewal: 10,
    premiumAmount: 1000,
    currency: "MXN",
    policyType: "AUTO",
    ...partial,
  };
}

describe("renewals.logic", () => {
  const today = new Date("2024-06-15");

  it("assigns URGENT priority when renewal is due", () => {
    expect(calculateRenewalPriority(new Date("2024-06-15"), today)).toBe("URGENT");
    expect(calculateRenewalPriority(new Date("2024-06-10"), today)).toBe("URGENT");
  });

  it("includes active policies with renewal date", () => {
    expect(shouldIncludeInRenewals("ACTIVE", new Date("2024-07-01"))).toBe(true);
    expect(shouldIncludeInRenewals("CANCELLED", new Date("2024-07-01"))).toBe(false);
  });

  it("builds renewal task title and description", () => {
    expect(createRenewalTaskTitle("HIGH", "POL-1")).toMatch(/POL-1/);
    expect(createRenewalTaskDescription(5, "Acme", 1000, "MXN")).toMatch(/Acme/);
  });

  it("filters and sorts renewals", () => {
    const renewals: RenewalInfo[] = [
      makeRenewal({
        policyId: "1",
        renewalDate: addDays(today, 10),
        priority: "MEDIUM",
      }),
      makeRenewal({
        policyId: "2",
        renewalDate: addDays(today, 2),
        priority: "HIGH",
      }),
    ];
    const filtered = filterRenewalsByTimeRange(renewals, 30, today);
    expect(filtered).toHaveLength(2);
    const sorted = sortRenewalsByPriority(renewals);
    expect(sorted[0].priority).toBe("HIGH");
    const stats = calculateRenewalStats(
      renewals.map((r) => ({ renewalDate: r.renewalDate, premiumAmount: r.premiumAmount })),
      today,
    );
    expect(stats.totalActive).toBe(2);
  });
});
