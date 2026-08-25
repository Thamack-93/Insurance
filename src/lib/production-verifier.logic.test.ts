import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aggregateVerificationStatus,
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
});
