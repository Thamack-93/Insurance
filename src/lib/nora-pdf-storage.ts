import "server-only";

import { del, list } from "@vercel/blob";
import { NORA_POLICY_PDF_MAX_AGE_MS, NORA_POLICY_PDF_PREFIX } from "@/lib/nora-pdf-storage.shared";

export async function cleanupExpiredNoraPolicyPdfUploads(userId: string, organizationId: string) {
  const cutoff = Date.now() - NORA_POLICY_PDF_MAX_AGE_MS;
  const safeOrganizationId = organizationId.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 96) || "unknown";
  const safeUserId = userId.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 96) || "unknown";
  const prefix = `${NORA_POLICY_PDF_PREFIX}/${safeOrganizationId}/${safeUserId}/`;
  const { blobs } = await list({ prefix, limit: 100 });
  const expired = blobs.filter((blob) => blob.uploadedAt.getTime() < cutoff);
  await Promise.all(expired.map((blob) => del(blob.url)));
  return expired.length;
}
