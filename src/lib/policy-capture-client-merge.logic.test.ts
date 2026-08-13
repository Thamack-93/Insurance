import { describe, expect, it } from "vitest";
import { buildCaptureClientEnrichment, chooseCaptureClient, type CaptureClientCandidate } from "@/lib/policy-capture-client-merge";

function client(overrides: Partial<CaptureClientCandidate> = {}): CaptureClientCandidate {
  return {
    id: "client-1",
    fullName: "MOTORES ANGELOPOLIS SA DE CV",
    type: "COMPANY",
    rfc: null,
    email: null,
    phone: null,
    address: null,
    birthDate: null,
    ...overrides,
  };
}

describe("policy capture client merge", () => {
  it("matches company names with punctuation and legal suffix differences", () => {
    expect(chooseCaptureClient({ fullName: "MOTORES ANGELOPOLIS, S.A. DE C.V.", rfc: null }, [client()]).candidate?.id).toBe("client-1");
  });

  it("fills only missing client fields", () => {
    const result = buildCaptureClientEnrichment(client({ email: "existente@example.com" }), {
      fullName: "MOTORES ANGELOPOLIS, S.A. DE C.V.",
      rfc: "ABC010101AA1",
      email: "nuevo@example.com",
      address: "Av. Reforma 1",
    });
    expect(result.updates).toMatchObject({ rfc: "ABC010101AA1", address: "Av. Reforma 1" });
    expect(result.updates).not.toHaveProperty("email");
    expect(result.conflicts).toEqual([{ field: "email", existing: "existente@example.com", incoming: "nuevo@example.com" }]);
  });

  it("rejects an RFC that belongs to another client", () => {
    const result = chooseCaptureClient(
      { fullName: "MOTORES ANGELOPOLIS, S.A. DE C.V.", rfc: "ABC010101AA1" },
      [client(), client({ id: "client-2", fullName: "OTRA EMPRESA", rfc: "ABC010101AA1" })],
    );
    expect(result.candidate).toBeNull();
    expect(result.conflict).toContain("RFC");
  });
});
