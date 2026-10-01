import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BackupManifest } from "./backup-logic";

const mocks = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn(), end: vi.fn() }));
vi.mock("pg", () => ({
  Pool: class {
    connect = async () => ({ query: mocks.query, release: mocks.release });
    end = mocks.end;
  },
}));
vi.mock("@/lib/backup-restore-validation", async (importOriginal) => ({
  ...await importOriginal<typeof import("./backup-restore-validation")>(),
  validateForeignKeys: vi.fn().mockResolvedValue([]),
  validateDomainInvariants: vi.fn().mockResolvedValue([]),
  synchronizeSequences: vi.fn().mockResolvedValue([]),
}));

import { restoreOrganizationBackup } from "./organization-backup-restore";

const organizationId = "org-fixture";
const plaintext = Buffer.from([
  { type: "table", schema: "public", name: "Client", primaryKey: ["id"], columns: [{ name: "id", postgresType: "text" }, { name: "organizationId", postgresType: "text" }] },
  { type: "row", schema: "public", table: "Client", data: { id: "client-fixture", organizationId } },
  { type: "table_end", schema: "public", table: "Client", rowCount: 1 },
  { type: "end", rowCount: 1 },
].map((value) => JSON.stringify(value)).join("\n"));
const manifest = { version: 2, organization: { id: organizationId }, capability: "COMPLETE", totals: { rows: 1, tables: 1 }, tables: [{ schema: "public", name: "Client", rowCount: 1 }] } as BackupManifest;

describe("tenant restore count verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.end.mockResolvedValue(undefined);
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM "Organization"')) return { rows: [{ status: "ACTIVE" }] };
      if (sql.includes("count(*)")) return { rows: [{ count: "1" }] };
      return { rows: [] };
    });
  });

  it("reports actual tenant counts only after matching the backup and manifest", async () => {
    const result = await restoreOrganizationBackup({ targetDatabaseUrl: "postgresql://test:fake@localhost/disposable", organizationId, plaintext, manifest });
    expect(result.tables).toEqual([{ table: "Client", rows: 1, backup: 1, manifest: 1 }]);
    expect(mocks.query).toHaveBeenCalledWith('SELECT count(*)::text AS count FROM "public"."Client" WHERE "organizationId" = $1', [organizationId]);
    expect(mocks.query).toHaveBeenCalledWith("COMMIT");
  });

  it("rolls back tenant replacement when stored rows differ from the backup", async () => {
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM "Organization"')) return { rows: [{ status: "ACTIVE" }] };
      if (sql.includes("count(*)")) return { rows: [{ count: "0" }] };
      return { rows: [] };
    });
    await expect(restoreOrganizationBackup({ targetDatabaseUrl: "postgresql://test:fake@localhost/disposable", organizationId, plaintext, manifest })).rejects.toMatchObject({ code: "COUNT_MISMATCH" });
    expect(mocks.query).toHaveBeenCalledWith("ROLLBACK");
    expect(mocks.query).not.toHaveBeenCalledWith("COMMIT");
  });
  it("rejects corrupt totals before modifying the destination", async () => {
    await expect(restoreOrganizationBackup({ targetDatabaseUrl: "postgresql://test:fake@localhost/disposable", organizationId, plaintext, manifest: { ...manifest, totals: { rows: 2, tables: 1 } } })).rejects.toMatchObject({ code: "COUNT_MISMATCH" });
    expect(mocks.query).not.toHaveBeenCalled();
  });
});
