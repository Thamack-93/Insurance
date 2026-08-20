-- Preflight is deliberately first: it aborts before any schema mutation.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "KnowledgeSource"
    WHERE "status" = 'ACTIVE'
    GROUP BY "organizationId", "insurerName", "product"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'KnowledgeSource tiene activos duplicados por organización/aseguradora/producto';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "GeneralKnowledgeSource"
    WHERE "status" = 'ACTIVE'
    GROUP BY "product"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'GeneralKnowledgeSource tiene activos duplicados por producto';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "KnowledgeSource" s
    LEFT JOIN "KnowledgeChunk" c ON c."sourceId" = s."id"
    GROUP BY s."id" HAVING count(c."id") = 0
  ) OR EXISTS (
    SELECT 1 FROM "GeneralKnowledgeSource" s
    LEFT JOIN "GeneralKnowledgeChunk" c ON c."sourceId" = s."id"
    GROUP BY s."id" HAVING count(c."id") = 0
  ) THEN
    RAISE EXCEPTION 'Existe una fuente de conocimiento sin chunks';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "KnowledgeSource" s
    JOIN "KnowledgeChunk" c ON c."sourceId" = s."id"
    WHERE c."organizationId" <> s."organizationId"
  ) THEN
    RAISE EXCEPTION 'Existe un chunk tenant inconsistente';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "KnowledgeSource"
    WHERE "contentHash" IS NULL OR "contentHash" !~ '^[0-9a-f]{64}$'
  ) OR EXISTS (
    SELECT 1 FROM "GeneralKnowledgeSource"
    WHERE "contentHash" IS NULL OR "contentHash" !~ '^[0-9a-f]{64}$'
  ) THEN
    RAISE EXCEPTION 'Existe un contentHash inválido';
  END IF;
END;
$$;

CREATE EXTENSION IF NOT EXISTS "unaccent";

ALTER TABLE "KnowledgeSource"
  ALTER COLUMN "effectiveFrom" TYPE DATE USING "effectiveFrom"::date,
  ALTER COLUMN "effectiveTo" TYPE DATE USING "effectiveTo"::date,
  ADD COLUMN "manifestHash" TEXT,
  ADD COLUMN "integrityVersion" TEXT NOT NULL DEFAULT 'CHUNK_MANIFEST_V1',
  ADD COLUMN "integrityVerifiedAt" TIMESTAMP(3);

ALTER TABLE "GeneralKnowledgeSource"
  ALTER COLUMN "effectiveFrom" TYPE DATE USING "effectiveFrom"::date,
  ALTER COLUMN "effectiveTo" TYPE DATE USING "effectiveTo"::date,
  ADD COLUMN "manifestHash" TEXT,
  ADD COLUMN "integrityVersion" TEXT NOT NULL DEFAULT 'CHUNK_MANIFEST_V1',
  ADD COLUMN "integrityVerifiedAt" TIMESTAMP(3);

