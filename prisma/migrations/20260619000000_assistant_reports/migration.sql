BEGIN;

CREATE TABLE "AssistantReport" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "themeKey" TEXT NOT NULL,
  "themeLabel" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "version" INTEGER NOT NULL DEFAULT 1,
  "parentReportId" TEXT,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "recommendation" TEXT NOT NULL,
  "plan" TEXT NOT NULL,
  "evidenceJson" TEXT NOT NULL,
  "detailsJson" TEXT NOT NULL,
  "signalCount" INTEGER NOT NULL DEFAULT 0,
  "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
  "firstSignalAt" TIMESTAMP(3) NOT NULL,
  "lastSignalAt" TIMESTAMP(3) NOT NULL,
  "openedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AssistantReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AssistantReportSignal" (
  "id" TEXT NOT NULL,
  "reportId" TEXT NOT NULL,
  "signalKind" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "inputJson" TEXT NOT NULL,
  "outputJson" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AssistantReportSignal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssistantReport_kind_idx" ON "AssistantReport"("kind");
CREATE INDEX "AssistantReport_themeKey_idx" ON "AssistantReport"("themeKey");
CREATE INDEX "AssistantReport_status_idx" ON "AssistantReport"("status");
CREATE INDEX "AssistantReport_version_idx" ON "AssistantReport"("version");
CREATE INDEX "AssistantReport_parentReportId_idx" ON "AssistantReport"("parentReportId");
CREATE INDEX "AssistantReport_lastSignalAt_idx" ON "AssistantReport"("lastSignalAt");
CREATE INDEX "AssistantReport_createdAt_idx" ON "AssistantReport"("createdAt");

CREATE INDEX "AssistantReportSignal_reportId_idx" ON "AssistantReportSignal"("reportId");
CREATE INDEX "AssistantReportSignal_signalKind_idx" ON "AssistantReportSignal"("signalKind");
CREATE INDEX "AssistantReportSignal_source_idx" ON "AssistantReportSignal"("source");
CREATE INDEX "AssistantReportSignal_createdAt_idx" ON "AssistantReportSignal"("createdAt");

ALTER TABLE "AssistantReport"
ADD CONSTRAINT "AssistantReport_parentReportId_fkey"
FOREIGN KEY ("parentReportId") REFERENCES "AssistantReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "AssistantReportSignal"
ADD CONSTRAINT "AssistantReportSignal_reportId_fkey"
FOREIGN KEY ("reportId") REFERENCES "AssistantReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
