-- Add fixed-hour Telegram digest scheduling per user.
ALTER TABLE "User"
ADD COLUMN "telegramDigestHour" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN "telegramDigestLastSentAt" TIMESTAMP(3);

-- Remove the old per-event quiet hours window now that digest timing is fixed.
ALTER TABLE "NotificationPreference"
DROP COLUMN "quietHoursStart",
DROP COLUMN "quietHoursEnd";
