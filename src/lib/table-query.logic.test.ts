import { describe, expect, it } from "vitest";
import { buildTableHref, readAllowedTableParam, readTablePage, readTableSort } from "@/lib/table-query";

describe("table-query helpers", () => {
  it("reads and clamps page numbers", () => {
    expect(readTablePage({})).toBe(1);
    expect(readTablePage({ page: "3" })).toBe(3);
    expect(readTablePage({ page: "0" })).toBe(1);
    expect(readTablePage({ page: "9.8" })).toBe(9);
  });

  it("reads allowed params only", () => {
    expect(readAllowedTableParam({ tab: "cobrar" }, "tab", ["cobrar", "historico"])).toBe("cobrar");
    expect(readAllowedTableParam({ tab: "otro" }, "tab", ["cobrar", "historico"])).toBeUndefined();
  });

  it("reads sort state with safe defaults", () => {
    expect(readTableSort({})).toEqual({ sortKey: null, direction: null });
    expect(readTableSort({ sort: "client" })).toEqual({ sortKey: "client", direction: "asc" });
    expect(readTableSort({ sort: "client", dir: "desc" })).toEqual({ sortKey: "client", direction: "desc" });
  });

  it("builds table urls while preserving filters", () => {
    const href = buildTableHref(
      "/claims",
      { q: "abc", page: "4", sort: "client", dir: "asc" },
      { q: "abc", sort: "client", dir: "desc" },
    );

    expect(href).toBe("/claims?q=abc&sort=client&dir=desc");
  });
});
