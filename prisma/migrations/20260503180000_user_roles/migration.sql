-- Add role/active/lastLoginAt to User
ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'AGENT';
ALTER TABLE "User" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "lastLoginAt" DATETIME;

-- Promote all existing real users to ADMIN so the broker keeps full access.
-- The system user stays as AGENT (irrelevant: it cannot log in).
UPDATE "User" SET "role" = 'ADMIN' WHERE "id" != 'system-user-0000';

CREATE INDEX "User_role_idx" ON "User"("role");
CREATE INDEX "User_active_idx" ON "User"("active");
