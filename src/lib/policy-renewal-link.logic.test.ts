import { describe, expect, it } from "vitest";
import { validateRenewalLink } from "@/lib/policy-renewal-link.logic";

const source = {
  id: "old",
  clientId: "client-1",
  insurerId: "insurer-1",
  policyType: "AUTO",
  startDate: new Date("2025-06-01T00:00:00.000Z"),
  endDate: new Date("2026-06-01T00:00:00.000Z"),
};
const renewal = {
  id: "new",
  clientId: "client-1",
  insurerId: "insurer-1",
  policyType: "AUTO",
  startDate: new Date("2026-06-01T00:00:00.000Z"),
  endDate: new Date("2027-06-01T00:00:00.000Z"),
};

describe("renewal source authorization and term invariants", () => {
  it("accepts a consecutive term even when the official number is unchanged", () => {
    expect(validateRenewalLink(source, renewal)).toBeNull();
  });
  it("rejects a same-record link", () => {
    expect(validateRenewalLink(source, { ...renewal, id: source.id })).toMatch(/sí misma/);
  });
  it("rejects a wrong client, insurer, or policy type", () => {
    expect(validateRenewalLink(source, { ...renewal, clientId: "other" })).toMatch(/otro cliente/);
    expect(validateRenewalLink(source, { ...renewal, insurerId: "other" })).toMatch(/aseguradora/);
    expect(validateRenewalLink(source, { ...renewal, policyType: "GMM" })).toMatch(/ramo/);
  });
  it("rejects backwards and distant terms", () => {
    expect(validateRenewalLink(source, { ...renewal, startDate: source.startDate })).toMatch(/posterior/);
    expect(validateRenewalLink(source, { ...renewal, startDate: new Date("2027-01-01T00:00:00.000Z") })).toMatch(/separadas/);
    expect(validateRenewalLink(source, { ...renewal, startDate: new Date("2026-04-01T00:00:00.000Z") })).toMatch(/solapadas/);
  });
  it("allows the defined narrow overlap and gap used by renewal matching", () => {
    expect(validateRenewalLink(source, { ...renewal, startDate: new Date("2026-05-12T00:00:00.000Z") })).toBeNull();
    expect(validateRenewalLink(source, { ...renewal, startDate: new Date("2026-07-01T00:00:00.000Z") })).toBeNull();
  });
  it("fails closed on invalid dates", () => {
    expect(validateRenewalLink(source, { ...renewal, startDate: new Date(NaN) })).toMatch(/vigencias/);
  });
});
