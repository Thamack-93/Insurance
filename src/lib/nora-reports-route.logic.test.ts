import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const getDb = vi.hoisted(() => vi.fn());
const requirePortfolioReadScope = vi.hoisted(() => vi.fn());
const receiptOperationalWhere = vi.hoisted(() => vi.fn());
const policyOperationalWhere = vi.hoisted(() => vi.fn());
const commissionOperationalWhere = vi.hoisted(() => vi.fn());
const getWorkItems = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({ getDb }));
vi.mock("@/lib/auth", () => ({
  AuthError: class AuthError extends Error {
    status = 401;
  },
}));
vi.mock("@/lib/portfolio-access", () => ({
  requirePortfolioReadScope,
  receiptOperationalWhere,
  policyOperationalWhere,
  commissionOperationalWhere,
}));
vi.mock("@/lib/business-dates", () => ({
  businessToday: () => new Date("2026-07-24T06:00:00.000Z"),
  businessAddDays: (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000),
  businessEndOfDay: (date: Date) => new Date(date.getTime() + 86_400_000 - 1),
  parseBusinessDateInput: (value: string) => new Date(`${value}T06:00:00.000Z`),
  formatBusinessDateInput: (date: Date) => date.toISOString().slice(0, 10),
}));
vi.mock("@/lib/work-queue", () => ({
  getWorkItems,
  OPEN_WORK_ITEM_STATUSES: ["OPEN", "IN_PROGRESS"],
}));

import { GET } from "@/app/api/nora/reports/route";

const scope = { id: "agent-1", role: "AGENT", portfolioOwnerId: "agent-1" };
const db = {
  receipt: { findMany: vi.fn() },
  policy: { findMany: vi.fn() },
  commission: { findMany: vi.fn() },
};

function requestFor(type: string, params = "") {
  return new NextRequest(`http://localhost/api/nora/reports?type=${type}${params}`);
}

describe("Nora report authorization scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDb.mockReturnValue(db);
    requirePortfolioReadScope.mockResolvedValue(scope);
    receiptOperationalWhere.mockImplementation((ownerId?: string) => ({ receiptScope: ownerId ?? "admin" }));
    policyOperationalWhere.mockImplementation((ownerId?: string) => ({ policyScope: ownerId ?? "admin" }));
    commissionOperationalWhere.mockImplementation((ownerId?: string) => ({ commissionScope: ownerId ?? "admin" }));
    db.receipt.findMany.mockResolvedValue([]);
    db.policy.findMany.mockResolvedValue([]);
    db.commission.findMany.mockResolvedValue([]);
    getWorkItems.mockResolvedValue([]);
  });

  it("scopes overdue collections to the authenticated agent portfolio", async () => {
    const response = await GET(requestFor("overdue"));

    expect(response.status).toBe(200);
    expect(db.receipt.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ receiptScope: "agent-1" }),
      }),
    );
    await expect(response.json()).resolves.toMatchObject({ success: true, report: { slug: "cobranza-vencida", rows: [] } });
  });

  it("scopes renewals and active portfolio reports to the authenticated agent portfolio", async () => {
    const renewals = await GET(requestFor("renewals", "&days=45"));
    const portfolio = await GET(requestFor("portfolio"));

    expect(renewals.status).toBe(200);
    expect(portfolio.status).toBe(200);
    expect(db.policy.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: expect.objectContaining({ policyScope: "agent-1", status: "ACTIVE" }) }),
    );
    expect(db.policy.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: expect.objectContaining({ policyScope: "agent-1", status: "ACTIVE" }) }),
    );
  });

  it("scopes commission and operation exports to the authenticated portfolio", async () => {
    const commissions = await GET(requestFor("commissions", "&filter=pending"));
    const operations = await GET(requestFor("operations", "&filter=urgent"));

    expect(commissions.status).toBe(200);
    expect(operations.status).toBe(200);
    expect(db.commission.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ commissionScope: "agent-1" }) }),
    );
    expect(getWorkItems).toHaveBeenCalledWith(
      expect.objectContaining({ portfolioOwnerId: "agent-1", priorities: ["URGENT"] }),
    );
  });

  it("rejects an inverted date range before querying report records", async () => {
    const response = await GET(requestFor("overdue", "&from=2026-07-25&to=2026-07-20"));

    expect(response.status).toBe(400);
    expect(db.receipt.findMany).not.toHaveBeenCalled();
  });

  it("rejects unsupported report types without querying portfolio data", async () => {
    const response = await GET(requestFor("all-customers"));

    expect(response.status).toBe(400);
    expect(db.receipt.findMany).not.toHaveBeenCalled();
    expect(db.policy.findMany).not.toHaveBeenCalled();
  });
});
