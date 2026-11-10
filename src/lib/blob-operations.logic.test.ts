import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ day: 0, month: 0, put: vi.fn(), list: vi.fn(), copy: vi.fn(), upsert: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    $transaction: (callback: (tx: unknown) => unknown) => callback({
      $queryRaw: vi.fn(),
      blobOperationUsage: {
        aggregate: ({ where }: { where: { periodKind: "DAY" | "MONTH"; periodStart?: { gte?: Date } } }) => Promise.resolve({
          _sum: { advancedOperations: where.periodStart?.gte ? state.month : state.day },
        }),
        upsert: (args: { where: { periodKind_periodStart_category_source_operation: { periodKind: "DAY" | "MONTH" } }; create: { advancedOperations: number }; update: { advancedOperations: { increment: number } } }) => {
          state.upsert(args);
          if (args.where.periodKind_periodStart_category_source_operation.periodKind === "DAY") state.day += args.create.advancedOperations;
          else state.month += args.create.advancedOperations;
          return Promise.resolve({});
        },
      },
    }),
  }),
}));
vi.mock("@vercel/blob", () => ({ put: state.put, list: state.list, copy: state.copy }));

import {
  BLOB_OPERATION_DAILY_INTERACTIVE_BUDGET,
  BLOB_OPERATION_MONTHLY_INTERACTIVE_BUDGET,
  BlobOperationBudgetExceededError,
  multipartAdvancedOperationCount,
  recordBlobAdvancedOperation,
  trackedBlobPut,
} from "./blob-operations";

describe("Blob operation governance", () => {
  beforeEach(() => {
    state.day = 0;
    state.month = 0;
    state.put.mockReset().mockResolvedValue({ url: "https://blob.test/file" });
    state.list.mockReset();
    state.copy.mockReset();
    state.upsert.mockReset();
  });

  it("accounts for a repeated Nora PDF upload/analyze flow without cleanup list operations", async () => {
    for (let index = 0; index < 20; index++) {
      await trackedBlobPut({
        source: "nora.pdf.upload",
        pathname: `temp/${index}.pdf`,
        body: new Blob(["pdf"]),
        options: { access: "private", tokenPayload: {} },
      });
      // Analysis deletes the known URL; deletion is free and performs no list.
    }
    expect(state.day).toBe(20);
    expect(state.month).toBe(20);
    expect(state.put).toHaveBeenCalledTimes(20);
    expect(state.list).not.toHaveBeenCalled();
    expect(state.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { periodKind_periodStart_category_source_operation: expect.objectContaining({ source: "nora.pdf.upload", operation: "put" }) },
    }));
  });

  it("stops interactive work at the daily and monthly limits while critical backup writes continue", async () => {
    await recordBlobAdvancedOperation({ source: "nora.handoff.save", operation: "put", advancedOperations: BLOB_OPERATION_DAILY_INTERACTIVE_BUDGET });
    await expect(recordBlobAdvancedOperation({ source: "documents.upload", operation: "put", advancedOperations: 1 }))
      .rejects.toBeInstanceOf(BlobOperationBudgetExceededError);

    state.day = 0;
    state.month = BLOB_OPERATION_MONTHLY_INTERACTIVE_BUDGET;
    await expect(recordBlobAdvancedOperation({ source: "documents.upload", operation: "put", advancedOperations: 1 }))
      .rejects.toMatchObject({ period: "MONTH", limit: BLOB_OPERATION_MONTHLY_INTERACTIVE_BUDGET });
    await expect(recordBlobAdvancedOperation({ source: "backups.scheduled.create", operation: "multipart_put", advancedOperations: 4, category: "CRITICAL" })).resolves.toBeDefined();
  });

  it("reserves multipart work conservatively and attributes it before the upload begins", async () => {
    expect(multipartAdvancedOperationCount(15 * 1024 * 1024)).toBe(4);
    await trackedBlobPut({
      source: "nora.pdf.upload",
      pathname: "temp/policy.pdf",
      body: new Blob(["pdf"]),
      options: { access: "private", multipart: true, tokenPayload: {} },
      advancedOperations: multipartAdvancedOperationCount(15 * 1024 * 1024),
    });
    expect(state.day).toBe(4);
    expect(state.put).toHaveBeenCalledOnce();
  });
});
