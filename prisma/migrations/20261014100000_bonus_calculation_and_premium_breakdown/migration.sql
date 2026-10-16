ALTER TABLE "Policy" ADD COLUMN "bonusSellerId" TEXT;
ALTER TABLE "Policy" ADD COLUMN "bonusEligibilityJson" TEXT;
ALTER TABLE "Receipt" ADD COLUMN "vatAmount" DECIMAL(65,30);
ALTER TABLE "Receipt" ADD COLUMN "issuanceExpenseAmount" DECIMAL(65,30);
ALTER TABLE "Receipt" ADD COLUMN "surchargeAmount" DECIMAL(65,30);
ALTER TABLE "Receipt" ADD COLUMN "discountAmount" DECIMAL(65,30);
ALTER TABLE "Receipt" ADD COLUMN "netPremiumAmount" DECIMAL(65,30);

CREATE TABLE "BonusRuleSet" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "programKey" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "effectiveStart" TIMESTAMP(3) NOT NULL,
  "effectiveEnd" TIMESTAMP(3) NOT NULL,
  "sourceFileName" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "rulesJson" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BonusRuleSet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BonusRun" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "ruleSetId" TEXT NOT NULL,
  "programKey" TEXT NOT NULL,
  "sellerId" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "periodType" TEXT NOT NULL,
  "periodNumber" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "baseAmount" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "bonusRate" DECIMAL(65,30),
  "bonusAmount" DECIMAL(65,30),
  "snapshotJson" TEXT NOT NULL,
  "reviewReasonsJson" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdById" TEXT,
  "approvedById" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BonusRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BonusRunItem" (
  "organizationId" TEXT NOT NULL,
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "paymentId" TEXT,
  "receiptId" TEXT,
  "policyId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'REVIEW',
  "currency" VARCHAR(3),
  "paidAmount" DECIMAL(65,30),
  "netPremiumPaid" DECIMAL(65,30),
  "eligibleAmount" DECIMAL(65,30),
  "conversionRate" DECIMAL(65,30),
  "conversionDate" DATE,
  "reason" TEXT,
  "evidenceJson" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BonusRunItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BonusRuleSet_organizationId_programKey_version_key" ON "BonusRuleSet"("organizationId", "programKey", "version");
CREATE INDEX "BonusRuleSet_organizationId_programKey_status_idx" ON "BonusRuleSet"("organizationId", "programKey", "status");
CREATE INDEX "BonusRuleSet_organizationId_effectiveStart_effectiveEnd_idx" ON "BonusRuleSet"("organizationId", "effectiveStart", "effectiveEnd");
CREATE UNIQUE INDEX "BonusRun_organizationId_programKey_sellerId_year_periodType_periodNumber_key" ON "BonusRun"("organizationId", "programKey", "sellerId", "year", "periodType", "periodNumber");
CREATE INDEX "BonusRun_organizationId_year_periodType_periodNumber_status_idx" ON "BonusRun"("organizationId", "year", "periodType", "periodNumber", "status");
CREATE INDEX "BonusRun_organizationId_sellerId_year_idx" ON "BonusRun"("organizationId", "sellerId", "year");
CREATE INDEX "BonusRun_ruleSetId_idx" ON "BonusRun"("ruleSetId");
CREATE UNIQUE INDEX "BonusRunItem_runId_paymentId_key" ON "BonusRunItem"("runId", "paymentId");
CREATE INDEX "BonusRunItem_organizationId_runId_status_idx" ON "BonusRunItem"("organizationId", "runId", "status");
CREATE INDEX "BonusRunItem_organizationId_paymentId_idx" ON "BonusRunItem"("organizationId", "paymentId");
CREATE INDEX "BonusRunItem_organizationId_policyId_idx" ON "BonusRunItem"("organizationId", "policyId");
CREATE INDEX "Policy_bonusSellerId_idx" ON "Policy"("bonusSellerId");
CREATE INDEX "Policy_organizationId_bonusSellerId_idx" ON "Policy"("organizationId", "bonusSellerId");

ALTER TABLE "Policy" ADD CONSTRAINT "Policy_bonusSellerId_fkey" FOREIGN KEY ("bonusSellerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BonusRuleSet" ADD CONSTRAINT "BonusRuleSet_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BonusRuleSet" ADD CONSTRAINT "BonusRuleSet_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BonusRun" ADD CONSTRAINT "BonusRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BonusRun" ADD CONSTRAINT "BonusRun_ruleSetId_fkey" FOREIGN KEY ("ruleSetId") REFERENCES "BonusRuleSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BonusRun" ADD CONSTRAINT "BonusRun_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BonusRun" ADD CONSTRAINT "BonusRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BonusRun" ADD CONSTRAINT "BonusRun_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BonusRunItem" ADD CONSTRAINT "BonusRunItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BonusRunItem" ADD CONSTRAINT "BonusRunItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BonusRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BonusRunItem" ADD CONSTRAINT "BonusRunItem_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BonusRunItem" ADD CONSTRAINT "BonusRunItem_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BonusRunItem" ADD CONSTRAINT "BonusRunItem_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "Policy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "BonusRuleSet_organizationId_idx" ON "BonusRuleSet"("organizationId");
CREATE INDEX "BonusRun_organizationId_idx" ON "BonusRun"("organizationId");
CREATE INDEX "BonusRunItem_organizationId_idx" ON "BonusRunItem"("organizationId");

CREATE TRIGGER "BonusRuleSet_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "BonusRuleSet"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();
CREATE TRIGGER "BonusRun_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "BonusRun"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();
CREATE TRIGGER "BonusRunItem_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "BonusRunItem"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();
