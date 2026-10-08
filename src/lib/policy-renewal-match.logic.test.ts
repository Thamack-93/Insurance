import { describe, expect, it } from "vitest";
import { canReactivateStaleSerialSuggestion, getRenewalStartGapDays, matchSerialRenewal, normalizePolicySerial, STALE_SERIAL_SUGGESTION_NOTE } from "@/lib/policy-renewal-match.logic";

const date = (value: string) => new Date(`${value}T12:00:00.000Z`);

describe("serial renewal matching", () => {
  it("normalizes VIN punctuation and case", () => {
    expect(normalizePolicySerial(" jm3-er293 390233329 ")).toBe("JM3ER293390233329");
  });

  it("suggests same-client exact VIN renewals across insurers with consecutive dates", () => {
    const result = matchSerialRenewal(
      { clientId: "client-1", insurerId: "carrier-old", policyType: "AUTO", endDate: date("2026-10-13"), serialNumbers: ["JM3-ER293390233329"] },
      { clientId: "client-1", insurerId: "carrier-new", policyType: "AUTO", startDate: date("2026-10-13"), serialNumbers: ["JM3ER293390233329"] },
    );
    expect(result).toMatchObject({ gapDays: 0, confidence: 0.99, serialNumber: "JM3ER293390233329" });
  });

  it("does not suggest another client's vehicle, a different VIN, or dates outside the window", () => {
    const source = { clientId: "client-1", policyType: "AUTO", endDate: date("2026-10-13"), serialNumbers: ["VIN-1"] };
    expect(matchSerialRenewal(source, { clientId: "client-2", policyType: "AUTO", startDate: date("2026-10-13"), serialNumbers: ["VIN-1"] })).toBeNull();
    expect(matchSerialRenewal(source, { clientId: "client-1", policyType: "AUTO", startDate: date("2026-10-13"), serialNumbers: ["VIN-2"] })).toBeNull();
    expect(matchSerialRenewal(source, { clientId: "client-1", policyType: "AUTO", startDate: date("2026-12-01"), serialNumbers: ["VIN-1"] })).toBeNull();
  });

  it("calculates the date gap by calendar day", () => {
    expect(getRenewalStartGapDays(date("2026-10-13"), date("2026-10-20"))).toBe(7);
  });

  it("reopens only suggestions dismissed because their serial match became stale", () => {
    expect(canReactivateStaleSerialSuggestion("DISMISSED", STALE_SERIAL_SUGGESTION_NOTE)).toBe(true);
    expect(canReactivateStaleSerialSuggestion("DISMISSED", "Sugerencia de coincidencia por serie descartada.")).toBe(false);
    expect(canReactivateStaleSerialSuggestion("ACCEPTED", STALE_SERIAL_SUGGESTION_NOTE)).toBe(false);
  });
});
