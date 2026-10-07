import { afterAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { getDb, resetDb } from "@/lib/db";
import type { OrganizationContext } from "@/lib/organization-context";

const contextState = vi.hoisted(() => ({ current: null as OrganizationContext | null }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/organization-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/organization-context")>();
  return { ...actual, requireOrganizationContext: vi.fn(async () => {
    if (!contextState.current) throw new Error("TEST_ORGANIZATION_CONTEXT_NOT_SET");
    return contextState.current;
  }) };
});

import { getOperationalInsights } from "@/lib/operational-insights";

const enabled = process.env.TENANT_ISOLATION_TEST_DB === "1" && process.env.PLAYWRIGHT_ENFORCE_DISPOSABLE_DB === "1";
const describeDisposable = enabled ? describe : describe.skip;
const ORGANIZATION_A = "org_legacy_singleton_0001";
const ORGANIZATION_B = "org_pedro_gomez_0001";

function assertLocalDatabase() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is required for the disposable Operational Insights integration.");
  const host = new URL(value).hostname.toLowerCase();
  if (!["localhost", "127.0.0.1", "::1", "postgres"].includes(host)) {
    throw new Error("Operational Insights integration tests require a disposable local PostgreSQL database.");
  }
  return value;
}

async function readContext(db: PrismaClient, userId: string): Promise<OrganizationContext> {
  const membership = await db.organizationMembership.findUnique({
    where: { userId },
    include: { user: true, organization: true },
  });
  if (!membership || !membership.active || !membership.user.active || membership.organization.status !== "ACTIVE") {
    throw new Error(`OPERATIONAL_INSIGHTS_FIXTURE_MEMBERSHIP_INVALID:${userId}`);
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

describeDisposable("Operational Insights disposable PostgreSQL integration", () => {
  it("keeps partial-payment promises visible, clears settled promises, and scopes by organization and portfolio", async () => {
    assertLocalDatabase();
    const db = getDb();
    const suffix = `${process.pid}-${Date.now()}`;
    const created: Array<{ organizationId: string; clientId: string; policyId: string; receiptId: string; workItemId: string; insurerId: string }> = [];

    async function seedPromise(input: { organizationId: string; portfolioOwnerId: string; suffix: string }) {
      const insurer = await db.insurer.create({ data: { organizationId: input.organizationId, name: `Insights ${input.suffix}` } });
      const client = await db.client.create({
        data: {
          organizationId: input.organizationId,
          fullName: `Insights ${input.suffix}`,
          type: "PERSON",
          status: "ACTIVE",
          portfolioOwnerId: input.portfolioOwnerId,
        },
      });
      const now = new Date();
      const policy = await db.policy.create({
        data: {
          organizationId: input.organizationId,
          policyNumber: `INSIGHTS-${input.suffix}`,
          clientId: client.id,
          insurerId: insurer.id,
          policyType: "AUTO",
          status: "ACTIVE",
          paymentFrequency: "ANNUAL",
          startDate: new Date(now.getTime() - 30 * 86_400_000),
          endDate: new Date(now.getTime() + 365 * 86_400_000),
          premiumAmount: 1000,
          currency: "MXN",
        },
      });
      const receipt = await db.receipt.create({
        data: {
          organizationId: input.organizationId,
          receiptNumber: `INSIGHTS-${input.suffix}`,
          policyId: policy.id,
          clientId: client.id,
          insurerId: insurer.id,
          periodStartDate: now,
          periodEndDate: new Date(now.getTime() + 365 * 86_400_000),
          dueDate: new Date(now.getTime() + 30 * 86_400_000),
          amount: 1000,
          currency: "MXN",
          status: "PENDING",
        },
      });
      const workItem = await db.workItem.create({
        data: {
          organizationId: input.organizationId,
          sourceType: "Collection",
          sourceId: `receipt:${receipt.id}:collection-followup`,
          workItemType: "TASK",
          taskType: "PAYMENT",
          status: "OPEN",
          priority: "HIGH",
          title: `Promesa ${input.suffix}`,
          entityType: "RECEIPT",
          entityId: receipt.id,
          clientId: client.id,
          policyId: policy.id,
          insurerId: insurer.id,
          receiptId: receipt.id,
          assignedToId: input.portfolioOwnerId,
          // Deliberately later than the promise date; metadata is authoritative.
          dueDate: new Date(now.getTime() + 30 * 86_400_000),
          metadataJson: JSON.stringify({ kind: "COLLECTION_FOLLOWUP", outcome: "PROMISED_PAYMENT", promisedPaymentDate: now.toISOString() }),
        },
      });
      const fixture = { organizationId: input.organizationId, clientId: client.id, policyId: policy.id, receiptId: receipt.id, workItemId: workItem.id, insurerId: insurer.id };
      created.push(fixture);
      return fixture;
    }

    try {
      const context = await readContext(db, "tenant-agent-a");
      if (context.organizationId !== ORGANIZATION_A || context.membershipRole !== "AGENT") {
        throw new Error("OPERATIONAL_INSIGHTS_FIXTURE_AGENT_A_INVALID");
      }
      await db.organization.findUniqueOrThrow({ where: { id: ORGANIZATION_B } });
      const visible = await seedPromise({ organizationId: ORGANIZATION_A, portfolioOwnerId: "tenant-agent-a", suffix: `OWN-${suffix}` });
      const otherPortfolio = await seedPromise({ organizationId: ORGANIZATION_A, portfolioOwnerId: "tenant-admin-a", suffix: `OTHER-${suffix}` });
      const otherOrganization = await seedPromise({ organizationId: ORGANIZATION_B, portfolioOwnerId: "tenant-owner-b", suffix: `ORG-B-${suffix}` });
      contextState.current = context;

      const first = await getOperationalInsights({ group: "collections", page: 1 });
      expect(first.records.some((record) => record.id === `Receipt:${visible.receiptId}` && record.signals.some((signal) => signal.id === `promise-today:${visible.receiptId}`))).toBe(true);
      expect(first.records.some((record) => record.id === `Receipt:${otherPortfolio.receiptId}`)).toBe(false);
      expect(first.records.some((record) => record.id === `Receipt:${otherOrganization.receiptId}`)).toBe(false);

      await db.payment.create({ data: { organizationId: ORGANIZATION_A, receiptId: visible.receiptId, policyId: visible.policyId, clientId: visible.clientId, amount: 100, currency: "MXN", status: "POSTED", paidDate: new Date() } });
      const partial = await getOperationalInsights({ group: "collections", page: 1 });
      expect(partial.records.some((record) => record.id === `Receipt:${visible.receiptId}`)).toBe(true);

      await db.payment.create({ data: { organizationId: ORGANIZATION_A, receiptId: visible.receiptId, policyId: visible.policyId, clientId: visible.clientId, amount: 895, currency: "MXN", status: "POSTED", paidDate: new Date() } });
      const settled = await getOperationalInsights({ group: "collections", page: 1 });
      expect(settled.records.some((record) => record.id === `Receipt:${visible.receiptId}`)).toBe(false);
    } finally {
      contextState.current = null;
      for (const fixture of created.reverse()) {
        await db.payment.deleteMany({ where: { receiptId: fixture.receiptId } });
        await db.workItem.deleteMany({ where: { id: fixture.workItemId } });
        await db.receipt.deleteMany({ where: { id: fixture.receiptId } });
        await db.policy.deleteMany({ where: { id: fixture.policyId } });
        await db.client.deleteMany({ where: { id: fixture.clientId } });
        await db.insurer.deleteMany({ where: { id: fixture.insurerId } });
      }
    }
  });
});

afterAll(async () => {
  contextState.current = null;
  await resetDb();
});
