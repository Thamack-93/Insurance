import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchPdfCaptureWithTimeout,
  withOperationTimeout,
} from "@/lib/pdf-capture-client";

describe("pdf capture client deadlines", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("aborts an analysis request that exceeds the client deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));

    const request = fetchPdfCaptureWithTimeout(
      "/api/nora/policy-pdf/analyze",
      { method: "POST" },
      50,
      "El análisis tardó demasiado.",
    );
    const rejection = expect(request).rejects.toMatchObject({ code: "OPERATION_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(50);

    await rejection;
  });

  it("rejects a stalled upload promise with an actionable timeout", async () => {
    vi.useFakeTimers();
    const upload = withOperationTimeout(new Promise<never>(() => {}), 50, "La subida tardó demasiado.");
    const rejection = expect(upload).rejects.toMatchObject({
      code: "OPERATION_TIMEOUT",
      message: "La subida tardó demasiado.",
    });
    await vi.advanceTimersByTimeAsync(50);

    await rejection;
  });
});
