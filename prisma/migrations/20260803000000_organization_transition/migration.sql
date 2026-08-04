CREATE TABLE "Organization" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "timeZone" TEXT NOT NULL DEFAULT 'Etc/GMT+6',
  "defaultCurrency" TEXT NOT NULL DEFAULT 'MXN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");
CREATE INDEX "Organization_status_idx" ON "Organization"("status");

INSERT INTO "Organization" ("id","name","slug","status","timeZone","defaultCurrency")
VALUES ('org_legacy_singleton_0001','PolicyDesk Legacy Organization','legacy-singleton','BOOTSTRAP','Etc/GMT+6','MXN');

CREATE TABLE "OrganizationMembership" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrganizationMembership_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrganizationMembership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrganizationMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "OrganizationMembership_organizationId_userId_key" ON "OrganizationMembership"("organizationId","userId");
CREATE INDEX "OrganizationMembership_organizationId_idx" ON "OrganizationMembership"("organizationId");
CREATE INDEX "OrganizationMembership_userId_idx" ON "OrganizationMembership"("userId");
CREATE INDEX "OrganizationMembership_role_idx" ON "OrganizationMembership"("role");
CREATE INDEX "OrganizationMembership_active_idx" ON "OrganizationMembership"("active");

ALTER TABLE "User" ADD COLUMN "platformRole" TEXT NOT NULL DEFAULT 'NONE';
CREATE INDEX "User_platformRole_idx" ON "User"("platformRole");
ALTER TABLE "Client" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "Client_organizationId_idx" ON "Client"("organizationId");
ALTER TABLE "Client" ADD CONSTRAINT "Client_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Insurer" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "Insurer_organizationId_idx" ON "Insurer"("organizationId");
ALTER TABLE "Insurer" ADD CONSTRAINT "Insurer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Policy" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "Policy_organizationId_idx" ON "Policy"("organizationId");
ALTER TABLE "Policy" ADD CONSTRAINT "Policy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Receipt" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "Receipt_organizationId_idx" ON "Receipt"("organizationId");
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PolicyEndorsement" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "PolicyEndorsement_organizationId_idx" ON "PolicyEndorsement"("organizationId");
ALTER TABLE "PolicyEndorsement" ADD CONSTRAINT "PolicyEndorsement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "Payment_organizationId_idx" ON "Payment"("organizationId");
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Commission" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "Commission_organizationId_idx" ON "Commission"("organizationId");
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Task" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "Task_organizationId_idx" ON "Task"("organizationId");
ALTER TABLE "Task" ADD CONSTRAINT "Task_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WorkItem" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "WorkItem_organizationId_idx" ON "WorkItem"("organizationId");
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Claim" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "Claim_organizationId_idx" ON "Claim"("organizationId");
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Quote" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "Quote_organizationId_idx" ON "Quote"("organizationId");
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Document" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "Document_organizationId_idx" ON "Document"("organizationId");
ALTER TABLE "Document" ADD CONSTRAINT "Document_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ActivityLog" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "ActivityLog_organizationId_idx" ON "ActivityLog"("organizationId");
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssistantActionDraft" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "AssistantActionDraft_organizationId_idx" ON "AssistantActionDraft"("organizationId");
ALTER TABLE "AssistantActionDraft" ADD CONSTRAINT "AssistantActionDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationPreference" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "NotificationPreference_organizationId_idx" ON "NotificationPreference"("organizationId");
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "NotificationEvent" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "NotificationEvent_organizationId_idx" ON "NotificationEvent"("organizationId");
ALTER TABLE "NotificationEvent" ADD CONSTRAINT "NotificationEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PolicyInsuredParty" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "PolicyInsuredParty_organizationId_idx" ON "PolicyInsuredParty"("organizationId");
ALTER TABLE "PolicyInsuredParty" ADD CONSTRAINT "PolicyInsuredParty_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PolicyInsuredAsset" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "PolicyInsuredAsset_organizationId_idx" ON "PolicyInsuredAsset"("organizationId");
ALTER TABLE "PolicyInsuredAsset" ADD CONSTRAINT "PolicyInsuredAsset_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TelegramLinkToken" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "TelegramLinkToken_organizationId_idx" ON "TelegramLinkToken"("organizationId");
ALTER TABLE "TelegramLinkToken" ADD CONSTRAINT "TelegramLinkToken_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerImportBatch" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "LedgerImportBatch_organizationId_idx" ON "LedgerImportBatch"("organizationId");
ALTER TABLE "LedgerImportBatch" ADD CONSTRAINT "LedgerImportBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerImportRow" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "LedgerImportRow_organizationId_idx" ON "LedgerImportRow"("organizationId");
ALTER TABLE "LedgerImportRow" ADD CONSTRAINT "LedgerImportRow_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerImportAction" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "LedgerImportAction_organizationId_idx" ON "LedgerImportAction"("organizationId");
ALTER TABLE "LedgerImportAction" ADD CONSTRAINT "LedgerImportAction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerImportIssue" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "LedgerImportIssue_organizationId_idx" ON "LedgerImportIssue"("organizationId");
ALTER TABLE "LedgerImportIssue" ADD CONSTRAINT "LedgerImportIssue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TelegramDraft" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "TelegramDraft_organizationId_idx" ON "TelegramDraft"("organizationId");
ALTER TABLE "TelegramDraft" ADD CONSTRAINT "TelegramDraft_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MaintenanceRun" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "MaintenanceRun_organizationId_idx" ON "MaintenanceRun"("organizationId");
ALTER TABLE "MaintenanceRun" ADD CONSTRAINT "MaintenanceRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReceiptReconciliationIssue" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "ReceiptReconciliationIssue_organizationId_idx" ON "ReceiptReconciliationIssue"("organizationId");
ALTER TABLE "ReceiptReconciliationIssue" ADD CONSTRAINT "ReceiptReconciliationIssue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PolicyRenewalSuggestion" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "PolicyRenewalSuggestion_organizationId_idx" ON "PolicyRenewalSuggestion"("organizationId");
ALTER TABLE "PolicyRenewalSuggestion" ADD CONSTRAINT "PolicyRenewalSuggestion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DataQualitySuppressionRule" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "DataQualitySuppressionRule_organizationId_idx" ON "DataQualitySuppressionRule"("organizationId");
ALTER TABLE "DataQualitySuppressionRule" ADD CONSTRAINT "DataQualitySuppressionRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssistantReport" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "AssistantReport_organizationId_idx" ON "AssistantReport"("organizationId");
ALTER TABLE "AssistantReport" ADD CONSTRAINT "AssistantReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssistantReportSignal" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "AssistantReportSignal_organizationId_idx" ON "AssistantReportSignal"("organizationId");
ALTER TABLE "AssistantReportSignal" ADD CONSTRAINT "AssistantReportSignal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssistantAiRun" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "AssistantAiRun_organizationId_idx" ON "AssistantAiRun"("organizationId");
ALTER TABLE "AssistantAiRun" ADD CONSTRAINT "AssistantAiRun_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AssistantAiAttempt" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "AssistantAiAttempt_organizationId_idx" ON "AssistantAiAttempt"("organizationId");
ALTER TABLE "AssistantAiAttempt" ADD CONSTRAINT "AssistantAiAttempt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Alert" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "Alert_organizationId_idx" ON "Alert"("organizationId");
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SecurityEventAggregate" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "SecurityEventAggregate_organizationId_idx" ON "SecurityEventAggregate"("organizationId");
ALTER TABLE "SecurityEventAggregate" ADD CONSTRAINT "SecurityEventAggregate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Organization_transition_singleton_idx" ON "Organization" ((1));
CREATE UNIQUE INDEX "OrganizationMembership_transition_owner_idx"
  ON "OrganizationMembership" ((1))
  WHERE "role" = 'OWNER';

