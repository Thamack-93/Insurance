import { createHash } from "node:crypto";

export const KNOWLEDGE_INTEGRITY_VERSION = "CHUNK_MANIFEST_V1";

export type KnowledgeManifestChunk = {
  ordinal: number;
  content: string;
  section: string | null;
  page: number | null;
};

export function hashKnowledgeContent(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function buildKnowledgeManifest(title: string, version: string, chunks: KnowledgeManifestChunk[]) {
  return JSON.stringify({
    integrityVersion: KNOWLEDGE_INTEGRITY_VERSION,
    title,
    version,
    chunks: chunks
      .slice()
      .sort((left, right) => left.ordinal - right.ordinal)
      .map((chunk) => ({
        ordinal: chunk.ordinal,
        page: chunk.page,
        section: chunk.section,
        content: chunk.content,
      })),
  });
}

export function hashKnowledgeManifest(title: string, version: string, chunks: KnowledgeManifestChunk[]) {
  return hashKnowledgeContent(buildKnowledgeManifest(title, version, chunks));
}

