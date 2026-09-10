export const NORA_POLICY_PDF_PREFIX = "temp/nora-policy-pdfs";
export const NORA_POLICY_PDF_MAX_BYTES = 15 * 1024 * 1024;
export const NORA_POLICY_PDF_MAX_AGE_MS = 60 * 60 * 1000;

function sanitizeSegment(value: string) {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]+/g, "_");
  return normalized.slice(0, 96) || "unknown";
}

/**
 * Builds an opaque, tenant-prefixed path. The display filename is deliberately
 * not included: client names and other document metadata must never become
 * object keys or provider-visible paths.
 */
export function buildNoraPolicyPdfPathname(organizationId: string, userId: string, fileName?: string) {
  // Keep the call-site filename argument for API compatibility, but never
  // incorporate it into the provider-visible object key.
  void fileName;
  const randomPart = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${NORA_POLICY_PDF_PREFIX}/${sanitizeSegment(organizationId)}/${sanitizeSegment(userId)}/${randomPart}.pdf`;
}

export function isNoraPolicyPdfPathname(pathname: string, userId: string, organizationId?: string) {
  const userSegment = sanitizeSegment(userId);
  const prefix = organizationId
    ? `${NORA_POLICY_PDF_PREFIX}/${sanitizeSegment(organizationId)}/${userSegment}/`
    : `${NORA_POLICY_PDF_PREFIX}/`;
  return pathname.startsWith(prefix) && pathname.includes(`/${userSegment}/`) && pathname.toLowerCase().endsWith(".pdf");
}
