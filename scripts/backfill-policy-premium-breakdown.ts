import "dotenv/config";

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../src/generated/prisma/client.ts";
import { safeJson } from "../src/lib/activity-log.ts";
import { assertOrganizationContextInTransaction, type OrganizationContext } from "../src/lib/organization-context.ts";
import { deriveNetPremium, roundPremiumMoney } from "../src/lib/premium-breakdown.ts";
import { evaluatePolicyPremiumBackfill, type PolicyPremiumBackfillPolicy } from "../src/lib/policy-premium-backfill.ts";

const APPLY_CONFIRMATION = "APPLY_POLICY_PREMIUM_BREAKDOWN_TO_PRODUCTION";
const EXPECTED_ELIGIBLE = 85;
const EXPECTED_RECEIPT_CANDIDATES = 80;
const EXPECTED_SOURCE_REVIEWED = 4;
const EXPECTED_REMAINING_REVIEW = 1;
const EXPECTED_REVIEW_NUMBERS = new Set(["1009228", "19941U01", "10589W00", "2000006", "200541"]);
const SOURCE_REVIEW_NUMBERS = new Set(["1009228", "19941U01", "10589W00", "200541"]);

type SourceReviewEntry = {
  policyId: string;
  policyNumber: string;
  sourceReference: string;
  premiumAmount?: number;
  premiumVatAmount: number;
  premiumIssuanceExpenseAmount: number;
  premiumSurchargeAmount: number;
  premiumDiscountAmount: number;
};

type SourceReviewFile = { entries: SourceReviewEntry[] };

function arg(name: string) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function requireArg(name: string) {
  const value = arg(name)?.trim();
  if (!value) throw new Error(`POLICY_PREMIUM_BACKFILL_REQUIRES_--${name}`);
  return value;
}

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function asJson(value: unknown): Prisma.JsonValue | null {
  return value as Prisma.JsonValue | null;
}

async function loadEligiblePolicies(db: PrismaClient | Prisma.TransactionClient, organizationId: string, asOfDate: Date) {
  const yearStart = new Date(Date.UTC(asOfDate.getUTCFullYear(), 0, 1));
  const nextYearStart = new Date(Date.UTC(asOfDate.getUTCFullYear() + 1, 0, 1));
  const policies = await db.policy.findMany({
    where: {
      organizationId,
      OR: [
        { status: "ACTIVE", startDate: { lte: asOfDate }, endDate: { gte: asOfDate } },
        { payments: { some: { organizationId, status: "POSTED", paidDate: { gte: yearStart, lt: nextYearStart } } } },
      ],
    },
    select: {
      id: true,
      policyNumber: true,
      policyType: true,
      premiumAmount: true,
      premiumVatAmount: true,
      premiumIssuanceExpenseAmount: true,
      premiumSurchargeAmount: true,
      premiumDiscountAmount: true,
      receipts: {
        where: { organizationId },
        select: {
          id: true,
          status: true,
          amount: true,
          endorsementId: true,
          vatAmount: true,
          issuanceExpenseAmount: true,
          surchargeAmount: true,
          discountAmount: true,
          premiumBreakdownByUnit: true,
        },
        orderBy: [{ receiptSequence: "asc" }, { dueDate: "asc" }, { id: "asc" }],
      },
    },
    orderBy: [{ policyNumber: "asc" }, { id: "asc" }],
  });
  return policies.map((policy) => ({
    id: policy.id,
    policyNumber: policy.policyNumber,
    policyType: policy.policyType,
    premiumAmount: Number(policy.premiumAmount),
    premiumVatAmount: policy.premiumVatAmount === null ? null : Number(policy.premiumVatAmount),
    premiumIssuanceExpenseAmount: policy.premiumIssuanceExpenseAmount === null ? null : Number(policy.premiumIssuanceExpenseAmount),
    premiumSurchargeAmount: policy.premiumSurchargeAmount === null ? null : Number(policy.premiumSurchargeAmount),
    premiumDiscountAmount: policy.premiumDiscountAmount === null ? null : Number(policy.premiumDiscountAmount),
    receipts: policy.receipts.map((receipt) => ({
      id: receipt.id,
      status: receipt.status,
      amount: Number(receipt.amount),
      endorsementId: receipt.endorsementId,
      vatAmount: receipt.vatAmount === null ? null : Number(receipt.vatAmount),
      issuanceExpenseAmount: receipt.issuanceExpenseAmount === null ? null : Number(receipt.issuanceExpenseAmount),
      surchargeAmount: receipt.surchargeAmount === null ? null : Number(receipt.surchargeAmount),
      discountAmount: receipt.discountAmount === null ? null : Number(receipt.discountAmount),
      premiumBreakdownByUnit: asJson(receipt.premiumBreakdownByUnit),
    })),
  })) satisfies PolicyPremiumBackfillPolicy[];
}

