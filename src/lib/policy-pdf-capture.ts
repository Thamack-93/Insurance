import "server-only";

import PDFParser from "pdf2json";
import { PDFParse } from "pdf-parse";
import {
  extractPolicyPdfDraftFromText,
  normalizePdfPaymentFrequencyLabel,
  suggestPreviousPolicyNumber,
} from "@/lib/policy-pdf-capture.shared";

export { extractPolicyPdfDraftFromText, normalizePdfPaymentFrequencyLabel, suggestPreviousPolicyNumber };

export class PolicyPdfCaptureError extends Error {
  code: "INVALID_PDF" | "NO_TEXT" | "PARSE_FAILURE";

  constructor(code: "INVALID_PDF" | "NO_TEXT" | "PARSE_FAILURE", message: string) {
    super(message);
    this.name = "PolicyPdfCaptureError";
    this.code = code;
  }
}

const INVALID_PDF_ERROR_PATTERNS = ["invalid pdf", "malformed", "corrupt", "xref", "format error"];

function isInvalidPdfError(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return INVALID_PDF_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

async function extractTextWithPdf2Json(file: Uint8Array) {
  const pdfParser = new PDFParser();

  return new Promise<string>((resolve, reject) => {
    pdfParser.on("pdfParser_dataReady", () => resolve(pdfParser.getRawTextContent()));
    pdfParser.on("pdfParser_dataError", (errorData) => {
      const message =
        errorData && "parserError" in errorData && errorData.parserError instanceof Error
          ? errorData.parserError.message
          : "PDF parsing failed";
      reject(new Error(message));
    });
    pdfParser.parseBuffer(Buffer.from(file));
  });
}

async function extractTextWithPdfParse(file: Uint8Array) {
  const parser = new PDFParse({ data: Buffer.from(file), verbosity: 0 });
  try {
    const result = await parser.getText({ pageJoiner: "" });
    return result.text;
  } finally {
    await parser.destroy();
  }
}

export async function parsePolicyPdfCapture(file: Uint8Array) {
  const parseErrors: unknown[] = [];

  try {
    const text = await extractTextWithPdf2Json(file);
    if (text.trim()) return extractPolicyPdfDraftFromText(text);
  } catch (error) {
    parseErrors.push(error);
  }

  try {
    const text = await extractTextWithPdfParse(file);
    if (text.trim()) return extractPolicyPdfDraftFromText(text);
  } catch (error) {
    parseErrors.push(error);
  }

  if (parseErrors.some(isInvalidPdfError)) {
    throw new PolicyPdfCaptureError("INVALID_PDF", "El PDF parece estar corrupto o no es un archivo PDF válido.");
  }
  if (parseErrors.length > 0) {
    throw new PolicyPdfCaptureError(
      "PARSE_FAILURE",
      "No pudimos analizar el PDF. Revisa que el archivo esté completo y tenga texto legible.",
    );
  }
  throw new PolicyPdfCaptureError(
    "NO_TEXT",
    "El PDF no tiene una capa de texto extraíble. Puede ser una imagen, un escaneo o un PDF con texto inaccesible para el parser.",
  );
}
