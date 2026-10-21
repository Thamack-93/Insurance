import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const document = {
    id: "doc-1",
    fileName: "synthetic-broker-comparison.pdf",
    filePath: "blob:https://private.example/doc-1",
    mimeType: "application/pdf",
    documentType: "QUOTE",
    version: 4,
    metadataJson: JSON.stringify({ retainedKey: "keep-me" }),
    quoteId: "quote-1",
  };
  const tx = {
    organization: { findUnique: vi.fn().mockResolvedValue({ kind: "PERSONAL" }) },
    document: {
      findFirst: vi.fn().mockResolvedValue(document),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  return {
    document,
    tx,
    requireUser: vi.fn().mockResolvedValue({ id: "user-1" }),
    requireOrganizationContext: vi.fn().mockResolvedValue({ organizationId: "org-1", userId: "user-1", membershipRole: "OWNER" }),
    assertOrganizationContextInTransaction: vi.fn().mockResolvedValue(undefined),
    withTenantTransaction: vi.fn(async (_context: unknown, callback: (value: typeof tx) => unknown) => callback(tx)),
    resolveOrganizationCapability: vi.fn().mockResolvedValue({ enabled: true }),
    extractPdfTextFromBytes: vi.fn().mockResolvedValue({ pageCount: 1, text: "Corredor de Prueba\nCliente Sintético\nAseguradora Alfa\nPrima $12,345.67 MXN" }),
    get: vi.fn().mockResolvedValue({ stream: new Response(new Uint8Array([37, 80, 68, 70])).body }),
    extractBrokerComparisonWithAi: vi.fn().mockResolvedValue({ value: {
      draft: {
        brokerName: { value: "Corredor de Prueba", status: "EXTRACTED" },
        clientName: { value: "Cliente Sintético", status: "EXTRACTED" },
        policyType: { value: null, status: "MISSING" },
        insuredAsset: { value: null, status: "MISSING" },
        validityDate: { value: null, status: "MISSING" },
        options: [{
          insurerName: { value: "Aseguradora Alfa", status: "EXTRACTED" },
          productPlan: { value: null, status: "MISSING" },
          premium: { value: "$12,345.67", status: "EXTRACTED" },
          currency: { value: "MXN", status: "EXTRACTED" },
          paymentOptions: { value: [], status: "MISSING" },
          coverageLimits: { value: [], status: "MISSING" },
          deductibles: { value: [], status: "MISSING" },
          exclusions: { value: [], status: "MISSING" },
        }],
      },
      warnings: ["Confirma la moneda con el documento original."],
    } }),
    writeActivityLog: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/assistant-ai", () => ({ extractBrokerComparisonWithAi: mocks.extractBrokerComparisonWithAi }));
vi.mock("@/lib/activity-log", () => ({ writeActivityLog: mocks.writeActivityLog }));
vi.mock("@/lib/deployment", () => ({ areDocumentFilesEnabled: () => true }));
vi.mock("@/lib/files", () => ({ assertSafeDocumentPath: (value: string) => value }));
vi.mock("@/lib/organization-context", () => ({
  assertOrganizationContextInTransaction: mocks.assertOrganizationContextInTransaction,
  requireOrganizationContext: mocks.requireOrganizationContext,
  withTenantTransaction: mocks.withTenantTransaction,
}));
vi.mock("@/lib/organization-capabilities", () => ({ resolveOrganizationCapability: mocks.resolveOrganizationCapability }));
vi.mock("@/lib/pdf-text-extraction", () => ({ extractPdfTextFromBytes: mocks.extractPdfTextFromBytes }));
vi.mock("@vercel/blob", () => ({ get: mocks.get }));

import { confirmBrokerComparisonExtraction, extractBrokerComparisonDocument } from "@/app/(dashboard)/documents/broker-comparison-actions";

describe("broker comparison PDF source-document workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.BLOB_READ_WRITE_TOKEN = "test-only";
    mocks.document.version = 4;
    mocks.document.metadataJson = JSON.stringify({ retainedKey: "keep-me" });
    mocks.tx.organization.findUnique.mockResolvedValue({ kind: "PERSONAL" });
    mocks.tx.document.findFirst.mockResolvedValue(mocks.document);
    mocks.tx.document.updateMany.mockResolvedValue({ count: 1 });
    mocks.extractPdfTextFromBytes.mockResolvedValue({ pageCount: 1, text: "synthetic broker comparison text" });
    mocks.get.mockImplementation(async () => ({ stream: new Response(new Uint8Array([37, 80, 68, 70])).body }));
  });

  it("extracts only from an authorized linked QUOTE document and does not persist the draft", async () => {
    const result = await extractBrokerComparisonDocument("doc-1");
    expect(result.ok).toBe(true);
    expect(mocks.tx.document.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ organizationId: "org-1", documentType: "QUOTE", quoteId: { not: null } }) }));
    expect(mocks.extractBrokerComparisonWithAi).toHaveBeenCalledWith(expect.objectContaining({ text: "synthetic broker comparison text" }));
    expect(mocks.tx.document.updateMany).not.toHaveBeenCalled();
  });

  it("persists corrected review only on confirmation and keeps existing metadata", async () => {
    const extraction = await extractBrokerComparisonDocument("doc-1");
    expect(extraction.ok).toBe(true);
    if (!extraction.ok) return;
    const correctedExtraction = {
      ...extraction.value.extraction,
      draft: {
        ...extraction.value.extraction.draft,
        options: extraction.value.extraction.draft.options.map((option, index) => index === 0
          ? { ...option, premium: { value: "$12,345.70", status: "VERIFIED" as const } }
          : option),
      },
    };
    const confirmation = await confirmBrokerComparisonExtraction({
      documentId: "doc-1",
      expectedVersion: extraction.value.documentVersion,
      extraction: correctedExtraction,
    });
    if (!confirmation.ok) throw new Error(JSON.stringify(confirmation));
    expect(confirmation.ok).toBe(true);
    expect(mocks.tx.document.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ version: 4, quoteId: "quote-1", organizationId: "org-1", metadataJson: JSON.stringify({ retainedKey: "keep-me" }) }),
      data: expect.objectContaining({ version: { increment: 1 }, metadataJson: expect.stringContaining("brokerComparisonExtraction") }),
    }));
    const savedMetadata = JSON.parse(mocks.tx.document.updateMany.mock.calls[0]?.[0].data.metadataJson as string) as Record<string, unknown>;
    expect(savedMetadata.retainedKey).toBe("keep-me");
    expect(savedMetadata.brokerComparisonExtraction).toMatchObject({
      status: "REVIEWED",
      sourceDocumentId: "doc-1",
      pilotLabel: "PILOT ONLY — MANUAL REVIEW REQUIRED",
      draft: { options: [{ premium: { value: "$12,345.70", status: "VERIFIED" } }] },
    });
    expect(mocks.writeActivityLog).toHaveBeenCalledWith(expect.objectContaining({ action: "BROKER_COMPARISON_EXTRACTION_CONFIRMED", entityId: "doc-1" }));
  });

  it("fails closed for Demo organizations and scan-only PDFs", async () => {
    mocks.tx.organization.findUnique.mockResolvedValue({ kind: "DEMO" });
    const demoResult = await extractBrokerComparisonDocument("doc-1");
    expect(demoResult).toMatchObject({ ok: false, code: "DEMO_DISABLED" });

    mocks.tx.organization.findUnique.mockResolvedValue({ kind: "PERSONAL" });
    mocks.extractPdfTextFromBytes.mockResolvedValue({ pageCount: 1, text: "" });
    const scanResult = await extractBrokerComparisonDocument("doc-1");
    expect(scanResult).toMatchObject({ ok: false, code: "NO_TEXT" });
    expect(mocks.tx.document.updateMany).not.toHaveBeenCalled();
  });
});

