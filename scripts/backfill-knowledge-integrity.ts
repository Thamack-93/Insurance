import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { hashKnowledgeManifest, KNOWLEDGE_INTEGRITY_VERSION } from "../src/lib/knowledge-integrity.ts";

if (process.env.ALLOW_KNOWLEDGE_INTEGRITY_BACKFILL !== "1") {
  throw new Error("El backfill requiere ALLOW_KNOWLEDGE_INTEGRITY_BACKFILL=1.");
}
const connectionString = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL es obligatorio.");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const [internal, general] = await Promise.all([
    db.knowledgeSource.findMany({ include: { chunks: { orderBy: { ordinal: "asc" }, select: { ordinal: true, content: true, section: true, page: true } } } }),
    db.generalKnowledgeSource.findMany({ include: { chunks: { orderBy: { ordinal: "asc" }, select: { ordinal: true, content: true, section: true, page: true } } } }),
  ]);
  let updated = 0;
  let skipped = 0;
  for (const source of internal) {
    if (!source.chunks.length) { skipped += 1; continue; }
    const manifestHash = hashKnowledgeManifest(source.title, source.version, source.chunks);
    await db.knowledgeSource.update({ where: { id: source.id }, data: { manifestHash, integrityVersion: KNOWLEDGE_INTEGRITY_VERSION, integrityVerifiedAt: new Date() } });
    updated += 1;
  }
  for (const source of general) {
    if (!source.chunks.length) { skipped += 1; continue; }
    const manifestHash = hashKnowledgeManifest(source.title, source.version, source.chunks);
    await db.generalKnowledgeSource.update({ where: { id: source.id }, data: { manifestHash, integrityVersion: KNOWLEDGE_INTEGRITY_VERSION, integrityVerifiedAt: new Date() } });
    updated += 1;
  }
  console.log(JSON.stringify({ internalSources: internal.length, generalSources: general.length, updated, skipped }, null, 2));
}

main().finally(() => db.$disconnect());

