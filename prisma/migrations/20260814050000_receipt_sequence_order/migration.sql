-- Keep the displayed receipt number untouched while making numeric ordering
-- deterministic for values such as 1, 2, 10 and REC-001, REC-002.
ALTER TABLE "Receipt" ADD COLUMN "receiptSequence" INTEGER;

UPDATE "Receipt"
SET "receiptSequence" = RIGHT_MATCH.value::integer
FROM (
  SELECT
    "id",
    substring(btrim("receiptNumber") from '([0-9]+)$') AS value
  FROM "Receipt"
) AS RIGHT_MATCH
WHERE "Receipt"."id" = RIGHT_MATCH."id"
  AND RIGHT_MATCH.value IS NOT NULL
  AND length(RIGHT_MATCH.value) <= 9;

CREATE INDEX "Receipt_policyId_receiptSequence_idx"
  ON "Receipt"("policyId", "receiptSequence");
