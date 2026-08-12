import "server-only";

import { del, list } from "@vercel/blob";
import { NORA_CAPTURE_HANDOFF_MAX_AGE_MS, NORA_CAPTURE_HANDOFF_PREFIX } from "@/lib/nora-capture-handoff-storage.shared";

export async function cleanupExpiredNoraCaptureHandoffs(userId: string) {
  if (!process.env.BLOB_READ_WRITE_TOKEN?.trim()) return 0;
  const cutoff = Date.now() - NORA_CAPTURE_HANDOFF_MAX_AGE_MS;
  const { blobs } = await list({ prefix: `${NORA_CAPTURE_HANDOFF_PREFIX}/${userId}/`, limit: 100 });
  const expired = blobs.filter((blob) => blob.uploadedAt.getTime() < cutoff);
  await Promise.all(expired.map((blob) => del(blob.url)));
  return expired.length;
}
