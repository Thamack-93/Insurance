import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    organization: { findUnique: vi.fn() },
    document: { findFirst: vi.fn(), updateMany: vi.fn() },
    policy: { findFirst: vi.fn() },
    client: { findFirst: vi.fn() },
    task: { create: vi.fn() },
    workItem: { create: vi.fn() },
  };
  return { tx, context: { organizationId: "org-a", userId: "admin-a", membershipRole: "ADMIN" } };
});

vi.mock("@/lib/organization-context", () => ({
  requireOrganizationContext: vi.fn(async () => mocks.context),
  assertOrganizationContextInTransaction: vi.fn(),
  withTenantTransaction: vi.fn(async (_context: unknown, operation: (tx: typeof mocks.tx) => Promise<unknown>) => operation(mocks.tx)),
}));
vi.mock("@/lib/portfolio-access", () => ({
  documentOperationalWhere: (portfolioOwnerId: string | undefined, organizationId: string) => ({ organizationId, ...(portfolioOwnerId ? { portfolioOwnerId } : {}) }),
  workItemPortfolioWhere: () => ({}),
}));
vi.mock("@/lib/organization-capabilities", () => ({ resolveOrganizationCapability: vi.fn(async () => ({ enabled: true })) }));
vi.mock("@/lib/deployment", () => ({ areDocumentFilesEnabled: vi.fn(() => true) }));
vi.mock("@/lib/activity-log", () => ({ writeActivityLog: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/mutation-utils", () => ({
  errorResult: (error: string) => ({ ok: false, error }),
  successResult: (id: string, redirectTo: string, message: string) => ({ ok: true, id, redirectTo, message }),
  revalidatePaths: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  AuthError: class extends Error {
    status: number;
    constructor(message: string, status = 401) { super(message); this.status = status; }
  },
}));
vi.mock("@/lib/work-item-resolvers", () => ({ findWorkItemByRouteId: vi.fn() }));

import { createDocumentFollowUp } from "@/app/(dashboard)/tasks/actions";

function validForm() {
  const formData = new FormData();
  formData.set("title", "Revisar expediente del cliente");
  formData.set("dueDate", "2026-10-30");
  formData.set("notes", "Seguimiento interno");
  return formData;
}

describe("createDocumentFollowUp authorization and idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tx.organization.findUnique.mockResolvedValue({ kind: "STANDARD" });
  });

  it("rejects a document outside the active organization before creating records", async () => {
    mocks.tx.$queryRaw.mockResolvedValue([]);

    await expect(createDocumentFollowUp("document-org-b", validForm())).resolves.toEqual({
      ok: false,
      error: "El documento no existe o no pertenece a tu cartera.",
    });
    expect(mocks.tx.document.findFirst).not.toHaveBeenCalled();
    expect(mocks.tx.task.create).not.toHaveBeenCalled();
    expect(mocks.tx.workItem.create).not.toHaveBeenCalled();
  });

  it("returns the existing follow-up without creating duplicates", async () => {
    mocks.tx.$queryRaw.mockResolvedValue([{ id: "document-1" }]);
    mocks.tx.document.findFirst.mockResolvedValue({ id: "document-1", taskId: "task-existing" });

    await expect(createDocumentFollowUp("document-1", validForm())).resolves.toMatchObject({
      ok: true,
      taskId: "task-existing",
      href: "/tasks/task-existing",
      existing: true,
    });
    expect(mocks.tx.task.create).not.toHaveBeenCalled();
    expect(mocks.tx.workItem.create).not.toHaveBeenCalled();
    expect(mocks.tx.document.updateMany).not.toHaveBeenCalled();
  });
});
