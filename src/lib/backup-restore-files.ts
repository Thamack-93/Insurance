import { createHash } from "node:crypto";
import { get } from "@vercel/blob";
import { Pool } from "pg";

type FileReferenceKind = "document" | "commission_evidence";

export type RestoredFileReference = {
  kind: FileReferenceKind;
  path: string | null;
  expectedSha256?: string | null;
  expectedSize?: number | null;
  metadataOnly?: boolean;
};

export type RestoredFileProbe = {
  status: "AVAILABLE" | "MISSING" | "UNREADABLE";
  size?: number;
  sha256?: string;
};

export type RestoredFileValidation = {
  status: "PASS" | "PENDING" | "FAIL";
  complete: boolean;
  referenceCount: number;
  blobReferenceCount: number;
  verifiedCount: number;
  availableWithoutHashCount: number;
  missingCount: number;
  unreadableCount: number;
  sizeMismatchCount: number;
  hashMismatchCount: number;
  untrackedReferenceCount: number;
  metadataOnlyCount: number;
  documentReferenceCount: number;
  commissionEvidenceReferenceCount: number;
};

type Probe = (path: string) => Promise<RestoredFileProbe>;

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function readDocumentMetadata(value: string | null) {
  if (!value) return {} as { sha256?: string; sizeBytes?: number };
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const sha256 = isSha256(parsed.sha256) ? parsed.sha256 : undefined;
    const sizeValue = parsed.sizeBytes ?? parsed.size ?? parsed.fileSize;
    const sizeBytes = typeof sizeValue === "number" && Number.isSafeInteger(sizeValue) && sizeValue >= 0
      ? sizeValue
      : undefined;
    return { sha256, sizeBytes };
  } catch {
    return {} as { sha256?: string; sizeBytes?: number };
  }
}

/**
 * Evaluates file references separately from database integrity. A present blob
 * without a recorded source hash is available for reading but cannot prove
 * historical integrity, so the result remains PENDING.
 */
export async function evaluateRestoredFileReferences(
  references: RestoredFileReference[],
  probe: Probe,
): Promise<RestoredFileValidation> {
  const result: RestoredFileValidation = {
    status: "PASS",
    complete: true,
    referenceCount: references.length,
    blobReferenceCount: 0,
    verifiedCount: 0,
    availableWithoutHashCount: 0,
    missingCount: 0,
    unreadableCount: 0,
    sizeMismatchCount: 0,
    hashMismatchCount: 0,
    untrackedReferenceCount: 0,
    metadataOnlyCount: 0,
    documentReferenceCount: references.filter((reference) => reference.kind === "document").length,
    commissionEvidenceReferenceCount: references.filter((reference) => reference.kind === "commission_evidence").length,
  };

  for (const reference of references) {
    if (reference.metadataOnly) {
      result.metadataOnlyCount += 1;
      if (result.status !== "FAIL") result.status = "PENDING";
      result.complete = false;
      continue;
    }

    if (!reference.path?.startsWith("blob:") || reference.path.slice("blob:".length).trim().length === 0) {
      result.untrackedReferenceCount += 1;
      if (result.status !== "FAIL") result.status = "PENDING";
      result.complete = false;
      continue;
    }

    result.blobReferenceCount += 1;
    let inspected: RestoredFileProbe;
    try {
      inspected = await probe(reference.path.slice("blob:".length));
    } catch {
      inspected = { status: "UNREADABLE" };
    }

    if (inspected.status === "MISSING") {
      result.missingCount += 1;
      result.status = "FAIL";
      result.complete = false;
      continue;
    }
    if (inspected.status !== "AVAILABLE" || inspected.size === undefined || !inspected.sha256) {
      result.unreadableCount += 1;
      result.status = "FAIL";
      result.complete = false;
      continue;
    }

    if (reference.expectedSize !== undefined && reference.expectedSize !== null && inspected.size !== reference.expectedSize) {
      result.sizeMismatchCount += 1;
      result.status = "FAIL";
      result.complete = false;
      continue;
    }
    if (!isSha256(reference.expectedSha256)) {
      result.availableWithoutHashCount += 1;
      result.status = result.status === "FAIL" ? "FAIL" : "PENDING";
      result.complete = false;
      continue;
    }
    if (inspected.sha256.toLowerCase() !== reference.expectedSha256.toLowerCase()) {
      result.hashMismatchCount += 1;
      result.status = "FAIL";
      result.complete = false;
      continue;
    }
    result.verifiedCount += 1;
  }

  return result;
}

function isMissingBlobError(error: unknown) {
  const candidate = error as { name?: unknown; status?: unknown; statusCode?: unknown };
  return candidate?.status === 404
    || candidate?.statusCode === 404
    || (typeof candidate?.name === "string" && /not.?found/i.test(candidate.name));
}

async function probeBlob(path: string): Promise<RestoredFileProbe> {
  try {
    const response = await get(path, { access: "private", useCache: false });
    if (!response || response.statusCode !== 200 || !response.stream) return { status: "MISSING" };
    const hash = createHash("sha256");
    let size = 0;
    const reader = response.stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        size += value.byteLength;
      }
    } finally {
      reader.releaseLock();
    }
    if (response.blob.size !== size) return { status: "UNREADABLE" };
    return { status: "AVAILABLE", size, sha256: hash.digest("hex") };
  } catch (error) {
    return { status: isMissingBlobError(error) ? "MISSING" : "UNREADABLE" };
  }
}

export async function validateRestoredFiles(targetDatabaseUrl: string): Promise<RestoredFileValidation> {
  const pool = new Pool({ connectionString: targetDatabaseUrl, max: 1, application_name: "policydesk-restore-file-validation" });
  try {
    const documents = await pool.query<{ filePath: string | null; metadataJson: string | null }>(
      `SELECT "filePath", "metadataJson" FROM "Document" ORDER BY id`,
    );
    const statements = await pool.query<{ sourceFilePath: string | null; sourceHash: string | null }>(
      `SELECT "sourceFilePath", "sourceHash" FROM "CommissionStatement" ORDER BY id`,
    );
    const references: RestoredFileReference[] = [
      ...documents.rows.map((document) => {
        const metadata = readDocumentMetadata(document.metadataJson);
        return {
          kind: "document" as const,
          path: document.filePath,
          expectedSha256: metadata.sha256,
          expectedSize: metadata.sizeBytes,
          metadataOnly: document.filePath?.startsWith("demo://") ?? false,
        };
      }),
      ...statements.rows.map((statement) => ({
        kind: "commission_evidence" as const,
        path: statement.sourceFilePath,
        expectedSha256: statement.sourceHash,
      })),
    ];
    return evaluateRestoredFileReferences(references, probeBlob);
  } finally {
    await pool.end().catch(() => undefined);
  }
}
