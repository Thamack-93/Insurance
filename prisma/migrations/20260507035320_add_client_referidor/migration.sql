-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Client" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fullName" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'PERSON',
    "email" TEXT,
    "phone" TEXT,
    "secondaryPhone" TEXT,
    "rfc" TEXT,
    "address" TEXT,
    "preferredContactMethod" TEXT,
    "referidorId" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    CONSTRAINT "Client_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Client_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Client_referidorId_fkey" FOREIGN KEY ("referidorId") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Client" ("address", "createdAt", "createdById", "email", "fullName", "id", "notes", "phone", "preferredContactMethod", "rfc", "secondaryPhone", "status", "type", "updatedAt", "updatedById") SELECT "address", "createdAt", "createdById", "email", "fullName", "id", "notes", "phone", "preferredContactMethod", "rfc", "secondaryPhone", "status", "type", "updatedAt", "updatedById" FROM "Client";
DROP TABLE "Client";
ALTER TABLE "new_Client" RENAME TO "Client";
CREATE INDEX "Client_fullName_idx" ON "Client"("fullName");
CREATE INDEX "Client_status_idx" ON "Client"("status");
CREATE INDEX "Client_referidorId_idx" ON "Client"("referidorId");
CREATE INDEX "Client_createdById_idx" ON "Client"("createdById");
CREATE INDEX "Client_updatedById_idx" ON "Client"("updatedById");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
