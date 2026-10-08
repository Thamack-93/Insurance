import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { assertTemporaryNeonRestoreTarget } from "@/lib/backup-restore-guards";

const source = "postgresql://user:secret@ep-main.us-east-2.aws.neon.tech/app";
const sourcePooler = "postgresql://user:secret@ep-main-pooler.us-east-2.aws.neon.tech/app";
const target = "postgresql://user:secret@ep-restore.us-east-2.aws.neon.tech/app";
const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const allow = "true";

describe("temporary Neon restore guard", () => {
  it("accepts an explicitly authorized separate restore branch", () => {
    const result = assertTemporaryNeonRestoreTarget({
      sourceDatabaseUrl: source,
      targetDatabaseUrl: target,
      branchName: `restore-cert-stage3-${sha}`,
      allowRestore: allow, candidateSha: sha,
    });
    expect(result.target.hostname).toContain("ep-restore");
  });

  it("rejects the current endpoint and missing authorization", () => {
    expect(() =>
      assertTemporaryNeonRestoreTarget({
        sourceDatabaseUrl: source,
        targetDatabaseUrl: source,
        branchName: `restore-cert-stage3-${sha}`,
        allowRestore: allow, candidateSha: sha,
      }),
    ).toThrow("base actual");
    expect(() =>
      assertTemporaryNeonRestoreTarget({
        sourceDatabaseUrl: source,
        targetDatabaseUrl: target,
        branchName: `restore-cert-stage3-${sha}`,
      }),
    ).toThrow("ALLOW_TEMPORARY_NEON_RESTORE");
  });

  it("requires the SHA-bound restore certification branch and rejects Vercel", () => {
    expect(() => assertTemporaryNeonRestoreTarget({ sourceDatabaseUrl: source, targetDatabaseUrl: target, branchName: `restore-cert-stage3-${sha}` , allowRestore: allow })).toThrow("CERTIFICATION_CANDIDATE_SHA_REQUIRED");
    expect(() => assertTemporaryNeonRestoreTarget({ sourceDatabaseUrl: source, targetDatabaseUrl: target, branchName: `restore-cert-stage3-${sha}`, allowRestore: allow, candidateSha: sha, actualHead: "b".repeat(40) })).toThrow("RESTORE_CANDIDATE_SHA_MISMATCH");
    expect(() => assertTemporaryNeonRestoreTarget({ sourceDatabaseUrl: source, targetDatabaseUrl: target, branchName: "restore-other", allowRestore: allow, candidateSha: sha })).toThrow("RESTORE_NEON_BRANCH_CANDIDATE_MISMATCH");
    expect(() => assertTemporaryNeonRestoreTarget({ sourceDatabaseUrl: source, targetDatabaseUrl: target, branchName: `restore-cert-stage3-${sha}`, allowRestore: allow, candidateSha: sha, vercelEnv: "preview" })).toThrow("TENANT_CERTIFICATION_REFUSES_VERCEL_ENVIRONMENT");
  });

  it("rejects pooler and direct URLs for the same Neon endpoint", () => {
    expect(() =>
      assertTemporaryNeonRestoreTarget({
        sourceDatabaseUrl: sourcePooler,
        targetDatabaseUrl: source,
        branchName: `restore-cert-stage3-${sha}`,
        allowRestore: allow, candidateSha: sha,
      }),
    ).toThrow("base actual");
  });

  it("rejects explicit production URL variants when they are listed as forbidden", () => {
    expect(() =>
      assertTemporaryNeonRestoreTarget({
        sourceDatabaseUrl: source,
        targetDatabaseUrl: sourcePooler,
        branchName: `restore-cert-stage3-${sha}`,
        allowRestore: allow, candidateSha: sha,
        forbiddenDatabaseUrls: [source, sourcePooler],
      }),
    ).toThrow("base actual");
  });

  it("accepts only restore, preview or temp branch prefixes", () => {
    expect(() =>
      assertTemporaryNeonRestoreTarget({
        sourceDatabaseUrl: source,
        targetDatabaseUrl: target,
        branchName: "production",
        allowRestore: allow, candidateSha: sha,
      }),
    ).toThrow("rama restore-");
    expect(() =>
      assertTemporaryNeonRestoreTarget({
        sourceDatabaseUrl: source,
        targetDatabaseUrl: target,
        branchName: "staging",
        allowRestore: allow, candidateSha: sha,
      }),
    ).toThrow("rama restore-");
    expect(() =>
      assertTemporaryNeonRestoreTarget({
        sourceDatabaseUrl: source,
        targetDatabaseUrl: target,
        branchName: "restore_2026-07-30",
        allowRestore: allow, candidateSha: sha,
      }),
    ).toThrow("rama restore-");
  });
});
