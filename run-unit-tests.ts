#!/usr/bin/env tsx
// Simple test runner for unit tests using tsx

import { calculateCommission, getCommissionStatusFromReceipt, calculateOverdueStatus, aggregateCommissionStats } from "./src/lib/commissions.logic";
import { calculateRenewalPriority, shouldIncludeInRenewals, createRenewalTaskTitle, createRenewalTaskDescription, calculateRenewalStats, filterRenewalsByTimeRange, sortRenewalsByPriority } from "./src/lib/renewals.logic";
import { calculateFinancialMetrics, calculatePolicyTypeMetrics, calculateClientMetrics, calculateMonthlyTrends, calculateInsurerMetrics, getDefaultReportPeriods } from "./src/lib/reports.logic";

// Simple test framework
let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${error}`);
    failed++;
  }
}

function expect(actual: any) {
  return {
    toBe(expected: any) {
      if (actual !== expected) {
        throw new Error(`Expected ${expected} but got ${actual}`);
      }
    },
    toEqual(expected: any) {
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
      }
    },
    toBeDefined() {
      if (actual === undefined) {
        throw new Error(`Expected value to be defined but got undefined`);
      }
    },
    toBeNull() {
      if (actual !== null) {
        throw new Error(`Expected null but got ${actual}`);
      }
    },
    toBeUndefined() {
      if (actual !== undefined) {
        throw new Error(`Expected undefined but got ${actual}`);
      }
    },
    toBeLessThanOrEqual(expected: number) {
      if (actual > expected) {
        throw new Error(`Expected ${actual} to be <= ${expected}`);
      }
    },
    toBeGreaterThanOrEqual(expected: number) {
      if (actual < expected) {
        throw new Error(`Expected ${actual} to be >= ${expected}`);
      }
    },
    toHaveLength(expected: number) {
      if (actual.length !== expected) {
        throw new Error(`Expected length ${expected} but got ${actual.length}`);
      }
    },
    toContain(expected: any) {
      if (!actual.includes(expected)) {
        throw new Error(`Expected ${JSON.stringify(actual)} to contain ${JSON.stringify(expected)}`);
      }
    },
    toMatch(pattern: RegExp) {
      if (!pattern.test(actual)) {
        throw new Error(`Expected ${actual} to match ${pattern}`);
      }
    },
    get not() {
      return {
        toBe(expected: any) {
          if (actual === expected) {
            throw new Error(`Expected ${actual} not to be ${expected}`);
          }
        },
        toContain(expected: any) {
          if (actual.includes(expected)) {
            throw new Error(`Expected ${JSON.stringify(actual)} not to contain ${JSON.stringify(expected)}`);
          }
        },
      };
    },
  };
}

// Commissions Logic Tests
console.log("\n=== Commissions Logic Tests ===\n");

test("calculates commission at 10% rate by default", () => {
  const result = calculateCommission({
    policyId: "policy-123",
    clientId: "client-123",
    insurerId: "insurer-123",
    premiumAmount: 1000,
    commissionRate: 10,
    receiptDueDate: new Date("2024-06-01"),
    receiptStatus: "PENDING",
  });
  expect(result.expectedAmount).toBe(100);
  expect(result.percentage).toBe(10);
  expect(result.status).toBe("EXPECTED");
});

test("calculates commission at custom rate", () => {
  const result = calculateCommission({
    policyId: "policy-123",
    clientId: "client-123",
    insurerId: "insurer-123",
    premiumAmount: 2000,
    commissionRate: 15,
    receiptDueDate: new Date("2024-06-01"),
    receiptStatus: "PENDING",
  });
  expect(result.expectedAmount).toBe(300);
  expect(result.percentage).toBe(15);
});

test("sets status to PENDING when receipt is PAID", () => {
  const result = calculateCommission({
    policyId: "policy-123",
    clientId: "client-123",
    insurerId: "insurer-123",
    premiumAmount: 1000,
    commissionRate: 10,
    receiptDueDate: new Date("2024-06-01"),
    receiptStatus: "PAID",
  });
  expect(result.status).toBe("PENDING");
});

test("getCommissionStatusFromReceipt returns EXPECTED for PENDING receipt", () => {
  const status = getCommissionStatusFromReceipt("PENDING");
  expect(status).toBe("EXPECTED");
});

test("getCommissionStatusFromReceipt returns PENDING for PAID receipt", () => {
  const status = getCommissionStatusFromReceipt("PAID");
  expect(status).toBe("PENDING");
});

test("calculateOverdueStatus returns PENDING when EXPECTED and due date passed", () => {
  const today = new Date("2024-06-20");
  const expectedDate = new Date("2024-06-15");
  const result = calculateOverdueStatus("EXPECTED", expectedDate, today);
  expect(result).toBe("PENDING");
});

test("calculateOverdueStatus returns OVERDUE when PENDING and due date passed", () => {
  const today = new Date("2024-06-20");
  const expectedDate = new Date("2024-06-15");
  const result = calculateOverdueStatus("PENDING", expectedDate, today);
  expect(result).toBe("OVERDUE");
});

test("calculateOverdueStatus returns null when no change needed", () => {
  const today = new Date("2024-06-15");
  const expectedDate = new Date("2024-06-20");
  const result = calculateOverdueStatus("EXPECTED", expectedDate, today);
  expect(result).toBeNull();
});

test("aggregateCommissionStats calculates totals correctly", () => {
  const commissions = [
    { status: "EXPECTED", expectedAmount: 100, actualAmount: null },
    { status: "PENDING", expectedAmount: 200, actualAmount: 190 },
    { status: "PAID", expectedAmount: 150, actualAmount: 150 },
  ];
  const result = aggregateCommissionStats(commissions);
  expect(result.totalExpected).toBe(450);
  expect(result.totalActual).toBe(340);
  expect(result.statusBreakdown).toHaveLength(3);
});

// Renewals Logic Tests
console.log("\n=== Renewals Logic Tests ===\n");

test("calculateRenewalPriority returns URGENT when renewal is today", () => {
  const today = new Date("2024-06-15");
  const renewalDate = new Date("2024-06-15");
  const priority = calculateRenewalPriority(renewalDate, today);
  expect(priority).toBe("URGENT");
});

test("calculateRenewalPriority returns URGENT when renewal is past", () => {
  const today = new Date("2024-06-20");
  const renewalDate = new Date("2024-06-15");
  const priority = calculateRenewalPriority(renewalDate, today);
  expect(priority).toBe("URGENT");
});

test("calculateRenewalPriority returns HIGH when within 14 days", () => {
  const today = new Date("2024-06-15");
  const renewalDate = new Date("2024-06-25");
  const priority = calculateRenewalPriority(renewalDate, today);
  expect(priority).toBe("HIGH");
});

test("calculateRenewalPriority returns MEDIUM when within 30 days", () => {
  const today = new Date("2024-06-15");
  const renewalDate = new Date("2024-07-05");
  const priority = calculateRenewalPriority(renewalDate, today);
  expect(priority).toBe("MEDIUM");
});

test("calculateRenewalPriority returns LOW when more than 30 days", () => {
  const today = new Date("2024-06-15");
  const renewalDate = new Date("2024-08-01");
  const priority = calculateRenewalPriority(renewalDate, today);
  expect(priority).toBe("LOW");
});

test("shouldIncludeInRenewals returns true for active policy with renewal date", () => {
  const today = new Date("2024-06-15");
  const renewalDate = new Date("2024-07-15");
  const result = shouldIncludeInRenewals("ACTIVE", renewalDate, today);
  expect(result).toBe(true);
});

test("shouldIncludeInRenewals returns false for non-active policy", () => {
  const today = new Date("2024-06-15");
  const renewalDate = new Date("2024-07-15");
  const result = shouldIncludeInRenewals("CANCELLED", renewalDate, today);
  expect(result).toBe(false);
});

test("shouldIncludeInRenewals returns false without renewal date", () => {
  const today = new Date("2024-06-15");
  const result = shouldIncludeInRenewals("ACTIVE", null, today);
  expect(result).toBe(false);
});

test("createRenewalTaskTitle includes URGENT prefix", () => {
  const title = createRenewalTaskTitle("URGENT", "POL-001");
  expect(title).toContain("[URGENTE]");
  expect(title).toContain("POL-001");
});

test("createRenewalTaskDescription describes overdue renewal", () => {
  const description = createRenewalTaskDescription(-5, "Juan Pérez", 1000, "MXN");
  expect(description).toContain("vencida hace 5 días");
  expect(description).toContain("Juan Pérez");
});

test("createRenewalTaskDescription describes upcoming renewal", () => {
  const description = createRenewalTaskDescription(15, "María García", 2000, "MXN");
  expect(description).toContain("vence en 15 días");
});

test("calculateRenewalStats calculates overdue count", () => {
  const today = new Date("2024-06-15");
  const policies = [
    { renewalDate: new Date("2024-06-10"), premiumAmount: 1000 },
    { renewalDate: new Date("2024-06-20"), premiumAmount: 1000 },
    { renewalDate: null, premiumAmount: 1000 },
  ];
  const stats = calculateRenewalStats(policies, today);
  expect(stats.overdueCount).toBe(1);
  expect(stats.next30DaysCount).toBe(1);
});

test("calculateRenewalStats calculates total premium", () => {
  const today = new Date("2024-06-15");
  const policies = [
    { renewalDate: new Date("2024-06-20"), premiumAmount: 1000 },
    { renewalDate: new Date("2024-07-20"), premiumAmount: 2000 },
    { renewalDate: null, premiumAmount: 1500 },
  ];
  const stats = calculateRenewalStats(policies, today);
  expect(stats.totalRenewalPremium).toBe(3000);
});

test("sortRenewalsByPriority sorts correctly", () => {
  const renewals = [
    { policyId: "1", policyNumber: "POL-001", clientId: "c1", clientName: "C1", insurerId: "i1", insurerName: "I1", renewalDate: new Date(), daysUntilRenewal: 15, priority: "MEDIUM" as const, premiumAmount: 1000, currency: "MXN", policyType: "AUTO" },
    { policyId: "2", policyNumber: "POL-002", clientId: "c2", clientName: "C2", insurerId: "i2", insurerName: "I2", renewalDate: new Date(), daysUntilRenewal: 5, priority: "HIGH" as const, premiumAmount: 1000, currency: "MXN", policyType: "AUTO" },
    { policyId: "3", policyNumber: "POL-003", clientId: "c3", clientName: "C3", insurerId: "i3", insurerName: "I3", renewalDate: new Date(), daysUntilRenewal: 0, priority: "URGENT" as const, premiumAmount: 1000, currency: "MXN", policyType: "AUTO" },
  ];
  const sorted = sortRenewalsByPriority(renewals);
  expect(sorted[0].priority).toBe("URGENT");
  expect(sorted[1].priority).toBe("HIGH");
  expect(sorted[2].priority).toBe("MEDIUM");
});

// Reports Logic Tests
console.log("\n=== Reports Logic Tests ===\n");

test("calculateFinancialMetrics calculates total premium", () => {
  const receipts = [
    { amount: 1000, status: "PAID" },
    { amount: 2000, status: "PENDING" },
    { amount: 1500, status: "PAID" },
  ];
  const commissions: any[] = [];
  const metrics = calculateFinancialMetrics(receipts, commissions);
  expect(metrics.totalPremium).toBe(4500);
  expect(metrics.totalReceipts).toBe(3);
  expect(metrics.paidReceipts).toBe(2);
  expect(metrics.pendingReceipts).toBe(1);
});

test("calculateFinancialMetrics calculates commission", () => {
  const receipts: any[] = [];
  const commissions = [
    { expectedAmount: 100, actualAmount: 100 },
    { expectedAmount: 200, actualAmount: null },
  ];
  const metrics = calculateFinancialMetrics(receipts, commissions);
  expect(metrics.totalCommission).toBe(300);
});

test("calculatePolicyTypeMetrics groups by type", () => {
  const policies = [
    { policyType: "AUTO", premiumAmount: 1000 },
    { policyType: "AUTO", premiumAmount: 2000 },
    { policyType: "HOME", premiumAmount: 1500 },
  ];
  const metrics = calculatePolicyTypeMetrics(policies);
  expect(metrics).toHaveLength(2);
  const auto = metrics.find((m: any) => m.type === "AUTO");
  expect(auto?.count).toBe(2);
  expect(auto?.totalPremium).toBe(3000);
});

test("calculateClientMetrics calculates per client", () => {
  const clients = [
    {
      id: "c1",
      fullName: "Juan Pérez",
      policies: [
        { premiumAmount: 1000, startDate: new Date("2024-01-01") },
        { premiumAmount: 2000, startDate: new Date("2024-02-01") },
      ],
    },
  ];
  const metrics = calculateClientMetrics(clients);
  expect(metrics[0].clientName).toBe("Juan Pérez");
  expect(metrics[0].totalPremium).toBe(3000);
  expect(metrics[0].policyCount).toBe(2);
});

test("calculateInsurerMetrics calculates per insurer", () => {
  const insurers = [
    {
      id: "i1",
      name: "GNP",
      commissionRate: 10,
      policies: [
        { premiumAmount: 1000, commission: [{ expectedAmount: 100, actualAmount: 100 }] },
        { premiumAmount: 2000, commission: [{ expectedAmount: 200, actualAmount: null }] },
      ],
    },
  ];
  const metrics = calculateInsurerMetrics(insurers);
  expect(metrics[0].insurerName).toBe("GNP");
  expect(metrics[0].totalPremium).toBe(3000);
  expect(metrics[0].totalCommission).toBe(300);
});

test("getDefaultReportPeriods returns default periods", () => {
  const result = getDefaultReportPeriods(null, null);
  expect(result.available).toBe(true);
  const labels = result.periods.map((p: any) => p.label);
  expect(labels).toContain("Último mes");
  expect(labels).toContain("Últimos 3 meses");
  expect(labels).toContain("Último año");
});

// Summary
console.log("\n=== Test Summary ===");
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);

if (failed > 0) {
  process.exit(1);
}
