CREATE TYPE "KnowledgeSourceStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

CREATE TABLE "KnowledgeSource" (
    "organizationId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "insurerName" TEXT,
    "product" TEXT,
    "version" TEXT NOT NULL,
    "status" "KnowledgeSourceStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "contentHash" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KnowledgeSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeChunk" (
    "organizationId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "section" TEXT,
    "page" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GeneralKnowledgeSource" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "product" TEXT,
    "version" TEXT NOT NULL,
    "status" "KnowledgeSourceStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GeneralKnowledgeSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GeneralKnowledgeChunk" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "section" TEXT,
    "page" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GeneralKnowledgeChunk_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KnowledgeSource_organizationId_contentHash_key" ON "KnowledgeSource"("organizationId", "contentHash");
CREATE INDEX "KnowledgeSource_organizationId_idx" ON "KnowledgeSource"("organizationId");
CREATE INDEX "KnowledgeSource_organizationId_status_idx" ON "KnowledgeSource"("organizationId", "status");
CREATE INDEX "KnowledgeSource_organizationId_insurerName_product_idx" ON "KnowledgeSource"("organizationId", "insurerName", "product");
CREATE INDEX "KnowledgeSource_createdById_idx" ON "KnowledgeSource"("createdById");
CREATE UNIQUE INDEX "KnowledgeChunk_sourceId_ordinal_key" ON "KnowledgeChunk"("sourceId", "ordinal");
CREATE INDEX "KnowledgeChunk_organizationId_idx" ON "KnowledgeChunk"("organizationId");
CREATE INDEX "KnowledgeChunk_organizationId_sourceId_idx" ON "KnowledgeChunk"("organizationId", "sourceId");
CREATE UNIQUE INDEX "GeneralKnowledgeSource_contentHash_key" ON "GeneralKnowledgeSource"("contentHash");
CREATE INDEX "GeneralKnowledgeSource_status_idx" ON "GeneralKnowledgeSource"("status");
CREATE INDEX "GeneralKnowledgeSource_product_idx" ON "GeneralKnowledgeSource"("product");
CREATE UNIQUE INDEX "GeneralKnowledgeChunk_sourceId_ordinal_key" ON "GeneralKnowledgeChunk"("sourceId", "ordinal");
CREATE INDEX "GeneralKnowledgeChunk_sourceId_idx" ON "GeneralKnowledgeChunk"("sourceId");

ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GeneralKnowledgeChunk" ADD CONSTRAINT "GeneralKnowledgeChunk_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "GeneralKnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TRIGGER "KnowledgeSource_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "KnowledgeSource"
FOR EACH ROW EXECUTE FUNCTION "policydesk_assign_singleton_organization"();
COMMENT ON TRIGGER "KnowledgeSource_transition_singleton_organization" ON "KnowledgeSource" IS
'Cycle 1 temporary singleton assignment and immutability barrier; remove only after tenant-context rollout and two-organization validation.';

CREATE TRIGGER "KnowledgeChunk_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "KnowledgeChunk"
FOR EACH ROW EXECUTE FUNCTION "policydesk_assign_singleton_organization"();
COMMENT ON TRIGGER "KnowledgeChunk_transition_singleton_organization" ON "KnowledgeChunk" IS
'Cycle 1 temporary singleton assignment and immutability barrier; remove only after tenant-context rollout and two-organization validation.';
