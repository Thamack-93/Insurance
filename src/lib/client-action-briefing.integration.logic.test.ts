import { afterAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { getDb, resetDb } from "@/lib/db";
import { portfolioReadScope } from "@/lib/portfolio-access";
import type { OrganizationContext } from "@/lib/organization-context";

const contextState = vi.hoisted(() => ({ current: null as OrganizationContext | null }));
vi.mock("server-only", () => ({}));
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, connection: vi.fn(async () => undefined) };
});
vi.mock("@/lib/organization-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/organization-context")>();
  return {
    ...actual,
    requireOrganizationContext: vi.fn(async () => {
      if (!contextState.current) throw new Error("TEST_ORGANIZATION_CONTEXT_NOT_SET");
      return contextState.current;
    }),
  };
});

import { getClientActionBriefingFromDb, getClientActionOverview } from "@/lib/client-action-briefing";
import { withTenantTransaction } from "@/lib/organization-context";

const enabled = process.env.TENANT_ISOLATION_TEST_DB === "1" && process.env.PLAYWRIGHT_ENFORCE_DISPOSABLE_DB === "1";
const describeDisposable = enabled ? describe : describe.skip;
const ORGANIZATION_A = "org_legacy_singleton_0001";
const ORGANIZATION_B = "org_pedro_gomez_0001";

function assertLocalDatabase() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is required for the disposable Client Action Briefing integration.");
  const host = new URL(value).hostname.toLowerCase();
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host)) {
    throw new Error("Client Action Briefing integration tests require a disposable local PostgreSQL database.");
  }
}

async function readContext(db: PrismaClient, userId: string): Promise<OrganizationContext> {
  const membership = await db.organizationMembership.findUnique({ where: { userId }, include: { user: true, organization: true } });
  if (!membership || !membership.active || !membership.user.active || membership.organization.status !== "ACTIVE") {
    throw new Error(`CLIENT_ACTION_FIXTURE_MEMBERSHIP_INVALID:${userId}`);
  }
  return {
    userId: membership.userId,
    userEmail: membership.user.email,
    userName: membership.user.name,
    userRole: membership.user.role,
    platformRole: membership.user.platformRole,
    organizationId: membership.organizationId,
    organizationName: membership.organization.name,
    organizationSlug: membership.organization.slug,
    organizationStatus: membership.organization.status,
    membershipId: membership.id,
    membershipRole: membership.role as OrganizationContext["membershipRole"],
  };
}