COMMENT ON INDEX "Organization_transition_singleton_idx" IS
  'Cycle 1 temporary singleton barrier. Remove only with explicit tenant-aware rollout.';
COMMENT ON INDEX "OrganizationMembership_transition_owner_idx" IS
  'Cycle 1 temporary single Owner barrier. Remove with singleton transition guards.';

CREATE OR REPLACE FUNCTION policydesk_assign_singleton_organization()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  organization_count INTEGER;
  singleton_id TEXT;
BEGIN
  SELECT count(*), min("id") INTO organization_count, singleton_id FROM "Organization";

  IF organization_count = 0 THEN
    RAISE EXCEPTION 'POLICYDESK_ORGANIZATION_NOT_BOOTSTRAPPED'
      USING ERRCODE = 'P0001';
  ELSIF organization_count > 1 THEN
    RAISE EXCEPTION 'POLICYDESK_MULTIPLE_ORGANIZATIONS_NOT_SUPPORTED'
      USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD."organizationId" IS NOT NULL
     AND NEW."organizationId" IS DISTINCT FROM OLD."organizationId" THEN
    RAISE EXCEPTION 'POLICYDESK_ORGANIZATION_IMMUTABLE'
      USING ERRCODE = 'P0001';
  END IF;

  IF NEW."organizationId" IS NULL THEN
    NEW."organizationId" := singleton_id;
  ELSIF NEW."organizationId" IS DISTINCT FROM singleton_id THEN
    RAISE EXCEPTION 'POLICYDESK_ORGANIZATION_MISMATCH'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION policydesk_assign_singleton_organization() IS
  'Cycle 1 temporary singleton assignment barrier. Normal trigger only; remove after explicit tenant context rollout.';

