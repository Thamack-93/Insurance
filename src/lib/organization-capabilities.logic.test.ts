import { describe, expect, it, vi } from "vitest";
import { isDemoExternalCapability, resolveOrganizationCapability, type OrganizationCapabilityKey } from "./organization-capabilities";

describe("DEMO capability invariant", () => {
  it("keeps provider-facing integrations blocked for every DEMO tenant", () => {
    const providerCapabilities: OrganizationCapabilityKey[] = ["NORA", "EMAIL", "TELEGRAM", "WHATSAPP", "QUALITAS", "IMPORTS"];
    expect(providerCapabilities.every((key) => isDemoExternalCapability(key))).toBe(true);
  });

  it("does not classify internal workflow capabilities as external side effects", () => {
    expect(isDemoExternalCapability("EXPORTS")).toBe(false);
    expect(isDemoExternalCapability("DOCUMENTS")).toBe(false);
  });

  it("cannot reopen any provider capability from a permissive DEMO capability row", async () => {
    const organization = {
      id: "demo-org",
      kind: "DEMO",
      status: "ACTIVE",
      capabilities: [{ enabled: true, limitValue: 99, source: "OPERATOR_CERTIFIED" }],
      billingSubscriptions: [{ status: "TRIAL", endsAt: null, plan: { code: "DEMO", active: true } }],
    };
    const db = { organization: { findUnique: vi.fn().mockResolvedValue(organization) } } as never;
    for (const capability of ["NORA", "IMPORTS", "EMAIL", "TELEGRAM", "WHATSAPP", "QUALITAS"] as const) {
      const result = await resolveOrganizationCapability("demo-org", capability, db);
      expect(result).toMatchObject({ enabled: false, reason: "DEMO_RESTRICTED", limitValue: null, capability });
    }
  });
});
