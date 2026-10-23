import { describe, expect, it } from "vitest";
import { getDocumentSituation } from "./document-situation";

const today = new Date("2026-10-22T12:00:00");

describe("getDocumentSituation", () => {
  it("marks a linked active policy with current coverage as vigente", () => {
    expect(getDocumentSituation({ policy: { status: "ACTIVE", endDate: new Date("2026-10-22T00:00:00") } }, today).label).toBe("Vigente");
  });

  it("marks expired or cancelled records as historical", () => {
    expect(getDocumentSituation({ policy: { status: "EXPIRED", endDate: new Date("2027-10-22") } }, today).label).toBe("Histórico");
    expect(getDocumentSituation({ receipt: { status: "PAID" } }, today).label).toBe("Histórico");
    expect(getDocumentSituation({ task: { status: "RESOLVED" } }, today).label).toBe("Histórico");
  });

  it("marks open operational records as in progress", () => {
    expect(getDocumentSituation({ receipt: { status: "OVERDUE" } }, today).label).toBe("En curso");
    expect(getDocumentSituation({ claim: { status: "WAITING_INSURER" } }, today).label).toBe("En curso");
    expect(getDocumentSituation({ task: { status: "OPEN" } }, today).label).toBe("En curso");
  });

  it("does not call a client-only or unlinked file active", () => {
    expect(getDocumentSituation({ client: { id: "client-1" }, clientId: "client-1" }, today).label).toBe("Histórico");
    expect(getDocumentSituation({}, today).label).toBe("Sin expediente");
  });
});
