BEGIN;

CREATE TYPE "NotificationChannelType" AS ENUM ('TELEGRAM', 'WEB', 'EMAIL');
CREATE TYPE "NotificationEventStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

CREATE TABLE "NotificationChannel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationChannelType" NOT NULL,
    "telegramChatId" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationChannel_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "NotificationChannel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "channelType" "NotificationChannelType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
    "minPriority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "quietHoursStart" TEXT,
    "quietHoursEnd" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "NotificationEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "userId" TEXT NOT NULL,
    "workItemId" TEXT,
    "clientId" TEXT,
    "policyId" TEXT,
    "receiptId" TEXT,
    "channelType" "NotificationChannelType" NOT NULL,
    "status" "NotificationEventStatus" NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "NotificationEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NotificationEvent_workItemId_fkey" FOREIGN KEY ("workItemId") REFERENCES "WorkItem" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "NotificationEvent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "NotificationEvent_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "NotificationEvent_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "NotificationChannel_userId_type_key" ON "NotificationChannel"("userId", "type");
CREATE INDEX "NotificationChannel_userId_idx" ON "NotificationChannel"("userId");
CREATE INDEX "NotificationChannel_type_idx" ON "NotificationChannel"("type");
CREATE INDEX "NotificationChannel_telegramChatId_idx" ON "NotificationChannel"("telegramChatId");

CREATE UNIQUE INDEX "NotificationPreference_userId_eventType_channelType_key" ON "NotificationPreference"("userId", "eventType", "channelType");
CREATE INDEX "NotificationPreference_userId_idx" ON "NotificationPreference"("userId");
CREATE INDEX "NotificationPreference_eventType_idx" ON "NotificationPreference"("eventType");
CREATE INDEX "NotificationPreference_channelType_idx" ON "NotificationPreference"("channelType");

CREATE INDEX "NotificationEvent_userId_idx" ON "NotificationEvent"("userId");
CREATE INDEX "NotificationEvent_type_idx" ON "NotificationEvent"("type");
CREATE INDEX "NotificationEvent_channelType_idx" ON "NotificationEvent"("channelType");
CREATE INDEX "NotificationEvent_status_idx" ON "NotificationEvent"("status");
CREATE INDEX "NotificationEvent_createdAt_idx" ON "NotificationEvent"("createdAt");
CREATE INDEX "NotificationEvent_workItemId_idx" ON "NotificationEvent"("workItemId");
CREATE INDEX "NotificationEvent_clientId_idx" ON "NotificationEvent"("clientId");
CREATE INDEX "NotificationEvent_policyId_idx" ON "NotificationEvent"("policyId");
CREATE INDEX "NotificationEvent_receiptId_idx" ON "NotificationEvent"("receiptId");

COMMIT;
