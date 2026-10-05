import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const registeredTransactions = vi.hoisted(() => new WeakSet<object>());
const rootClient = vi.hoisted(() => ({ $transaction: vi.fn() }));
const requireOrganizationContext = vi.hoisted(() => vi.fn());
const withTenantTransaction = vi.hoisted(() => vi.fn());
const getDb = vi.hoisted(() => vi.fn());
const workItemFindFirst = vi.hoisted(() => vi.fn());
const suppressionFindMany = vi.hoisted(() => vi.fn());
const suppressionUpsert = vi.hoisted(() => vi.fn());
const suppressionFindFirstOrThrow = vi.hoisted(() => vi.fn());
const suppressionUpdateMany = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({ getDb }));
vi.mock("@/lib/organization-context", () => ({
  isApplicationPrismaClient: (client: unknown) => client === rootClient,
  isTenantTransactionClient: (client: unknown) => typeof client === "object" && client !== null && registeredTransactions.has(client),
  requireOrganizationContext,
  withTenantTransaction,
}));
vi.mock("@/lib/portfolio-access", () => ({
  workItemPortfolioWhere: (ownerId: string) => ({ portfolioOwnerId: ownerId }),
}));

import { deactivateSuppressionRule, findMatchingSuppressionRule, getActiveSuppressionRules, upsertSuppressionRule } from "./data-quality-rules";
import { findWorkItemByRouteId } from "./work-item-resolvers";

const context = { organizationId: "org-a" } as never;
const rule = {
  id: "rule-1",
  category: "RENOVATIONS",
  issueCode: "RENEWAL_SUGGESTION",
  criteriaJson: "{}",
  active: true,
  reason: null,
  expiresAt: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
};

function makeTransaction() {
  const tx = {
    $transaction: vi.fn(async (callback: (nested: unknown) => unknown) => callback({})),
    workItem: { findFirst: workItemFindFirst },
    dataQualitySuppressionRule: {
      findMany: suppressionFindMany,
      upsert: suppressionUpsert,
      findFirstOrThrow: suppressionFindFirstOrThrow,
      updateMany: suppressionUpdateMany,
    },
  };
  registeredTransactions.add(tx);
  return tx;
}

describe("tenant helper transaction reuse", () => {
  beforeEach(() => {
    registeredTransactions.delete(rootClient);
    requireOrganizationContext.mockReset().mockResolvedValue(context);
    withTenantTransaction.mockReset();
    getDb.mockReset().mockReturnValue(rootClient);
    workItemFindFirst.mockReset().mockResolvedValue({ id: "work-1" });
    suppressionFindMany.mockReset().mockResolvedValue([rule]);
    suppressionUpsert.mockReset().mockResolvedValue(rule);
    suppressionFindFirstOrThrow.mockReset().mockResolvedValue(rule);
    suppressionUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  });

  it("queries a WorkItem in the supplied Prisma transaction without opening another", async () => {
    const tx = makeTransaction();
    const result = await findWorkItemByRouteId("work-1", "org-a", tx as never, "agent-1");

    expect(result).toEqual({ id: "work-1" });
    expect(workItemFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId: "org-a", AND: [{ portfolioOwnerId: "agent-1" }] }),
    }));
    expect(tx.$transaction).not.toHaveBeenCalled();
    expect(withTenantTransaction).not.toHaveBeenCalled();
  });

  it("opens exactly one validated tenant transaction for a root client", async () => {
    const tx = makeTransaction();
    withTenantTransaction.mockImplementation(async (_ctx, callback) => callback(tx));

    await findWorkItemByRouteId("work-1", "org-a", rootClient as never);

    expect(withTenantTransaction).toHaveBeenCalledTimes(1);
    expect(rootClient.$transaction).not.toHaveBeenCalled();
    expect(tx.$transaction).not.toHaveBeenCalled();
  });

  it("opens one validated transaction for a suppression-rule write from the root client", async () => {
    const tx = makeTransaction();
    withTenantTransaction.mockImplementation(async (_ctx, callback) => callback(tx));

    await upsertSuppressionRule({
      category: "RENOVATIONS",
      issueCode: rule.issueCode,
      criteria: {},
      actorId: "user-1",
      organizationId: "org-a",
    }, rootClient as never);

    expect(withTenantTransaction).toHaveBeenCalledTimes(1);
    expect(suppressionUpsert).toHaveBeenCalledTimes(1);
    expect(tx.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a mismatched organization and an unregistered transaction client", async () => {
    requireOrganizationContext.mockResolvedValueOnce({ organizationId: "org-b" });
    await expect(findWorkItemByRouteId("work-1", "org-a")).rejects.toThrow("ORGANIZATION_CONTEXT_MISMATCH");

    const unsupported = { $transaction: vi.fn(), workItem: { findFirst: workItemFindFirst } };
    await expect(findWorkItemByRouteId("work-1", "org-a", unsupported as never)).rejects.toThrow("TENANT_TRANSACTION_REQUIRED");
    expect(withTenantTransaction).not.toHaveBeenCalled();
  });

  it("reuses the supplied transaction for all suppression-rule operations", async () => {
    const tx = makeTransaction();

    await expect(getActiveSuppressionRules("org-a", tx as never)).resolves.toHaveLength(1);
    await expect(findMatchingSuppressionRule({ category: "RENOVATIONS", issueCode: rule.issueCode, fields: {} }, "org-a", tx as never)).resolves.toMatchObject({ id: rule.id });
    await expect(upsertSuppressionRule({ category: "RENOVATIONS", issueCode: rule.issueCode, criteria: {}, actorId: "user-1", organizationId: "org-a" }, tx as never)).resolves.toMatchObject({ id: rule.id });
    await expect(deactivateSuppressionRule(rule.id, "org-a", "user-1", tx as never)).resolves.toMatchObject({ id: rule.id, active: false });

    expect(tx.$transaction).not.toHaveBeenCalled();
    expect(withTenantTransaction).not.toHaveBeenCalled();
    expect(suppressionFindMany).toHaveBeenCalledTimes(2);
    expect(suppressionUpsert).toHaveBeenCalledTimes(1);
    expect(suppressionUpdateMany).toHaveBeenCalledTimes(1);
  });
});
