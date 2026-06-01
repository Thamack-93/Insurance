-- Add referidor relationship without redefining the whole table on Postgres
ALTER TABLE "Client" ADD COLUMN "referidorId" TEXT;

ALTER TABLE "Client" ADD CONSTRAINT "Client_referidorId_fkey" FOREIGN KEY ("referidorId") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Client_referidorId_idx" ON "Client"("referidorId");
