import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getDb = vi.hoisted(() => vi.fn());
const getCurrentUser = vi.hoisted(() => vi.fn());
const writeActivityLog = vi.hoisted(() => vi.fn());
const createClient = vi.hoisted(() => vi.fn());
const updateClient = vi.hoisted(() => vi.fn());
const createPolicy = vi.hoisted(() => vi.fn());
const updatePolicy = vi.hoisted(() => vi.fn());
const createReceipt = vi.hoisted(() => vi.fn());
const updateReceipt = vi.hoisted(() => vi.fn());
const createPayment = vi.hoisted(() => vi.fn());
const createWorkItem = vi.hoisted(() => vi.fn());
const updateWorkItem = vi.hoisted(() => vi.fn());
const requireOrganizationContext = vi.hoisted(() => vi.fn());
const createClaim = vi.hoisted(() => vi.fn());
const updateClaim = vi.hoisted(() => vi.fn());
const updateClaimChecklistStatus = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({ getDb }));
vi.mock("@/lib/auth", () => ({ getCurrentUser }));
vi.mock("@/lib/organization-context", () => ({ requireOrganizationContext }));
vi.mock("@/lib/activity-log", () => ({ writeActivityLog }));
vi.mock("@/app/(dashboard)/clients/actions", () => ({ createClient, updateClient }));
vi.mock("@/app/(dashboard)/policies/actions", () => ({ createPolicy, updatePolicy }));
vi.mock("@/app/(dashboard)/receipts/actions", () => ({ createReceipt, updateReceipt }));
vi.mock("@/app/(dashboard)/payments/actions", () => ({ createPayment }));
vi.mock("@/app/(dashboard)/tasks/actions", () => ({ createWorkItem, updateWorkItem }));
vi.mock("@/app/(dashboard)/claims/actions", () => ({ createClaim, updateClaim }));
vi.mock("@/lib/claim-checklists", () => ({
  CLAIM_CHECKLIST_STATUSES: ["MISSING", "REQUESTED", "RECEIVED", "WAIVED"],
  getClaimChecklistTemplate: vi.fn(),
  updateClaimChecklistStatus,
}));
vi.mock("@/lib/work-item-resolvers", () => ({ findWorkItemByRouteId: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn() }));

import { confirmAssistantActionDraft } from "@/lib/assistant-actions";

type AssistantActionDraftTableMock = {
  findFirst: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
};

type MockDb = {
  assistantActionDraft: AssistantActionDraftTableMock;
};

function makeDb(overrides: Partial<MockDb> = {}): MockDb {
  return {
    assistantActionDraft: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
    ...overrides,
  } as MockDb;
}

const user = { id: "user-1", role: "AGENT" as const };

function makeDraft(overrides: Partial<{
  id: string;
  userId: string;
  status: string;
  expiresAt: Date;
  payloadJson: string;
}> = {}) {
  return {
    id: "draft-1",
    userId: "user-1",
    status: "PENDING",
    expiresAt: new Date("2030-01-01T00:00:00.000Z"),
    payloadJson: JSON.stringify({
      title: "Crear cliente",
      summary: "Alta de cliente",
      reply: "Listo para confirmar.",
      entityType: "client",
      operation: "create",
      targetId: null,
      targetLabel: null,
      targetUpdatedAt: null,
      formValues: {
        fullName: "Cliente Demo",
        type: "PERSON",
        email: "demo@example.com",
        phone: "",
        secondaryPhone: "",
        rfc: "",
        address: "",
        preferredContactMethod: "EMAIL",
        referidorId: "",
        notes: "",
        status: "ACTIVE",
      },
      changes: [],
    }),
    ...overrides,
  };
}

