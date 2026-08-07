import { describe, expect, it } from "vitest";
import {
  getBreadcrumbSegments,
  getPrimaryNavigationId,
  getUtilityNavigation,
  globalNavigation,
  isLocalNavigationItemActive,
  isNavigationItemActive,
  isUtilityNavigationItemActive,
  policyNavigation,
  reportsNavigation,
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

  it("keeps functional section routes separate from redirect aliases", () => {
    const policies = globalNavigation.find((item) => item.id === "policies");
    const reports = globalNavigation.find((item) => item.id === "reports");

    expect(policies?.redirectAliases).toBeUndefined();
    expect(policies?.activePaths).toContain("/quotes");
    expect(reports?.redirectAliases).toBeUndefined();
    expect(reports?.activePaths).toContain("/portfolio");
  });
});

describe("local navigation", () => {
  it("marks functional section views active without changing their canonical paths", () => {
    expect(isLocalNavigationItemActive(
      policyNavigation.find((item) => item.href === "/quotes")!,
      "/quotes",
      new URLSearchParams(),
    )).toBe(true);
    expect(isLocalNavigationItemActive(
      reportsNavigation.find((item) => item.href === "/portfolio")!,
      "/portfolio",
      new URLSearchParams(),
    )).toBe(true);
    expect(isLocalNavigationItemActive(
      reportsNavigation.find((item) => item.href === "/reports?view=portfolio")!,
      "/reports",
      new URLSearchParams("view=portfolio"),
    )).toBe(true);
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

  it("adds contextual breadcrumbs for Today Insights and portfolio reports", () => {
    expect(getBreadcrumbSegments("/today", new URLSearchParams("view=insights"))).toEqual([
      { segment: "today", label: "Hoy" },
      { segment: "insights", label: "Insights" },
    ]);
    expect(getBreadcrumbSegments("/reports", new URLSearchParams("view=portfolio"))).toEqual([
      { segment: "reports", label: "Reportes" },
      { segment: "portfolio", label: "Reporte de cartera" },
    ]);
  });
});