async function loadSourceReview(pathname: string | null): Promise<SourceReviewFile> {
  if (!pathname) return { entries: [] };
  const parsed = JSON.parse(await readFile(pathname, "utf8")) as SourceReviewFile;
  if (!Array.isArray(parsed.entries)) throw new Error("POLICY_PREMIUM_BACKFILL_SOURCE_REVIEW_INVALID");
  if (new Set(parsed.entries.map((entry) => entry.policyNumber)).size !== parsed.entries.length) throw new Error("POLICY_PREMIUM_BACKFILL_SOURCE_REVIEW_DUPLICATE_POLICY");
  for (const entry of parsed.entries) {
    if (!SOURCE_REVIEW_NUMBERS.has(entry.policyNumber) || !entry.policyId || !entry.sourceReference?.trim()) throw new Error("POLICY_PREMIUM_BACKFILL_SOURCE_REVIEW_SCOPE_INVALID");
    if ([entry.premiumVatAmount, entry.premiumIssuanceExpenseAmount, entry.premiumSurchargeAmount, entry.premiumDiscountAmount].some((value) => !Number.isFinite(value))) throw new Error("POLICY_PREMIUM_BACKFILL_SOURCE_REVIEW_AMOUNT_INVALID");
  }
  return parsed;
}

function sourceOverrideIsValid(entry: SourceReviewEntry, policy: PolicyPremiumBackfillPolicy) {
  if (entry.policyId !== policy.id || entry.policyNumber !== policy.policyNumber) return false;
  const gross = roundPremiumMoney(entry.premiumAmount ?? policy.premiumAmount);
  const net = deriveNetPremium(gross, {
    vatAmount: entry.premiumVatAmount,
    issuanceExpenseAmount: entry.premiumIssuanceExpenseAmount,
    surchargeAmount: entry.premiumSurchargeAmount,
    discountAmount: entry.premiumDiscountAmount,
  });
  return net !== null && Math.abs(net) < gross + 0.01;
}

