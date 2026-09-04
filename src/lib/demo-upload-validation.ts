import "server-only";

export const DEMO_UPLOAD_MAX_BYTES = 15 * 1024 * 1024;
export const DEMO_UPLOAD_MAX_PAGES = 100;
export const DEMO_UPLOAD_MIME = "application/pdf" as const;

export type DemoUploadValidation =
  | { ok: true; sha256: string; sizeBytes: number; detectedMimeType: typeof DEMO_UPLOAD_MIME }
  | { ok: false; code: string; message: string };

function startsWith(bytes: Uint8Array, signature: number[]) {
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

/**
 * Validates the subset of PDFs accepted by DEMO uploads. This is deliberately
 * not advertised as antivirus: it rejects active/embedded content and limits
 * parser exposure before any OCR or AI provider receives the file.
 */
export async function validateDemoPdf(file: File): Promise<DemoUploadValidation> {
  if (file.size <= 0 || file.size > DEMO_UPLOAD_MAX_BYTES) {
    return { ok: false, code: "DEMO_FILE_SIZE_INVALID", message: "El PDF supera el límite de 15 MB o está vacío." };
  }
  if (file.type && file.type !== "application/pdf" && file.type !== "application/octet-stream") {
    return { ok: false, code: "DEMO_MIME_INVALID", message: "El DEMO solo acepta archivos PDF." };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return { ok: false, code: "DEMO_PDF_SIGNATURE_INVALID", message: "El archivo no tiene una firma PDF válida." };
  }

  const text = new TextDecoder("latin1").decode(bytes);
  const tail = text.slice(Math.max(0, text.length - 2048));
  if (!/%%EOF\s*$/i.test(tail)) {
    return { ok: false, code: "DEMO_PDF_EOF_INVALID", message: "El PDF parece incompleto o corrupto." };
  }

  const forbidden = /\/JavaScript\b|\/JS\b|\/OpenAction\b|\/AA\b|\/Launch\b|\/EmbeddedFile\b|\/RichMedia\b|\/SubmitForm\b|\/GoToR\b|\/XFA\b|\/Encrypt\b/i;
  if (forbidden.test(text)) {
    return { ok: false, code: "DEMO_PDF_ACTIVE_CONTENT", message: "El PDF contiene contenido activo o incrustado no permitido." };
  }

  const pages = (text.match(/\/Type\s*\/Page\b/g) ?? []).length;
  if (pages > DEMO_UPLOAD_MAX_PAGES) {
    return { ok: false, code: "DEMO_PDF_PAGE_LIMIT", message: "El PDF supera el máximo de 100 páginas." };
  }

  const { createHash } = await import("node:crypto");
  return {
    ok: true,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.byteLength,
    detectedMimeType: DEMO_UPLOAD_MIME,
  };
}

/** Public contract name used by upload callers and operator tooling. */
export const validateDemoUpload = validateDemoPdf;