CREATE OR REPLACE FUNCTION policydesk_guard_organization_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'POLICYDESK_BOOTSTRAP_ORGANIZATION_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' AND OLD."id" = 'org_legacy_singleton_0001' THEN
    RAISE EXCEPTION 'POLICYDESK_BOOTSTRAP_ORGANIZATION_IMMUTABLE'
      USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."id" = 'org_legacy_singleton_0001'
     AND NEW."id" IS DISTINCT FROM OLD."id" THEN
    RAISE EXCEPTION 'POLICYDESK_BOOTSTRAP_ORGANIZATION_IMMUTABLE'
      USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION policydesk_guard_organization_delete() IS
  'Cycle 1 temporary protection for the deterministic bootstrap organization.';

CREATE OR REPLACE FUNCTION policydesk_guard_singleton_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  member_user_role TEXT;
  organization_status TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."userId" = 'system-user-0000' THEN
      RAISE EXCEPTION 'POLICYDESK_SYSTEM_MEMBERSHIP_FORBIDDEN' USING ERRCODE = 'P0001';
    END IF;
    IF OLD."role" = 'OWNER' AND OLD."active" THEN
      RAISE EXCEPTION 'POLICYDESK_OWNER_IMMUTABLE' USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW."userId" = 'system-user-0000' THEN
    RAISE EXCEPTION 'POLICYDESK_SYSTEM_MEMBERSHIP_FORBIDDEN' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."organizationId" <> 'org_legacy_singleton_0001' THEN
    RAISE EXCEPTION 'POLICYDESK_ORGANIZATION_MISMATCH' USING ERRCODE = 'P0001';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."organizationId" IS DISTINCT FROM NEW."organizationId" THEN
    RAISE EXCEPTION 'POLICYDESK_ORGANIZATION_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;
  IF NEW."role" NOT IN ('OWNER','ADMIN','AGENT') THEN
    RAISE EXCEPTION 'POLICYDESK_MEMBERSHIP_ROLE_INVALID' USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."role" = 'OWNER' AND OLD."active"
     AND (NEW."role" <> 'OWNER' OR NOT NEW."active") THEN
    RAISE EXCEPTION 'POLICYDESK_OWNER_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;

  SELECT "role" INTO member_user_role FROM "User" WHERE "id" = NEW."userId";
  IF member_user_role IS NULL THEN
    RAISE EXCEPTION 'POLICYDESK_MEMBERSHIP_USER_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  SELECT "status" INTO organization_status FROM "Organization" WHERE "id" = NEW."organizationId";
  IF NEW."role" = 'OWNER' AND organization_status <> 'BOOTSTRAP'
     AND NOT (TG_OP = 'UPDATE' AND OLD."role" = 'OWNER') THEN
    RAISE EXCEPTION 'POLICYDESK_OWNER_ONLY_DURING_BOOTSTRAP' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION policydesk_guard_singleton_membership() IS
  'Cycle 1 temporary membership barrier: one singleton organization and one immutable active Owner.';