function buildPlan(policies: PolicyPremiumBackfillPolicy[], sourceReview: SourceReviewFile) {
  const outcomes = policies.map((policy) => evaluatePolicyPremiumBackfill(policy));
  const entriesByNumber = new Map(sourceReview.entries.map((entry) => [entry.policyNumber, entry]));
  const sourceReviewed = new Set<string>();
  const updates = outcomes.flatMap((outcome) => {
    const policy = policies.find((item) => item.id === outcome.policyId)!;
    const override = entriesByNumber.get(policy.policyNumber);
    if (!override) return outcome.status === "CANDIDATE" ? [{ outcome, policyId: policy.id, fields: {
      premiumAmount: policy.premiumAmount,
      premiumVatAmount: outcome.totals!.vatAmount,
      premiumIssuanceExpenseAmount: outcome.totals!.issuanceExpenseAmount,
      premiumSurchargeAmount: outcome.totals!.surchargeAmount,
      premiumDiscountAmount: outcome.totals!.discountAmount,
      sourceReference: "Recibos base completos y conciliados con prima de póliza",
    } }] : [];
    if (outcome.status !== "REVIEW" || !sourceOverrideIsValid(override, policy)) throw new Error(`POLICY_PREMIUM_BACKFILL_SOURCE_OVERRIDE_NOT_VALID:${policy.policyNumber}`);
    sourceReviewed.add(policy.policyNumber);
    return [{ outcome, policyId: policy.id, fields: {
      premiumAmount: roundPremiumMoney(override.premiumAmount ?? policy.premiumAmount),
      premiumVatAmount: roundPremiumMoney(override.premiumVatAmount),
      premiumIssuanceExpenseAmount: roundPremiumMoney(override.premiumIssuanceExpenseAmount),
      premiumSurchargeAmount: roundPremiumMoney(override.premiumSurchargeAmount),
      premiumDiscountAmount: roundPremiumMoney(override.premiumDiscountAmount),
      sourceReference: override.sourceReference.trim(),
    } }];
  });
  if (sourceReviewed.size !== sourceReview.entries.length) throw new Error("POLICY_PREMIUM_BACKFILL_SOURCE_REVIEW_NOT_APPLIED");
  const remainingReview = outcomes.filter((outcome) => outcome.status === "REVIEW" && !sourceReviewed.has(outcome.policyNumber));
  return { outcomes, updates, sourceReviewedCount: sourceReviewed.size, remainingReview };
}

function assertExpectedScope(plan: ReturnType<typeof buildPlan>, hasSourceReview: boolean) {
  const eligible = plan.outcomes.length;
  const candidates = plan.outcomes.filter((outcome) => outcome.status === "CANDIDATE").length;
  const reviewNumbers = new Set(plan.outcomes.filter((outcome) => outcome.status === "REVIEW").map((outcome) => outcome.policyNumber));
  if (eligible !== EXPECTED_ELIGIBLE || candidates !== EXPECTED_RECEIPT_CANDIDATES || reviewNumbers.size !== EXPECTED_REVIEW_NUMBERS.size || [...EXPECTED_REVIEW_NUMBERS].some((number) => !reviewNumbers.has(number))) {
    throw new Error(`POLICY_PREMIUM_BACKFILL_EXPECTED_SCOPE_MISMATCH:${JSON.stringify({ eligible, candidates, sourceReviewed: plan.sourceReviewedCount, remainingReview: plan.remainingReview.length })}`);
  }
  if (hasSourceReview) {
    if (plan.sourceReviewedCount !== EXPECTED_SOURCE_REVIEWED || plan.remainingReview.length !== EXPECTED_REMAINING_REVIEW || plan.remainingReview[0]?.policyNumber !== "2000006") throw new Error("POLICY_PREMIUM_BACKFILL_UNEXPECTED_SOURCE_REVIEW_SCOPE");
  } else if (plan.sourceReviewedCount !== 0 || plan.remainingReview.length !== EXPECTED_REVIEW_NUMBERS.size) {
    throw new Error("POLICY_PREMIUM_BACKFILL_UNEXPECTED_INITIAL_REVIEW_SCOPE");
  }
}

function canonicalInputHash(policies: PolicyPremiumBackfillPolicy[]) {
  return sha256(policies.map((policy) => ({
    id: policy.id,
    policyNumber: policy.policyNumber,
    policyType: policy.policyType,
    premiumAmount: policy.premiumAmount,
    premiumVatAmount: policy.premiumVatAmount,
    premiumIssuanceExpenseAmount: policy.premiumIssuanceExpenseAmount,
    premiumSurchargeAmount: policy.premiumSurchargeAmount,
    premiumDiscountAmount: policy.premiumDiscountAmount,
    receipts: policy.receipts.map((receipt) => ({ ...receipt })).sort((a, b) => a.id.localeCompare(b.id)),
  })));
}

async function loadProtectedFinancialSnapshot(db: PrismaClient | Prisma.TransactionClient, organizationId: string, policyIds: string[]) {
  const [receipts, payments, commissions] = await Promise.all([
    db.receipt.findMany({ where: { organizationId, policyId: { in: policyIds } }, orderBy: { id: "asc" } }),
    db.payment.findMany({ where: { organizationId, policyId: { in: policyIds } }, orderBy: { id: "asc" } }),
    db.commission.findMany({ where: { organizationId, policyId: { in: policyIds } }, orderBy: { id: "asc" } }),
  ]);
  return sha256({ receipts, payments, commissions });
}

