-- Keep the database contract aligned with Prisma and the integrity checks:
-- sources created before integrity backfill may legitimately have no version.
ALTER TABLE "KnowledgeSource"
  ALTER COLUMN "integrityVersion" DROP NOT NULL;

ALTER TABLE "GeneralKnowledgeSource"
  ALTER COLUMN "integrityVersion" DROP NOT NULL;