CREATE OR REPLACE FUNCTION policydesk_sync_user_membership()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  existing_role TEXT;
BEGIN
  IF NEW."id" = 'system-user-0000' THEN
    RETURN NEW;
  END IF;

  -- Global SUPERADMIN accounts are intentionally outside tenant memberships.
  -- This is still a Cycle 1 compatibility trigger and will be removed with
  -- the singleton barrier after explicit tenant context ships.
  IF NEW."platformRole" = 'SUPERADMIN' THEN
    RETURN NEW;
  END IF;

  IF NEW."role" NOT IN ('ADMIN','AGENT') THEN
    RAISE EXCEPTION 'POLICYDESK_LEGACY_USER_ROLE_UNSUPPORTED' USING ERRCODE = 'P0001';
  END IF;

  SELECT "role" INTO existing_role
  FROM "OrganizationMembership"
  WHERE "organizationId" = 'org_legacy_singleton_0001' AND "userId" = NEW."id";

  IF existing_role = 'OWNER' THEN
    IF NEW."role" <> 'ADMIN' OR NOT NEW."active" THEN
      RAISE EXCEPTION 'POLICYDESK_OWNER_IMMUTABLE' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  INSERT INTO "OrganizationMembership" ("id","organizationId","userId","role","active")
  VALUES (concat('om_', NEW."id"), 'org_legacy_singleton_0001', NEW."id",
          CASE WHEN NEW."role" = 'ADMIN' THEN 'ADMIN' ELSE 'AGENT' END, NEW."active")
  ON CONFLICT ("organizationId","userId") DO UPDATE
    SET "role" = EXCLUDED."role", "active" = EXCLUDED."active", "updatedAt" = CURRENT_TIMESTAMP;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION policydesk_sync_user_membership() IS
  'Cycle 1 temporary User to singleton membership synchronization; excludes the technical system user.';

CREATE OR REPLACE FUNCTION policydesk_guard_user_owner_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "OrganizationMembership"
    WHERE "userId" = OLD."id" AND "role" = 'OWNER' AND "active"
  ) THEN
    RAISE EXCEPTION 'POLICYDESK_OWNER_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$function$;

COMMENT ON FUNCTION policydesk_guard_user_owner_delete() IS
  'Cycle 1 temporary guard preventing deletion of the selected active Owner.';

CREATE TRIGGER "Organization_transition_delete_guard"
BEFORE DELETE OR UPDATE OF "id" ON "Organization"
FOR EACH ROW EXECUTE FUNCTION policydesk_guard_organization_delete();

CREATE TRIGGER "Organization_transition_truncate_guard"
BEFORE TRUNCATE ON "Organization"
FOR EACH STATEMENT EXECUTE FUNCTION policydesk_guard_organization_delete();

CREATE TRIGGER "OrganizationMembership_transition_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "OrganizationMembership"
FOR EACH ROW EXECUTE FUNCTION policydesk_guard_singleton_membership();

