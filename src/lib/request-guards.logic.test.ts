import { describe, expect, it } from "vitest";
import { assertSameOrigin } from "@/lib/request-guards";

describe("request same-origin guard", () => {
  it("accepts the canonical request origin", () => {
    expect(() => assertSameOrigin({
      url: "http://localhost:3000/api/assistant",
      headers: new Headers({ origin: "http://localhost:3000" }),
    })).not.toThrow();
  });

  it("accepts an exact forwarded host behind a trusted proxy", () => {
    expect(() => assertSameOrigin({
      url: "http://localhost:3000/api/assistant",
      headers: new Headers({
        origin: "https://preview.example.com",
        host: "localhost:3000",
        "x-forwarded-host": "preview.example.com",
        "x-forwarded-proto": "https",
      }),
    })).not.toThrow();
  });

  it("rejects unrelated origins", () => {
    expect(() => assertSameOrigin({
      url: "https://app.example.com/api/assistant",
      headers: new Headers({ origin: "https://evil.example" }),
    })).toThrow();
  });
});
