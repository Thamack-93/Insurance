import { describe, expect, it } from "vitest";
import {
  getBreadcrumbSegments,
  getPrimaryNavigationId,
  getUtilityNavigation,
  globalNavigation,
  isNavigationItemActive,
  isUtilityNavigationItemActive,
} from "./navigation";

describe("global navigation", () => {
  it("exposes exactly the seven primary destinations in operational order", () => {
    expect(globalNavigation.map(({ id, label }) => ({ id, label }))).toEqual([
      { id: "today", label: "Hoy" },
      { id: "operations", label: "Operación" },
      { id: "clients", label: "Clientes" },
      { id: "policies", label: "Pólizas" },
      { id: "receipts", label: "Recibos" },
      { id: "commissions", label: "Comisiones y bonos" },
      { id: "reports", label: "Reportes" },
    ]);
  });

  it.each([
    ["/today", "today"],
    ["/dashboard", "today"],
    ["/tasks", "operations"],
    ["/tasks/task-1", "operations"],
    ["/renewals", "operations"],
    ["/claims/claim-1", "operations"],
    ["/quotes/quote-1", "policies"],
    ["/due-payments", "receipts"],
    ["/payments/new", "receipts"],
    ["/portfolio", "reports"],
  ] as const)("maps %s to %s", (pathname, expected) => {
    expect(getPrimaryNavigationId(pathname)).toBe(expected);
  });

  it("does not treat Nora as a sidebar destination", () => {
    expect(getPrimaryNavigationId("/assistant")).toBeUndefined();
  });

  it("handles a trailing slash without dropping the active primary destination", () => {
    const receipts = globalNavigation.find((item) => item.id === "receipts");
    expect(receipts).toBeDefined();
    expect(isNavigationItemActive(receipts!, "/due-payments/")).toBe(true);
  });
});

describe("utility navigation", () => {
  it("hides Administration for agents without hiding their profile", () => {
    expect(getUtilityNavigation(false).map((item) => item.id)).toEqual(["profile"]);
  });

  it("shows Administration and profile to administrators", () => {
    expect(getUtilityNavigation(true).map((item) => item.id)).toEqual(["administration", "profile"]);
  });

  it("keeps only Profile active inside its more-specific settings route", () => {
    const utilities = getUtilityNavigation(true);
    expect(isUtilityNavigationItemActive(utilities[0], "/settings/account")).toBe(false);
    expect(isUtilityNavigationItemActive(utilities[1], "/settings/account")).toBe(true);
  });
});

describe("breadcrumbs", () => {
  it("uses the canonical receipt label for the legacy due payments route", () => {
    expect(getBreadcrumbSegments("/due-payments")).toEqual([
      { segment: "due-payments", label: "Recibos" },
    ]);
  });

  it("uses Nora rather than the deprecated assistant label", () => {
    expect(getBreadcrumbSegments("/assistant")).toEqual([
      { segment: "assistant", label: "Nora" },
    ]);
  });
});
