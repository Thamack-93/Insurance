BEGIN;

ALTER TABLE "NotificationChannel" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "NotificationPreference" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "NotificationEvent" ALTER COLUMN "updatedAt" DROP DEFAULT;

COMMIT;
