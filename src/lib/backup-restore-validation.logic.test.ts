import { describe, expect, it, vi } from "vitest";
import { synchronizeSequences, validateForeignKeys, validateRestoreSchema, validateTableCounts, validateDomainInvariants, type ParsedBackup } from "@/lib/backup-restore-validation";

const parsed: ParsedBackup = {
  tables: new Map([
    ["public.User", { type: "table", schema: "public", name: "User", columns: [{ name: "id", postgresType: "text" }] }],
  ]),
  rows: new Map([
    ["public.User", [{ type: "row", schema: "public", table: "User", data: { id: "u1" } }]],
  ]),
  tableEnds: new Map([["public.User", 1]]),
  declaredTotalRows: 1,
};

describe("restore count validation", () => {
  it("rejects a manifest count mismatch", async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ count: "1" }] }) } as never;
    await expect(validateTableCounts(client, parsed, [{ schema: "public", name: "User", rowCount: 2 }], 2)).rejects.toMatchObject({ code: "COUNT_MISMATCH" });
  });

  it("accepts equal backup, manifest and target counts", async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ count: "1" }] }) } as never;
    const result = await validateTableCounts(client, parsed, [{ schema: "public", name: "User", rowCount: 1 }], 1);
    expect(result.totalRows).toBe(1);
    expect(result.tables["public.User"].target).toBe(1);
  });

  it("rejects a target count mismatch and a total mismatch", async () => {
    const targetMismatchClient = { query: vi.fn().mockResolvedValue({ rows: [{ count: "2" }] }) } as never;
    await expect(validateTableCounts(targetMismatchClient, parsed, [{ schema: "public", name: "User", rowCount: 1 }], 1)).rejects.toThrow("restaurado");
    const totalMismatchClient = { query: vi.fn().mockResolvedValue({ rows: [{ count: "1" }] }) } as never;
    await expect(validateTableCounts(totalMismatchClient, parsed, [{ schema: "public", name: "User", rowCount: 1 }], 2)).rejects.toThrow("total del manifiesto");
  });
});

describe("foreign-key validation", () => {
  it("rejects an orphaned composite foreign key", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            constraint_name: "child_parent_fkey",
            table_name: "Child",
            referenced_table: "Parent",
            columns: ["one", "two"],
            referenced_columns: ["one", "two"],
          }],
        })
        .mockResolvedValueOnce({ rows: [{ count: "1" }] }),
    } as never;
    await expect(validateForeignKeys(client)).rejects.toMatchObject({ code: "FOREIGN_KEY_VIOLATION" });
  });

  it("accepts valid single-column foreign keys", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            constraint_name: "child_parent_fkey",
            table_name: "Child",
            referenced_table: "Parent",
            columns: ["parentId"],
            referenced_columns: ["id"],
          }],
        })
        .mockResolvedValueOnce({ rows: [{ count: "0" }] }),
    } as never;
    const results = await validateForeignKeys(client);
    expect(results[0]?.orphanCount).toBe(0);
  });

  it("accepts JSON FK metadata when the postgres driver returns text", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{
            constraint_name: "child_parent_fkey",
            table_name: "Child",
            referenced_table: "Parent",
            columns: '["one","two"]',
            referenced_columns: '["one","two"]',
          }],
        })
        .mockResolvedValueOnce({ rows: [{ count: "0" }] }),
    } as never;
    const results = await validateForeignKeys(client);
    expect(results[0]?.columns).toEqual(["one", "two"]);
  });
});

describe("schema validation", () => {
  it("rejects a target missing required tables", async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [] }) } as never;
    await expect(validateRestoreSchema(client, parsed)).rejects.toMatchObject({ code: "BACKUP_SCHEMA_INCOMPATIBLE" });
  });
});

describe("domain validation", () => {
  it("fails when the effective payment uniqueness query reports a duplicate", async () => {
    const client = {
      query: vi.fn(async (sql: string) => ({
        rows: [{ count: sql.includes('GROUP BY "receiptId"') ? "1" : "0" }],
      })),
    } as never;
    await expect(validateDomainInvariants(client)).rejects.toThrow("posted_payment_duplicate_receipt");
  });
});

describe("sequence synchronization", () => {
  it("chooses the next safe value from the restored maximum and increment", async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ table_schema: "public", table_name: "AuditNumber", column_name: "id", sequence_name: "public.AuditNumber_id_seq" }] })
        .mockResolvedValueOnce({ rows: [{ max_value: "7", min_value: "1" }] })
        .mockResolvedValueOnce({ rows: [{ min_value: "1", start_value: "1", increment_by: "1" }] })
        .mockResolvedValueOnce({ rows: [] }),
    };
    const result = await synchronizeSequences(client as never);
    expect(result[0]?.nextValue).toBe("8");
    expect(client.query).toHaveBeenCalledWith("SELECT setval($1::regclass, $2::bigint, true)", ["public.AuditNumber_id_seq", "7"]);
  });
});