describe("confirmAssistantActionDraft", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUser.mockResolvedValue(user);
    requireOrganizationContext.mockResolvedValue({ organizationId: "org-test", membershipRole: "AGENT" });
    createClient.mockResolvedValue({
      ok: true,
      id: "client-1",
      redirectTo: "/clients/client-1",
      message: "Cliente creado.",
    });
    createClaim.mockResolvedValue({
      ok: true,
      id: "claim-1",
      redirectTo: "/claims/claim-1",
      message: "Siniestro creado.",
    });
  });

  it("confirms a persisted pending draft exactly once", async () => {
    const draft = makeDraft();
    const db = makeDb({
      assistantActionDraft: {
        findFirst: vi.fn().mockResolvedValue(draft),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({ id: draft.id }),
        create: vi.fn(),
      },
    });
    getDb.mockReturnValue(db);

    const result = await confirmAssistantActionDraft(draft.id, user.id);

    expect(result.ok).toBe(true);
    expect(db.assistantActionDraft.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: draft.id,
          userId: user.id,
          status: "PENDING",
        }),
      }),
    );
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(db.assistantActionDraft.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: draft.id, organizationId: "org-test", userId: user.id }),
        data: expect.objectContaining({ status: "CONFIRMED" }),
      }),
    );
    expect(writeActivityLog).toHaveBeenCalled();
  });

  it("creates a claim only after claiming a pending confirmation draft", async () => {
    const draft = makeDraft({
      payloadJson: JSON.stringify({
        title: "Crear siniestro",
        summary: "Alta de siniestro",
        reply: "Listo para confirmar.",
        entityType: "claim",
        operation: "create",
        targetId: null,
        targetLabel: null,
        targetUpdatedAt: null,
        formValues: {
          folio: "SIN-001",
          clientId: "client-1",
          policyId: "policy-1",
          insurerId: "insurer-1",
          claimType: "COLLISION",
          description: "",
          status: "OPEN",
          incidentDate: "2026-08-10",
          reportedDate: "2026-08-11",
          closedDate: "",
          notes: "",
        },
        changes: [],
      }),
    });
    const db = makeDb({
      assistantActionDraft: {
        findFirst: vi.fn().mockResolvedValue(draft),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        update: vi.fn().mockResolvedValue({ id: draft.id }),
        create: vi.fn(),
      },
    });
    getDb.mockReturnValue(db);

    const result = await confirmAssistantActionDraft(draft.id, user.id);

    expect(result.ok).toBe(true);
    expect(db.assistantActionDraft.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: draft.id, userId: user.id, status: "PENDING" }),
    }));
    expect(createClaim).toHaveBeenCalledTimes(1);
    expect(db.assistantActionDraft.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "CONFIRMED" }),
    }));
  });

  it("blocks expired drafts before execution", async () => {
    const draft = makeDraft({ expiresAt: new Date("2000-01-01T00:00:00.000Z") });
    const db = makeDb({
      assistantActionDraft: {
        findFirst: vi.fn().mockResolvedValue(draft),
        updateMany: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: draft.id }),
        create: vi.fn(),
      },
    });
    getDb.mockReturnValue(db);

    const result = await confirmAssistantActionDraft(draft.id, user.id);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected an expired draft failure.");
    }
    if ("error" in result) {
      expect(result.error).toContain("expiró");
    }
    expect(db.assistantActionDraft.updateMany).toHaveBeenCalledTimes(1);
    expect(createClient).not.toHaveBeenCalled();
    expect(db.assistantActionDraft.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: draft.id, organizationId: "org-test", userId: user.id },
        data: expect.objectContaining({ status: "EXPIRED" }),
      }),
    );
  });

  it("rejects cancelled drafts before they can execute", async () => {
    const draft = makeDraft({ status: "CANCELLED" });
    const db = makeDb({
      assistantActionDraft: {
        findFirst: vi.fn().mockResolvedValue(draft),
        updateMany: vi.fn(),
        update: vi.fn(),
        create: vi.fn(),
      },
    });
    getDb.mockReturnValue(db);

    const result = await confirmAssistantActionDraft(draft.id, user.id);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected a cancelled draft failure.");
    }
    if ("error" in result) {
      expect(result.error).toContain("ya no está pendiente");
    }
    expect(db.assistantActionDraft.updateMany).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects a draft owned by a different user without executing it", async () => {
    const db = makeDb({
      assistantActionDraft: {
        findFirst: vi.fn().mockResolvedValue(null),
        updateMany: vi.fn(),
        update: vi.fn(),
        create: vi.fn(),
      },
    });
    getDb.mockReturnValue(db);

    const result = await confirmAssistantActionDraft("someone-elses-draft", user.id);

    expect(result).toEqual(expect.objectContaining({ ok: false }));
    expect(db.assistantActionDraft.findFirst).toHaveBeenCalledWith({
      where: { id: "someone-elses-draft", organizationId: "org-test", userId: user.id },
    });
    expect(db.assistantActionDraft.updateMany).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("does not execute when another confirmation has already claimed the draft", async () => {
    const draft = makeDraft();
    const db = makeDb({
      assistantActionDraft: {
        findFirst: vi.fn().mockResolvedValue(draft),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        update: vi.fn(),
        create: vi.fn(),
      },
    });
    getDb.mockReturnValue(db);

    const result = await confirmAssistantActionDraft(draft.id, user.id);

    expect(result).toEqual(expect.objectContaining({ ok: false }));
    expect(db.assistantActionDraft.updateMany).toHaveBeenCalledTimes(1);
    expect(createClient).not.toHaveBeenCalled();
    expect(db.assistantActionDraft.update).not.toHaveBeenCalled();
  });
});
