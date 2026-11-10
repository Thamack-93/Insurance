import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; pathname: string; kind: string; expiresAt: Date }>,
  del: vi.fn(),
  deleteMany: vi.fn(),
  raw: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    organization: { findMany: async () => [{ id: "org-a" }] },
    blobOperationUsage: { deleteMany: async () => ({ count: 0 }) },
  }),
}));
vi.mock("@vercel/blob", () => ({ del: mocks.del }));
vi.mock("@/lib/organization-context", () => ({
  assertOrganizationContextInTransaction: vi.fn(),
  withSystemOrganizationTransaction: async (_organizationId: string, _reason: string, callback: (tx: unknown) => unknown) => callback({
    noraTemporaryBlob: {
      findMany: async () => mocks.rows,
      deleteMany: mocks.deleteMany,
    },
    $queryRaw: mocks.raw,
  }),
  withTenantTransaction: vi.fn(),
}));

import { cleanupExpiredNoraTemporaryBlobs } from "./nora-temporary-blob-ledger";

describe("Nora temporary Blob expiry ledger", () => {
  beforeEach(() => {
    mocks.rows = [];
    mocks.del.mockReset().mockResolvedValue(undefined);
    mocks.deleteMany.mockReset().mockResolvedValue({ count: 0 });
    mocks.raw.mockReset().mockResolvedValue([{ id: "expired-pdf" }]);
  });

  it("deletes expired tenant paths directly and never scans Blob storage", async () => {
    const now = new Date("2026-11-09T12:00:00.000Z");
    const pathname = "temp/nora-policy-pdfs/org-a/user-a/expired.pdf";
    mocks.rows = [{ id: "expired-pdf", pathname, kind: "POLICY_PDF", expiresAt: new Date("2026-11-09T11:00:00.000Z") }];

    const result = await cleanupExpiredNoraTemporaryBlobs(now);

    expect(mocks.del).toHaveBeenCalledOnce();
    expect(mocks.del).toHaveBeenCalledWith(pathname);
    expect(mocks.deleteMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "expired-pdf", organizationId: "org-a", expiresAt: { lte: now } }),
    }));
    expect(result).toMatchObject({ deleted: 1, failed: 0, organizations: 1 });
  });

  it("fails closed on a ledger path outside the organization prefix", async () => {
    mocks.rows = [{
      id: "foreign",
      pathname: "temp/nora-policy-pdfs/org-b/user-a/foreign.pdf",
      kind: "POLICY_PDF",
      expiresAt: new Date("2026-11-09T11:00:00.000Z"),
    }];

    const result = await cleanupExpiredNoraTemporaryBlobs(new Date("2026-11-09T12:00:00.000Z"));

    expect(mocks.del).not.toHaveBeenCalled();
    expect(result).toMatchObject({ deleted: 0, failed: 1 });
  });
});