CREATE TRIGGER "User_transition_membership_sync"
AFTER INSERT OR UPDATE OF "role","active" ON "User"
FOR EACH ROW EXECUTE FUNCTION policydesk_sync_user_membership();

CREATE TRIGGER "User_transition_owner_delete_guard"
BEFORE DELETE ON "User"
FOR EACH ROW EXECUTE FUNCTION policydesk_guard_user_owner_delete();

CREATE TRIGGER "Client_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "Client"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

COMMENT ON TRIGGER "Client_transition_singleton_organization" ON "Client" IS
  'Cycle 1 temporary singleton organization assignment; normal trigger intentionally not ENABLE ALWAYS.';
CREATE TRIGGER "Insurer_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "Insurer"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

COMMENT ON TRIGGER "Insurer_transition_singleton_organization" ON "Insurer" IS
  'Cycle 1 temporary singleton organization assignment; normal trigger intentionally not ENABLE ALWAYS.';
CREATE TRIGGER "Policy_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "Policy"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

COMMENT ON TRIGGER "Policy_transition_singleton_organization" ON "Policy" IS
  'Cycle 1 temporary singleton organization assignment; normal trigger intentionally not ENABLE ALWAYS.';
CREATE TRIGGER "Receipt_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "Receipt"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

COMMENT ON TRIGGER "Receipt_transition_singleton_organization" ON "Receipt" IS
  'Cycle 1 temporary singleton organization assignment; normal trigger intentionally not ENABLE ALWAYS.';
CREATE TRIGGER "PolicyEndorsement_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "PolicyEndorsement"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

COMMENT ON TRIGGER "PolicyEndorsement_transition_singleton_organization" ON "PolicyEndorsement" IS
  'Cycle 1 temporary singleton organization assignment; normal trigger intentionally not ENABLE ALWAYS.';
CREATE TRIGGER "Payment_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "Payment"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

COMMENT ON TRIGGER "Payment_transition_singleton_organization" ON "Payment" IS
  'Cycle 1 temporary singleton organization assignment; normal trigger intentionally not ENABLE ALWAYS.';
CREATE TRIGGER "Commission_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "Commission"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

COMMENT ON TRIGGER "Commission_transition_singleton_organization" ON "Commission" IS
  'Cycle 1 temporary singleton organization assignment; normal trigger intentionally not ENABLE ALWAYS.';
CREATE TRIGGER "Task_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "Task"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

COMMENT ON TRIGGER "Task_transition_singleton_organization" ON "Task" IS
  'Cycle 1 temporary singleton organization assignment; normal trigger intentionally not ENABLE ALWAYS.';
CREATE TRIGGER "WorkItem_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "WorkItem"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

COMMENT ON TRIGGER "WorkItem_transition_singleton_organization" ON "WorkItem" IS
  'Cycle 1 temporary singleton organization assignment; normal trigger intentionally not ENABLE ALWAYS.';
CREATE TRIGGER "Claim_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "Claim"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

COMMENT ON TRIGGER "Claim_transition_singleton_organization" ON "Claim" IS
  'Cycle 1 temporary singleton organization assignment; normal trigger intentionally not ENABLE ALWAYS.';
CREATE TRIGGER "Quote_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "Quote"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

COMMENT ON TRIGGER "Quote_transition_singleton_organization" ON "Quote" IS
  'Cycle 1 temporary singleton organization assignment; normal trigger intentionally not ENABLE ALWAYS.';
CREATE TRIGGER "Document_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "Document"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

COMMENT ON TRIGGER "Document_transition_singleton_organization" ON "Document" IS
  'Cycle 1 temporary singleton organization assignment; normal trigger intentionally not ENABLE ALWAYS.';
CREATE TRIGGER "ActivityLog_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "ActivityLog"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

