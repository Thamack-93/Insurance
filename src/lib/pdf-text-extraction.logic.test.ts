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

  it("extracts and joins text from multiple server PDF pages", async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    pdfMocks.serverGetDocument.mockReturnValue({
      destroy,
      promise: Promise.resolve({
        numPages: 2,
        getPage: async (pageNumber: number) => ({
          getTextContent: async () => ({ items: [{ str: `Página ${pageNumber}`, transform: [1, 0, 0, 1, 0, 10] }] }),
        }),
      }),
    });

    await expect(extractPdfTextFromBytes(new Uint8Array([1, 2, 3]))).resolves.toEqual({
      pageCount: 2,
      text: "Página 1\nPágina 2",
    });
    expect(destroy).toHaveBeenCalled();
  });

  it("propagates a corrupt PDF.js document error and still destroys the loading task", async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    pdfMocks.serverGetDocument.mockImplementation(() => ({
      destroy,
      promise: new Promise((_resolve, reject) => {
        setTimeout(() => reject(new Error("Invalid PDF structure")), 0);
      }),
    }));

    await expect(extractPdfTextFromBytes(new Uint8Array([1, 2, 3]))).rejects.toThrow("Invalid PDF structure");
    expect(destroy).toHaveBeenCalled();
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
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(50);

    await rejection;
    expect(pdfMocks.browserGetDocument).toHaveBeenCalledWith(expect.objectContaining({ isEvalSupported: false }));
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
    expect(pdfMocks.serverGetDocument).toHaveBeenCalledWith(expect.objectContaining({ isEvalSupported: false }));
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
