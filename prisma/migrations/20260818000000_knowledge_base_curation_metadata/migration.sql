ALTER TABLE "KnowledgeSource"
  ADD COLUMN "sourceUrl" TEXT,
  ADD COLUMN "authority" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3);

ALTER TABLE "GeneralKnowledgeSource"
  ADD COLUMN "sourceUrl" TEXT,
  ADD COLUMN "authority" TEXT,
  ADD COLUMN "reviewedAt" TIMESTAMP(3);
