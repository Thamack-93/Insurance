ALTER TABLE "User" ALTER COLUMN "timeZone" SET DEFAULT 'Etc/GMT+6';
UPDATE "User" SET "timeZone" = 'Etc/GMT+6' WHERE "timeZone" IS DISTINCT FROM 'Etc/GMT+6';
