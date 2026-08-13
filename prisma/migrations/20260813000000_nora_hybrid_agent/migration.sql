CREATE TYPE "ClaimChecklistStatus" AS ENUM ('MISSING', 'REQUESTED', 'RECEIVED', 'WAIVED');

CREATE TABLE "ClaimChecklistItem" (
    "organizationId" TEXT,
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "documentId" TEXT,
    "requirementCode" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" "ClaimChecklistStatus" NOT NULL DEFAULT 'MISSING',
    "requestedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "waivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClaimChecklistItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClaimChecklistItem_claimId_requirementCode_key" ON "ClaimChecklistItem"("claimId", "requirementCode");
CREATE INDEX "ClaimChecklistItem_claimId_idx" ON "ClaimChecklistItem"("claimId");
CREATE INDEX "ClaimChecklistItem_documentId_idx" ON "ClaimChecklistItem"("documentId");
CREATE INDEX "ClaimChecklistItem_status_idx" ON "ClaimChecklistItem"("status");
CREATE INDEX "ClaimChecklistItem_organizationId_idx" ON "ClaimChecklistItem"("organizationId");

ALTER TABLE "ClaimChecklistItem" ADD CONSTRAINT "ClaimChecklistItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClaimChecklistItem" ADD CONSTRAINT "ClaimChecklistItem_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClaimChecklistItem" ADD CONSTRAINT "ClaimChecklistItem_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TRIGGER "ClaimChecklistItem_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "ClaimChecklistItem"
FOR EACH ROW EXECUTE FUNCTION "policydesk_assign_singleton_organization"();

COMMENT ON TRIGGER "ClaimChecklistItem_transition_singleton_organization" ON "ClaimChecklistItem" IS
'Cycle 1 temporary singleton assignment and immutability barrier; remove only after tenant-context rollout and two-organization validation.';
