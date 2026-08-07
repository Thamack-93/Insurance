import { reconstructPdfTextFromTextContent } from "@/lib/pdf-text-reconstruction";

export async function extractPdfTextFromFile(file: File) {
  const pdfjs = await import("pdfjs-dist/build/pdf.min.mjs");
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await loadingTask.promise;

  try {
    const pageTexts: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = reconstructPdfTextFromTextContent(textContent);
      if (pageText) {
        pageTexts.push(pageText);
      }
    }
    return pageTexts.join("\n");
  } finally {
    await pdf.destroy().catch(() => {});
  }
}
