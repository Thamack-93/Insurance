-- Align the AI diagnostics tables with the Prisma schema.
-- The original migration used an unqualified DECIMAL and database defaults
-- for @updatedAt fields. Prisma expects DECIMAL(65,30) and manages
-- @updatedAt values in the client without a database default.

ALTER TABLE "AssistantAiRun"
  ALTER COLUMN "estimatedCostUsd" TYPE DECIMAL(65,30),
  ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "AssistantAiAttempt"
  ALTER COLUMN "estimatedCostUsd" TYPE DECIMAL(65,30),
  ALTER COLUMN "updatedAt" DROP DEFAULT;