COMMENT ON TRIGGER "ActivityLog_transition_singleton_organization" ON "ActivityLog" IS
  'Cycle 1 temporary singleton organization assignment; normal trigger intentionally not ENABLE ALWAYS.';
CREATE TRIGGER "AssistantActionDraft_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "AssistantActionDraft"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

COMMENT ON TRIGGER "AssistantActionDraft_transition_singleton_organization" ON "AssistantActionDraft" IS
  'Cycle 1 temporary singleton organization assignment; normal trigger intentionally not ENABLE ALWAYS.';
CREATE TRIGGER "NotificationPreference_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "NotificationPreference"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

COMMENT ON TRIGGER "NotificationPreference_transition_singleton_organization" ON "NotificationPreference" IS
  'Cycle 1 temporary singleton organization assignment; normal trigger intentionally not ENABLE ALWAYS.';
CREATE TRIGGER "NotificationEvent_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "NotificationEvent"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

COMMENT ON TRIGGER "NotificationEvent_transition_singleton_organization" ON "NotificationEvent" IS
  'Cycle 1 temporary singleton organization assignment; normal trigger intentionally not ENABLE ALWAYS.';
CREATE TRIGGER "PolicyInsuredParty_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "PolicyInsuredParty"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

COMMENT ON TRIGGER "PolicyInsuredParty_transition_singleton_organization" ON "PolicyInsuredParty" IS
  'Cycle 1 temporary singleton organization assignment; normal trigger intentionally not ENABLE ALWAYS.';
CREATE TRIGGER "PolicyInsuredAsset_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "PolicyInsuredAsset"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

COMMENT ON TRIGGER "PolicyInsuredAsset_transition_singleton_organization" ON "PolicyInsuredAsset" IS
  'Cycle 1 temporary singleton organization assignment; normal trigger intentionally not ENABLE ALWAYS.';
CREATE TRIGGER "TelegramLinkToken_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "TelegramLinkToken"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

COMMENT ON TRIGGER "TelegramLinkToken_transition_singleton_organization" ON "TelegramLinkToken" IS
  'Cycle 1 temporary singleton organization assignment; normal trigger intentionally not ENABLE ALWAYS.';
CREATE TRIGGER "LedgerImportBatch_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "LedgerImportBatch"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

COMMENT ON TRIGGER "LedgerImportBatch_transition_singleton_organization" ON "LedgerImportBatch" IS
  'Cycle 1 temporary singleton organization assignment; normal trigger intentionally not ENABLE ALWAYS.';
CREATE TRIGGER "LedgerImportRow_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "LedgerImportRow"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

COMMENT ON TRIGGER "LedgerImportRow_transition_singleton_organization" ON "LedgerImportRow" IS
  'Cycle 1 temporary singleton organization assignment; normal trigger intentionally not ENABLE ALWAYS.';
CREATE TRIGGER "LedgerImportAction_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "LedgerImportAction"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

COMMENT ON TRIGGER "LedgerImportAction_transition_singleton_organization" ON "LedgerImportAction" IS
  'Cycle 1 temporary singleton organization assignment; normal trigger intentionally not ENABLE ALWAYS.';
CREATE TRIGGER "LedgerImportIssue_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "LedgerImportIssue"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

COMMENT ON TRIGGER "LedgerImportIssue_transition_singleton_organization" ON "LedgerImportIssue" IS
  'Cycle 1 temporary singleton organization assignment; normal trigger intentionally not ENABLE ALWAYS.';
CREATE TRIGGER "TelegramDraft_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "TelegramDraft"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

COMMENT ON TRIGGER "TelegramDraft_transition_singleton_organization" ON "TelegramDraft" IS
  'Cycle 1 temporary singleton organization assignment; normal trigger intentionally not ENABLE ALWAYS.';
CREATE TRIGGER "MaintenanceRun_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "MaintenanceRun"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

