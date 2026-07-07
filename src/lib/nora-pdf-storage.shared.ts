export const NORA_POLICY_PDF_PREFIX = "temp/nora-policy-pdfs";
export const NORA_POLICY_PDF_MAX_BYTES = 10 * 1024 * 1024;
export const NORA_POLICY_PDF_MAX_AGE_MS = 60 * 60 * 1000;

function sanitizeFileName(fileName: string) {
  const normalized = fileName.trim().replace(/[^a-zA-Z0-9._-]+/g, "_");
  return normalized || "policy.pdf";
}

export function buildNoraPolicyPdfPathname(userId: string, fileName: string) {
  const extension = fileName.toLowerCase().endsWith(".pdf") ? "" : ".pdf";
  return `${NORA_POLICY_PDF_PREFIX}/${userId}/${Date.now()}-${sanitizeFileName(fileName)}${extension}`;
}

export function isNoraPolicyPdfPathname(pathname: string, userId: string) {
  return pathname.startsWith(`${NORA_POLICY_PDF_PREFIX}/${userId}/`) && pathname.toLowerCase().endsWith(".pdf");
}