ALTER TABLE "KnowledgeSource"
  ADD CONSTRAINT "KnowledgeSource_manifestHash_format_check"
  CHECK ("manifestHash" IS NULL OR "manifestHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "KnowledgeSource_version_not_blank_check"
  CHECK (length(btrim("version")) > 0),
  ADD CONSTRAINT "KnowledgeSource_integrityVersion_not_blank_check"
  CHECK ("integrityVersion" IS NULL OR length(btrim("integrityVersion")) > 0);

ALTER TABLE "GeneralKnowledgeSource"
  ADD CONSTRAINT "GeneralKnowledgeSource_manifestHash_format_check"
  CHECK ("manifestHash" IS NULL OR "manifestHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "GeneralKnowledgeSource_version_not_blank_check"
  CHECK (length(btrim("version")) > 0),
  ADD CONSTRAINT "GeneralKnowledgeSource_integrityVersion_not_blank_check"
  CHECK ("integrityVersion" IS NULL OR length(btrim("integrityVersion")) > 0);

CREATE TEXT SEARCH CONFIGURATION policydesk_spanish (COPY = spanish);
ALTER TEXT SEARCH CONFIGURATION policydesk_spanish
  ALTER MAPPING FOR hword, hword_part, word
  WITH unaccent, spanish_stem;

CREATE INDEX "KnowledgeChunk_search_tsvector_idx"
  ON "KnowledgeChunk" USING GIN ((
    setweight(to_tsvector('policydesk_spanish', coalesce("section", '')), 'B') ||
    setweight(to_tsvector('policydesk_spanish', coalesce("content", '')), 'D')
  ));
CREATE INDEX "GeneralKnowledgeChunk_search_tsvector_idx"
  ON "GeneralKnowledgeChunk" USING GIN ((
    setweight(to_tsvector('policydesk_spanish', coalesce("section", '')), 'B') ||
    setweight(to_tsvector('policydesk_spanish', coalesce("content", '')), 'D')
  ));

CREATE UNIQUE INDEX "KnowledgeSource_active_scope_key"
  ON "KnowledgeSource"(
    "organizationId",
    coalesce("insurerName", ''),
    coalesce("product", '')
  ) WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "GeneralKnowledgeSource_active_product_key"
  ON "GeneralKnowledgeSource"(coalesce("product", ''))
  WHERE "status" = 'ACTIVE';

CREATE OR REPLACE FUNCTION "policydesk_invalidate_knowledge_source_integrity"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "KnowledgeSource"
     SET "manifestHash" = NULL,
         "integrityVerifiedAt" = NULL,
         "status" = CASE WHEN "status" = 'ACTIVE' THEN 'DRAFT'::"KnowledgeSourceStatus" ELSE "status" END,
         "updatedAt" = CURRENT_TIMESTAMP
   WHERE "id" = COALESCE(NEW."sourceId", OLD."sourceId");
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION "policydesk_invalidate_knowledge_source_metadata"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."status" = 'ACTIVE' THEN
    NEW."status" := 'DRAFT'::"KnowledgeSourceStatus";
  END IF;
  NEW."manifestHash" := NULL;
  NEW."integrityVerifiedAt" := NULL;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "KnowledgeChunk_integrity_invalidation"
AFTER INSERT OR UPDATE OR DELETE ON "KnowledgeChunk"
FOR EACH ROW EXECUTE FUNCTION "policydesk_invalidate_knowledge_source_integrity"();

CREATE TRIGGER "KnowledgeSource_integrity_invalidation"
BEFORE UPDATE OF "title", "version", "insurerName", "product", "sourceUrl", "authority", "reviewedAt", "effectiveFrom", "effectiveTo"
ON "KnowledgeSource"
FOR EACH ROW EXECUTE FUNCTION "policydesk_invalidate_knowledge_source_metadata"();

CREATE TRIGGER "GeneralKnowledgeChunk_integrity_invalidation"
AFTER INSERT OR UPDATE OR DELETE ON "GeneralKnowledgeChunk"
FOR EACH ROW EXECUTE FUNCTION "policydesk_invalidate_knowledge_source_integrity"();

CREATE OR REPLACE FUNCTION "policydesk_invalidate_general_knowledge_source_integrity"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "GeneralKnowledgeSource"
     SET "manifestHash" = NULL,
         "integrityVerifiedAt" = NULL,
         "status" = CASE WHEN "status" = 'ACTIVE' THEN 'DRAFT'::"KnowledgeSourceStatus" ELSE "status" END,
         "updatedAt" = CURRENT_TIMESTAMP
   WHERE "id" = COALESCE(NEW."sourceId", OLD."sourceId");
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER "GeneralKnowledgeChunk_integrity_invalidation" ON "GeneralKnowledgeChunk";
CREATE TRIGGER "GeneralKnowledgeChunk_integrity_invalidation"
AFTER INSERT OR UPDATE OR DELETE ON "GeneralKnowledgeChunk"
FOR EACH ROW EXECUTE FUNCTION "policydesk_invalidate_general_knowledge_source_integrity"();

CREATE OR REPLACE FUNCTION "policydesk_invalidate_general_knowledge_source_metadata"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."status" = 'ACTIVE' THEN
    NEW."status" := 'DRAFT'::"KnowledgeSourceStatus";
  END IF;
  NEW."manifestHash" := NULL;
  NEW."integrityVerifiedAt" := NULL;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "GeneralKnowledgeSource_integrity_invalidation"
BEFORE UPDATE OF "title", "version", "product", "sourceUrl", "authority", "reviewedAt", "effectiveFrom", "effectiveTo"
ON "GeneralKnowledgeSource"
FOR EACH ROW EXECUTE FUNCTION "policydesk_invalidate_general_knowledge_source_metadata"();
