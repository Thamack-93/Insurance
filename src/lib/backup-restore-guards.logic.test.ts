import { describe, expect, it } from "vitest";
import { assertTemporaryNeonRestoreTarget } from "@/lib/backup-restore-guards";

const source = "postgresql://user:secret@ep-main.us-east-2.aws.neon.tech/app";
const sourcePooler = "postgresql://user:secret@ep-main-pooler.us-east-2.aws.neon.tech/app";
const target = "postgresql://user:secret@ep-restore.us-east-2.aws.neon.tech/app";

describe("temporary Neon restore guard", () => {
  it("accepts an explicitly authorized separate restore branch", () => {
    const result = assertTemporaryNeonRestoreTarget({
      sourceDatabaseUrl: source,
      targetDatabaseUrl: target,
      branchName: "restore-2026-07-04",
      allowRestore: "true",
    });
    expect(result.target.hostname).toContain("ep-restore");
  });

  it("rejects the current endpoint and missing authorization", () => {
    expect(() =>
      assertTemporaryNeonRestoreTarget({
        sourceDatabaseUrl: source,
        targetDatabaseUrl: source,
        branchName: "restore-test",
        allowRestore: "true",
      }),
    ).toThrow("base actual");
    expect(() =>
      assertTemporaryNeonRestoreTarget({
        sourceDatabaseUrl: source,
        targetDatabaseUrl: target,
        branchName: "restore-test",
      }),
    ).toThrow("ALLOW_TEMPORARY_NEON_RESTORE");
  });

  it("rejects pooler and direct URLs for the same Neon endpoint", () => {
    expect(() =>
      assertTemporaryNeonRestoreTarget({
        sourceDatabaseUrl: sourcePooler,
        targetDatabaseUrl: source,
        branchName: "restore-validation",
        allowRestore: "true",
      }),
    ).toThrow("base actual");
  });

  it("rejects explicit production URL variants when they are listed as forbidden", () => {
    expect(() =>
      assertTemporaryNeonRestoreTarget({
        sourceDatabaseUrl: source,
        targetDatabaseUrl: sourcePooler,
        branchName: "restore-validation",
        allowRestore: "true",
        forbiddenDatabaseUrls: [source, sourcePooler],
      }),
    ).toThrow("base actual");
  });
});
