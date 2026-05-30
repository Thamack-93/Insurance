BEGIN;

CREATE TYPE "WorkItemType" AS ENUM ('TASK', 'REMINDER', 'ALERT');
CREATE TYPE "WorkItemStatus" AS ENUM (
    'OPEN',
    'IN_PROGRESS',
    'WAITING_CLIENT',
    'WAITING_INSURER',
    'WAITING_DOCUMENT',
    'SENT',
    'RESOLVED',
    'CANCELLED',
    'ARCHIVED',
    'DISMISSED'
);

CREATE TABLE "WorkItem" (
    "id" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "workItemType" "WorkItemType" NOT NULL DEFAULT 'TASK',
    "status" "WorkItemStatus" NOT NULL DEFAULT 'OPEN',
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "severity" "AlertSeverity",
    "folio" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "clientId" TEXT,
    "policyId" TEXT,
    "insurerId" TEXT,
    "receiptId" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "closedDate" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "WorkItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "WorkItem_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WorkItem_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WorkItem_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "Insurer" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WorkItem_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WorkItem_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WorkItem_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "WorkItem" (
    "id",
    "sourceType",
    "sourceId",
    "workItemType",
    "status",
    "priority",
    "severity",
    "folio",
    "title",
    "description",
    "entityType",
    "entityId",
    "clientId",
    "policyId",
    "insurerId",
    "receiptId",
    "startDate",
    "dueDate",
    "closedDate",
    "readAt",
    "notes",
    "createdAt",
    "updatedAt",
    "createdById",
    "updatedById"
)
SELECT
    "id",
    'Reminder',
    "id",
    'REMINDER'::"WorkItemType",
    (CASE "status"
        WHEN 'ACTIVE' THEN 'OPEN'
        WHEN 'DONE' THEN 'RESOLVED'
        WHEN 'CANCELLED' THEN 'CANCELLED'
        ELSE 'OPEN'
    END)::"WorkItemStatus",
    'MEDIUM'::"Priority",
    NULL,
    NULL,
    "title",
    "description",
    "entityType",
    "entityId",
    NULL,
    NULL,
    NULL,
    NULL,
    "createdAt",
    "reminderDate",
    CASE
        WHEN "status" = 'DONE' THEN "updatedAt"
        WHEN "status" = 'CANCELLED' THEN "updatedAt"
        ELSE NULL
    END,
    CASE
        WHEN "status" = 'DONE' THEN "updatedAt"
        ELSE NULL
    END,
    NULL,
    "createdAt",
    "updatedAt",
    NULL,
    NULL
FROM "Reminder";

CREATE UNIQUE INDEX "WorkItem_sourceType_sourceId_key" ON "WorkItem"("sourceType", "sourceId");
CREATE INDEX "WorkItem_folio_idx" ON "WorkItem"("folio");
CREATE INDEX "WorkItem_entityType_entityId_idx" ON "WorkItem"("entityType", "entityId");
CREATE INDEX "WorkItem_clientId_idx" ON "WorkItem"("clientId");
CREATE INDEX "WorkItem_policyId_idx" ON "WorkItem"("policyId");
CREATE INDEX "WorkItem_insurerId_idx" ON "WorkItem"("insurerId");
CREATE INDEX "WorkItem_receiptId_idx" ON "WorkItem"("receiptId");
CREATE INDEX "WorkItem_status_idx" ON "WorkItem"("status");
CREATE INDEX "WorkItem_priority_idx" ON "WorkItem"("priority");
CREATE INDEX "WorkItem_dueDate_idx" ON "WorkItem"("dueDate");
CREATE INDEX "WorkItem_createdById_idx" ON "WorkItem"("createdById");
CREATE INDEX "WorkItem_updatedById_idx" ON "WorkItem"("updatedById");

DROP TABLE "Reminder";

COMMIT;
