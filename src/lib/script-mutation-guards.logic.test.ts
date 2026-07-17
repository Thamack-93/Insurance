import { afterEach, describe, expect, it, vi } from "vitest";
import { assertProductionMutationAllowed } from "../../scripts/_shared.ts";

describe("production mutation guard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows explicit non-production targets", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://localhost:5432/policydesk");
    vi.stubEnv("SCRIPT_TARGET_ENV", "development");

    expect(() =>
      assertProductionMutationAllowed({
        actionLabel: "Script de mantenimiento",
        overrideEnv: "ALLOW_SCRIPT_MAINTENANCE_PRODUCTION",
      }),
    ).not.toThrow();
  });

  it("blocks production targets unless overridden", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://ep-prod.us-east-2.aws.neon.tech/policydesk");
    vi.stubEnv("SCRIPT_TARGET_ENV", "production");

    expect(() =>
      assertProductionMutationAllowed({
        actionLabel: "Script de mantenimiento",
        overrideEnv: "ALLOW_SCRIPT_MAINTENANCE_PRODUCTION",
      }),
    ).toThrow("ALLOW_SCRIPT_MAINTENANCE_PRODUCTION");
  });

  it("allows production targets only with an explicit override", () => {
    vi.stubEnv("DATABASE_URL", "postgresql://ep-prod.us-east-2.aws.neon.tech/policydesk");
    vi.stubEnv("SCRIPT_TARGET_ENV", "production");
    vi.stubEnv("ALLOW_SCRIPT_MAINTENANCE_PRODUCTION", "1");

    expect(() =>
      assertProductionMutationAllowed({
        actionLabel: "Script de mantenimiento",
        overrideEnv: "ALLOW_SCRIPT_MAINTENANCE_PRODUCTION",
      }),
    ).not.toThrow();
  });
});
