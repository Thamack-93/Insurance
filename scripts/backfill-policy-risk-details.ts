import "dotenv/config";

import { randomUUID, createHash } from "node:crypto";
import { chmod, mkdir, open, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma } from "../src/generated/prisma/client.ts";
import { PrismaClient } from "../src/generated/prisma/client.ts";
import { assertDisposableCertificationTarget } from "./tenant-certification-target.mjs";
import {
  assertReviewedPolicyRiskBackfillManifest,
  POLICY_RISK_BACKFILL_MANIFEST_VERSION,
  POLICY_RISK_BACKFILL_PROCESSOR_VERSION,
  policyRiskBackfillInputHash,
  policyRiskBackfillManifestContentHash,
  policyRiskBackfillReviewedHash,
  type PolicyRiskBackfillManifest,
  type PolicyRiskBackfillManifestRow,
} from "../src/lib/policy-risk-backfill-manifest.ts";
import { convertLegacyPolicyDescription, hasPolicyRiskData, projectPolicyRiskRelations, riskDetailsFromExisting, summarizePolicyRiskDetails } from "../src/lib/policy-risk-details.ts";
import { assertPolicyRiskInventoryOutcomeRun, parseVerifiedPolicyRiskInventoryOutcomeReport, reconcilePolicyRiskInventory, type PolicyRiskInventoryInput, type PolicyRiskInventoryOutcomeReport } from "../src/lib/policy-risk-inventory-reconciliation.ts";

const PAGE_SIZE = 200;
const INVENTORY_PAGE_SIZE = 50;
const MAX_BATCH_SIZE = 500;
const MAX_PRODUCTION_BATCH_SIZE = 50;
const APPLY_CONFIRMATION = "APPLY_POLICY_RISK_BACKFILL";
const PRODUCTION_APPLY_CONFIRMATION = "APPLY_POLICY_RISK_BACKFILL_TO_PRODUCTION";
const PRODUCTION_APPLY_ROLE = "policydesk_backfill";
const TEST_READONLY_ROLE_PATTERN = /^policydesk_readonly_test_[a-f0-9]{8}$/;
const TEST_WRITER_ROLE_PATTERN = /^policydesk_backfill_test_[a-f0-9]{8}$/;

function arg(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function selectedPolicyNumbers() {
  const value = arg("policy-numbers");
  if (value === null) return null;
  const raw = value.split(",");
  const policyNumbers = raw.map((item) => item.trim()).filter(Boolean);
  if (!policyNumbers.length || policyNumbers.length !== raw.length || new Set(policyNumbers).size !== policyNumbers.length || policyNumbers.length > MAX_PRODUCTION_BATCH_SIZE) {
    throw new Error("POLICY_RISK_BACKFILL_POLICY_NUMBER_SCOPE_INVALID");
  }
  return policyNumbers;
}

function candidateSha() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    throw new Error("POLICY_RISK_BACKFILL_GIT_SHA_REQUIRED");
  }
}

async function processorSha256() {
  const digest = createHash("sha256");
  for (const file of ["scripts/backfill-policy-risk-details.ts", "src/lib/policy-risk-details.ts", "src/lib/policy-risk-backfill-manifest.ts", "src/lib/policy-risk-inventory-reconciliation.ts"]) {
    digest.update(file).update("\0").update(await readFile(path.resolve(file)));
  }
  return digest.digest("hex");
}

function planPolicy(policy: {
  id: string;
  policyNumber: string;
  policyType: string;
  insuredObject: string | null;
  beneficiaryInfo: string | null;
  insuredAssets: Array<{ description: string; serialNumber: string | null; isPrimary: boolean }>;
  insuredParties: Array<{ fullName: string; isPrimary: boolean; sourceLabel: string | null }>;
}): PolicyRiskBackfillManifestRow {
  const sourceDescription = policy.insuredObject?.trim() || policy.insuredAssets.map((asset) => asset.description.trim()).filter(Boolean).join("; ") || null;
  const result = convertLegacyPolicyDescription(policy.policyType, sourceDescription, policy.insuredAssets[0]?.serialNumber ?? null, policy.insuredAssets.map((asset) => asset.serialNumber));
  const relationBasedRisk = !result.riskDetails && ["GMM", "VIDA", "ACCIDENTES", "FIANZAS"].includes(policy.policyType) && (policy.insuredParties.length > 0 || (["VIDA", "FIANZAS"].includes(policy.policyType) && Boolean(policy.beneficiaryInfo?.trim())))
    ? riskDetailsFromExisting(policy.policyType, null, null, [], policy.insuredParties, policy.beneficiaryInfo)
    : null;
  const riskDetails = result.riskDetails
    ? riskDetailsFromExisting(policy.policyType, result.riskDetails, sourceDescription, policy.insuredAssets, policy.insuredParties, policy.beneficiaryInfo) ?? result.riskDetails
    : relationBasedRisk;
  const hasStructuredData = hasPolicyRiskData(riskDetails);
  const classification = result.status === "REVIEW" ? "REVIEW" : hasStructuredData ? "CONVERTED" : "EMPTY";
  const proposedRelations = projectPolicyRiskRelations(riskDetails);
  const source = {
    insuredObject: policy.insuredObject,
    beneficiaryInfo: policy.beneficiaryInfo,
    assets: policy.insuredAssets,
    insuredParties: policy.insuredParties,
  };
  return {
    policyId: policy.id,
    policyNumber: policy.policyNumber,
    policyType: policy.policyType,
    inputHash: policyRiskBackfillInputHash({ policyId: policy.id, policyNumber: policy.policyNumber, policyType: policy.policyType, ...source }),
    classification,
    reason: result.reason,
    source,
    proposed: {
      riskDetails,
      insuredObject: summarizePolicyRiskDetails(riskDetails),
      assets: proposedRelations.assets,
      insuredParties: proposedRelations.insuredParties,
    },
    decision: null,
  };
}