function createPrisma(connectionString: string) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

async function withOrganizationReadContext<T>(
  prisma: PrismaClient,
  organizationId: string,
  read: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`SELECT set_config('app.organization_id', ${organizationId}, true)`);
    return read(tx);
  });
}

async function assertProductionTarget(prisma: PrismaClient) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("POLICY_PREMIUM_BACKFILL_DATABASE_URL_REQUIRED");
  const url = new URL(connectionString);
  const expectedHost = process.env.POLICY_PREMIUM_BACKFILL_PRODUCTION_HOST?.toLowerCase();
  const expectedDatabase = process.env.POLICY_PREMIUM_BACKFILL_PRODUCTION_DATABASE;
  const expectedRole = process.env.POLICY_PREMIUM_BACKFILL_PRODUCTION_ROLE;
  const usePolicyAppUser = process.argv.includes("--use-policy-app-user");
  const roleIsAllowed = expectedRole === "policydesk_backfill"
    || (expectedRole === "policydesk_app" && usePolicyAppUser);
  if (process.env.NODE_ENV !== "production" || process.env.VERCEL === "1" || process.env.VERCEL_ENV) throw new Error("POLICY_PREMIUM_BACKFILL_APPLY_REQUIRES_OPERATOR_RUNTIME");
  if (url.hostname !== expectedHost || decodeURIComponent(url.pathname.replace(/^\//, "").split("?")[0]) !== expectedDatabase || decodeURIComponent(url.username) !== expectedRole || !roleIsAllowed) throw new Error("POLICY_PREMIUM_BACKFILL_TARGET_MISMATCH");
  if (url.searchParams.get("sslmode")?.toLowerCase() !== "verify-full" || !url.hostname.endsWith(".neon.tech")) throw new Error("POLICY_PREMIUM_BACKFILL_TLS_OR_HOST_INVALID");
  const identity = await prisma.$queryRaw<Array<{ role: string; database: string; readOnly: string; superuser: boolean; bypassRls: boolean; login: boolean; inherit: boolean }>>(Prisma.sql`
    SELECT current_user AS role, current_database() AS database,
      current_setting('transaction_read_only') AS "readOnly",
      r.rolsuper AS superuser, r.rolbypassrls AS "bypassRls", r.rolcanlogin AS login, r.rolinherit AS inherit
    FROM pg_roles r WHERE r.rolname=current_user
  `);
  const current = identity[0];
  if (!current || current.role !== expectedRole || current.database !== expectedDatabase || current.readOnly !== "off" || current.superuser || current.bypassRls || !current.login || current.inherit) throw new Error("POLICY_PREMIUM_BACKFILL_ROLE_NOT_RESTRICTED");
}

async function applyPlan(prisma: PrismaClient, organizationId: string, asOfDate: Date, plan: ReturnType<typeof buildPlan>, expectedInputHash: string) {
  const email = process.env.POLICY_PREMIUM_BACKFILL_REVIEWER_EMAIL?.trim();
  if (!email) throw new Error("POLICY_PREMIUM_BACKFILL_REVIEWER_EMAIL_REQUIRED");
  const actor = await withOrganizationReadContext(prisma, organizationId, (tx) => tx.organizationMembership.findFirst({
    where: { organizationId, active: true, role: { in: ["OWNER", "ADMIN"] }, user: { active: true, email: { equals: email, mode: "insensitive" } }, organization: { status: "ACTIVE" } },
    select: { id: true, role: true, user: { select: { id: true, email: true, name: true, role: true, platformRole: true } }, organization: { select: { id: true, name: true, slug: true, status: true } } },
  }));
  if (!actor) throw new Error("POLICY_PREMIUM_BACKFILL_REVIEWER_NOT_ACTIVE_ORGANIZATION_ADMIN");
  const context: OrganizationContext = {
    userId: actor.user.id,
    userEmail: actor.user.email,
    userName: actor.user.name,
    userRole: actor.user.role,
    platformRole: actor.user.platformRole,
    organizationId: actor.organization.id,
    organizationName: actor.organization.name,
    organizationSlug: actor.organization.slug,
    organizationStatus: actor.organization.status,
    membershipId: actor.id,
    membershipRole: actor.role as OrganizationContext["membershipRole"],
  };
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    await assertOrganizationContextInTransaction(tx, context, ["OWNER", "ADMIN"]);
    const fresh = await loadEligiblePolicies(tx, organizationId, asOfDate);
    if (canonicalInputHash(fresh) !== expectedInputHash) throw new Error("POLICY_PREMIUM_BACKFILL_STALE_INPUT");
    const policyIds = fresh.map((policy) => policy.id);
    const beforeFinancialSnapshot = await loadProtectedFinancialSnapshot(tx, organizationId, policyIds);
    for (const item of plan.updates) {
      const current = fresh.find((policy) => policy.id === item.policyId);
      if (!current || current.premiumVatAmount != null || current.premiumIssuanceExpenseAmount != null || current.premiumSurchargeAmount != null || current.premiumDiscountAmount != null) throw new Error(`POLICY_PREMIUM_BACKFILL_POLICY_NOT_EMPTY:${item.outcome.policyNumber}`);
      const updated = await tx.policy.update({
        where: { id: item.policyId, organizationId },
        data: {
          premiumAmount: item.fields.premiumAmount,
          premiumVatAmount: item.fields.premiumVatAmount,
          premiumIssuanceExpenseAmount: item.fields.premiumIssuanceExpenseAmount,
          premiumSurchargeAmount: item.fields.premiumSurchargeAmount,
          premiumDiscountAmount: item.fields.premiumDiscountAmount,
          updatedById: context.userId,
        },
        select: { id: true, premiumAmount: true, premiumVatAmount: true, premiumIssuanceExpenseAmount: true, premiumSurchargeAmount: true, premiumDiscountAmount: true },
      });
      await tx.activityLog.create({
        data: {
          organizationId,
          entityType: "Policy",
          entityId: item.policyId,
          action: item.outcome.status === "CANDIDATE" ? "POLICY_PREMIUM_BREAKDOWN_BACKFILL" : "POLICY_PREMIUM_BREAKDOWN_SOURCE_REVIEW",
          oldValue: safeJson({
            premiumAmount: current.premiumAmount,
            premiumVatAmount: current.premiumVatAmount,
            premiumIssuanceExpenseAmount: current.premiumIssuanceExpenseAmount,
            premiumSurchargeAmount: current.premiumSurchargeAmount,
            premiumDiscountAmount: current.premiumDiscountAmount,
          }),
          newValue: safeJson({ ...updated, sourceReference: item.fields.sourceReference }),
          userId: context.userId,
        },
      });
    }
    const after = await loadEligiblePolicies(tx, organizationId, asOfDate);
    if (await loadProtectedFinancialSnapshot(tx, organizationId, policyIds) !== beforeFinancialSnapshot) throw new Error("POLICY_PREMIUM_BACKFILL_RECEIPTS_PAYMENTS_OR_COMMISSIONS_CHANGED");
    const verificationFailures = plan.updates.filter((item) => {
      const saved = after.find((policy) => policy.id === item.policyId);
      if (!saved) return true;
      const expectedPremium = item.fields.premiumAmount;
      const expected = [item.fields.premiumVatAmount, item.fields.premiumIssuanceExpenseAmount, item.fields.premiumSurchargeAmount, item.fields.premiumDiscountAmount];
      const actual = [saved.premiumVatAmount, saved.premiumIssuanceExpenseAmount, saved.premiumSurchargeAmount, saved.premiumDiscountAmount];
      return Math.abs(saved.premiumAmount - expectedPremium) > 0.001
        || actual.some((value, index) => value === null || Math.abs(value - expected[index]!) > 0.001);
    });
    if (verificationFailures.length) throw new Error(`POLICY_PREMIUM_BACKFILL_POST_WRITE_VERIFICATION_FAILED:${verificationFailures.map((item) => item.outcome.policyNumber).join(",")}`);
    return { updated: plan.updates.length, leftInReview: plan.remainingReview.map((item) => item.policyNumber), protectedFinancialSnapshotSha256: beforeFinancialSnapshot };
  }, { maxWait: 10_000, timeout: 120_000 });
}

