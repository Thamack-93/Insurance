import { reconstructPdfTextFromTextContent } from "@/lib/pdf-text-reconstruction";
import {
  abortablePdfPromise,
  createPdfTextExtractionControl,
  DEFAULT_BROWSER_PDF_TEXT_EXTRACTION_TIMEOUT_MS,
  type PdfTextExtractionOptions,
} from "@/lib/pdf-text-extraction.shared";

export async function extractPdfTextFromFile(
  file: File,
  options: PdfTextExtractionOptions = { timeoutMs: DEFAULT_BROWSER_PDF_TEXT_EXTRACTION_TIMEOUT_MS },
) {
  const control = createPdfTextExtractionControl({
    timeoutMs: options.timeoutMs ?? DEFAULT_BROWSER_PDF_TEXT_EXTRACTION_TIMEOUT_MS,
    signal: options.signal,
  });
  type Pdfjs = typeof import("pdfjs-dist/webpack.mjs");
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
    const pdfjs = await abortablePdfPromise(import("pdfjs-dist/webpack.mjs"), control);
    const data = await abortablePdfPromise(file.arrayBuffer(), control);
    loadingTask = pdfjs.getDocument({ data: new Uint8Array(data) });
    if (control.signal.aborted) destroyPdf();
    const resolvedPdf = await abortablePdfPromise(loadingTask.promise, control);
    pdf = resolvedPdf;
    const pageTexts: string[] = [];
    for (let pageNumber = 1; pageNumber <= resolvedPdf.numPages; pageNumber += 1) {
      const page = await abortablePdfPromise(resolvedPdf.getPage(pageNumber), control);
      const textContent = await abortablePdfPromise(page.getTextContent(), control);
      const pageText = reconstructPdfTextFromTextContent(textContent);
      if (pageText) {
        pageTexts.push(pageText);
      }
    }
    return pageTexts.join("\n");
  } finally {
    control.signal.removeEventListener("abort", destroyPdf);
    await pdf?.destroy().catch(() => {});
    control.cleanup();
  }
}
