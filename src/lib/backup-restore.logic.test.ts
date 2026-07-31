import { describe, expect, it } from "vitest";
import { sanitizeRestoreDrillError, createEmptyDrillReport } from "@/lib/backup-restore-report";
import { parseBackupRecords } from "@/lib/backup-restore-validation";

describe("backup restore report safety", () => {
  it("redacts URLs, credentials and secrets from errors", () => {
    const message = sanitizeRestoreDrillError(
      new Error("RESTORE_DATABASE_URL=postgresql://user:password@host/db?sslmode=require BACKUP_ENCRYPTION_KEY=secret-value"),
    );
    expect(message).not.toContain("postgresql://user");
    expect(message).not.toContain("password");
    expect(message).not.toContain("secret-value");
    expect(message).toContain("[redacted]");
  });

  it("always creates a failure-capable report shape", () => {
    const report = createEmptyDrillReport({
      backupFilename: "policydesk-20260730T000000000Z-abcdefabcdef-kv-v1.ndjson.gz.enc",
      startedAt: "2026-07-30T00:00:00.000Z",
    });
    expect(report.drillVersion).toBe(1);
    expect(report.finalStatus).toBe("FAIL");
    expect(report.sanitizedError).toBeNull();
  });
});
describe("backup record parser", () => {
  it("parses table, row, table_end and end records", () => {
    const parsed = parseBackupRecords(Buffer.from([
      JSON.stringify({ type: "backup", format: "policydesk-postgres-ndjson", version: 1 }),
      JSON.stringify({ type: "table", schema: "public", name: "User", columns: [{ name: "id", postgresType: "text" }] }),
      JSON.stringify({ type: "row", schema: "public", table: "User", data: { id: "u1" } }),
      JSON.stringify({ type: "table_end", schema: "public", table: "User", rowCount: 1 }),
      JSON.stringify({ type: "end", tableCount: 1, rowCount: 1 }),
      "",
    ].join("\n")));
    expect(parsed.rows.get("public.User")).toHaveLength(1);
    expect(parsed.tableEnds.get("public.User")).toBe(1);
    expect(parsed.declaredTotalRows).toBe(1);
  });

  it("rejects rows for tables that were not declared", () => {
    expect(() => parseBackupRecords(Buffer.from(JSON.stringify({ type: "row", schema: "public", table: "User", data: {} })))).toThrow("antes de su definición");
  });
});
