export const POLICY_PDF_MAX_FILES = 8;
export const POLICY_PDF_MAX_BATCH_BYTES = 30 * 1024 * 1024;

export type PolicyPdfFileLike = Pick<File, "name" | "type" | "size" | "lastModified">;

export function validatePolicyPdfFile(file: PolicyPdfFileLike) {
  if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf" && file.type !== "application/octet-stream") {
    return "Solo se aceptan archivos PDF.";
  }
  if (file.size > 10 * 1024 * 1024) return "Supera el máximo individual de 10 MB.";
  return null;
}

export function mergePolicyPdfFiles<T extends PolicyPdfFileLike>(existing: T[], incoming: T[]) {
  const next = [...existing];
  const seen = new Set(next.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
  let error: string | null = null;

  for (const file of incoming) {
    const validationError = validatePolicyPdfFile(file);
    if (validationError) {
      error ??= `${file.name}: ${validationError}`;
      continue;
    }
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (seen.has(key)) {
      error ??= `${file.name}: ya está en la cola.`;
      continue;
    }
    if (next.length >= POLICY_PDF_MAX_FILES) {
      error ??= `Puedes analizar hasta ${POLICY_PDF_MAX_FILES} PDFs por lote.`;
      break;
    }
    if (next.reduce((total, item) => total + item.size, 0) + file.size > POLICY_PDF_MAX_BATCH_BYTES) {
      error ??= "El lote supera el máximo total de 30 MB.";
      break;
    }
    seen.add(key);
    next.push(file);
  }

  return { files: next, error };
}
