CREATE TABLE "TelegramWebhookUpdate" (
    "id" TEXT NOT NULL,
    "updateId" INTEGER NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramWebhookUpdate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TelegramWebhookUpdate_updateId_key" ON "TelegramWebhookUpdate"("updateId");
CREATE INDEX "TelegramWebhookUpdate_receivedAt_idx" ON "TelegramWebhookUpdate"("receivedAt");
