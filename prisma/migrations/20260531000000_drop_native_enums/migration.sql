BEGIN;

-- Convert WorkItem enums to TEXT
ALTER TABLE "WorkItem" ALTER COLUMN "workItemType" DROP DEFAULT;
ALTER TABLE "WorkItem" ALTER COLUMN "workItemType" TYPE TEXT USING "workItemType"::TEXT;
ALTER TABLE "WorkItem" ALTER COLUMN "workItemType" SET DEFAULT 'TASK';

ALTER TABLE "WorkItem" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "WorkItem" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "WorkItem" ALTER COLUMN "status" SET DEFAULT 'OPEN';

-- Convert NotificationChannelType usages to TEXT
ALTER TABLE "NotificationChannel" ALTER COLUMN "type" TYPE TEXT USING "type"::TEXT;
ALTER TABLE "NotificationPreference" ALTER COLUMN "channelType" TYPE TEXT USING "channelType"::TEXT;
ALTER TABLE "NotificationEvent" ALTER COLUMN "channelType" TYPE TEXT USING "channelType"::TEXT;

-- Convert NotificationEventStatus usages to TEXT
ALTER TABLE "NotificationEvent" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "NotificationEvent" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "NotificationEvent" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- Drop the enum types
DROP TYPE "WorkItemType";
DROP TYPE "WorkItemStatus";
DROP TYPE "NotificationChannelType";
DROP TYPE "NotificationEventStatus";

COMMIT;
