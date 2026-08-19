import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { GENERAL_INSURANCE_SOURCES } from "../src/lib/knowledge-base-general.ts";
import { hashKnowledgeContent, hashKnowledgeManifest, KNOWLEDGE_INTEGRITY_VERSION } from "../src/lib/knowledge-integrity.ts";

function splitContent(content: string, maxCharacters = 1_200) {
  const paragraphs = content.replace(/\r/g, "").split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const chunks: Array<{ content: string; section: string | null }> = [];
  let current = "";
  let section: string | null = null;
  for (const paragraph of paragraphs.length ? paragraphs : [content]) {
    const firstLine = paragraph.split("\n", 1)[0]?.trim() ?? "";
    if (/^#{1,6}\s+/.test(firstLine)) section = firstLine.replace(/^#{1,6}\s+/, "").trim() || section;
    if (!current) current = paragraph;
    else if (current.length + paragraph.length + 2 <= maxCharacters) current = `${current}\n\n${paragraph}`;
    else {
      chunks.push({ content: current, section });
      current = paragraph;
    }
  }
  if (current) chunks.push({ content: current, section });
  return chunks.flatMap((chunk) => {
    if (chunk.content.length <= maxCharacters) return [chunk];
    return Array.from({ length: Math.ceil(chunk.content.length / maxCharacters) }, (_, index) => ({
      content: chunk.content.slice(index * maxCharacters, (index + 1) * maxCharacters),
      section: chunk.section,
    }));
  });
}

const connectionString = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL es obligatorio para sembrar la guía general.");

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  for (const source of GENERAL_INSURANCE_SOURCES) {
    const content = source.content.replace(/\u0000/g, "").trim();
    const chunks = splitContent(content);
    const contentHash = hashKnowledgeContent(`${source.title}\n${source.version}\n${content}`);
      const manifestHash = hashKnowledgeManifest(source.title, source.version, chunks.map((chunk, ordinal) => ({ ordinal, content: chunk.content, section: chunk.section, page: null })));
    const result = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`GENERAL:${source.product ?? ""}`}, 0))`;
      const current = await tx.generalKnowledgeSource.upsert({
        where: { contentHash },
        update: {
          title: source.title,
          product: source.product,
          version: source.version,
          status: "ACTIVE",
          sourceUrl: source.sourceUrl,
          authority: source.authority,
          reviewedAt: source.reviewedAt,
          manifestHash,
          integrityVersion: KNOWLEDGE_INTEGRITY_VERSION,
          integrityVerifiedAt: new Date(),
        },
        create: {
          title: source.title,
          product: source.product,
          version: source.version,
          status: "ACTIVE",
          sourceUrl: source.sourceUrl,
          authority: source.authority,
          reviewedAt: source.reviewedAt,
          contentHash,
          manifestHash,
          integrityVersion: KNOWLEDGE_INTEGRITY_VERSION,
          integrityVerifiedAt: new Date(),
          chunks: { create: chunks.map((chunk, ordinal) => ({ ordinal, content: chunk.content, section: chunk.section })) },
        },
        select: { id: true, title: true, version: true, status: true },
      });
      const existingChunks = await tx.generalKnowledgeChunk.count({ where: { sourceId: current.id } });
      if (!existingChunks) await tx.generalKnowledgeChunk.createMany({ data: chunks.map((chunk, ordinal) => ({ sourceId: current.id, ordinal, content: chunk.content, section: chunk.section, page: null })) });
      await tx.generalKnowledgeSource.update({
        where: { id: current.id },
        data: { status: "ACTIVE", manifestHash, integrityVersion: KNOWLEDGE_INTEGRITY_VERSION, integrityVerifiedAt: new Date() },
      });
      await tx.generalKnowledgeSource.updateMany({
        where: { status: "ACTIVE", product: source.product, id: { not: current.id } },
        data: { status: "ARCHIVED" },
      });
      return current;
    });
    console.log(`General knowledge source ready: ${result.id} ${source.product} (${result.version})`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
