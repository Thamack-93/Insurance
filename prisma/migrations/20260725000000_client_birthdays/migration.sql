ALTER TABLE "Client"
ADD COLUMN "birthDate" DATE;

ALTER TABLE "NotificationEvent"
ADD COLUMN "dedupeKey" TEXT;

CREATE UNIQUE INDEX "NotificationEvent_dedupeKey_key"
ON "NotificationEvent"("dedupeKey");
