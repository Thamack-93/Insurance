export const NORA_CAPTURE_HANDOFF_PREFIX = "temp/nora-policy-handoffs";
export const NORA_CAPTURE_HANDOFF_MAX_AGE_MS = 15 * 60 * 1000;
export const NORA_CAPTURE_HANDOFF_MAX_BYTES = 128 * 1024;

function safeSegment(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 96) || "unknown";
}

/**
 * Organization-aware handoff paths. The optional third argument preserves the
 * legacy helper contract for callers that only handle non-tenant temporary
 * handoffs; all authenticated application routes pass organizationId.
 */
export function buildNoraCaptureHandoffPathname(userId: string, handoffId: string, organizationId?: string) {
  const prefix = organizationId
    ? `${NORA_CAPTURE_HANDOFF_PREFIX}/${safeSegment(organizationId)}/${safeSegment(userId)}`
    : `${NORA_CAPTURE_HANDOFF_PREFIX}/${safeSegment(userId)}`;
  return `${prefix}/${encodeURIComponent(handoffId)}.json`;
}

export function isNoraCaptureHandoffPathname(pathname: string, userId: string, handoffId?: string, organizationId?: string) {
  const prefix = organizationId
    ? `${NORA_CAPTURE_HANDOFF_PREFIX}/${safeSegment(organizationId)}/${safeSegment(userId)}/`
    : `${NORA_CAPTURE_HANDOFF_PREFIX}/${safeSegment(userId)}/`;
  if (!pathname.startsWith(prefix) || !pathname.endsWith(".json")) return false;
  if (!handoffId) return true;
  return pathname === buildNoraCaptureHandoffPathname(userId, handoffId, organizationId);
}
