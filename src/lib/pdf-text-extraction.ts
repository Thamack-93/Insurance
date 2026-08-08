import "server-only";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { reconstructPdfTextFromTextContent } from "@/lib/pdf-text-reconstruction";
import {
  abortablePdfPromise,
  createPdfTextExtractionControl,
  DEFAULT_SERVER_PDF_TEXT_EXTRACTION_TIMEOUT_MS,
  type PdfTextExtractionOptions,
} from "@/lib/pdf-text-extraction.shared";

export async function extractPdfTextFromBytes(
  data: Uint8Array,
  options: PdfTextExtractionOptions = { timeoutMs: DEFAULT_SERVER_PDF_TEXT_EXTRACTION_TIMEOUT_MS },
) {
  const control = createPdfTextExtractionControl({
    timeoutMs: options.timeoutMs ?? DEFAULT_SERVER_PDF_TEXT_EXTRACTION_TIMEOUT_MS,
    signal: options.signal,
  });
  type Pdfjs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
  type LoadingTask = ReturnType<Pdfjs["getDocument"]>;
  type PdfDocument = Awaited<LoadingTask["promise"]>;
  let loadingTask: LoadingTask | null = null;
  let pdf: PdfDocument | null = null;
  const destroyPdf = () => {
    void loadingTask?.destroy().catch(() => {});
    void pdf?.destroy().catch(() => {});
  };
  control.signal.addEventListener("abort", destroyPdf, { once: true });

  try {
    const pdfjs = await abortablePdfPromise(import("pdfjs-dist/legacy/build/pdf.mjs"), control);
    const standardFontDataUrl =
      pathToFileURL(path.join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts")).href + "/";
    loadingTask = pdfjs.getDocument({
      data,
      standardFontDataUrl,
    });
    if (control.signal.aborted) destroyPdf();
    const resolvedPdf = await abortablePdfPromise(loadingTask.promise, control);
    pdf = resolvedPdf;
    const pageTexts: string[] = [];

    for (let pageNumber = 1; pageNumber <= resolvedPdf.numPages; pageNumber += 1) {
      const page = await abortablePdfPromise(resolvedPdf.getPage(pageNumber), control);
      const textContent = await abortablePdfPromise(page.getTextContent(), control);
      const pageText = reconstructPdfTextFromTextContent(textContent);
      if (pageText.trim()) {
        pageTexts.push(pageText);
      }
    }

    return {
      text: pageTexts.join("\n"),
      pageCount: resolvedPdf.numPages,
    };
  } finally {
    control.signal.removeEventListener("abort", destroyPdf);
    await pdf?.destroy().catch(() => {});
    control.cleanup();
  }
}
