import "server-only";

import { del, list } from "@vercel/blob";
import { assertDeploymentDatabaseSafety } from "@/lib/deployment-db-safety";
import { NORA_POLICY_PDF_MAX_AGE_MS, NORA_POLICY_PDF_PREFIX } from "@/lib/nora-pdf-storage.shared";

export async function cleanupExpiredNoraPolicyPdfUploads(userId: string) {
  await assertDeploymentDatabaseSafety();
  const cutoff = Date.now() - NORA_POLICY_PDF_MAX_AGE_MS;
  const prefix = `${NORA_POLICY_PDF_PREFIX}/${userId}/`;
  const { blobs } = await list({ prefix, limit: 100 });
  const expired = blobs.filter((blob) => blob.uploadedAt.getTime() < cutoff);
  await Promise.all(expired.map((blob) => del(blob.url)));
  return expired.length;
}
