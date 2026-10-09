import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aggregateVerificationStatus,
  inspectMigrationHistory,
  resolveProductionTenantMode,
} from "@/lib/production-verifier";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("production verifier contract", () => {
  it("uses singleton mode by default and rejects unknown modes", () => {
    expect(resolveProductionTenantMode(undefined)).toBe("single-org");
    expect(resolveProductionTenantMode("multi-org")).toBe("multi-org");
    expect(resolveProductionTenantMode("production")).toBe("INVALID");
  });

  it("keeps WARN successful and BLOCKED non-zero", () => {
    expect(aggregateVerificationStatus([])).toBe("PASS");
    expect(aggregateVerificationStatus([{ code: "RLS_DISABLED", severity: "WARN", message: "safe" }])).toBe("WARN");
    expect(aggregateVerificationStatus([{ code: "MIGRATION_PENDING", severity: "BLOCKED", message: "stop" }])).toBe("BLOCKED");
  });

  it("ignores rolled-back attempts after Prisma successfully reapplies the migration", () => {
    const history = inspectMigrationHistory([
      { migration_name: "cutover", finished_at: null, rolled_back_at: new Date("2026-10-08T00:00:00Z"), applied_steps_count: 1 },
      { migration_name: "cutover", finished_at: new Date("2026-10-09T00:00:00Z"), rolled_back_at: null, applied_steps_count: 1 },
    ]);

    expect(history).toEqual({ incomplete: [], duplicateNames: [] });
  });

  it("still blocks unresolved and repeated active migration attempts", () => {
    const history = inspectMigrationHistory([
      { migration_name: "unfinished", finished_at: null, rolled_back_at: null, applied_steps_count: 1 },
      { migration_name: "repeated", finished_at: new Date("2026-10-09T00:00:00Z"), rolled_back_at: null, applied_steps_count: 1 },
      { migration_name: "repeated", finished_at: new Date("2026-10-09T00:01:00Z"), rolled_back_at: null, applied_steps_count: 1 },
    ]);

    expect(history).toEqual({ incomplete: ["unfinished"], duplicateNames: ["repeated"] });
  });
});
