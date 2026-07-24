CREATE TABLE "SecurityEventAggregate" (
    "id" TEXT NOT NULL,
    "alertType" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" TEXT NOT NULL,

    CONSTRAINT "SecurityEventAggregate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SecurityEventAggregate_alertType_fingerprint_windowStart_key"
  ON "SecurityEventAggregate"("alertType", "fingerprint", "windowStart");
CREATE INDEX "SecurityEventAggregate_alertType_idx" ON "SecurityEventAggregate"("alertType");
CREATE INDEX "SecurityEventAggregate_lastSeenAt_idx" ON "SecurityEventAggregate"("lastSeenAt");
