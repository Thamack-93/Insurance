-- Add family root reference so each Policy can represent one vigencia and point to its family root.
ALTER TABLE "Policy" ADD COLUMN "familyRootId" TEXT;

CREATE INDEX "Policy_familyRootId_idx" ON "Policy"("familyRootId");

ALTER TABLE "Policy"
ADD CONSTRAINT "Policy_familyRootId_fkey"
FOREIGN KEY ("familyRootId") REFERENCES "Policy"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