COMMENT ON TRIGGER "MaintenanceRun_transition_singleton_organization" ON "MaintenanceRun" IS
  'Cycle 1 temporary singleton organization assignment; normal trigger intentionally not ENABLE ALWAYS.';
CREATE TRIGGER "ReceiptReconciliationIssue_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "ReceiptReconciliationIssue"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

COMMENT ON TRIGGER "ReceiptReconciliationIssue_transition_singleton_organization" ON "ReceiptReconciliationIssue" IS
  'Cycle 1 temporary singleton organization assignment; normal trigger intentionally not ENABLE ALWAYS.';
CREATE TRIGGER "PolicyRenewalSuggestion_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "PolicyRenewalSuggestion"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

COMMENT ON TRIGGER "PolicyRenewalSuggestion_transition_singleton_organization" ON "PolicyRenewalSuggestion" IS
  'Cycle 1 temporary singleton organization assignment; normal trigger intentionally not ENABLE ALWAYS.';
CREATE TRIGGER "DataQualitySuppressionRule_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "DataQualitySuppressionRule"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

COMMENT ON TRIGGER "DataQualitySuppressionRule_transition_singleton_organization" ON "DataQualitySuppressionRule" IS
  'Cycle 1 temporary singleton organization assignment; normal trigger intentionally not ENABLE ALWAYS.';
CREATE TRIGGER "AssistantReport_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "AssistantReport"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

COMMENT ON TRIGGER "AssistantReport_transition_singleton_organization" ON "AssistantReport" IS
  'Cycle 1 temporary singleton organization assignment; normal trigger intentionally not ENABLE ALWAYS.';
CREATE TRIGGER "AssistantReportSignal_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "AssistantReportSignal"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

COMMENT ON TRIGGER "AssistantReportSignal_transition_singleton_organization" ON "AssistantReportSignal" IS
  'Cycle 1 temporary singleton organization assignment; normal trigger intentionally not ENABLE ALWAYS.';
CREATE TRIGGER "AssistantAiRun_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "AssistantAiRun"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

COMMENT ON TRIGGER "AssistantAiRun_transition_singleton_organization" ON "AssistantAiRun" IS
  'Cycle 1 temporary singleton organization assignment; normal trigger intentionally not ENABLE ALWAYS.';
CREATE TRIGGER "AssistantAiAttempt_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "AssistantAiAttempt"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

COMMENT ON TRIGGER "AssistantAiAttempt_transition_singleton_organization" ON "AssistantAiAttempt" IS
  'Cycle 1 temporary singleton organization assignment; normal trigger intentionally not ENABLE ALWAYS.';
CREATE TRIGGER "Alert_transition_singleton_organization"
BEFORE INSERT OR UPDATE OF "organizationId" ON "Alert"
FOR EACH ROW EXECUTE FUNCTION policydesk_assign_singleton_organization();

COMMENT ON TRIGGER "Alert_transition_singleton_organization" ON "Alert" IS
  'Cycle 1 temporary singleton organization assignment; normal trigger intentionally not ENABLE ALWAYS.';


COMMENT ON TRIGGER "Organization_transition_delete_guard" ON "Organization" IS
  'Cycle 1 temporary bootstrap deletion guard; remove only with tenant-aware organizations.';
COMMENT ON TRIGGER "Organization_transition_truncate_guard" ON "Organization" IS
  'Cycle 1 temporary bootstrap truncate guard; restore replica mode intentionally bypasses normal triggers.';
COMMENT ON TRIGGER "OrganizationMembership_transition_guard" ON "OrganizationMembership" IS
  'Cycle 1 temporary legacy membership guard; remove when membership is authoritative.';
COMMENT ON TRIGGER "User_transition_membership_sync" ON "User" IS
  'Cycle 1 temporary legacy User role/active synchronization; remove when membership is authoritative.';
COMMENT ON TRIGGER "User_transition_owner_delete_guard" ON "User" IS
  'Cycle 1 temporary protection for the selected active Owner.';
