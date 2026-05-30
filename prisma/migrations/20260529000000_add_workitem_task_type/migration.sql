-- Add business task subtype to WorkItem so task screens can live entirely on WorkItem.
ALTER TABLE "WorkItem" ADD COLUMN "taskType" "TaskType";

-- Backfill the subtype for historical task-backed work items.
UPDATE "WorkItem" AS w
SET "taskType" = t."taskType"
FROM "Task" AS t
WHERE w."sourceType" = 'Task'
  AND w."sourceId" = t."id";

CREATE INDEX "WorkItem_taskType_idx" ON "WorkItem"("taskType");