async function main() {
  const organizationId = requireArg("organization-id");
  const asOfRaw = requireArg("as-of");
  const asOfDate = new Date(`${asOfRaw}T00:00:00.000Z`);
  if (!Number.isFinite(asOfDate.getTime()) || asOfDate.toISOString().slice(0, 10) !== asOfRaw) throw new Error("POLICY_PREMIUM_BACKFILL_AS_OF_DATE_INVALID");
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("POLICY_PREMIUM_BACKFILL_DATABASE_URL_REQUIRED");
  const prisma = createPrisma(connectionString);
  try {
    if (process.argv.includes("--apply")) await assertProductionTarget(prisma);
    const [policies, sourceReview] = await Promise.all([
      withOrganizationReadContext(prisma, organizationId, (tx) => loadEligiblePolicies(tx, organizationId, asOfDate)),
      loadSourceReview(arg("source-review") ? path.resolve(arg("source-review")!) : null),
    ]);
    const plan = buildPlan(policies, sourceReview);
    assertExpectedScope(plan, sourceReview.entries.length > 0);
    const inputHash = canonicalInputHash(policies);
    const report = {
      mode: process.argv.includes("--apply") ? "apply-preflight" : "dry-run",
      organizationId,
      asOfDate: asOfRaw,
      eligiblePolicyCount: policies.length,
      receiptMatchCandidateCount: plan.outcomes.filter((outcome) => outcome.status === "CANDIDATE").length,
      sourceReviewedCount: plan.sourceReviewedCount,
      remainingReview: plan.remainingReview,
      selectedPolicyCount: plan.updates.length,
      inputHash,
      sourceReviewSha256: sourceReview.entries.length ? sha256(sourceReview) : null,
      outcomes: plan.outcomes.map((outcome) => ({ ...outcome, sourceReviewed: sourceReview.entries.some((entry) => entry.policyNumber === outcome.policyNumber) })),
      updates: plan.updates.map((item) => ({ policyId: item.policyId, policyNumber: item.outcome.policyNumber, fields: item.fields })),
    };
    const reportPath = arg("report");
    if (reportPath) await writeFile(path.resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    if (!process.argv.includes("--apply")) {
      process.stdout.write(`${JSON.stringify({ ...report, reportFile: reportPath ? path.resolve(reportPath) : null }, null, 2)}\n`);
      return;
    }
    if (arg("confirm-apply") !== APPLY_CONFIRMATION) throw new Error(`POLICY_PREMIUM_BACKFILL_APPLY_REQUIRES_--confirm-apply=${APPLY_CONFIRMATION}`);
    if (!sourceReview.entries.length) throw new Error("POLICY_PREMIUM_BACKFILL_SOURCE_REVIEW_FILE_REQUIRED");
    const expectedHash = requireArg("expected-input-sha256");
    if (expectedHash !== inputHash) throw new Error("POLICY_PREMIUM_BACKFILL_EXPECTED_INPUT_HASH_MISMATCH");
    if (requireArg("expected-source-review-sha256") !== sha256(sourceReview)) throw new Error("POLICY_PREMIUM_BACKFILL_EXPECTED_SOURCE_REVIEW_HASH_MISMATCH");
    const result = await applyPlan(prisma, organizationId, asOfDate, plan, inputHash);
    process.stdout.write(`${JSON.stringify({ ...report, mode: "production-apply", result }, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "POLICY_PREMIUM_BACKFILL_FAILED";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