describeDisposable("Client Action Briefing disposable PostgreSQL integration", () => {
  it("loads only the authorized client portfolio and organization, with direct source links", async () => {
    assertLocalDatabase();
    const db = getDb();
    const suffix = `${process.pid}-${Date.now()}`;
    const created: Array<{ organizationId: string; insurerId: string; clientId: string; policyId: string; receiptId: string; taskId: string; claimId: string }> = [];

    async function seed(input: { organizationId: string; ownerId: string; label: string }) {
      const insurer = await db.insurer.create({ data: { organizationId: input.organizationId, name: `Client Brief ${input.label}` } });
      const client = await db.client.create({
        data: { organizationId: input.organizationId, fullName: `Client Brief ${input.label}`, type: "PERSON", status: "ACTIVE", portfolioOwnerId: input.ownerId },
      });
      const today = new Date();
      const policy = await db.policy.create({
        data: {
          organizationId: input.organizationId, policyNumber: `CAB-${input.label}`, clientId: client.id, insurerId: insurer.id,
          policyType: "AUTO", status: "ACTIVE", paymentFrequency: "ANNUAL", startDate: new Date(today.getTime() - 30 * 86_400_000),
          endDate: new Date(today.getTime() + 20 * 86_400_000), premiumAmount: 1200, currency: "MXN",
        },
      });
      const receipt = await db.receipt.create({
        data: {
          organizationId: input.organizationId, receiptNumber: `CAB-R-${input.label}`, policyId: policy.id, clientId: client.id, insurerId: insurer.id,
          periodStartDate: today, periodEndDate: new Date(today.getTime() + 365 * 86_400_000), dueDate: new Date(today.getTime() - 2 * 86_400_000),
          amount: 1200, currency: "MXN", status: "OVERDUE",
        },
      });
      const task = await db.workItem.create({
        data: {
          organizationId: input.organizationId, sourceType: "WorkItem", sourceId: `cab-task-${input.label}`, workItemType: "TASK", taskType: "GENERAL",
          status: "OPEN", priority: "HIGH", title: `Seguimiento ${input.label}`, entityType: "Task", entityId: `cab-task-${input.label}`,
          clientId: client.id, policyId: policy.id, dueDate: new Date(today.getTime() - 86_400_000),
        },
      });
      const claim = await db.claim.create({
        data: {
          organizationId: input.organizationId, folio: `CAB-C-${input.label}`, clientId: client.id, policyId: policy.id, insurerId: insurer.id,
          claimType: "AUTO", status: "OPEN", incidentDate: today, reportedDate: today, dueDate: new Date(today.getTime() - 86_400_000),
        },
      });
      const fixture = { organizationId: input.organizationId, insurerId: insurer.id, clientId: client.id, policyId: policy.id, receiptId: receipt.id, taskId: task.id, claimId: claim.id };
      created.push(fixture);
      return { ...fixture, clientName: client.fullName, policyNumber: policy.policyNumber };
    }

    try {
      const context = await readContext(db, "tenant-agent-a");
      if (context.organizationId !== ORGANIZATION_A || context.membershipRole !== "AGENT") throw new Error("CLIENT_ACTION_FIXTURE_AGENT_INVALID");
      await db.organization.findUniqueOrThrow({ where: { id: ORGANIZATION_B } });
      const visible = await seed({ organizationId: ORGANIZATION_A, ownerId: context.userId, label: `OWN-${suffix}` });
      const otherPortfolio = await seed({ organizationId: ORGANIZATION_A, ownerId: "tenant-admin-a", label: `OTHER-${suffix}` });
      const otherOrganization = await seed({ organizationId: ORGANIZATION_B, ownerId: "tenant-pedro-gomez", label: `ORG-B-${suffix}` });
      contextState.current = context;
      const scope = portfolioReadScope(context);

      const clientActions = await withTenantTransaction(context, (tx) => getClientActionBriefingFromDb(scope, tx, visible.clientId));
      expect(clientActions.some((item) => item.href === `/receipts/${visible.receiptId}`)).toBe(true);
      expect(clientActions.some((item) => item.href === `/policies/${visible.policyId}`)).toBe(true);
      expect(clientActions.some((item) => item.href === `/claims/${visible.claimId}`)).toBe(true);
      expect(clientActions.some((item) => item.href === `/tasks/${visible.taskId}`)).toBe(true);

      const overview = await getClientActionOverview(scope);
      expect(overview.map((item) => item.clientId)).toContain(visible.clientId);
      expect(overview.map((item) => item.clientId)).not.toContain(otherPortfolio.clientId);
      expect(overview.map((item) => item.clientId)).not.toContain(otherOrganization.clientId);
      expect(overview.map((item) => item.clientName)).not.toContain(otherPortfolio.clientName);
      expect(overview.map((item) => item.clientName)).not.toContain(otherOrganization.clientName);
    } finally {
      contextState.current = null;
      for (const fixture of created.reverse()) {
        await db.claim.deleteMany({ where: { id: fixture.claimId, organizationId: fixture.organizationId } });
        await db.workItem.deleteMany({ where: { id: fixture.taskId, organizationId: fixture.organizationId } });
        await db.receipt.deleteMany({ where: { id: fixture.receiptId, organizationId: fixture.organizationId } });
        await db.policy.deleteMany({ where: { id: fixture.policyId, organizationId: fixture.organizationId } });
        await db.client.deleteMany({ where: { id: fixture.clientId, organizationId: fixture.organizationId } });
        await db.insurer.deleteMany({ where: { id: fixture.insurerId, organizationId: fixture.organizationId } });
      }
    }
  });
});

afterAll(async () => {
  contextState.current = null;
  await resetDb();
});
