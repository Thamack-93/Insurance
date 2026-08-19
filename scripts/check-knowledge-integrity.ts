import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.ts";

const connectionString = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL es obligatorio.");

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const [internalDuplicates, generalDuplicates, missingChunks, invalidHashes, invalidActiveIntegrity, tenantMismatches] = await Promise.all([
    db.$queryRaw<Array<{ organizationId: string; insurerName: string | null; product: string | null; count: bigint }>>`
      SELECT "organizationId", "insurerName", "product", count(*)
      FROM "KnowledgeSource" WHERE "status" = 'ACTIVE'
      GROUP BY "organizationId", "insurerName", "product" HAVING count(*) > 1
    `,
    db.$queryRaw<Array<{ product: string | null; count: bigint }>>`
      SELECT "product", count(*) FROM "GeneralKnowledgeSource" WHERE "status" = 'ACTIVE'
      GROUP BY "product" HAVING count(*) > 1
    `,
    db.$queryRaw<Array<{ sourceType: string; sourceId: string }>>`
      SELECT 'INTERNAL' AS "sourceType", s."id" AS "sourceId"
      FROM "KnowledgeSource" s LEFT JOIN "KnowledgeChunk" c ON c."sourceId" = s."id"
      GROUP BY s."id" HAVING count(c."id") = 0
      UNION ALL
      SELECT 'GENERAL', s."id"
      FROM "GeneralKnowledgeSource" s LEFT JOIN "GeneralKnowledgeChunk" c ON c."sourceId" = s."id"
      GROUP BY s."id" HAVING count(c."id") = 0
    `,
    db.$queryRaw<Array<{ sourceType: string; sourceId: string }>>`
      SELECT 'INTERNAL' AS "sourceType", "id" AS "sourceId" FROM "KnowledgeSource"
      WHERE "contentHash" !~ '^[0-9a-f]{64}$' OR ("manifestHash" IS NOT NULL AND "manifestHash" !~ '^[0-9a-f]{64}$')
      UNION ALL
      SELECT 'GENERAL', "id" FROM "GeneralKnowledgeSource"
      WHERE "contentHash" !~ '^[0-9a-f]{64}$' OR ("manifestHash" IS NOT NULL AND "manifestHash" !~ '^[0-9a-f]{64}$')
    `,
    db.$queryRaw<Array<{ sourceType: string; sourceId: string }>>`
      SELECT 'INTERNAL' AS "sourceType", "id" AS "sourceId" FROM "KnowledgeSource"
      WHERE "status" = 'ACTIVE' AND ("manifestHash" !~ '^[0-9a-f]{64}$' OR "integrityVersion" <> 'CHUNK_MANIFEST_V1' OR "integrityVerifiedAt" IS NULL)
      UNION ALL
      SELECT 'GENERAL', "id" FROM "GeneralKnowledgeSource"
      WHERE "status" = 'ACTIVE' AND ("manifestHash" !~ '^[0-9a-f]{64}$' OR "integrityVersion" <> 'CHUNK_MANIFEST_V1' OR "integrityVerifiedAt" IS NULL)
    `,
    db.$queryRaw<Array<{ chunkId: string }>>`
      SELECT c."id" AS "chunkId"
      FROM "KnowledgeChunk" c JOIN "KnowledgeSource" s ON s."id" = c."sourceId"
      WHERE c."organizationId" <> s."organizationId"
    `,
  ]);

  const report = {
    internalActiveDuplicates: internalDuplicates.map((row) => ({ ...row, count: Number(row.count) })),
    generalActiveDuplicates: generalDuplicates.map((row) => ({ ...row, count: Number(row.count) })),
    sourcesWithoutChunks: missingChunks,
    invalidHashes,
    invalidActiveIntegrity,
    tenantMismatches,
  };
  console.log(JSON.stringify(report, null, 2));
  if (internalDuplicates.length || generalDuplicates.length || missingChunks.length || invalidHashes.length || invalidActiveIntegrity.length || tenantMismatches.length) {
    process.exitCode = 1;
  }
}

main().finally(() => db.$disconnect());