async function scanAll(prisma: Pick<PrismaClient, "policy">, organizationId: string, policyNumbers: string[] | null = null) {
  const candidates: PolicyRiskBackfillManifestRow[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await prisma.policy.findMany({
      where: { organizationId, riskDetails: { equals: Prisma.DbNull }, ...(policyNumbers ? { policyNumber: { in: policyNumbers } } : {}), ...(cursor ? { id: { gt: cursor } } : {}) },
      select: {
        id: true,
        policyNumber: true,
        policyType: true,
        insuredObject: true,
        beneficiaryInfo: true,
        insuredAssets: { select: { description: true, serialNumber: true, isPrimary: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
        insuredParties: { select: { fullName: true, isPrimary: true, sourceLabel: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
    });
    if (!page.length) break;
    candidates.push(...page.map(planPolicy));
    cursor = page[page.length - 1].id;
    if (page.length < PAGE_SIZE) break;
  }
  return candidates;
}

async function assertProductionPreviewRole(tx: Prisma.TransactionClient, connectionString: string) {
  const url = new URL(connectionString);
  const expectedRole = process.env.POLICY_RISK_BACKFILL_READONLY_ROLE?.trim();
  const expectedDatabase = process.env.POLICY_RISK_BACKFILL_PRODUCTION_DATABASE?.trim();
  const expectedHost = process.env.POLICY_RISK_BACKFILL_PRODUCTION_HOST?.trim().toLowerCase();
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new Error("POLICY_RISK_BACKFILL_PREVIEW_REQUIRES_POSTGRES");
  const allowedReadonlyRole = process.env.NODE_ENV === "test"
    ? Boolean(expectedRole && TEST_READONLY_ROLE_PATTERN.test(expectedRole))
    : expectedRole === "policydesk_readonly";
  if (!expectedRole || !allowedReadonlyRole || decodeURIComponent(url.username) !== expectedRole) {
    throw new Error("POLICY_RISK_BACKFILL_PREVIEW_REQUIRES_CANONICAL_READONLY_ROLE");
  }
  if (!expectedDatabase || decodeURIComponent(url.pathname.replace(/^\//, "").split("?")[0]) !== expectedDatabase || !expectedHost || url.hostname.toLowerCase() !== expectedHost) {
    throw new Error("POLICY_RISK_BACKFILL_PREVIEW_TARGET_MISMATCH");
  }
  if (process.env.VERCEL === "1" || process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview") {
    throw new Error("POLICY_RISK_BACKFILL_PREVIEW_REFUSES_VERCEL_ENVIRONMENT");
  }

  const session = await tx.$queryRaw<Array<{ currentRole: string; currentDatabase: string; transactionReadOnly: string; superuser: boolean; bypassRls: boolean; canLogin: boolean; inherits: boolean }>>(Prisma.sql`
    SELECT current_user AS "currentRole",
      current_database() AS "currentDatabase",
      current_setting('transaction_read_only') AS "transactionReadOnly",
      role.rolsuper AS "superuser",
      role.rolbypassrls AS "bypassRls",
      role.rolcanlogin AS "canLogin",
      role.rolinherit AS "inherits"
    FROM pg_roles role WHERE role.rolname = current_user
  `);
  const identity = session[0];
  if (!identity || identity.currentRole !== expectedRole || identity.currentDatabase !== expectedDatabase || identity.transactionReadOnly !== "on" || identity.superuser || identity.bypassRls || !identity.canLogin || identity.inherits) {
    throw new Error("POLICY_RISK_BACKFILL_PREVIEW_SESSION_NOT_READONLY");
  }
  const writePrivileges = await tx.$queryRaw<Array<{ tableName: string; privilege: string }>>(Prisma.sql`
    SELECT c.relname AS "tableName", privilege.privilege AS "privilege"
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS privilege(privilege)
    WHERE n.nspname = 'public'
      AND c.relname IN ('Organization', 'Policy', 'Client', 'PolicyInsuredAsset', 'PolicyInsuredParty', 'MaintenanceRun')
      AND (
        has_table_privilege(current_user, c.oid, privilege.privilege)
        OR CASE
          WHEN privilege.privilege IN ('INSERT', 'UPDATE', 'REFERENCES')
            THEN has_any_column_privilege(current_user, c.oid, privilege.privilege)
          ELSE false
        END
      )
  `);
  if (writePrivileges.length) throw new Error("POLICY_RISK_BACKFILL_PREVIEW_ROLE_HAS_WRITE_PRIVILEGES");
  const maintenanceRunReadPrivileges = await tx.$queryRaw<Array<{ columnName: string }>>(Prisma.sql`
    SELECT required.column_name AS "columnName"
    FROM (VALUES ('id'), ('organizationId'), ('type'), ('status'), ('summaryJson')) AS required(column_name)
    LEFT JOIN pg_class relation ON relation.relname = 'MaintenanceRun'
      AND relation.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
    LEFT JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    LEFT JOIN pg_attribute attribute ON attribute.attrelid = relation.oid AND attribute.attname::text = required.column_name AND attribute.attnum > 0 AND NOT attribute.attisdropped
    WHERE namespace.oid IS NULL OR attribute.attnum IS NULL OR NOT has_column_privilege(current_user, relation.oid, attribute.attnum, 'SELECT')
  `);
  if (maintenanceRunReadPrivileges.length) throw new Error("POLICY_RISK_BACKFILL_PREVIEW_ROLE_MISSING_MAINTENANCE_RUN_READ_PRIVILEGES");
}

async function scanProductionReadOnly(prisma: PrismaClient, organizationId: string, connectionString: string, policyNumbers: string[] | null) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    await assertProductionPreviewRole(tx, connectionString);
    const tenantContext = await tx.$queryRaw<Array<{ organizationId: string }>>(Prisma.sql`
      SELECT set_config('app.organization_id', ${organizationId}, true) AS "organizationId"
    `);
    if (tenantContext[0]?.organizationId !== organizationId) throw new Error("POLICY_RISK_BACKFILL_PREVIEW_TENANT_CONTEXT_FAILED");
    const organization = await tx.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
    if (!organization) throw new Error("POLICY_RISK_BACKFILL_PREVIEW_ORGANIZATION_NOT_VISIBLE");
    return scanAll(tx, organizationId, policyNumbers);
  });
}

async function scanPolicyInventory(tx: Prisma.TransactionClient, organizationId: string) {
  const policies: PolicyRiskInventoryInput[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await tx.policy.findMany({
      where: { organizationId, ...(cursor ? { id: { gt: cursor } } : {}) },
      select: {
        id: true,
        policyNumber: true,
        policyType: true,
        status: true,
        riskDetails: true,
        riskDetailsReviewRequired: true,
        insuredObject: true,
        beneficiaryInfo: true,
        client: { select: { portfolioOwnerId: true } },
        insuredAssets: { select: { description: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
        insuredParties: { select: { fullName: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      },
      orderBy: { id: "asc" },
      take: INVENTORY_PAGE_SIZE,
    });
    if (!page.length) break;
    policies.push(...page.map((policy) => ({
      policyId: policy.id,
      policyNumber: policy.policyNumber,
      policyType: policy.policyType,
      status: policy.status,
      portfolioOwnerId: policy.client.portfolioOwnerId,
      riskDetails: policy.riskDetails,
      riskDetailsReviewRequired: policy.riskDetailsReviewRequired,
      insuredObject: policy.insuredObject,
      beneficiaryInfo: policy.beneficiaryInfo,
      assets: policy.insuredAssets,
      insuredParties: policy.insuredParties,
    })));
    cursor = page[page.length - 1].id;
    if (page.length < INVENTORY_PAGE_SIZE) break;
  }
  return policies;
}

async function scanProductionInventoryReadOnly(prisma: PrismaClient, organizationId: string, connectionString: string, outcomeReport: PolicyRiskInventoryOutcomeReport | undefined, expectedCandidateSha: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    await assertProductionPreviewRole(tx, connectionString);
    const tenantContext = await tx.$queryRaw<Array<{ organizationId: string }>>(Prisma.sql`
      SELECT set_config('app.organization_id', ${organizationId}, true) AS "organizationId"
    `);
    if (tenantContext[0]?.organizationId !== organizationId) throw new Error("POLICY_RISK_INVENTORY_TENANT_CONTEXT_FAILED");
    const organization = await tx.organization.findUnique({ where: { id: organizationId }, select: { id: true } });
    if (!organization) throw new Error("POLICY_RISK_INVENTORY_ORGANIZATION_NOT_VISIBLE");
    if (outcomeReport) {
      const maintenanceRun = await tx.maintenanceRun.findFirst({
        where: { id: outcomeReport.maintenanceRunId, organizationId, type: "POLICY_RISK_BACKFILL" },
        select: { id: true, organizationId: true, type: true, status: true, summaryJson: true },
      });
      assertPolicyRiskInventoryOutcomeRun({ report: outcomeReport, run: maintenanceRun, organizationId, expectedCandidateSha });
    }
    const [policies, databasePolicyCount] = await Promise.all([
      scanPolicyInventory(tx, organizationId),
      tx.policy.count({ where: { organizationId } }),
    ]);
    if (policies.length !== databasePolicyCount) throw new Error("POLICY_RISK_INVENTORY_DATABASE_COUNT_MISMATCH");
    return policies;
  }, { maxWait: 10_000, timeout: 120_000 });
}

const PRODUCTION_APPLY_COLUMN_PRIVILEGES = new Map<string, Map<string, Set<string>>>([
  ["Organization", new Map([
    ["SELECT", new Set(["id", "status"])],
    ["UPDATE", new Set(["updatedAt"])],
  ])],
  ["OrganizationMembership", new Map([
    ["SELECT", new Set(["id", "organizationId", "userId", "role", "active"])],
    ["UPDATE", new Set(["updatedAt"])],
  ])],
  ["User", new Map([
    ["SELECT", new Set(["id", "email", "active"])],
    ["UPDATE", new Set(["updatedAt"])],
  ])],
  ["Policy", new Map([
    ["SELECT", new Set(["id", "organizationId", "policyNumber", "policyType", "insuredObject", "beneficiaryInfo", "riskDetails"])],
    ["UPDATE", new Set(["riskDetails", "insuredObject", "riskDetailsReviewRequired", "updatedAt"])],
  ])],
  ["PolicyInsuredAsset", new Map([
    ["SELECT", new Set(["id", "organizationId", "policyId", "assetType", "description", "serialNumber", "isPrimary", "createdAt", "updatedAt"])],
    ["INSERT", new Set(["id", "organizationId", "policyId", "assetType", "description", "serialNumber", "isPrimary", "createdAt", "updatedAt"])],
    ["UPDATE", new Set(["updatedAt"])],
  ])],
  ["PolicyInsuredParty", new Map([
    ["SELECT", new Set(["id", "organizationId", "policyId", "fullName", "isPrimary", "sourceLabel", "createdAt", "updatedAt"])],
    ["INSERT", new Set(["id", "organizationId", "policyId", "fullName", "isPrimary", "sourceLabel", "createdAt", "updatedAt"])],
    ["UPDATE", new Set(["updatedAt"])],
  ])],
  ["MaintenanceRun", new Map([
    ["SELECT", new Set(["id", "organizationId"])],
    ["INSERT", new Set(["id", "organizationId", "type", "status", "summaryJson", "createdAt", "startedAt", "updatedAt"])],
    ["UPDATE", new Set(["status", "completedAt", "summaryJson", "updatedAt"])],
  ])],
]);

type ProductionApplyTarget = {
  prisma: PrismaClient;
  host: string;
  database: string;
  role: string;
};

function createProductionApplyTarget(connectionString: string): ProductionApplyTarget {
  const url = new URL(connectionString);
  const expectedRole = process.env.POLICY_RISK_BACKFILL_PRODUCTION_APPLY_ROLE?.trim();
  const expectedDatabase = process.env.POLICY_RISK_BACKFILL_PRODUCTION_DATABASE?.trim();
  const expectedHost = process.env.POLICY_RISK_BACKFILL_PRODUCTION_HOST?.trim().toLowerCase();
  const actualRole = decodeURIComponent(url.username);
  const actualDatabase = decodeURIComponent(url.pathname.replace(/^\//, "").split("?")[0]);
  const actualHost = url.hostname.toLowerCase();
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") throw new Error("POLICY_RISK_BACKFILL_PRODUCTION_APPLY_REQUIRES_POSTGRES");
  const allowedWriterRole = process.env.NODE_ENV === "test"
    ? Boolean(expectedRole && TEST_WRITER_ROLE_PATTERN.test(expectedRole))
    : expectedRole === PRODUCTION_APPLY_ROLE;
  if (!expectedRole || !allowedWriterRole || actualRole !== expectedRole) {
    throw new Error("POLICY_RISK_BACKFILL_PRODUCTION_APPLY_REQUIRES_CANONICAL_WRITER_ROLE");
  }
  if (!expectedDatabase || actualDatabase !== expectedDatabase) throw new Error("POLICY_RISK_BACKFILL_PRODUCTION_DATABASE_MISMATCH");
  if (!expectedHost || actualHost !== expectedHost) throw new Error("POLICY_RISK_BACKFILL_PRODUCTION_HOST_MISMATCH");
  if (process.env.VERCEL === "1" || process.env.VERCEL_ENV === "production" || process.env.VERCEL_ENV === "preview") {
    throw new Error("POLICY_RISK_BACKFILL_PRODUCTION_APPLY_REFUSES_VERCEL_ENVIRONMENT");
  }

  if (process.env.NODE_ENV === "test") {
    assertDisposableCertificationTarget(connectionString, process.env, "source");
  } else if (!url.hostname.toLowerCase().endsWith(".neon.tech")) {
    throw new Error("POLICY_RISK_BACKFILL_PRODUCTION_APPLY_REQUIRES_NEON_HOST");
  }
  if (process.env.NODE_ENV !== "test" && process.env.NODE_ENV !== "production") {
    throw new Error("POLICY_RISK_BACKFILL_PRODUCTION_APPLY_REQUIRES_EXPLICIT_NONDEVELOPMENT_MODE");
  }
  const sslmode = url.searchParams.get("sslmode")?.toLowerCase();
  if (process.env.NODE_ENV !== "test" && sslmode !== "verify-full") {
    throw new Error("POLICY_RISK_BACKFILL_PRODUCTION_APPLY_REQUIRES_TLS_VERIFY_FULL");
  }
  if (["host", "hostaddr", "service", "options"].some((parameter) => url.searchParams.has(parameter))) {
    throw new Error("POLICY_RISK_BACKFILL_PRODUCTION_APPLY_UNSUPPORTED_CONNECTION_OVERRIDE");
  }
  return {
    prisma: new PrismaClient({ adapter: new PrismaPg({ connectionString }) }),
    host: actualHost,
    database: actualDatabase,
    role: expectedRole,
  };
}

function stripRedundantOuterParentheses(expression: string) {
  let normalized = expression.trim();
  while (normalized.startsWith("(") && normalized.endsWith(")")) {
    let depth = 0;
    let singleQuoted = false;
    let doubleQuoted = false;
    let enclosesWholeExpression = true;
    for (let index = 0; index < normalized.length; index += 1) {
      const character = normalized[index];
      if (character === "'" && !doubleQuoted) {
        if (singleQuoted && normalized[index + 1] === "'") {
          index += 1;
          continue;
        }
        singleQuoted = !singleQuoted;
      } else if (character === '\"' && !singleQuoted) {
        if (doubleQuoted && normalized[index + 1] === '\"') {
          index += 1;
          continue;
        }
        doubleQuoted = !doubleQuoted;
      } else if (!singleQuoted && !doubleQuoted && character === "(") {
        depth += 1;
      } else if (!singleQuoted && !doubleQuoted && character === ")") {
        depth -= 1;
        if (depth === 0 && index < normalized.length - 1) {
          enclosesWholeExpression = false;
          break;
        }
      }
    }
    if (!enclosesWholeExpression || depth !== 0 || singleQuoted || doubleQuoted) break;
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized;
}

function normalizeTenantPolicyExpression(expression: string | null) {
  const source = stripRedundantOuterParentheses(expression ?? "")
    .replace(/'app\.organization_id'::text/gi, "'app.organization_id'")
    .replace(/''::text/gi, "''");
  let normalized = "";
  let singleQuoted = false;
  let doubleQuoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "'" && !doubleQuoted) {
      normalized += character;
      if (singleQuoted && source[index + 1] === "'") {
        normalized += source[index + 1];
        index += 1;
      } else {
        singleQuoted = !singleQuoted;
      }
      continue;
    }
    if (character === '\"' && !singleQuoted) {
      normalized += character;
      if (doubleQuoted && source[index + 1] === '\"') {
        normalized += source[index + 1];
        index += 1;
      } else {
        doubleQuoted = !doubleQuoted;
      }
      continue;
    }
    if (!singleQuoted && !doubleQuoted && /\s/.test(character)) continue;
    normalized += !singleQuoted && !doubleQuoted ? character.toLowerCase() : character;
  }
  return normalized;
}

const EXPECTED_TENANT_POLICY = '"organizationId" = nullif(current_setting(\'app.organization_id\', true), \'\')';
const NORMALIZED_EXPECTED_TENANT_POLICY = normalizeTenantPolicyExpression(EXPECTED_TENANT_POLICY);

async function assertProductionApplyRole(tx: Prisma.TransactionClient, target: ProductionApplyTarget) {
  const identityRows = await tx.$queryRaw<Array<{
    currentRole: string;
    currentDatabase: string;
    transactionReadOnly: string;
    rowSecurity: string;
    superuser: boolean;
    bypassRls: boolean;
    canLogin: boolean;
    inherits: boolean;
    createDatabase: boolean;
    createRole: boolean;
    replication: boolean;
  }>>(Prisma.sql`
      SELECT current_user AS "currentRole",
      current_database() AS "currentDatabase",
      current_setting('transaction_read_only') AS "transactionReadOnly",
      current_setting('row_security') AS "rowSecurity",
      role.rolsuper AS "superuser",
      role.rolbypassrls AS "bypassRls",
      role.rolcanlogin AS "canLogin",
      role.rolinherit AS "inherits",
      role.rolcreatedb AS "createDatabase",
      role.rolcreaterole AS "createRole",
      role.rolreplication AS "replication"
    FROM pg_roles role WHERE role.rolname = current_user
  `);
  const identity = identityRows[0];
  if (!identity || identity.currentRole !== target.role || identity.currentDatabase !== target.database || identity.transactionReadOnly !== "off" || identity.rowSecurity !== "on" || identity.superuser || identity.bypassRls || !identity.canLogin || identity.inherits || identity.createDatabase || identity.createRole || identity.replication) {
    throw new Error("POLICY_RISK_BACKFILL_PRODUCTION_APPLY_ROLE_NOT_RESTRICTED");
  }

  const memberships = await tx.$queryRaw<Array<{ roleName: string }>>(Prisma.sql`
    SELECT parent.rolname AS "roleName"
    FROM pg_auth_members membership
    JOIN pg_roles parent ON parent.oid = membership.roleid
    JOIN pg_roles member ON member.oid = membership.member
    WHERE member.rolname = current_user
  `);
  if (memberships.length) throw new Error("POLICY_RISK_BACKFILL_PRODUCTION_APPLY_ROLE_HAS_MEMBERSHIPS");

  const ownership = await tx.$queryRaw<Array<{ objectType: string; objectName: string }>>(Prisma.sql`
    SELECT 'DATABASE' AS "objectType", current_database() AS "objectName"
    WHERE has_database_privilege(current_user, current_database(), 'CREATE')
      OR pg_catalog.pg_get_userbyid((SELECT datdba FROM pg_database WHERE datname = current_database())) = current_user
    UNION ALL
    SELECT 'SCHEMA', namespace.nspname
    FROM pg_namespace namespace
    WHERE namespace.nspname = 'public'
      AND pg_catalog.pg_get_userbyid(namespace.nspowner) = current_user
    UNION ALL
    SELECT 'TABLE', relation.relname
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = ANY(ARRAY['Organization', 'OrganizationMembership', 'User', 'Policy', 'PolicyInsuredAsset', 'PolicyInsuredParty', 'MaintenanceRun'])
      AND pg_catalog.pg_get_userbyid(relation.relowner) = current_user
  `);
  if (ownership.length) throw new Error("POLICY_RISK_BACKFILL_PRODUCTION_APPLY_ROLE_OWNS_PROTECTED_OBJECTS");

  const columns = await tx.$queryRaw<Array<{ tableName: string; columnName: string; privilege: string }>>(Prisma.sql`
    SELECT relation.relname AS "tableName", attribute.attname AS "columnName", requested.privilege AS "privilege"
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_attribute attribute ON attribute.attrelid = relation.oid AND attribute.attnum > 0 AND NOT attribute.attisdropped
    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')) AS requested(privilege)
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND has_column_privilege(current_user, relation.oid, attribute.attnum, requested.privilege)
  `);
  for (const column of columns) {
    if (!PRODUCTION_APPLY_COLUMN_PRIVILEGES.get(column.tableName)?.get(column.privilege)?.has(column.columnName)) {
      throw new Error("POLICY_RISK_BACKFILL_PRODUCTION_APPLY_ROLE_HAS_EXCESS_COLUMN_PRIVILEGES");
    }
  }
  for (const [tableName, privileges] of PRODUCTION_APPLY_COLUMN_PRIVILEGES) {
    for (const [privilege, requiredColumns] of privileges) {
      for (const columnName of requiredColumns) {
        if (!columns.some((column) => column.tableName === tableName && column.columnName === columnName && column.privilege === privilege)) {
          throw new Error("POLICY_RISK_BACKFILL_PRODUCTION_APPLY_ROLE_MISSING_REQUIRED_PRIVILEGES");
        }
      }
    }
  }

  const excessTablePrivileges = await tx.$queryRaw<Array<{ tableName: string; privilege: string }>>(Prisma.sql`
    SELECT relation.relname AS "tableName", requested.privilege AS "privilege"
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) AS requested(privilege)
    WHERE namespace.nspname = 'public'
      AND relation.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND has_table_privilege(current_user, relation.oid, requested.privilege)
  `);
  if (excessTablePrivileges.length) throw new Error("POLICY_RISK_BACKFILL_PRODUCTION_APPLY_ROLE_HAS_TABLE_LEVEL_PRIVILEGES");

  const sequencePrivileges = await tx.$queryRaw<Array<{ sequenceName: string; privilege: string }>>(Prisma.sql`
    SELECT sequence.relname AS "sequenceName", requested.privilege AS "privilege"
    FROM pg_class sequence
    JOIN pg_namespace namespace ON namespace.oid = sequence.relnamespace
    CROSS JOIN (VALUES ('USAGE'), ('SELECT'), ('UPDATE')) AS requested(privilege)
    WHERE namespace.nspname = 'public' AND sequence.relkind = 'S'
      AND has_sequence_privilege(current_user, sequence.oid, requested.privilege)
  `);
  if (sequencePrivileges.length) throw new Error("POLICY_RISK_BACKFILL_PRODUCTION_APPLY_ROLE_HAS_SEQUENCE_PRIVILEGES");

  const unsafeSchemas = await tx.$queryRaw<Array<{ schemaName: string }>>(Prisma.sql`
    SELECT namespace.nspname AS "schemaName"
    FROM pg_namespace namespace
    WHERE namespace.nspname NOT LIKE 'pg_%'
      AND namespace.nspname <> 'information_schema'
      AND has_schema_privilege(current_user, namespace.oid, 'CREATE')
  `);
  if (unsafeSchemas.length) throw new Error("POLICY_RISK_BACKFILL_PRODUCTION_APPLY_ROLE_HAS_SCHEMA_CREATE");

  const rlsRows = await tx.$queryRaw<Array<{ tableName: string; enabled: boolean; forced: boolean }>>(Prisma.sql`
    SELECT relation.relname AS "tableName", relation.relrowsecurity AS "enabled", relation.relforcerowsecurity AS "forced"
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname IN ('Policy', 'PolicyInsuredAsset', 'PolicyInsuredParty', 'MaintenanceRun')
  `);
  if (rlsRows.length !== 4 || rlsRows.some((row) => !row.enabled || !row.forced)) {
    throw new Error("POLICY_RISK_BACKFILL_PRODUCTION_APPLY_RLS_NOT_FORCED");
  }

  const policyRows = await tx.$queryRaw<Array<{ tableName: string; policyName: string; command: string; permissive: boolean; roles: string; usingExpression: string | null; checkExpression: string | null }>>(Prisma.sql`
    SELECT relation.relname AS "tableName", policy.polname AS "policyName", policy.polcmd::text AS "command",
      policy.polpermissive AS "permissive", policy.polroles::text AS "roles",
      pg_get_expr(policy.polqual, policy.polrelid) AS "usingExpression",
      pg_get_expr(policy.polwithcheck, policy.polrelid) AS "checkExpression"
    FROM pg_policy policy
    JOIN pg_class relation ON relation.oid = policy.polrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public' AND relation.relname IN ('Policy', 'PolicyInsuredAsset', 'PolicyInsuredParty', 'MaintenanceRun')
  `);
  const policyMismatch = policyRows.length !== 4 || policyRows.some((policy) =>
    policy.policyName !== "policydesk_tenant_context" || policy.command !== "*" || !policy.permissive || policy.roles !== "{0}" ||
    normalizeTenantPolicyExpression(policy.usingExpression) !== NORMALIZED_EXPECTED_TENANT_POLICY ||
    normalizeTenantPolicyExpression(policy.checkExpression) !== NORMALIZED_EXPECTED_TENANT_POLICY
  );
  if (policyMismatch) {
    if (process.env.NODE_ENV === "test") {
      const diagnostics = policyRows.map((policy) => ({
        tableName: policy.tableName,
        policyName: policy.policyName,
        command: policy.command,
        permissive: policy.permissive,
        roles: policy.roles,
        usingExpression: normalizeTenantPolicyExpression(policy.usingExpression),
        checkExpression: normalizeTenantPolicyExpression(policy.checkExpression),
      }));
      throw new Error(`POLICY_RISK_BACKFILL_PRODUCTION_APPLY_TENANT_POLICY_MISMATCH:${JSON.stringify({ count: policyRows.length, diagnostics })}`);
    }
    throw new Error("POLICY_RISK_BACKFILL_PRODUCTION_APPLY_TENANT_POLICY_MISMATCH");
  }
}

async function withProductionApplyTransaction<T>(
  target: ProductionApplyTarget,
  organizationId: string,
  reviewer: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return target.prisma.$transaction(async (tx) => {
    const tenantContext = await tx.$queryRaw<Array<{ organizationId: string }>>(Prisma.sql`
      SELECT set_config('app.organization_id', ${organizationId}, true) AS "organizationId"
    `);
    if (tenantContext[0]?.organizationId !== organizationId) throw new Error("POLICY_RISK_BACKFILL_PRODUCTION_APPLY_TENANT_CONTEXT_FAILED");
    await assertProductionApplyRole(tx, target);
    const authorization = await tx.$queryRaw<Array<{ organizationId: string }>>(Prisma.sql`
      SELECT organization.id AS "organizationId"
      FROM "Organization" organization
      JOIN "OrganizationMembership" membership ON membership."organizationId" = organization.id
      JOIN "User" actor ON actor.id = membership."userId"
      WHERE organization.id = ${organizationId}
        AND organization.status = 'ACTIVE'
        AND membership.active
        AND membership.role IN ('OWNER', 'ADMIN')
        AND actor.active
        AND lower(actor.email) = lower(${reviewer})
      FOR UPDATE OF organization, membership, actor
    `);
    if (authorization[0]?.organizationId !== organizationId) {
      throw new Error("POLICY_RISK_BACKFILL_PRODUCTION_APPLY_REVIEWER_NOT_ACTIVE_ORGANIZATION_ADMIN");
    }
    return work(tx);
  }, { maxWait: 10_000, timeout: 30_000 });
}

async function withDisposableApplyTransaction<T>(
  prisma: PrismaClient,
  organizationId: string,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return prisma.$transaction(async (tx) => {
    const tenantContext = await tx.$queryRaw<Array<{ organizationId: string }>>(Prisma.sql`
      SELECT set_config('app.organization_id', ${organizationId}, true) AS "organizationId"
    `);
    if (tenantContext[0]?.organizationId !== organizationId) {
      throw new Error("POLICY_RISK_BACKFILL_DISPOSABLE_APPLY_TENANT_CONTEXT_FAILED");
    }
    return work(tx);
  });
}

async function writePrivateManifest(file: string, manifest: unknown) {
  const resolved = path.resolve(file);
  if (!path.isAbsolute(file)) throw new Error("POLICY_RISK_BACKFILL_REPORT_PATH_MUST_BE_ABSOLUTE");
  if (!path.relative(process.cwd(), resolved).startsWith("..") && !path.isAbsolute(path.relative(process.cwd(), resolved))) {
    throw new Error("POLICY_RISK_BACKFILL_REPORT_MUST_BE_OUTSIDE_REPOSITORY");
  }
  const directory = path.dirname(resolved);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const handle = await open(resolved, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(resolved, 0o600);
  return resolved;
}

async function readPrivateReportBytes(file: string) {
  const resolved = path.resolve(file);
  if (!path.isAbsolute(file)) throw new Error("POLICY_RISK_BACKFILL_REPORT_PATH_MUST_BE_ABSOLUTE");
  if (!path.relative(process.cwd(), resolved).startsWith("..") && !path.isAbsolute(path.relative(process.cwd(), resolved))) {
    throw new Error("POLICY_RISK_BACKFILL_REPORT_MUST_BE_OUTSIDE_REPOSITORY");
  }
  const metadata = await stat(resolved);
  if ((metadata.mode & 0o077) !== 0) throw new Error("POLICY_RISK_BACKFILL_REPORT_PERMISSIONS_MUST_BE_0600");
  return readFile(resolved);
}

async function readReviewedManifest(file: string): Promise<PolicyRiskBackfillManifest> {
  return JSON.parse((await readPrivateReportBytes(file)).toString("utf8")) as PolicyRiskBackfillManifest;
}

async function main() {
  const organizationId = arg("organization-id")?.trim();
  if (!organizationId) throw new Error("Indica una organización explícita con --organization-id=ID.");
  const productionPreview = process.argv.includes("--production-preview");
  const productionInventoryReport = process.argv.includes("--production-inventory-report");
  const productionApply = process.argv.includes("--production-apply");
  const apply = process.argv.includes("--apply");
  const policyNumbers = selectedPolicyNumbers();
  if (productionInventoryReport && (productionPreview || productionApply || apply || process.argv.includes("--print-reviewed-digest") || policyNumbers || arg("confirm-apply") || arg("confirm-production-apply"))) {
    throw new Error("POLICY_RISK_INVENTORY_MODE_IS_EXCLUSIVE");
  }
  if (productionApply && !policyNumbers?.length) throw new Error("POLICY_RISK_BACKFILL_PRODUCTION_APPLY_POLICY_NUMBER_SCOPE_REQUIRED");
  if (productionPreview && apply) throw new Error("POLICY_RISK_BACKFILL_PRODUCTION_PREVIEW_IS_READ_ONLY");
  if (productionPreview && productionApply) throw new Error("POLICY_RISK_BACKFILL_PRODUCTION_MODES_ARE_EXCLUSIVE");
  if (productionApply && !apply) throw new Error("POLICY_RISK_BACKFILL_PRODUCTION_APPLY_REQUIRES_APPLY");
  if (productionApply && process.env.NODE_ENV !== "test" && process.env.POLICY_RISK_BACKFILL_PRODUCTION_APPLY_ENABLED !== "1") {
    throw new Error("POLICY_RISK_BACKFILL_PRODUCTION_APPLY_FEATURE_GATE_REQUIRED");
  }
  if (productionApply && arg("confirm-production-apply") !== PRODUCTION_APPLY_CONFIRMATION) {
    throw new Error(`POLICY_RISK_BACKFILL_PRODUCTION_APPLY_REQUIRES_--confirm-production-apply=${PRODUCTION_APPLY_CONFIRMATION}`);
  }
  if (!productionApply && arg("confirm-production-apply")) throw new Error("POLICY_RISK_BACKFILL_PRODUCTION_CONFIRMATION_WITHOUT_MODE");
  if (process.argv.includes("--print-reviewed-digest")) {
    const reviewedFile = arg("reviewed-report");
    const reviewer = arg("reviewed-by")?.trim();
    const previewSha = arg("preview-sha256")?.trim();
    if (!reviewedFile || !reviewer || !previewSha) throw new Error("REVIEW_DIGEST_REQUIRES_REPORT_REVIEWER_AND_PREVIEW_SHA");
    const manifest = await readReviewedManifest(reviewedFile);
    if (manifest.contentSha256 !== previewSha) throw new Error("POLICY_RISK_BACKFILL_MANIFEST_DIGEST_MISMATCH");
    if (manifest.reviewedBy?.trim() !== reviewer || !manifest.reviewedAt) throw new Error("POLICY_RISK_BACKFILL_REVIEWER_MISMATCH");
    assertReviewedPolicyRiskBackfillManifest(manifest, { organizationId, candidateSha: candidateSha(), processorSha256: await processorSha256() });
    process.stdout.write(`${JSON.stringify({ reviewedManifestSha256: policyRiskBackfillReviewedHash(manifest) })}\n`);
    return;
  }
  if (!productionPreview && !productionInventoryReport && !productionApply && (process.env.NODE_ENV !== "test" || process.env.TENANT_ISOLATION_TEST_DB !== "1" || process.env.PLAYWRIGHT_ENFORCE_DISPOSABLE_DB !== "1")) {
    throw new Error("La conversión requiere NODE_ENV=test, TENANT_ISOLATION_TEST_DB=1 y PLAYWRIGHT_ENFORCE_DISPOSABLE_DB=1.");
  }
  const readOnlyProductionMode = productionPreview || productionInventoryReport;
  const connectionString = (readOnlyProductionMode
    ? process.env.POLICY_RISK_BACKFILL_READONLY_DATABASE_URL
    : productionApply
      ? process.env.POLICY_RISK_BACKFILL_PRODUCTION_APPLY_DATABASE_URL
      : process.env.DATABASE_URL)?.trim();
  if (!connectionString) {
    throw new Error(readOnlyProductionMode
      ? "POLICY_RISK_BACKFILL_READONLY_DATABASE_URL_REQUIRED"
      : productionApply
        ? "POLICY_RISK_BACKFILL_PRODUCTION_APPLY_DATABASE_URL_REQUIRED"
        : "DATABASE_URL es obligatorio para la base desechable.");
  }
  if (productionApply && arg("confirm-apply") !== APPLY_CONFIRMATION) {
    throw new Error(`APPLY_REQUIRES_--confirm-apply=${APPLY_CONFIRMATION}`);
  }
  if (!readOnlyProductionMode && !productionApply) assertDisposableCertificationTarget(connectionString, process.env, "source");

  const productionTarget = productionApply ? createProductionApplyTarget(connectionString) : null;
  const prisma = productionTarget?.prisma ?? new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const sha = candidateSha();
    const processor = await processorSha256();
    if (productionInventoryReport) {
      const outcomeFile = arg("outcome-report");
      const outcomeSha = arg("outcome-manifest-sha256")?.trim();
      const outcomeFileSha = arg("outcome-report-sha256")?.trim();
      const outcomeManifestFile = arg("outcome-reviewed-manifest");
      if (Boolean(outcomeFile) !== Boolean(outcomeSha) || Boolean(outcomeFile) !== Boolean(outcomeFileSha) || Boolean(outcomeFile) !== Boolean(outcomeManifestFile)) {
        throw new Error("POLICY_RISK_INVENTORY_OUTCOME_REQUIRES_REPORT_REVIEWED_MANIFEST_AND_DIGESTS");
      }
      let outcomeReport: PolicyRiskInventoryOutcomeReport | undefined;
      let verifiedOutcomeFileSha256: string | null = null;
      let expectedInputHashes: Record<string, string> | undefined;
      if (outcomeFile && outcomeSha && outcomeFileSha) {
        const verified = parseVerifiedPolicyRiskInventoryOutcomeReport(await readPrivateReportBytes(outcomeFile), outcomeFileSha);
        outcomeReport = verified.report;
        verifiedOutcomeFileSha256 = verified.fileSha256;
        const reviewedManifest = await readReviewedManifest(outcomeManifestFile!);
        assertReviewedPolicyRiskBackfillManifest(reviewedManifest, { organizationId, candidateSha: sha, processorSha256: processor });
        if (reviewedManifest.contentSha256 !== outcomeReport.manifestSha256 || policyRiskBackfillReviewedHash(reviewedManifest) !== outcomeReport.reviewedManifestSha256 || reviewedManifest.candidateSha !== outcomeReport.candidateSha) {
          throw new Error("POLICY_RISK_INVENTORY_OUTCOME_REVIEWED_MANIFEST_MISMATCH");
        }
        expectedInputHashes = Object.fromEntries(reviewedManifest.candidates.map((candidate) => [candidate.policyId, candidate.inputHash]));
      }
      const policies = await scanProductionInventoryReadOnly(prisma, organizationId, connectionString, outcomeReport, sha);
      const report = reconcilePolicyRiskInventory({ organizationId, policies, outcomeReport, expectedManifestSha256: outcomeSha, expectedCandidateSha: outcomeReport ? sha : undefined, expectedInputHashes });
      const runId = randomUUID();
      const reportFile = arg("report-file") ?? `/private/tmp/policy-risk-inventory-${organizationId}-${runId}.json`;
      const reportPath = await writePrivateManifest(reportFile, {
        schemaVersion: 1,
        createdAt: new Date().toISOString(),
        mode: "PRODUCTION_READ_ONLY_WHOLE_ORGANIZATION_INVENTORY",
        candidateSha: sha,
        processorSha256: processor,
        snapshotIsolation: "REPEATABLE READ, READ ONLY",
        pageSize: INVENTORY_PAGE_SIZE,
        recognizedStructuredPredicate: "schema-valid riskDetails whose policyType matches the policy row, riskDetailsReviewRequired=false, and at least one non-empty value in data; this recognizes populated structured data but does not verify all optional fields are present",
        linkedApply: outcomeReport ? {
          reportFile: outcomeFile,
          reportSha256: verifiedOutcomeFileSha256,
          candidateSha: outcomeReport.candidateSha,
          runId: outcomeReport.runId,
          maintenanceRunId: outcomeReport.maintenanceRunId,
          status: outcomeReport.status,
          manifestSha256: outcomeReport.manifestSha256,
          reviewedManifestSha256: outcomeReport.reviewedManifestSha256,
        } : null,
        ...report,
      });
      process.stdout.write(`${JSON.stringify({ mode: "production-read-only-inventory", organizationId, runId, totalPolicies: report.totalPolicies, totals: report.totals, reportFile: reportPath }, null, 2)}\n`);
      return;
    }
    if (!apply) {
      const candidates = productionPreview
        ? await scanProductionReadOnly(prisma, organizationId, connectionString, policyNumbers)
        : await scanAll(prisma, organizationId, policyNumbers);
      const manifest: PolicyRiskBackfillManifest = {
        schemaVersion: POLICY_RISK_BACKFILL_MANIFEST_VERSION,
        processorVersion: POLICY_RISK_BACKFILL_PROCESSOR_VERSION,
        processorSha256: processor,
        runId: randomUUID(),
        createdAt: new Date().toISOString(),
        sourceMode: productionPreview ? "PRODUCTION_READ_ONLY_PREVIEW" : "DISPOSABLE_DRY_RUN",
        sourceTarget: productionPreview ? {
          host: new URL(connectionString).hostname.toLowerCase(),
          database: decodeURIComponent(new URL(connectionString).pathname.replace(/^\//, "").split("?")[0]),
        } : null,
        organizationId,
        candidateSha: sha,
        scanned: candidates.length,
        candidates,
        contentSha256: "",
        reviewedBy: null,
        reviewedAt: null,
      };
      manifest.contentSha256 = policyRiskBackfillManifestContentHash(manifest);
      const reportFile = arg("report-file") ?? `/private/tmp/policy-risk-backfill-${organizationId}-${manifest.runId}.json`;
      const reportPath = await writePrivateManifest(reportFile, manifest);
      const review = candidates.filter((row) => row.classification === "REVIEW").length;
      const converted = candidates.filter((row) => row.classification === "CONVERTED").length;
      const empty = candidates.filter((row) => row.classification === "EMPTY").length;
      process.stdout.write(`${JSON.stringify({ mode: productionPreview ? "production-read-only-preview" : "dry-run", readOnly: productionPreview, organizationId, runId: manifest.runId, candidateSha: sha, scanned: candidates.length, converted, review, empty, manifestSha256: manifest.contentSha256, reportFile: reportPath }, null, 2)}\n`);
      return;
    }

    const reviewedFile = arg("reviewed-report");
    const reviewer = arg("reviewed-by")?.trim();
    const expectedManifestSha = arg("manifest-sha256")?.trim();
    if (!reviewedFile || !reviewer || !expectedManifestSha || arg("confirm-apply") !== APPLY_CONFIRMATION) {
      throw new Error(`APPLY_REQUIRES_--reviewed-report, --reviewed-by, --manifest-sha256, and --confirm-apply=${APPLY_CONFIRMATION}`);
    }
    if (productionApply && arg("confirm-production-apply") !== PRODUCTION_APPLY_CONFIRMATION) {
      throw new Error(`POLICY_RISK_BACKFILL_PRODUCTION_APPLY_REQUIRES_--confirm-production-apply=${PRODUCTION_APPLY_CONFIRMATION}`);
    }
    const manifest = await readReviewedManifest(reviewedFile);
    if (policyRiskBackfillReviewedHash(manifest) !== expectedManifestSha) throw new Error("POLICY_RISK_BACKFILL_REVIEWED_DIGEST_MISMATCH");
    if (manifest.reviewedBy?.trim() !== reviewer || !manifest.reviewedAt) throw new Error("POLICY_RISK_BACKFILL_REVIEWER_MISMATCH");
    assertReviewedPolicyRiskBackfillManifest(manifest, { organizationId, candidateSha: sha, processorSha256: processor });
    if (productionApply && manifest.sourceMode !== "PRODUCTION_READ_ONLY_PREVIEW") throw new Error("POLICY_RISK_BACKFILL_PRODUCTION_APPLY_REQUIRES_PRODUCTION_PREVIEW_MANIFEST");
    if (productionApply && (!productionTarget || manifest.sourceTarget?.host !== productionTarget.host || manifest.sourceTarget.database !== productionTarget.database)) {
      throw new Error("POLICY_RISK_BACKFILL_PRODUCTION_APPLY_PREVIEW_TARGET_MISMATCH");
    }
    if (!productionApply && manifest.sourceMode !== "DISPOSABLE_DRY_RUN") throw new Error("POLICY_RISK_BACKFILL_DISPOSABLE_APPLY_REQUIRES_DISPOSABLE_MANIFEST");
    const reviewedManifestSha256 = expectedManifestSha;

    const requestedBatchSize = Number(arg("batch-size") ?? "50");
    const maximumBatchSize = productionApply ? MAX_PRODUCTION_BATCH_SIZE : MAX_BATCH_SIZE;
    if (!Number.isInteger(requestedBatchSize) || requestedBatchSize < 1 || requestedBatchSize > maximumBatchSize) {
      throw new Error(`POLICY_RISK_BACKFILL_BATCH_SIZE_MUST_BE_1_TO_${maximumBatchSize}`);
    }

    const current = productionTarget
      ? await withProductionApplyTransaction(productionTarget, organizationId, reviewer, (tx) => scanAll(tx, organizationId, policyNumbers))
      : await scanAll(prisma, organizationId, policyNumbers);
    const expectedById = new Map(manifest.candidates.map((row) => [row.policyId, row]));
    for (const row of current) {
      const expected = expectedById.get(row.policyId);
      if (!expected || expected.inputHash !== row.inputHash) throw new Error(`POLICY_RISK_BACKFILL_STALE_INPUT:${row.policyId}`);
    }
    const currentIds = new Set(current.map((row) => row.policyId));
    const alreadyAppliedRows = manifest.candidates.filter((row) => !currentIds.has(row.policyId));
    const loadAlreadyApplied = async (client: Pick<PrismaClient, "policy">) => alreadyAppliedRows.length
      ? await client.policy.findMany({
        where: { organizationId, id: { in: alreadyAppliedRows.map((row) => row.policyId) } },
        select: {
          id: true,
          insuredObject: true,
          riskDetails: true,
          insuredAssets: { select: { assetType: true, description: true, serialNumber: true, isPrimary: true } },
          insuredParties: { select: { fullName: true, isPrimary: true, sourceLabel: true } },
        },
      })
      : [];
    const alreadyApplied = productionTarget
      ? await withProductionApplyTransaction(productionTarget, organizationId, reviewer, loadAlreadyApplied)
      : await loadAlreadyApplied(prisma);
    const appliedById = new Map(alreadyApplied.map((row) => [row.id, row]));
    for (const row of alreadyAppliedRows) {
      const saved = appliedById.get(row.policyId);
      const detailsMatch = saved?.riskDetails != null && policyRiskBackfillInputHash(saved.riskDetails) === policyRiskBackfillInputHash(row.proposed.riskDetails);
      const summaryMatch = !row.proposed.insuredObject || saved?.insuredObject === row.proposed.insuredObject;
      const assetsMatch = row.proposed.assets.every((asset) => saved?.insuredAssets.some((actual) => actual.assetType === asset.assetType && actual.description === asset.description && actual.serialNumber === asset.serialNumber && actual.isPrimary === asset.isPrimary));
      const partiesMatch = row.proposed.insuredParties.every((party) => {
        const original = row.source.insuredParties.find((sourceParty) => sourceParty.fullName === party.fullName);
        return saved?.insuredParties.some((actual) => actual.fullName === party.fullName && actual.isPrimary === (original?.isPrimary ?? party.isPrimary) && actual.sourceLabel === (original?.sourceLabel ?? party.sourceLabel));
      });
      if (!detailsMatch || !summaryMatch || !assetsMatch || !partiesMatch) throw new Error(`POLICY_RISK_BACKFILL_PARTIAL_APPLY_CONFLICT:${row.policyId}`);
    }

    const mutatePolicyBeforeBatch = process.env.POLICY_RISK_BACKFILL_TEST_MUTATE_POLICY_ID_BEFORE_BATCH;
    if (!productionTarget && process.env.NODE_ENV === "test" && mutatePolicyBeforeBatch) {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw(Prisma.sql`SELECT set_config('app.organization_id', ${organizationId}, true)`);
        await tx.policy.updateMany({
          where: { id: mutatePolicyBeforeBatch, organizationId, riskDetails: { equals: Prisma.DbNull } },
          data: { insuredObject: "Concurrent source edit injected by disposable integration test" },
        });
      });
    }

    const createRun = (client: Pick<PrismaClient, "maintenanceRun">) => client.maintenanceRun.create({
      data: {
        organizationId,
        type: "POLICY_RISK_BACKFILL",
        status: "RUNNING",
        summaryJson: JSON.stringify({ mode: productionApply ? "production-apply" : "disposable-apply", organizationId, runId: manifest.runId, candidateSha: sha, manifestSha256: manifest.contentSha256, reviewedManifestSha256, reviewer, writerRole: productionTarget?.role ?? null, endpointHost: productionTarget?.host ?? null, database: productionTarget?.database ?? null, batchSize: requestedBatchSize, scanned: manifest.scanned }),
      },
      select: { id: true },
    });
    const run = productionTarget
      ? await withProductionApplyTransaction(productionTarget, organizationId, reviewer, createRun)
      : await withDisposableApplyTransaction(prisma, organizationId, createRun);
    let converted = 0;
    let deferred = 0;
    let empty = 0;
    let applied = 0;
    let alreadyAppliedCount = 0;
    let committedAppliedBatches = 0;
    const outcomes: Array<{ policyId: string; policyNumber: string; inputHash: string; outcome: "APPLIED" | "ALREADY_APPLIED" | "DEFERRED" | "EMPTY" }> = [];
    const resultFile = `${reviewedFile}.${run.id}.results.json`;
    const updateRun = async (data: Prisma.MaintenanceRunUpdateInput) => productionTarget
      ? withProductionApplyTransaction(productionTarget, organizationId, reviewer, (tx) => tx.maintenanceRun.update({ where: { id: run.id, organizationId }, data, select: { id: true } }))
      : withDisposableApplyTransaction(prisma, organizationId, (tx) => tx.maintenanceRun.update({ where: { id: run.id, organizationId }, data, select: { id: true } }));
    try {
      for (let offset = 0; offset < manifest.candidates.length; offset += requestedBatchSize) {
        const batch = manifest.candidates.slice(offset, offset + requestedBatchSize);
        const batchOutcomes: typeof outcomes = [];
        const batchCounts = { converted: 0, deferred: 0, empty: 0, applied: 0, alreadyApplied: 0 };
        const applyBatch = async (tx: Prisma.TransactionClient) => {
          for (const row of batch) {
            if (!currentIds.has(row.policyId)) {
              batchCounts.alreadyApplied += 1;
              batchOutcomes.push({ policyId: row.policyId, policyNumber: row.policyNumber, inputHash: row.inputHash, outcome: "ALREADY_APPLIED" });
              continue;
            }
            if (row.classification === "EMPTY") {
              batchCounts.empty += 1;
              batchOutcomes.push({ policyId: row.policyId, policyNumber: row.policyNumber, inputHash: row.inputHash, outcome: "EMPTY" });
              continue;
            }
            if (row.classification === "REVIEW" && row.decision === "DEFER") {
              batchCounts.deferred += 1;
              batchOutcomes.push({ policyId: row.policyId, policyNumber: row.policyNumber, inputHash: row.inputHash, outcome: "DEFERRED" });
              continue;
            }
            const approvedReview = row.classification === "REVIEW";
            if (approvedReview && !hasPolicyRiskData(row.proposed.riskDetails)) {
              batchCounts.deferred += 1;
              batchOutcomes.push({ policyId: row.policyId, policyNumber: row.policyNumber, inputHash: row.inputHash, outcome: "DEFERRED" });
              continue;
            }
            const lockedPolicy = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
              SELECT "id" FROM "Policy"
              WHERE "id" = ${row.policyId} AND "organizationId" = ${organizationId} AND "riskDetails" IS NULL
              FOR UPDATE
            `);
            if (!lockedPolicy.length) throw new Error(`POLICY_RISK_BACKFILL_WRITE_CONFLICT:${row.policyId}`);
            await tx.$queryRaw(Prisma.sql`
              SELECT "id" FROM "PolicyInsuredAsset"
              WHERE "organizationId" = ${organizationId} AND "policyId" = ${row.policyId}
              ORDER BY "id" FOR UPDATE
            `);
            await tx.$queryRaw(Prisma.sql`
              SELECT "id" FROM "PolicyInsuredParty"
              WHERE "organizationId" = ${organizationId} AND "policyId" = ${row.policyId}
              ORDER BY "id" FOR UPDATE
            `);
            const freshPolicy = await tx.policy.findFirst({
              where: { id: row.policyId, organizationId, riskDetails: { equals: Prisma.DbNull } },
              select: {
                id: true,
                policyNumber: true,
                policyType: true,
                insuredObject: true,
                beneficiaryInfo: true,
                insuredAssets: { select: { description: true, serialNumber: true, isPrimary: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
                insuredParties: { select: { fullName: true, isPrimary: true, sourceLabel: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
              },
            });
            if (!freshPolicy || planPolicy(freshPolicy).inputHash !== row.inputHash) {
              throw new Error(`POLICY_RISK_BACKFILL_STALE_INPUT:${row.policyId}`);
            }
            const updated = await tx.policy.updateMany({
              where: { id: row.policyId, organizationId, riskDetails: { equals: Prisma.DbNull } },
              data: {
                ...(hasPolicyRiskData(row.proposed.riskDetails) ? { riskDetails: row.proposed.riskDetails as Prisma.InputJsonValue } : {}),
                ...(row.proposed.insuredObject ? { insuredObject: row.proposed.insuredObject } : {}),
                riskDetailsReviewRequired: false,
              },
            });
            if (!updated.count) throw new Error(`POLICY_RISK_BACKFILL_WRITE_CONFLICT:${row.policyId}`);
            if (row.proposed.assets.length) {
              await tx.policyInsuredAsset.createMany({ data: row.proposed.assets.map((asset) => ({ ...asset, organizationId, policyId: row.policyId })), skipDuplicates: true });
            }
            if (row.proposed.insuredParties.length) {
              await tx.policyInsuredParty.createMany({ data: row.proposed.insuredParties.map((party) => ({ ...party, organizationId, policyId: row.policyId })), skipDuplicates: true });
            }
            batchCounts.converted += 1;
            batchCounts.applied += 1;
            batchOutcomes.push({ policyId: row.policyId, policyNumber: row.policyNumber, inputHash: row.inputHash, outcome: "APPLIED" });
            const failInsideBatchAfter = Number(process.env.POLICY_RISK_BACKFILL_TEST_FAIL_WITHIN_BATCH_AFTER_APPLIED_ROWS ?? "0");
            if (process.env.NODE_ENV === "test" && failInsideBatchAfter > 0 && batchCounts.applied === failInsideBatchAfter) {
              throw new Error("POLICY_RISK_BACKFILL_TEST_ROLLBACK_WITHIN_BATCH");
            }
          }
        };
        if (productionTarget) await withProductionApplyTransaction(productionTarget, organizationId, reviewer, applyBatch);
        else await withDisposableApplyTransaction(prisma, organizationId, applyBatch);
        converted += batchCounts.converted;
        deferred += batchCounts.deferred;
        empty += batchCounts.empty;
        applied += batchCounts.applied;
        alreadyAppliedCount += batchCounts.alreadyApplied;
        outcomes.push(...batchOutcomes);
        if (batchCounts.applied > 0) {
          committedAppliedBatches += 1;
          const failAfter = Number(process.env.POLICY_RISK_BACKFILL_TEST_FAIL_AFTER_APPLIED_BATCHES ?? "0");
          if (process.env.NODE_ENV === "test" && failAfter > 0 && committedAppliedBatches === failAfter) {
            throw new Error("POLICY_RISK_BACKFILL_TEST_INTERRUPTED_AFTER_COMMIT");
          }
        }
      }
      const summary = {
        mode: productionApply ? "production-apply" : "disposable-apply",
        organizationId,
        runId: manifest.runId,
        candidateSha: sha,
        manifestSha256: manifest.contentSha256,
        reviewer,
        reviewedManifestSha256,
        writerRole: productionTarget?.role ?? null,
        endpointHost: productionTarget?.host ?? null,
        database: productionTarget?.database ?? null,
        batchSize: requestedBatchSize,
        scanned: manifest.scanned,
        converted,
        deferred,
        empty,
        applied,
        alreadyApplied: alreadyAppliedCount,
        outcomesSha256: policyRiskBackfillInputHash(outcomes),
      };
      await updateRun({ status: deferred ? "REVIEW_REQUIRED" : "COMPLETED", completedAt: new Date(), summaryJson: JSON.stringify(summary) });
      await writePrivateManifest(resultFile, { ...summary, manifestSha256: manifest.contentSha256, maintenanceRunId: run.id, status: deferred ? "REVIEW_REQUIRED" : "COMPLETED", outcomes });
      const outcomeReportSha256 = createHash("sha256").update(await readFile(resultFile)).digest("hex");
      process.stdout.write(`${JSON.stringify({ ...summary, mode: "apply", maintenanceRunId: run.id, resultFile, outcomeReportSha256 }, null, 2)}\n`);
    } catch (error) {
      const errorCode = error instanceof Error ? error.message.split(":")[0] : "UNKNOWN";
      await updateRun({ status: "FAILED", completedAt: new Date(), summaryJson: JSON.stringify({ mode: productionApply ? "production-apply" : "disposable-apply", organizationId, runId: manifest.runId, candidateSha: sha, reviewer, reviewedManifestSha256, writerRole: productionTarget?.role ?? null, endpointHost: productionTarget?.host ?? null, database: productionTarget?.database ?? null, batchSize: requestedBatchSize, scanned: manifest.scanned, converted, deferred, empty, applied, alreadyApplied: alreadyAppliedCount, errorCode }) });
      await writePrivateManifest(resultFile, { organizationId, manifestSha256: manifest.contentSha256, reviewedManifestSha256, maintenanceRunId: run.id, status: "FAILED", converted, deferred, empty, applied, alreadyApplied: alreadyAppliedCount, errorCode, outcomes });
      throw error;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "POLICY_RISK_BACKFILL_FAILED"}\n`);
  process.exitCode = 1;
});
