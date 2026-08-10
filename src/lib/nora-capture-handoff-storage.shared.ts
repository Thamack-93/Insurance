export const NORA_CAPTURE_HANDOFF_PREFIX = "temp/nora-policy-handoffs";
export const NORA_CAPTURE_HANDOFF_MAX_AGE_MS = 15 * 60 * 1000;
export const NORA_CAPTURE_HANDOFF_MAX_BYTES = 128 * 1024;

export function buildNoraCaptureHandoffPathname(userId: string, handoffId: string) {
  return `${NORA_CAPTURE_HANDOFF_PREFIX}/${userId}/${encodeURIComponent(handoffId)}.json`;
}

export function isNoraCaptureHandoffPathname(pathname: string, userId: string, handoffId?: string) {
  const prefix = `${NORA_CAPTURE_HANDOFF_PREFIX}/${userId}/`;
  if (!pathname.startsWith(prefix) || !pathname.endsWith(".json")) return false;
  if (!handoffId) return true;
  return pathname === buildNoraCaptureHandoffPathname(userId, handoffId);
}
