import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requirePortfolioReadScope: vi.fn(),
  membershipFindFirst: vi.fn(),
  searchUserPortfolio: vi.fn(),
  getClaimChecklistSummary: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  AuthError: class AuthError extends Error {
    constructor(message: string, readonly status = 401) {
      super(message);
    }
  },
}));
vi.mock("@/lib/db", () => ({
  getDb: () => ({ organizationMembership: { findFirst: mocks.membershipFindFirst } }),
}));
vi.mock("@/lib/portfolio-access", () => ({
  requirePortfolioReadScope: mocks.requirePortfolioReadScope,
  claimOperationalWhere: vi.fn(),
  clientOperationalWhere: vi.fn(),
  endorsementOperationalWhere: vi.fn(),
  policyOperationalWhere: vi.fn(),
  receiptOperationalWhere: vi.fn(),
  workItemOperationalWhere: vi.fn(),
}));
vi.mock("@/lib/assistant-local", () => ({ searchUserPortfolio: mocks.searchUserPortfolio }));
vi.mock("@/lib/dashboard-queries", () => ({ getTodayData: vi.fn() }));
vi.mock("@/lib/renewals", () => ({ loadEligibleRenewalPolicies: vi.fn() }));
vi.mock("@/lib/work-queue", () => ({ getWorkItems: vi.fn(), OPEN_WORK_ITEM_STATUSES: [] }));
vi.mock("@/lib/risk-engine", () => ({ detectRisks: vi.fn() }));
vi.mock("@/lib/assistant-actions", () => ({ buildAssistantActionProposalFromPlan: vi.fn() }));
vi.mock("@/lib/claim-checklists", () => ({ getClaimChecklistSummary: mocks.getClaimChecklistSummary }));

import { createNoraAgentTools } from "@/lib/assistant-agent-tools";

type DirectTool = {
  execute?: (input: Record<string, unknown>, options: Record<string, unknown>) => Promise<unknown>;
};

describe("Nora agent tool authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePortfolioReadScope.mockResolvedValue({ id: "agent-1", role: "AGENT", portfolioOwnerId: "agent-1" });
    mocks.membershipFindFirst.mockResolvedValue({ organizationId: "org-default", role: "AGENT" });
    mocks.searchUserPortfolio.mockResolvedValue([]);
  });

  it("revalidates the live session and active organization membership", async () => {
    mocks.membershipFindFirst.mockResolvedValue(null);
    const runtime = createNoraAgentTools({ id: "agent-1", role: "AGENT" });
    const search = runtime.tools.searchPortfolio as DirectTool;

    await expect(search.execute?.({ query: "POL-001" }, {})).rejects.toThrow("membresía activa");
    expect(mocks.membershipFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: "agent-1", active: true }),
    }));
    expect(mocks.searchUserPortfolio).not.toHaveBeenCalled();
    expect(runtime.snapshot().trace).toEqual([expect.objectContaining({ tool: "searchPortfolio", outcome: "error" })]);
  });

  it("fails closed when the authenticated user changes between steps", async () => {
    mocks.requirePortfolioReadScope.mockResolvedValue({ id: "other-user", role: "ADMIN", portfolioOwnerId: "other-user" });
    const runtime = createNoraAgentTools({ id: "agent-1", role: "AGENT" });
    const search = runtime.tools.searchPortfolio as DirectTool;

    await expect(search.execute?.({ query: "POL-001" }, {})).rejects.toThrow("sesión de Nora cambió");
    expect(mocks.membershipFindFirst).not.toHaveBeenCalled();
    expect(mocks.searchUserPortfolio).not.toHaveBeenCalled();
  });

  it("uses only the server-derived identity for an authorized search", async () => {
    mocks.searchUserPortfolio.mockResolvedValue([{ id: "policy-1", type: "policy", title: "POL-001", href: "/policies/policy-1" }]);
    const runtime = createNoraAgentTools({ id: "agent-1", role: "AGENT" });
    const search = runtime.tools.searchPortfolio as DirectTool;

    await expect(search.execute?.({ query: "POL-001" }, {})).resolves.toEqual([
      expect.objectContaining({ id: "policy-1", title: "POL-001" }),
    ]);
    expect(mocks.searchUserPortfolio).toHaveBeenCalledWith({ id: "agent-1", role: "AGENT" }, "POL-001");
    expect(runtime.snapshot().trace).toEqual([expect.objectContaining({ tool: "searchPortfolio", outcome: "success" })]);
  });

  it("returns only checklist codes, statuses, dates and counts for GMM", async () => {
    mocks.getClaimChecklistSummary.mockResolvedValue({
      claimId: "claim-1",
      folio: "SIN-001",
      claimStatus: "OPEN",
      policyType: "GMM",
      policyNumber: "GMM-001",
      advisory: "Internal advisory",
      counts: { MISSING: 1, REQUESTED: 0, RECEIVED: 0, WAIVED: 0 },
      items: [{
        code: "medical_report_metadata",
        label: "Informe médico recibido",
        status: "MISSING",
        requestedAt: null,
        receivedAt: null,
        waivedAt: null,
        documentLinked: true,
      }],
    });
    const runtime = createNoraAgentTools({ id: "agent-1", role: "AGENT" });
    const checklist = runtime.tools.getClaimChecklist as DirectTool;

    const result = await checklist.execute?.({ claimId: "claim-1" }, {});

    expect(result).toEqual({
      counts: { MISSING: 1, REQUESTED: 0, RECEIVED: 0, WAIVED: 0 },
      items: [{
        code: "medical_report_metadata",
        status: "MISSING",
        requestedAt: null,
        receivedAt: null,
        waivedAt: null,
      }],
    });
    expect(JSON.stringify(result)).not.toContain("médico");
    expect(JSON.stringify(result)).not.toContain("documentLinked");
    expect(mocks.getClaimChecklistSummary).toHaveBeenCalledWith("claim-1", "agent-1");
  });

  it("removes subtitles, parent labels and links from searches in GMM mode", async () => {
    mocks.searchUserPortfolio.mockResolvedValue([{
      id: "claim-1",
      type: "claim",
      title: "SIN-001",
      subtitle: "Nombre privado · Aseguradora privada",
      parentLabel: "GMM-001",
      href: "/claims/claim-1",
    }]);
    const runtime = createNoraAgentTools({ id: "agent-1", role: "AGENT" }, { gmmMetadataOnly: true });
    const search = runtime.tools.searchPortfolio as DirectTool;

    const result = await search.execute?.({ query: "SIN-001" }, {});

    expect(result).toEqual([{ id: "claim-1", type: "claim", title: "SIN-001" }]);
    expect(JSON.stringify(result)).not.toContain("Nombre privado");
    expect(JSON.stringify(result)).not.toContain("Aseguradora privada");
  });
});
