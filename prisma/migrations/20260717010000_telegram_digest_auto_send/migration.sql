-- Track automatic Telegram digest sends separately from manual sends.
ALTER TABLE "User"
ADD COLUMN "telegramDigestLastAutoSentAt" TIMESTAMP(3);
