import "server-only";

import path from "node:path";
import { pathToFileURL } from "node:url";
import { reconstructPdfTextFromTextContent } from "@/lib/pdf-text-reconstruction";

export async function extractPdfTextFromBytes(data: Uint8Array) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const standardFontDataUrl =
    pathToFileURL(path.join(process.cwd(), "node_modules", "pdfjs-dist", "standard_fonts")).href + "/";

  const loadingTask = pdfjs.getDocument({
    data,
    standardFontDataUrl,
  });

  const pdf = await loadingTask.promise;
  try {
    const pageTexts: string[] = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = reconstructPdfTextFromTextContent(textContent);
      if (pageText.trim()) {
        pageTexts.push(pageText);
      }
    }

    return {
      text: pageTexts.join("\n"),
      pageCount: pdf.numPages,
    };
  } finally {
    await pdf.destroy().catch(() => {});
  }
}
