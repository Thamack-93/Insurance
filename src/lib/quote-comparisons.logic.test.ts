import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const context = { userId: "admin-1", organizationId: "org-a", membershipRole: "ADMIN" };
  const tx = {
    client: { findFirst: vi.fn() },
    quote: { findMany: vi.fn(), findFirst: vi.fn() },
    quoteComparison: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  };
  return {
    context,
    tx,
    requireOrganizationContext: vi.fn(),
    assertOrganizationContextInTransaction: vi.fn(),
    withTenantTransaction: vi.fn(async (_context: unknown, callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
    writeActivityLog: vi.fn(),
    quoteOperationalWhere: vi.fn((portfolioOwnerId: string | undefined, organizationId: string) => ({
      organizationId,
      client: { organizationId, ...(portfolioOwnerId ? { portfolioOwnerId } : {}) },
    })),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/organization-context", () => ({
  requireOrganizationContext: mocks.requireOrganizationContext,
  assertOrganizationContextInTransaction: mocks.assertOrganizationContextInTransaction,
  withTenantTransaction: mocks.withTenantTransaction,
}));
vi.mock("@/lib/activity-log", () => ({ writeActivityLog: mocks.writeActivityLog }));
vi.mock("@/lib/portfolio-access", () => ({ quoteOperationalWhere: mocks.quoteOperationalWhere }));

import {
  compareAutoQuoteConsistency,
  createQuoteComparison,
  hasUniqueQuoteIds,
  normalizeAutoQuoteTerms,
  selectComparisonQuote,
} from "./quote-comparisons";

