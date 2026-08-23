import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { platformBillingMutationsEnabled } from "@/lib/platform-billing";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("platform billing feature flag", () => {
  it("is disabled unless explicitly enabled", () => {
    vi.stubEnv("PLATFORM_BILLING_MUTATIONS_ENABLED", "");
    expect(platformBillingMutationsEnabled()).toBe(false);
    vi.stubEnv("PLATFORM_BILLING_MUTATIONS_ENABLED", "0");
    expect(platformBillingMutationsEnabled()).toBe(false);
    vi.stubEnv("PLATFORM_BILLING_MUTATIONS_ENABLED", "1");
    expect(platformBillingMutationsEnabled()).toBe(true);
  });
});
