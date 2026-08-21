-- Internal platform billing ledger. It is intentionally separate from
-- policy receipts/payments and stores every amount in minor currency units.

CREATE TABLE "Plan" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
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

CREATE UNIQUE INDEX "Plan_requestId_key" ON "Plan"("requestId");
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");
CREATE INDEX "Plan_active_idx" ON "Plan"("active");

CREATE TABLE "OrganizationSubscription" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
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
  CONSTRAINT "OrganizationSubscription_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "OrganizationSubscription_period_check" CHECK ("endsAt" IS NULL OR "endsAt" >= "startedAt")
);

CREATE UNIQUE INDEX "OrganizationSubscription_requestId_key" ON "OrganizationSubscription"("requestId");
CREATE INDEX "OrganizationSubscription_organizationId_status_idx"
  ON "OrganizationSubscription"("organizationId", "status");
CREATE INDEX "OrganizationSubscription_planId_idx" ON "OrganizationSubscription"("planId");
CREATE INDEX "OrganizationSubscription_startedAt_idx" ON "OrganizationSubscription"("startedAt");
CREATE UNIQUE INDEX "OrganizationSubscription_one_current_key"
  ON "OrganizationSubscription"("organizationId")
  WHERE "status" IN ('TRIAL', 'ACTIVE', 'PAST_DUE');

CREATE TABLE "BillingCharge" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "subscriptionId" TEXT,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "amountMinor" INTEGER NOT NULL,
  "currency" VARCHAR(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
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
    CHECK ("status" IN ('PENDING', 'PAID', 'VOID', 'REFUNDED')),
  CONSTRAINT "BillingCharge_amount_check" CHECK ("amountMinor" >= 0),
  CONSTRAINT "BillingCharge_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "BillingCharge_period_check" CHECK ("periodEnd" >= "periodStart"),
  CONSTRAINT "BillingCharge_paid_at_check"
    CHECK (("status" = 'PAID' AND "paidAt" IS NOT NULL) OR ("status" <> 'PAID'))
);

CREATE UNIQUE INDEX "BillingCharge_requestId_key" ON "BillingCharge"("requestId");
CREATE INDEX "BillingCharge_organizationId_periodStart_idx"
  ON "BillingCharge"("organizationId", "periodStart");
CREATE INDEX "BillingCharge_organizationId_status_paidAt_idx"
  ON "BillingCharge"("organizationId", "status", "paidAt");
CREATE INDEX "BillingCharge_subscriptionId_idx" ON "BillingCharge"("subscriptionId");

COMMENT ON TABLE "Plan" IS 'Global platform plan catalog; not a policy product catalog.';
COMMENT ON TABLE "OrganizationSubscription" IS 'Organization-scoped platform subscription snapshot.';
COMMENT ON TABLE "BillingCharge" IS 'Internal platform charge ledger; not policy premiums or customer payments.';
