import "server-only";

import { extractPdfTextFromBytes } from "@/lib/pdf-text-extraction";
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

export async function parsePolicyPdfCapture(file: Uint8Array) {
  try {
    const { text } = await extractPdfTextFromBytes(file);
    if (text.trim()) return extractPolicyPdfDraftFromText(text);
  } catch (error) {
    if (isInvalidPdfError(error)) {
      throw new PolicyPdfCaptureError("INVALID_PDF", "El PDF parece estar corrupto o no es un archivo PDF válido.");
    }
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
