import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchPdfCaptureWithTimeout,
  PdfCaptureUploadError,
  uploadPdfWithRetry,
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

  it("aborts a stalled blob upload and retries only the upload", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    let calls = 0;
    const uploadFn = vi.fn(async (_pathname: string, _file: File, options: { abortSignal?: AbortSignal }) => {
      calls += 1;
      if (options.abortSignal) signals.push(options.abortSignal);
      if (calls === 1) return await new Promise<never>(() => {});
      return { url: "https://blob.test/retried.pdf" } as never;
    });

    const request = uploadPdfWithRetry({
      pathname: "nora/policy.pdf",
      file: new File(["pdf"], "policy.pdf", { type: "application/pdf" }),
      handleUploadUrl: "/api/nora/policy-pdf/upload",
      clientPayload: "{}",
      attemptTimeoutMs: 50,
      totalTimeoutMs: 700,
      maxAttempts: 2,
      uploadFn: uploadFn as never,
    });

    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(500);
    await expect(request).resolves.toMatchObject({ url: "https://blob.test/retried.pdf", attempts: 2 });
    expect(calls).toBe(2);
    expect(signals[0]?.aborted).toBe(true);
  });

  it("does not retry authorization or size failures", async () => {
    const uploadFn = vi.fn(async () => {
      throw Object.assign(new Error("forbidden"), { statusCode: 403 });
    });

    await expect(uploadPdfWithRetry({
      pathname: "nora/policy.pdf",
      file: new File(["pdf"], "policy.pdf", { type: "application/pdf" }),
      handleUploadUrl: "/api/nora/policy-pdf/upload",
      clientPayload: "{}",
      maxAttempts: 2,
      uploadFn: uploadFn as never,
    })).rejects.toMatchObject({
      code: "UPLOAD_UNAUTHORIZED",
      retryable: false,
      attempts: 1,
    } satisfies Partial<PdfCaptureUploadError>);
    expect(uploadFn).toHaveBeenCalledTimes(1);
  });

  it("aborts an in-flight upload when the operation is cancelled", async () => {
    const controller = new AbortController();
    let aborted = false;
    const uploadFn = vi.fn(async (_pathname: string, _file: File, options: { abortSignal?: AbortSignal }) => {
      options.abortSignal?.addEventListener("abort", () => { aborted = true; }, { once: true });
      return await new Promise<never>(() => {});
    });
    const request = uploadPdfWithRetry({
      pathname: "nora/policy.pdf",
      file: new File(["pdf"], "policy.pdf", { type: "application/pdf" }),
      handleUploadUrl: "/api/nora/policy-pdf/upload",
      clientPayload: "{}",
      maxAttempts: 2,
      signal: controller.signal,
      uploadFn: uploadFn as never,
    });
    controller.abort("removed");
    await expect(request).rejects.toMatchObject({ code: "UPLOAD_CANCELLED", retryable: false });
    expect(aborted).toBe(true);
    expect(uploadFn).toHaveBeenCalledTimes(1);
  });
});
