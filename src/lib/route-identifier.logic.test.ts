import { describe, expect, it } from "vitest";
import { decodeRouteIdentifier } from "@/lib/route-identifier";

describe("decodeRouteIdentifier", () => {
  it("decodes reserved punctuation from a route parameter once", () => {
    expect(decodeRouteIdentifier("org_demo_123%3Ademo%3Apolicy%3A001")).toBe("org_demo_123:demo:policy:001");
  });

  it("leaves already decoded IDs unchanged", () => {
    expect(decodeRouteIdentifier("org_demo_123:demo:policy:001")).toBe("org_demo_123:demo:policy:001");
  });

  it("rejects malformed encoded route parameters", () => {
    expect(decodeRouteIdentifier("org_demo_123%3Ademo%")).toBeNull();
  });
});