describe("quote comparison operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(mocks.context, { userId: "admin-1", organizationId: "org-a", membershipRole: "ADMIN" });
    mocks.requireOrganizationContext.mockResolvedValue(mocks.context);
    mocks.tx.client.findFirst.mockResolvedValue({ id: "client-a" });
    mocks.tx.quote.findMany.mockResolvedValue([
      { id: "quote-a", policyType: "AUTO" },
      { id: "quote-b", policyType: "AUTO" },
    ]);
    mocks.tx.quote.findFirst.mockResolvedValue({ id: "quote-a" });
    mocks.tx.quoteComparison.create.mockResolvedValue({ id: "comparison-a", items: [] });
    mocks.tx.quoteComparison.findFirst.mockResolvedValue({
      id: "comparison-a",
      clientId: "client-a",
      policyType: "AUTO",
      version: 1,
      items: [{ quoteId: "quote-a" }],
    });
    mocks.tx.quoteComparison.updateMany.mockResolvedValue({ count: 1 });
  });

  it("flags vehicle, period, and currency mismatches", () => {
    const left = normalizeAutoQuoteTerms({ vehicle: { vin: "VIN-1" }, coveragePeriod: { start: "2026-01-01" }, premium: { currency: "mxn" } });
    const right = { vehicle: { vin: "VIN-2" }, coveragePeriod: { start: "2026-02-01" }, premium: { currency: "USD" } };
    expect(left.premium?.currency).toBe("MXN");
    expect(compareAutoQuoteConsistency(left, right)).toEqual(["Vehículos distintos.", "Periodos de cobertura distintos.", "Monedas distintas."]);
  });

  it("detects duplicate quote IDs explicitly", () => {
    expect(hasUniqueQuoteIds(["quote-a", "quote-b"])).toBe(true);
    expect(hasUniqueQuoteIds(["quote-a", "quote-a"])).toBe(false);
  });

  it("rejects duplicate IDs before querying quotes", async () => {
    await expect(createQuoteComparison({ clientId: "client-a", policyType: "AUTO", quoteIds: ["quote-a", "quote-a"] }))
      .rejects.toThrow("QUOTE_COMPARISON_SCOPE");
    expect(mocks.tx.quote.findMany).not.toHaveBeenCalled();
    expect(mocks.tx.quoteComparison.create).not.toHaveBeenCalled();
  });

  it("scopes comparison quotes to the selected client and organization", async () => {
    mocks.tx.quote.findMany.mockResolvedValueOnce([{ id: "quote-a", policyType: "AUTO" }]);

    await expect(createQuoteComparison({ clientId: "client-a", policyType: "AUTO", quoteIds: ["quote-a", "quote-b"] }))
      .rejects.toThrow("QUOTE_COMPARISON_SCOPE");

    expect(mocks.tx.quote.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ clientId: "client-a", organizationId: "org-a" }),
    }));
    expect(mocks.tx.quoteComparison.create).not.toHaveBeenCalled();
  });

  it("rejects quotes from a different policy type", async () => {
    mocks.tx.quote.findMany.mockResolvedValueOnce([
      { id: "quote-a", policyType: "AUTO" },
      { id: "quote-b", policyType: "HOME" },
    ]);

    await expect(createQuoteComparison({ clientId: "client-a", policyType: "AUTO", quoteIds: ["quote-a", "quote-b"] }))
      .rejects.toThrow("QUOTE_COMPARISON_SCOPE");
    expect(mocks.tx.quoteComparison.create).not.toHaveBeenCalled();
  });

  it("keeps creation inside the agent portfolio", async () => {
    Object.assign(mocks.context, { userId: "agent-1", membershipRole: "AGENT" });
    mocks.tx.client.findFirst.mockResolvedValueOnce(null);

    await expect(createQuoteComparison({ clientId: "client-outside", policyType: "AUTO", quoteIds: ["quote-a", "quote-b"] }))
      .rejects.toThrow("QUOTE_COMPARISON_SCOPE");

    expect(mocks.tx.client.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "client-outside", organizationId: "org-a", portfolioOwnerId: "agent-1" }),
    }));
  });

  it("checks comparison, quote client, policy type, organization, and portfolio before selection", async () => {
    Object.assign(mocks.context, { userId: "agent-1", membershipRole: "AGENT" });

    await expect(selectComparisonQuote({ comparisonId: "comparison-a", quoteId: "quote-a", expectedVersion: 1, reason: "Cliente eligió esta opción" }))
      .resolves.toEqual({ ok: true });

    expect(mocks.tx.quoteComparison.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "comparison-a", organizationId: "org-a", client: { organizationId: "org-a", portfolioOwnerId: "agent-1" } }),
    }));
    expect(mocks.tx.quote.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: "quote-a",
        clientId: "client-a",
        policyType: "AUTO",
        organizationId: "org-a",
        client: { organizationId: "org-a", portfolioOwnerId: "agent-1" },
      }),
    }));
    expect(mocks.tx.quoteComparison.updateMany).toHaveBeenCalledOnce();
  });

  it("rejects selection when the comparison is outside the agent portfolio", async () => {
    Object.assign(mocks.context, { userId: "agent-1", membershipRole: "AGENT" });
    mocks.tx.quoteComparison.findFirst.mockResolvedValueOnce(null);

    await expect(selectComparisonQuote({ comparisonId: "comparison-outside", quoteId: "quote-a", expectedVersion: 1, reason: "Elegida" }))
      .rejects.toThrow("QUOTE_COMPARISON_CONFLICT");
    expect(mocks.tx.quote.findFirst).not.toHaveBeenCalled();
    expect(mocks.tx.quoteComparison.updateMany).not.toHaveBeenCalled();
  });

  it("rejects selection if the quote no longer matches the comparison client and product", async () => {
    mocks.tx.quote.findFirst.mockResolvedValueOnce(null);

    await expect(selectComparisonQuote({ comparisonId: "comparison-a", quoteId: "quote-a", expectedVersion: 1, reason: "Elegida" }))
      .rejects.toThrow("QUOTE_COMPARISON_CONFLICT");
    expect(mocks.tx.quoteComparison.updateMany).not.toHaveBeenCalled();
  });

  it("requires a nonblank decision reason", async () => {
    await expect(selectComparisonQuote({ comparisonId: "comparison-a", quoteId: "quote-a", expectedVersion: 1, reason: "   " }))
      .rejects.toThrow("QUOTE_COMPARISON_INVALID_REASON");
    expect(mocks.requireOrganizationContext).not.toHaveBeenCalled();
    expect(mocks.tx.quoteComparison.findFirst).not.toHaveBeenCalled();
  });

  it("rejects quotes that are not included in the comparison or stale versions", async () => {
    await expect(selectComparisonQuote({ comparisonId: "comparison-a", quoteId: "quote-b", expectedVersion: 1, reason: "Elegida" }))
      .rejects.toThrow("QUOTE_COMPARISON_CONFLICT");
    await expect(selectComparisonQuote({ comparisonId: "comparison-a", quoteId: "quote-a", expectedVersion: 2, reason: "Elegida" }))
      .rejects.toThrow("QUOTE_COMPARISON_CONFLICT");
    expect(mocks.tx.quoteComparison.updateMany).not.toHaveBeenCalled();
  });
});
