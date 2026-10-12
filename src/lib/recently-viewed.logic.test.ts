import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRecentItems, recordRecentItem } from "@/lib/recently-viewed";

describe("recientes por usuario y organización", () => {
  const values = new Map<string, string>();

  beforeEach(() => {
    values.clear();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
      dispatchEvent: vi.fn(),
    });
    vi.stubGlobal("CustomEvent", class CustomEventStub {
      constructor(readonly type: string) {}
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("no comparte visitas entre cuentas u organizaciones y omite el almacén legado global", () => {
    values.set("pg_recently_viewed", JSON.stringify([
      { id: "real-policy", label: "Cliente real", href: "/policies/real-policy", type: "Póliza", visitedAt: 1 },
    ]));

    recordRecentItem(
      { id: "demo-policy", label: "Póliza DEMO", href: "/policies/demo-policy", type: "Póliza" },
      "demo-user",
      "demo-org",
    );

    expect(getRecentItems("demo-user", "demo-org").map(({ id }) => id)).toEqual(["demo-policy"]);
    expect(getRecentItems("other-user", "demo-org")).toEqual([]);
    expect(getRecentItems("demo-user", "other-org")).toEqual([]);
    expect(getRecentItems("demo-user", "")).toEqual([]);
  });
});
