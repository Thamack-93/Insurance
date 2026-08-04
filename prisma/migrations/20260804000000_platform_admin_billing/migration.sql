-- Platform SUPERADMIN and internal billing foundation.
-- This migration is additive: it does not remove Cycle 1 singleton guards or
-- create a second organization. Provisioning is operator-driven and idempotent.

ALTER TABLE "User"
  ADD CONSTRAINT "User_platformRole_check"
  CHECK ("platformRole" IN ('NONE', 'SUPERADMIN'));

CREATE TABLE "Plan" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "monthlyAmountMinor" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Plan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Plan_amount_check" CHECK ("monthlyAmountMinor" >= 0),
  CONSTRAINT "Plan_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");
CREATE INDEX "Plan_active_idx" ON "Plan"("active");

CREATE TABLE "OrganizationSubscription" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'TRIAL',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endsAt" TIMESTAMP(3),
  "monthlyAmountMinor" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrganizationSubscription_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrganizationSubscription_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrganizationSubscription_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrganizationSubscription_status_check"
    CHECK ("status" IN ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELED')),
  CONSTRAINT "OrganizationSubscription_amount_check" CHECK ("monthlyAmountMinor" >= 0),
  CONSTRAINT "OrganizationSubscription_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE INDEX "OrganizationSubscription_organizationId_status_idx"
  ON "OrganizationSubscription"("organizationId", "status");
CREATE INDEX "OrganizationSubscription_planId_idx" ON "OrganizationSubscription"("planId");
CREATE INDEX "OrganizationSubscription_startedAt_idx" ON "OrganizationSubscription"("startedAt");

CREATE TABLE "BillingCharge" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "subscriptionId" TEXT,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PAID',
  "paidAt" TIMESTAMP(3),
  "externalReference" TEXT,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BillingCharge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillingCharge_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "BillingCharge_subscriptionId_fkey"
    FOREIGN KEY ("subscriptionId") REFERENCES "OrganizationSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "BillingCharge_status_check"
    CHECK ("status" IN ('PAID', 'VOID', 'REFUNDED')),
  CONSTRAINT "BillingCharge_currency_check"
    CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE INDEX "BillingCharge_organizationId_periodStart_idx"
  ON "BillingCharge"("organizationId", "periodStart");
CREATE INDEX "BillingCharge_status_paidAt_idx" ON "BillingCharge"("status", "paidAt");
CREATE INDEX "BillingCharge_subscriptionId_idx" ON "BillingCharge"("subscriptionId");

CREATE TABLE "OrganizationMigrationConflict" (
  "id" TEXT NOT NULL,
  "sourceOrganizationId" TEXT NOT NULL,
  "targetOrganizationId" TEXT NOT NULL,
  "tableName" TEXT NOT NULL,
  "rowId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "detailsJson" TEXT,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "OrganizationMigrationConflict_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrganizationMigrationConflict_sourceOrganizationId_fkey"
    FOREIGN KEY ("sourceOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrganizationMigrationConflict_targetOrganizationId_fkey"
    FOREIGN KEY ("targetOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "OrganizationMigrationConflict_sourceOrganizationId_status_idx"
  ON "OrganizationMigrationConflict"("sourceOrganizationId", "status");
CREATE INDEX "OrganizationMigrationConflict_targetOrganizationId_status_idx"
  ON "OrganizationMigrationConflict"("targetOrganizationId", "status");
CREATE INDEX "OrganizationMigrationConflict_tableName_rowId_idx"
  ON "OrganizationMigrationConflict"("tableName", "rowId");

INSERT INTO "Plan" ("id", "code", "name", "monthlyAmountMinor", "currency", "active")
VALUES ('plan_trial_0001', 'TRIAL', 'Trial', 0, 'MXN', true)
ON CONFLICT ("code") DO NOTHING;

COMMENT ON TABLE "Plan" IS 'Global plan catalog; prices are minor units and are not a Stripe ledger.';
COMMENT ON TABLE "OrganizationSubscription" IS 'Organization-scoped subscription snapshot used by the platform dashboard.';
COMMENT ON TABLE "BillingCharge" IS 'Internal monthly charge ledger; corrections require an operator reason.';
COMMENT ON TABLE "OrganizationMigrationConflict" IS 'Review queue for safe, non-automatic tenant separation conflicts.';
