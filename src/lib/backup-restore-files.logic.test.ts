import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { evaluateRestoredFileReferences } from "@/lib/backup-restore-files";

const bytes = Buffer.from("restored-file");
const sha256 = createHash("sha256").update(bytes).digest("hex");

describe("restored file validation", () => {
  it("requires availability and the recorded hash for complete recovery", async () => {
    const result = await evaluateRestoredFileReferences([
      { kind: "document", path: "blob:documents/a.pdf", expectedSha256: sha256, expectedSize: bytes.length },
    ], async () => ({ status: "AVAILABLE", size: bytes.length, sha256 }));

    expect(result).toMatchObject({ status: "PASS", complete: true, verifiedCount: 1 });
  });

  it("keeps recovery pending when a blob is readable but has no source hash", async () => {
    const result = await evaluateRestoredFileReferences(
      [{ kind: "document", path: "blob:documents/a.pdf" }],
      async () => ({ status: "AVAILABLE", size: bytes.length, sha256 }),
    );

    expect(result).toMatchObject({ status: "PENDING", complete: false, availableWithoutHashCount: 1 });
  });

  it("blocks missing or mismatched evidence and counts untracked references", async () => {
    const result = await evaluateRestoredFileReferences([
      { kind: "document", path: "blob:documents/missing.pdf", expectedSha256: sha256 },
      { kind: "commission_evidence", path: "blob:statements/changed.pdf", expectedSha256: "f".repeat(64) },
      { kind: "commission_evidence", path: null, expectedSha256: sha256 },
    ], async (path) => path.includes("missing")
      ? { status: "MISSING" }
      : { status: "AVAILABLE", size: bytes.length, sha256 });

    expect(result.status).toBe("FAIL");
    expect(result.complete).toBe(false);
    expect(result.missingCount).toBe(1);
    expect(result.hashMismatchCount).toBe(1);
    expect(result.untrackedReferenceCount).toBe(1);
  });

  it("treats synthetic metadata-only references as pending", async () => {
    const result = await evaluateRestoredFileReferences([
      { kind: "document", path: "demo:organization/synthetic/file", metadataOnly: true },
    ], async () => ({ status: "AVAILABLE", size: bytes.length, sha256 }));

    expect(result).toMatchObject({ status: "PENDING", complete: false, metadataOnlyCount: 1 });
  });
});
