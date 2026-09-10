import "server-only";

import { del, list } from "@vercel/blob";
import { NORA_CAPTURE_HANDOFF_MAX_AGE_MS, NORA_CAPTURE_HANDOFF_PREFIX } from "@/lib/nora-capture-handoff-storage.shared";

export async function cleanupExpiredNoraCaptureHandoffs(userId: string, organizationId?: string) {
  if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) return 0;
  const cutoff = Date.now() - NORA_CAPTURE_HANDOFF_MAX_AGE_MS;
  const safeOrganizationId = organizationId?.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 96);
  const safeUserId = userId.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 96) || "unknown";
  const prefix = safeOrganizationId
    ? `${NORA_CAPTURE_HANDOFF_PREFIX}/${safeOrganizationId}/${safeUserId}/`
    : `${NORA_CAPTURE_HANDOFF_PREFIX}/${safeUserId}/`;
  const { blobs } = await list({ prefix, limit: 100 });
  const expired = blobs.filter((blob) => blob.uploadedAt.getTime() < cutoff);
  await Promise.all(expired.map((blob) => del(blob.url)));
  return expired.length;
}
