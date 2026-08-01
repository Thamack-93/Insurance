import { describe, expect, it } from "vitest";
import { evaluateRestoreApplicationReadChecks } from "@/lib/backup-restore-smoke";

describe("restore application read smoke", () => {
  it("passes only when every required read check passes", () => {
    const result = evaluateRestoreApplicationReadChecks([
      { name: "user_exists", ok: true, count: 1 },
      { name: "client_table_readable", ok: true, count: 0 },
    ], { User: 1, Client: 0 });
    expect(result.ok).toBe(true);
    expect(result.counts).toEqual({ User: 1, Client: 0 });
  });

  it("fails on a query failure even when other tables are readable", () => {
    const result = evaluateRestoreApplicationReadChecks([
      { name: "user_exists", ok: true, count: 1 },
      { name: "policy_table_readable", ok: false, detail: "query_failed" },
    ]);
    expect(result.ok).toBe(false);
  });
});
