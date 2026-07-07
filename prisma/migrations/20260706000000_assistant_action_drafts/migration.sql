BEGIN;

CREATE TABLE "AssistantActionDraft" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "reply" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "targetLabel" TEXT,
  "payloadJson" TEXT NOT NULL,
  "resultJson" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AssistantActionDraft_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssistantActionDraft_userId_idx" ON "AssistantActionDraft"("userId");
CREATE INDEX "AssistantActionDraft_status_idx" ON "AssistantActionDraft"("status");
CREATE INDEX "AssistantActionDraft_expiresAt_idx" ON "AssistantActionDraft"("expiresAt");
CREATE INDEX "AssistantActionDraft_createdAt_idx" ON "AssistantActionDraft"("createdAt");

ALTER TABLE "AssistantActionDraft"
ADD CONSTRAINT "AssistantActionDraft_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
