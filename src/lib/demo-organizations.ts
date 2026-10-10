import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { del, list } from "@vercel/blob";
import { Prisma } from "@/generated/prisma/client";
import { AuthError, hashPassword, requireSuperAdmin } from "@/lib/auth";
import { withSystemOrganizationTransaction } from "@/lib/organization-context";
import { acquireDistributedLock } from "@/lib/request-guards";
import { seedDemoBaseline, validateDemoBaseline, DEMO_SEED_VERSION } from "@/lib/demo-seed";
import { SYSTEM_USER_ID } from "@/lib/tenant-organization-foundation";
import { NORA_CAPTURE_HANDOFF_PREFIX } from "@/lib/nora-capture-handoff-storage.shared";
import { NORA_POLICY_PDF_PREFIX } from "@/lib/nora-pdf-storage.shared";

const DEMO_CAPABILITIES = ["NORA", "IMPORTS", "EXPORTS", "DOCUMENTS", "EMAIL", "TELEGRAM", "WHATSAPP", "QUALITAS"] as const;
const DEMO_ENABLED_CAPABILITIES = new Set(["EXPORTS", "DOCUMENTS"]);

function deterministicId(prefix: string, value: string) {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function slugify(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "prospect";
}

function temporaryPassword() {
  return randomBytes(24).toString("base64url");
}

async function revokeExtraDemoMembers(
  tx: Prisma.TransactionClient,
  input: { organizationId: string; ownerUserId: string; actorUserId: string; requestId: string },
) {
  const memberships = await tx.organizationMembership.findMany({
    where: { organizationId: input.organizationId, userId: { not: input.ownerUserId } },
    select: { userId: true, active: true, user: { select: { active: true, platformRole: true } } },
    orderBy: { userId: "asc" },
  });

  let changed = 0;
  for (const membership of memberships) {
    if (membership.userId === SYSTEM_USER_ID || membership.user.platformRole === "SUPERADMIN") {
      throw new Error("DEMO_SINGLE_USER_INVARIANT_UNSAFE_MEMBER");
    }

    const membershipDeactivated = membership.active;
    const userDeactivated = membership.user.active;
    if (membershipDeactivated) {
      await tx.organizationMembership.updateMany({
        where: { organizationId: input.organizationId, userId: membership.userId, active: true },
        data: { active: false },
      });
    }
    if (userDeactivated) {
      await tx.user.updateMany({
        where: { id: membership.userId, active: true },
        data: { active: false, sessionVersion: { increment: 1 } },
      });
    }
    const revokedSessions = await tx.session.updateMany({
      where: { userId: membership.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const accessChanged = membershipDeactivated || userDeactivated || revokedSessions.count > 0;
    if (accessChanged) {
      changed += 1;
      await tx.platformAuditLog.create({
        data: {
          requestId: deterministicId("request", `${input.requestId}:single-account:${membership.userId}`),
          actorUserId: input.actorUserId,
          targetOrganizationId: input.organizationId,
          targetUserId: membership.userId,
          action: "DEMO_MEMBER_ACCESS_REVOKED",
          reason: "single-account external DEMO reconciliation",
          metadataJson: JSON.stringify({ membershipDeactivated, userDeactivated, sessionsRevoked: revokedSessions.count }),
        },
      });
    }
  }

  return changed;
}

function sanitizedFailureCode(error: unknown, fallback: string) {
  // Only persist errors that are already a standalone machine code. Extracting
  // arbitrary uppercase words from provider messages can persist secret names
  // or fragments of credentials in the operator UI.
  const message = error instanceof Error ? error.message.trim() : "";
  const match = message.match(/^([A-Z][A-Z0-9_]{2,})$/);
  return match?.[0]?.slice(0, 80) ?? fallback;
}

function safeResetErrorDetails(error: unknown) {
  const candidate = typeof error === "object" && error !== null
    ? error as { name?: unknown; code?: unknown; status?: unknown; statusCode?: unknown }
    : {};
  const safeToken = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(value)
    ? value
    : undefined;
  const status = typeof candidate.status === "number" && candidate.status >= 100 && candidate.status <= 599
    ? candidate.status
    : typeof candidate.statusCode === "number" && candidate.statusCode >= 100 && candidate.statusCode <= 599
      ? candidate.statusCode
      : undefined;

  return {
    errorName: safeToken(candidate.name),
    errorCode: safeToken(candidate.code),
    status,
  };
}

export type DemoProvisioningInput = {
  name: string;
  slug?: string;
  ownerName: string;
  /** The external sales-assisted DEMO uses exactly one owner account. */
  requestedUsers?: number;
  requestId?: string;
};
export type DemoCredential = { email: string; password: string; name: string };
export type DemoProvisioningResult = {
  organizationId: string;
  ownerUserId: string;
  ownerEmail: string;
  temporaryPassword: string;
  credentials: DemoCredential[];
  trialEndsAt: Date;
  seedVersion: string;
};

export type DemoOrganizationSummary = {
  organizationId: string;
  name: string;
  slug: string;
  status: string;
  trialEndsAt: Date | null;
  seedVersion: string | null;
  dataVersion: number | null;
  realDataResetAt: Date | null;
  lastResetAt: Date | null;
  resetStatus: string | null;
  resetFailure: string | null;
  activeMemberCount: number;
  userCount: number;
  clientCount: number;
  policyCount: number;
  capabilities: Array<{ key: string; enabled: boolean; limitValue: number | null }>;
  lastActivityAt: Date | null;
};

/** Platform read model for the operator DEMO console. No tenant rows or
 * credential material are returned to the browser. */
export async function listDemoOrganizationSummaries(): Promise<DemoOrganizationSummary[]> {
  await requireSuperAdmin();
  const db = (await import("@/lib/db")).getDb();
  const organizations = await db.organization.findMany({
    where: { kind: "DEMO" },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      demoState: {
        select: {
          trialEndsAt: true,
          seedVersion: true,
          dataVersion: true,
          realDataResetAt: true,
          lastResetAt: true,
          resetStatus: true,
          resetFailure: true,
        },
      },
      capabilities: { select: { key: true, enabled: true, limitValue: true }, orderBy: { key: "asc" } },
      memberships: { select: { active: true, user: { select: { active: true } } } },
      platformAuditTargets: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1, select: { createdAt: true } },
    },
  });

  // Platform operators have no tenant membership. Counts therefore run as
  // explicit, one-organization system transactions so forced RLS never
  // turns a global platform page into an unscoped protected-table query.
  const tenantCounts = await Promise.all(organizations.map(async (organization) => {
    try {
      return await withSystemOrganizationTransaction(organization.id, "demo summary", async (tx) => ({
        organizationId: organization.id,
        clientCount: await tx.client.count({ where: { organizationId: organization.id } }),
        policyCount: await tx.policy.count({ where: { organizationId: organization.id } }),
      }));
    } catch {
      return { organizationId: organization.id, clientCount: 0, policyCount: 0 };
    }
  }));
  const countByOrganization = new Map(tenantCounts.map((counts) => [counts.organizationId, counts]));

  return organizations.map((organization) => ({
    organizationId: organization.id,
    name: organization.name,
    slug: organization.slug,
    status: organization.status,
    trialEndsAt: organization.demoState?.trialEndsAt ?? null,
    seedVersion: organization.demoState?.seedVersion ?? null,
    dataVersion: organization.demoState?.dataVersion ?? null,
    realDataResetAt: organization.demoState?.realDataResetAt ?? null,
    lastResetAt: organization.demoState?.lastResetAt ?? null,
    resetStatus: organization.demoState?.resetStatus ?? null,
    resetFailure: organization.demoState?.resetFailure ?? null,
    activeMemberCount: organization.memberships.filter((membership) => membership.active && membership.user.active).length,
    userCount: organization.memberships.length,
    clientCount: countByOrganization.get(organization.id)?.clientCount ?? 0,
    policyCount: countByOrganization.get(organization.id)?.policyCount ?? 0,
    capabilities: organization.capabilities,
    lastActivityAt: organization.platformAuditTargets[0]?.createdAt ?? null,
  }));
}

/** Platform-only, idempotent sales-assisted DEMO organization factory. */
export async function provisionDemoOrganization(input: DemoProvisioningInput): Promise<DemoProvisioningResult> {
  const actor = await requireSuperAdmin();
  if (process.env.PLATFORM_ORG_PROVISIONING_ENABLED !== "1") {
    throw new AuthError("La provisión de organizaciones está deshabilitada por configuración.", 503);
  }
  const name = input.name.trim();
  if (!name || name.length > 160) throw new Error("DEMO_NAME_INVALID");
  const ownerName = input.ownerName.trim() || "DEMO Owner";
  if (ownerName.length > 160) throw new Error("DEMO_OWNER_NAME_INVALID");
  const requestId = String(input.requestId ?? "").trim() || deterministicId("request", `${name}:${input.slug ?? ""}`);
  if (requestId.length > 128) throw new Error("DEMO_REQUEST_ID_INVALID");
  const slug = slugify(input.slug || name);
  const organizationId = deterministicId("org_demo", slug);
  const ownerUserId = deterministicId("usr_demo", `${slug}:owner`);
  const ownerEmail = `${slug}.owner@policydesk.local`;
  const password = temporaryPassword();
  const requestedUserCount = input.requestedUsers === undefined ? 1 : Number(input.requestedUsers);
  if (requestedUserCount !== 1) throw new Error("DEMO_SINGLE_USER_REQUIRED");
  const now = new Date();
  const trialEndsAt = new Date(now.getTime() + 30 * 86_400_000);
  // This initial transaction writes only platform/control rows. Synthetic
  // tenant rows are created later inside withSystemOrganizationTransaction.
  const db = (await import("@/lib/db")).getDb();
  const lock = await acquireDistributedLock(`demo-provision:${organizationId}`, 10 * 60_000, true);
  if (!lock.acquired) throw new Error("DEMO_PROVISION_LOCK_UNAVAILABLE");

  try {
    const setup = await db.$transaction(async (tx) => {
    const existing = await tx.organization.findUnique({ where: { id: organizationId }, select: { id: true, kind: true, status: true, name: true, slug: true } });
    if (existing && existing.kind !== "DEMO") throw new Error("DEMO_ID_COLLIDES_WITH_NON_DEMO_ORGANIZATION");
    if (existing && (existing.slug !== slug || existing.name !== name)) throw new Error("DEMO_ID_ALREADY_PROVISIONED_DIFFERENT_INPUT");
    if (existing) await revokeExtraDemoMembers(tx, { organizationId, ownerUserId, actorUserId: actor.id, requestId });
    if (existing?.status === "ACTIVE") {
      for (const key of DEMO_CAPABILITIES) {
        const enabled = DEMO_ENABLED_CAPABILITIES.has(key);
        await tx.organizationCapability.upsert({ where: { organizationId_key: { organizationId, key } }, update: { enabled, limitValue: null, source: "DEMO_DEFAULT" }, create: { organizationId, key, enabled, limitValue: null, source: "DEMO_DEFAULT" } });
      }
      const state = await tx.demoOrganizationState.findUnique({ where: { organizationId }, select: { trialEndsAt: true } });
      return { active: true as const, temporaryPassword: "", trialEndsAt: state?.trialEndsAt ?? trialEndsAt, requestId };
    }
    await tx.organization.upsert({ where: { id: organizationId }, update: { name, slug, kind: "DEMO", status: "PROVISIONING" }, create: { id: organizationId, name, slug, kind: "DEMO", status: "PROVISIONING", timeZone: "America/Mexico_City", defaultCurrency: "MXN" } });
    await tx.user.upsert({ where: { id: ownerUserId }, update: { email: ownerEmail, name: ownerName, role: "ADMIN", platformRole: "NONE", active: true, mustChangePassword: true, passwordHash: hashPassword(password), temporaryPasswordExpiresAt: new Date(now.getTime() + 86_400_000) }, create: { id: ownerUserId, email: ownerEmail, name: ownerName, passwordHash: hashPassword(password), role: "ADMIN", platformRole: "NONE", active: true, mustChangePassword: true, temporaryPasswordExpiresAt: new Date(now.getTime() + 86_400_000) } });
    await tx.organizationMembership.upsert({ where: { userId: ownerUserId }, update: { organizationId, role: "OWNER", active: true }, create: { organizationId, userId: ownerUserId, role: "OWNER", active: true } });
    // The DEMO plan is platform configuration, installed by a versioned
    // migration. Runtime app credentials may read it but must never create or
    // mutate plan definitions while provisioning a tenant.
    const plan = await tx.plan.findUnique({ where: { code: "DEMO" }, select: { id: true, active: true } });
    if (!plan?.active) throw new Error("DEMO_PLAN_MISSING");
    await tx.organizationSubscription.upsert({ where: { requestId: `demo-subscription:${organizationId}` }, update: { organizationId, planId: plan.id, status: "TRIAL", endsAt: trialEndsAt, monthlyAmountMinor: 0, currency: "USD" }, create: { requestId: `demo-subscription:${organizationId}`, organizationId, planId: plan.id, status: "TRIAL", endsAt: trialEndsAt, monthlyAmountMinor: 0, currency: "USD" } });
    for (const key of DEMO_CAPABILITIES) {
      const enabled = DEMO_ENABLED_CAPABILITIES.has(key);
      await tx.organizationCapability.upsert({ where: { organizationId_key: { organizationId, key } }, update: { enabled, limitValue: null, source: "DEMO_DEFAULT" }, create: { organizationId, key, enabled, limitValue: null, source: "DEMO_DEFAULT" } });
    }
    const existingState = await tx.demoOrganizationState.findUnique({ where: { organizationId }, select: { trialEndsAt: true } });
    const effectiveTrialEndsAt = existingState?.trialEndsAt ?? trialEndsAt;
    await tx.demoOrganizationState.upsert({ where: { organizationId }, update: { seedVersion: DEMO_SEED_VERSION, trialEndsAt: effectiveTrialEndsAt, resetStatus: "IDLE", resetFailure: null }, create: { organizationId, seedVersion: DEMO_SEED_VERSION, trialEndsAt: effectiveTrialEndsAt, resetStatus: "IDLE", dataVersion: 1 } });
      return { active: false as const, temporaryPassword: password, trialEndsAt: effectiveTrialEndsAt, requestId };
    });
    if (setup.active) return { organizationId, ownerUserId, ownerEmail, temporaryPassword: setup.temporaryPassword, credentials: [], trialEndsAt: setup.trialEndsAt, seedVersion: DEMO_SEED_VERSION };

    try {
      return await withSystemOrganizationTransaction(organizationId, "demo provision", async (tx) => {
        const credentials: DemoCredential[] = setup.temporaryPassword ? [{ email: ownerEmail, password: setup.temporaryPassword, name: ownerName }] : [];
        await seedDemoBaseline(tx, organizationId, ownerUserId);
        const seedCounts = await validateDemoBaseline(tx, organizationId);
        await tx.organization.update({ where: { id: organizationId }, data: { status: "ACTIVE" } });
        await tx.platformAuditLog.create({ data: { requestId: setup.requestId ?? deterministicId("request", `${organizationId}:provision`), actorUserId: actor.id, targetOrganizationId: organizationId, targetUserId: ownerUserId, action: "DEMO_ORGANIZATION_PROVISIONED", reason: "sales-assisted demo provisioning", metadataJson: JSON.stringify({ seedVersion: DEMO_SEED_VERSION, ...seedCounts }) } });
        return { organizationId, ownerUserId, ownerEmail, temporaryPassword: setup.temporaryPassword, credentials, trialEndsAt: setup.trialEndsAt, seedVersion: DEMO_SEED_VERSION };
      });
    } catch (error) {
      // Keep the organization in PROVISIONING, but expose a durable failure
      // state and operator audit trail so a retry cannot look active while the
      // synthetic baseline is incomplete.
      const failure = sanitizedFailureCode(error, "DEMO_PROVISIONING_FAILED");
      await withSystemOrganizationTransaction(organizationId, "demo provision", async (tx) => {
        await tx.demoOrganizationState.updateMany({ where: { organizationId }, data: { resetStatus: "FAILED", resetFailure: failure } });
        await tx.platformAuditLog.create({ data: { requestId: setup.requestId ?? requestId, actorUserId: actor.id, targetOrganizationId: organizationId, targetUserId: ownerUserId, action: "DEMO_ORGANIZATION_PROVISION_FAILED", reason: "synthetic baseline validation failed", metadataJson: JSON.stringify({ failure, seedVersion: DEMO_SEED_VERSION }) } });
      }).catch(() => undefined);
      throw error;
    }
  } finally {
    await lock.release();
  }
}

async function deleteDemoTenantRows(tx: Prisma.TransactionClient, organizationId: string) {
  // Child-first deletion keeps existing foreign keys valid while preserving
  // the organization, users, memberships, subscription and capabilities.
  await tx.notificationEvent.deleteMany({ where: { organizationId } });
  await tx.workItem.deleteMany({ where: { organizationId } });
  await tx.alert.deleteMany({ where: { organizationId } });
  await tx.claimChecklistItem.deleteMany({ where: { organizationId } });
  await tx.claim.deleteMany({ where: { organizationId } });
  await tx.payment.deleteMany({ where: { organizationId } });
  await tx.commissionCorrection.deleteMany({ where: { organizationId } });
  await tx.commissionStatementRow.deleteMany({ where: { organizationId } });
  await tx.commissionStatement.deleteMany({ where: { organizationId } });
  await tx.commission.deleteMany({ where: { organizationId } });
  await tx.receipt.deleteMany({ where: { organizationId } });
  await tx.policyEndorsement.deleteMany({ where: { organizationId } });
  await tx.policy.deleteMany({ where: { organizationId } });
  await tx.task.deleteMany({ where: { organizationId } });
  await tx.quoteComparisonItem.deleteMany({ where: { organizationId } });
  await tx.quoteComparison.deleteMany({ where: { organizationId } });
  await tx.quote.deleteMany({ where: { organizationId } });
  await tx.document.deleteMany({ where: { organizationId } });
  await tx.client.deleteMany({ where: { organizationId } });
  await tx.insurer.deleteMany({ where: { organizationId } });
  await tx.knowledgeChunk.deleteMany({ where: { organizationId } });
  await tx.knowledgeSource.deleteMany({ where: { organizationId } });
  await tx.assistantAiAttempt.deleteMany({ where: { organizationId } });
  await tx.assistantAiRun.deleteMany({ where: { organizationId } });
  await tx.assistantReportSignal.deleteMany({ where: { organizationId } });
  await tx.assistantReport.deleteMany({ where: { organizationId } });
  await tx.assistantActionDraft.deleteMany({ where: { organizationId } });
  await tx.activityLog.deleteMany({ where: { organizationId } });
  await tx.telegramDraft.deleteMany({ where: { organizationId } });
  await tx.telegramLinkToken.deleteMany({ where: { organizationId } });
  await tx.notificationPreference.deleteMany({ where: { organizationId } });
  // These rows reference MaintenanceRun, Receipt, Policy and suppression rules.
  // Delete them before those parents so resets also work against Production's
  // deployed foreign keys, which may not yet have the schema's SET NULL action.
  await tx.receiptReconciliationIssue.deleteMany({ where: { organizationId } });
  await tx.policyRenewalSuggestion.deleteMany({ where: { organizationId } });
  await tx.maintenanceRun.deleteMany({ where: { organizationId } });
  await tx.dataQualitySuppressionRule.deleteMany({ where: { organizationId } });
  await tx.ledgerImportIssue.deleteMany({ where: { organizationId } });
  await tx.ledgerImportAction.deleteMany({ where: { organizationId } });
  await tx.ledgerImportRow.deleteMany({ where: { organizationId } });
  await tx.ledgerImportBatch.deleteMany({ where: { organizationId } });
  await tx.policyInsuredParty.deleteMany({ where: { organizationId } });
  await tx.policyInsuredAsset.deleteMany({ where: { organizationId } });
  await tx.demoUploadArtifact.deleteMany({ where: { organizationId } });
}

function demoBlobPrefixes(organizationId: string) {
  const safeOrganizationId = organizationId.trim().replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 96) || "unknown";
  return [
    `${safeOrganizationId}/documents/`,
    `${NORA_POLICY_PDF_PREFIX}/${safeOrganizationId}/`,
    `${NORA_CAPTURE_HANDOFF_PREFIX}/${safeOrganizationId}/`,
  ];
}

/**
 * Remove private objects that may not yet have a ledger row (for example a
 * browser upload abandoned before analysis creates DemoUploadArtifact).
 * Prefixes are derived from the exact organization id and are never caller
 * supplied paths. Pagination makes the reset complete for large DEMOs.
 */
async function purgeDemoPrivateBlobs(organizationId: string) {
  let purged = 0;
  for (const prefix of demoBlobPrefixes(organizationId)) {
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
      if (page.blobs.length > 0) {
        await Promise.all(page.blobs.map((blob) => del(blob.url)));
        purged += page.blobs.length;
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  }
  return purged;
}

async function performDemoReset(organizationId: string, requestId: string, dryRun: boolean, actorUserId: string, reason: string) {
  const lock = await acquireDistributedLock(`demo-reset:${organizationId}`, 120_000, true);
  if (!lock.acquired) throw new Error("DEMO_RESET_LOCK_UNAVAILABLE");
  let resetStarted = false;
  let fencingVersion: number | null = null;
  let phase = "PREPARING";
  try {
    const resetPlan = await withSystemOrganizationTransaction(organizationId, "demo reset", async (tx) => {
      const organization = await tx.organization.findUnique({ where: { id: organizationId }, select: { id: true, kind: true, status: true } });
      if (!organization || organization.kind !== "DEMO") throw new Error("DEMO_RESET_REQUIRES_DEMO_ORGANIZATION");
      let state = await tx.demoOrganizationState.findUnique({ where: { organizationId } });
      if (!state) throw new Error("DEMO_STATE_MISSING");
      // Preview is strictly read-only, including when an old reset lease has
      // expired. Recovery belongs exclusively to an actual reset request.
      if (dryRun) {
        const counts = { clients: await tx.client.count({ where: { organizationId } }), policies: await tx.policy.count({ where: { organizationId } }) };
        const artifactCount = await tx.demoUploadArtifact.count({ where: { organizationId, status: "ACTIVE" } });
        return { organizationId, requestId, dryRun: true, counts, artifactCount };
      }
      if (state.resetStatus === "RESETTING") {
        // Compare the timestamp without time zone in PostgreSQL. Parsing this
        // value into a JavaScript Date shifts it when the runner's TZ is not
        // UTC, which can make an expired lease appear live for hours.
        const lease = await tx.$queryRaw<Array<{ expired: boolean }>>(Prisma.sql`
          SELECT ("resetLeaseExpiresAt" IS NULL OR
            "resetLeaseExpiresAt" <= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) AS expired
            FROM "DemoOrganizationState"
           WHERE "organizationId" = ${organizationId}
           FOR UPDATE
        `);
        if (!lease[0]?.expired) throw new Error("DEMO_RESET_ALREADY_RUNNING");
        await tx.demoOrganizationState.update({ where: { organizationId }, data: { resetStatus: "FAILED", resetPhase: "RECOVERING", resetFailure: "DEMO_RESET_LEASE_EXPIRED", resetAttemptId: null, resetLeaseExpiresAt: null, resetHeartbeatAt: new Date() } });
        await tx.organization.updateMany({ where: { id: organizationId, kind: "DEMO" }, data: { status: "SUSPENDED" } });
        await tx.platformAuditLog.create({ data: { targetOrganizationId: organizationId, action: "DEMO_RESET_STALE_RECOVERED", reason: "reset lease expired before completion" } });
        state = { ...state, resetStatus: "FAILED", dataVersion: state.dataVersion };
      }
      const counts = { clients: await tx.client.count({ where: { organizationId } }), policies: await tx.policy.count({ where: { organizationId } }) };
      if (!dryRun && state.resetRequestId === requestId && state.resetStatus === "IDLE" && state.lastResetAt) {
        return { organizationId, requestId, dryRun: false, replayed: true, counts };
      }
      await tx.organization.update({ where: { id: organizationId }, data: { status: "RESETTING" } });
      // Advance the fencing version at reset start. If the lease expires and
      // another worker takes over, its newer version prevents this worker
      // from reseeding or reactivating the tenant.
      const nextDataVersion = state.dataVersion + 1;
      const attemptId = randomUUID();
      const leaseExpiresAt = new Date(Date.now() + 120_000);
      const started = await tx.demoOrganizationState.updateMany({ where: { organizationId, dataVersion: state.dataVersion, resetStatus: { in: ["IDLE", "FAILED"] } }, data: { resetStatus: "RESETTING", resetFailure: null, dataVersion: nextDataVersion } });
      if (started.count !== 1) throw new Error("DEMO_RESET_ALREADY_RUNNING");
      await tx.demoOrganizationState.update({ where: { organizationId }, data: { resetPhase: "PREPARING", resetAttemptId: attemptId, resetRequestId: requestId, resetStartedAt: new Date(), resetHeartbeatAt: new Date(), resetLeaseExpiresAt: leaseExpiresAt, resetAttempts: { increment: 1 } } });
      const demoUsers = await tx.organizationMembership.findMany({ where: { organizationId }, select: { userId: true } });
      await tx.user.updateMany({ where: { id: { in: demoUsers.map(({ userId }) => userId) } }, data: { sessionVersion: { increment: 1 } } });
      await tx.session.updateMany({ where: { userId: { in: demoUsers.map(({ userId }) => userId) }, revokedAt: null }, data: { revokedAt: new Date() } });
      const artifacts = await tx.demoUploadArtifact.findMany({ where: { organizationId, status: "ACTIVE" }, select: { blobPath: true } });
      return { organizationId, requestId, dryRun: false, counts, dataVersion: nextDataVersion, attemptId, artifacts: artifacts.map(({ blobPath }) => blobPath), userIds: demoUsers.map(({ userId }) => userId) };
    });
    if (resetPlan.dryRun || ("replayed" in resetPlan && resetPlan.replayed)) return resetPlan;

    resetStarted = true;
    fencingVersion = resetPlan.dataVersion ?? null;
    phase = "PURGING_ARTIFACTS";
    await withSystemOrganizationTransaction(organizationId, "demo reset", (tx) => tx.demoOrganizationState.updateMany({ where: { organizationId, resetAttemptId: resetPlan.attemptId, dataVersion: resetPlan.dataVersion, resetStatus: "RESETTING" }, data: { resetPhase: "PURGING", resetHeartbeatAt: new Date(), resetLeaseExpiresAt: new Date(Date.now() + 120_000) } }));
    for (const blobPath of resetPlan.artifacts ?? []) {
      if (blobPath.startsWith("blob:")) await del(blobPath.slice("blob:".length));
      // Renew after every object so a large tenant cannot outlive its lease.
      // A failed renewal fences the worker before reseed/reactivation.
      if (!(await lock.renew())) {
        throw new Error("DEMO_RESET_LOCK_EXPIRED");
      }
    }

    // A reset may process many private objects. Renew the owner token before
    // the destructive/reseed transaction; a worker whose lease expired is
    // fenced out and can never reactivate the organization.
    if (!(await lock.renew())) {
      throw new Error("DEMO_RESET_LOCK_EXPIRED");
    }

    // The artifact ledger is authoritative for accepted documents, but a
    // client can disconnect after a Blob upload and before its ledger row is
    // committed. Prefix cleanup closes that orphan window and removes Nora
    // handoffs/temporary PDFs as part of the same DEMO reset boundary.
    phase = "PURGING_PRIVATE_BLOBS";
    await purgeDemoPrivateBlobs(organizationId);
    phase = "RESEEDING";
    await withSystemOrganizationTransaction(organizationId, "demo reset", (tx) => tx.demoOrganizationState.updateMany({ where: { organizationId, resetAttemptId: resetPlan.attemptId, dataVersion: resetPlan.dataVersion, resetStatus: "RESETTING" }, data: { resetPhase: "RESEEDING", resetHeartbeatAt: new Date(), resetLeaseExpiresAt: new Date(Date.now() + 120_000) } }));
    if (!(await lock.renew())) {
      throw new Error("DEMO_RESET_LOCK_EXPIRED");
    }

    return await withSystemOrganizationTransaction(organizationId, "demo reset", async (tx) => {
      const organization = await tx.organization.findUnique({ where: { id: organizationId }, select: { id: true, kind: true, status: true } });
      if (!organization || organization.kind !== "DEMO" || organization.status !== "RESETTING") throw new Error("DEMO_RESET_STATE_CHANGED");
      // Hold the state row lock across deletion and reseeding. If a lease
      // expires, a replacement worker may queue behind this transaction, but
      // the stale worker still cannot publish ACTIVE because of the
      // dataVersion compare-and-swap below.
      const lockedStates = await tx.$queryRaw<Array<{ organizationId: string; trialEndsAt: Date; resetStatus: string; dataVersion: number }>>(Prisma.sql`
        SELECT "organizationId", "trialEndsAt", "resetStatus", "dataVersion"
          FROM "DemoOrganizationState"
         WHERE "organizationId" = ${organizationId}
         FOR UPDATE
      `);
      const state = lockedStates[0];
      if (!state || state.resetStatus !== "RESETTING") throw new Error("DEMO_RESET_STATE_CHANGED");
      if (state.dataVersion !== resetPlan.dataVersion) throw new Error("DEMO_RESET_FENCING_FAILED");
      phase = "VERIFYING_AND_SEEDING";
      await tx.demoOrganizationState.updateMany({ where: { organizationId, resetAttemptId: resetPlan.attemptId, dataVersion: resetPlan.dataVersion, resetStatus: "RESETTING" }, data: { resetPhase: "VERIFYING", resetHeartbeatAt: new Date(), resetLeaseExpiresAt: new Date(Date.now() + 120_000) } });
      await deleteDemoTenantRows(tx, organizationId);
      const owner = await tx.organizationMembership.findFirst({ where: { organizationId, role: "OWNER", active: true }, select: { userId: true } });
      if (!owner) throw new Error("DEMO_OWNER_MISSING");
      await seedDemoBaseline(tx, organizationId, owner.userId);
      const seedCounts = await validateDemoBaseline(tx, organizationId);
      if (!(await lock.renew())) {
        throw new Error("DEMO_RESET_LOCK_EXPIRED");
      }
      // A trial can expire while the reset is purging/reseeding. Publish the
      // final lifecycle state atomically so a successful reset never exposes
      // an expired DEMO as ACTIVE, even for one request between transactions.
      const trialExpired = state.trialEndsAt <= new Date();
      const fencedState = await tx.demoOrganizationState.updateMany({ where: { organizationId, dataVersion: resetPlan.dataVersion, resetAttemptId: resetPlan.attemptId, resetStatus: "RESETTING" }, data: { resetStatus: "IDLE", resetPhase: "IDLE", resetAttemptId: null, resetHeartbeatAt: null, resetLeaseExpiresAt: null, lastResetAt: new Date(), realDataResetAt: null, resetFailure: null, dataVersion: { increment: 1 } } });
      if (fencedState.count !== 1) throw new Error("DEMO_RESET_FENCING_FAILED");
      const reactivated = await tx.organization.updateMany({ where: { id: organizationId, status: "RESETTING" }, data: { status: trialExpired ? "SUSPENDED" : "ACTIVE" } });
      if (reactivated.count !== 1) throw new Error("DEMO_RESET_STATE_CHANGED");
      await tx.platformAuditLog.create({ data: { requestId, actorUserId: actorUserId === SYSTEM_USER_ID ? null : actorUserId, targetOrganizationId: organizationId, action: "DEMO_ORGANIZATION_RESET", reason, metadataJson: JSON.stringify(seedCounts) } });
      return { organizationId, requestId, dryRun: false, counts: seedCounts };
    }, { maxWait: 15_000, timeout: 120_000 });
  } catch (error) {
    if (resetStarted) {
      const diagnostic = safeResetErrorDetails(error);
      console.error("DEMO_RESET_FAILED", {
        requestId,
        organizationId,
        phase,
        ...diagnostic,
      });
      try {
        await withSystemOrganizationTransaction(organizationId, "demo reset", async (tx) => {
          const failure = `${phase}_${sanitizedFailureCode(error, "DEMO_RESET_FAILED")}`;
          // Only the worker holding this fencing version may publish failure
          // state. A stale worker must not overwrite a newer reset attempt.
          // This CAS is also safe after a lease expiry: it leaves the tenant
          // suspended instead of marooning it in RESETTING.
          const fencedFailure = await tx.demoOrganizationState.updateMany({ where: { organizationId, ...(fencingVersion === null ? {} : { dataVersion: fencingVersion }), resetStatus: "RESETTING" }, data: { resetStatus: "FAILED", resetPhase: "IDLE", resetAttemptId: null, resetHeartbeatAt: null, resetLeaseExpiresAt: null, resetFailure: failure } });
          if (fencedFailure.count === 0) return;
          await tx.organization.updateMany({ where: { id: organizationId, kind: "DEMO", status: "RESETTING" }, data: { status: "SUSPENDED" } });
          await tx.platformAuditLog.create({ data: { requestId, actorUserId: actorUserId === SYSTEM_USER_ID ? null : actorUserId, targetOrganizationId: organizationId, action: "DEMO_ORGANIZATION_RESET_FAILED", reason: `${reason}: reset verification or private-file purge failed`, metadataJson: JSON.stringify({ failure }) } });
        });
      } catch (auditError) {
        console.error("DEMO_RESET_FAILURE_AUDIT_FAILED", auditError);
      }
    }
    throw error;
  } finally {
    await lock.release();
  }
}

export async function resetDemoOrganization(organizationId: string, requestId: string, dryRun = false, reason = "operator requested demo reset") {
  const actor = await requireSuperAdmin();
  const cleanRequestId = requestId.trim();
  if (!cleanRequestId || cleanRequestId.length > 128) throw new Error("DEMO_REQUEST_ID_INVALID");
  return performDemoReset(organizationId, cleanRequestId, dryRun, actor.id, reason);
}

/** Cron-only entry point. The caller is already authenticated by CRON_SECRET. */
export async function resetDemoOrganizationForSystem(organizationId: string, requestId: string) {
  const cleanRequestId = requestId.trim();
  if (!cleanRequestId || cleanRequestId.length > 128) throw new Error("DEMO_REQUEST_ID_INVALID");
  return performDemoReset(organizationId, cleanRequestId, false, SYSTEM_USER_ID, "scheduled seven-day real-data purge");
}

/** Explicit operator CLI entry point. It never accepts a tenant kind from the
 * caller; the reset transaction verifies DEMO classification before writing. */
export async function resetDemoOrganizationForCli(organizationId: string, requestId: string, dryRun = false, reason?: string) {
  const cleanOrganizationId = organizationId.trim();
  if (!cleanOrganizationId || cleanOrganizationId.length > 160) throw new Error("DEMO_ORGANIZATION_ID_REQUIRED");
  const cleanRequestId = requestId.trim();
  if (!cleanRequestId || cleanRequestId.length > 128) throw new Error("DEMO_REQUEST_ID_INVALID");
  const cleanReason = reason?.trim() ?? "";
  if (cleanReason.length < 8 || cleanReason.length > 500) throw new Error("DEMO_RESET_REASON_REQUIRED");
  return performDemoReset(cleanOrganizationId, cleanRequestId, dryRun, SYSTEM_USER_ID, cleanReason);
}

export async function extendDemoTrial(organizationId: string, days: number, reason: string) {
  const actor = await requireSuperAdmin();
  if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error("INVALID_TRIAL_EXTENSION");
  const cleanReason = reason.trim();
  if (cleanReason.length < 8 || cleanReason.length > 500) throw new Error("DEMO_TRIAL_REASON_REQUIRED");
  return withSystemOrganizationTransaction(organizationId, "demo trial extend", async (tx) => {
    const state = await tx.demoOrganizationState.findUnique({ where: { organizationId } });
    const org = await tx.organization.findUnique({ where: { id: organizationId }, select: { kind: true } });
    if (!state || org?.kind !== "DEMO") throw new Error("DEMO_TRIAL_REQUIRES_DEMO_ORGANIZATION");
    const trialEndsAt = new Date(Math.max(state.trialEndsAt.getTime(), Date.now()) + days * 86_400_000);
    await tx.demoOrganizationState.update({ where: { organizationId }, data: { trialEndsAt } });
    // Keep the billing snapshot aligned with the DEMO lifecycle. The
    // capability resolver and operator verifier must observe the same trial
    // deadline regardless of which control-plane table they read.
    await tx.organizationSubscription.updateMany({
      where: { organizationId, status: "TRIAL" },
      data: { endsAt: trialEndsAt },
    });
    await tx.platformAuditLog.create({ data: { actorUserId: actor.id, targetOrganizationId: organizationId, action: "DEMO_TRIAL_EXTENDED", reason: cleanReason, metadataJson: JSON.stringify({ days, trialEndsAt }) } });
    return trialEndsAt;
  });
}

export async function suspendOrganization(organizationId: string, reason: string) {
  const actor = await requireSuperAdmin();
  const cleanReason = reason.trim();
  if (cleanReason.length < 8 || cleanReason.length > 500) throw new Error("ORGANIZATION_SUSPENSION_REASON_REQUIRED");
  return withSystemOrganizationTransaction(organizationId, "organization suspend", async (tx) => {
    const organization = await tx.organization.findUnique({ where: { id: organizationId }, select: { id: true, status: true } });
    if (!organization) throw new Error("ORGANIZATION_NOT_FOUND");
    await tx.organization.update({ where: { id: organizationId }, data: { status: "SUSPENDED" } });
    await tx.user.updateMany({ where: { organizationMemberships: { some: { organizationId } } }, data: { sessionVersion: { increment: 1 } } });
    await tx.session.updateMany({ where: { user: { organizationMemberships: { some: { organizationId } } }, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.platformAuditLog.create({ data: { actorUserId: actor.id, targetOrganizationId: organizationId, action: "ORGANIZATION_SUSPENDED", reason: cleanReason } });
    return { organizationId, previousStatus: organization.status, status: "SUSPENDED" as const };
  });
}

export async function reactivateOrganization(organizationId: string, reason: string) {
  const actor = await requireSuperAdmin();
  const cleanReason = reason.trim();
  if (cleanReason.length < 8 || cleanReason.length > 500) throw new Error("ORGANIZATION_REACTIVATION_REASON_REQUIRED");
  return withSystemOrganizationTransaction(organizationId, "organization reactivate", async (tx) => {
    const organization = await tx.organization.findUnique({ where: { id: organizationId }, select: { id: true, kind: true, status: true, demoState: { select: { trialEndsAt: true, resetStatus: true } } } });
    if (!organization) throw new Error("ORGANIZATION_NOT_FOUND");
    const demoState = organization.demoState;
    if (organization.kind === "DEMO" && demoState && demoState.resetStatus === "FAILED") throw new Error("DEMO_RESET_REQUIRES_REMEDIATION");
    if (organization.kind === "DEMO" && (!demoState || demoState.trialEndsAt <= new Date())) throw new Error("DEMO_TRIAL_EXPIRED");
    await tx.organization.update({ where: { id: organizationId }, data: { status: "ACTIVE" } });
    await tx.platformAuditLog.create({ data: { actorUserId: actor.id, targetOrganizationId: organizationId, action: "ORGANIZATION_REACTIVATED", reason: cleanReason } });
    return { organizationId, previousStatus: organization.status, status: "ACTIVE" as const };
  });
}
