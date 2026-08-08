import { afterEach, describe, expect, it, vi } from "vitest";

const pdfMocks = vi.hoisted(() => ({
  browserGetDocument: vi.fn(),
  serverGetDocument: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("pdfjs-dist/webpack.mjs", () => ({ getDocument: pdfMocks.browserGetDocument }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({ getDocument: pdfMocks.serverGetDocument }));

import { extractPdfTextFromFile } from "@/lib/pdf-text-extraction.browser";
import { extractPdfTextFromBytes } from "@/lib/pdf-text-extraction";

function neverResolvingLoadingTask() {
  return {
    promise: new Promise<never>(() => {}),
    destroy: vi.fn().mockResolvedValue(undefined),
  };
}

describe("pdf text extraction deadlines", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("cancels a browser extraction that exceeds its deadline", async () => {
    await import("pdfjs-dist/webpack.mjs");
    vi.useFakeTimers();
    const loadingTask = neverResolvingLoadingTask();
    pdfMocks.browserGetDocument.mockReturnValue(loadingTask);

    const extraction = extractPdfTextFromFile(
      { arrayBuffer: async () => new ArrayBuffer(4) } as File,
      { timeoutMs: 50 },
    );
    const rejection = expect(extraction).rejects.toMatchObject({ code: "PDF_TEXT_EXTRACTION_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(50);

    await rejection;
  });

  it("cancels a server extraction that exceeds its deadline", async () => {
    await import("pdfjs-dist/legacy/build/pdf.mjs");
    vi.useRealTimers();
    const loadingTask = neverResolvingLoadingTask();
    pdfMocks.serverGetDocument.mockReturnValue(loadingTask);

    const extraction = extractPdfTextFromBytes(new Uint8Array([1, 2, 3]), { timeoutMs: 100 });
    await vi.waitFor(() => expect(pdfMocks.serverGetDocument).toHaveBeenCalled());
    const rejection = expect(extraction).rejects.toMatchObject({ code: "PDF_TEXT_EXTRACTION_TIMEOUT" });

    await rejection;
    expect(loadingTask.destroy).toHaveBeenCalled();
  });

  it("cancels browser extraction when the caller aborts", async () => {
    await import("pdfjs-dist/webpack.mjs");
    const loadingTask = neverResolvingLoadingTask();
    pdfMocks.browserGetDocument.mockReturnValue(loadingTask);
    const controller = new AbortController();
    const extraction = extractPdfTextFromFile(
      { arrayBuffer: async () => new ArrayBuffer(4) } as File,
      { timeoutMs: 5_000, signal: controller.signal },
    );
    const rejection = expect(extraction).rejects.toMatchObject({ code: "PDF_TEXT_EXTRACTION_ABORTED" });

    await Promise.resolve();
    controller.abort();

    await rejection;
  });
});
