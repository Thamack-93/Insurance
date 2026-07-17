-- CreateTable
CREATE TABLE "AssistantAiRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userRole" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "requestedModel" TEXT NOT NULL,
    "finalModel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "fallbackCount" INTEGER NOT NULL DEFAULT 0,
    "fallbackReason" TEXT,
    "reportId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "statusCode" INTEGER,
    "finishReason" TEXT,
    "usageJson" TEXT,
    "totalUsageJson" TEXT,
    "providerMetadataJson" TEXT,
    "responsePreview" TEXT,
    "estimatedCostUsd" DECIMAL,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantAiRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantAiAttempt" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "tier" TEXT NOT NULL,
    "requestedModel" TEXT NOT NULL,
    "finalModel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'STARTED',
    "fallbackReason" TEXT,
    "provider" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "statusCode" INTEGER,
    "finishReason" TEXT,
    "responsePreview" TEXT,
    "usageJson" TEXT,
    "totalUsageJson" TEXT,
    "providerMetadataJson" TEXT,
    "durationMs" INTEGER,
    "estimatedCostUsd" DECIMAL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantAiAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AssistantAiRun_userId_idx" ON "AssistantAiRun"("userId");

-- CreateIndex
CREATE INDEX "AssistantAiRun_userRole_idx" ON "AssistantAiRun"("userRole");

-- CreateIndex
CREATE INDEX "AssistantAiRun_operation_idx" ON "AssistantAiRun"("operation");

-- CreateIndex
CREATE INDEX "AssistantAiRun_tier_idx" ON "AssistantAiRun"("tier");

-- CreateIndex
CREATE INDEX "AssistantAiRun_status_idx" ON "AssistantAiRun"("status");

-- CreateIndex
CREATE INDEX "AssistantAiRun_requestedModel_idx" ON "AssistantAiRun"("requestedModel");

-- CreateIndex
CREATE INDEX "AssistantAiRun_finalModel_idx" ON "AssistantAiRun"("finalModel");

-- CreateIndex
CREATE INDEX "AssistantAiRun_reportId_idx" ON "AssistantAiRun"("reportId");

-- CreateIndex
CREATE INDEX "AssistantAiRun_createdAt_idx" ON "AssistantAiRun"("createdAt");

-- CreateIndex
CREATE INDEX "AssistantAiAttempt_runId_idx" ON "AssistantAiAttempt"("runId");

-- CreateIndex
CREATE INDEX "AssistantAiAttempt_attemptNumber_idx" ON "AssistantAiAttempt"("attemptNumber");

-- CreateIndex
CREATE INDEX "AssistantAiAttempt_tier_idx" ON "AssistantAiAttempt"("tier");

-- CreateIndex
CREATE INDEX "AssistantAiAttempt_status_idx" ON "AssistantAiAttempt"("status");

-- CreateIndex
CREATE INDEX "AssistantAiAttempt_requestedModel_idx" ON "AssistantAiAttempt"("requestedModel");

-- CreateIndex
CREATE INDEX "AssistantAiAttempt_finalModel_idx" ON "AssistantAiAttempt"("finalModel");

-- CreateIndex
CREATE INDEX "AssistantAiAttempt_createdAt_idx" ON "AssistantAiAttempt"("createdAt");

-- AddForeignKey
ALTER TABLE "AssistantAiRun" ADD CONSTRAINT "AssistantAiRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantAiRun" ADD CONSTRAINT "AssistantAiRun_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "AssistantReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssistantAiAttempt" ADD CONSTRAINT "AssistantAiAttempt_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AssistantAiRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
