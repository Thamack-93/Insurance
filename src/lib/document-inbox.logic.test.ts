import { describe, expect, it } from "vitest";
import { getDocumentInboxAssociationError } from "@/lib/document-inbox.logic";

describe("document inbox association validation", () => {
  it("requires policy documents to be associated with a policy", () => {
    expect(getDocumentInboxAssociationError("POLICY", "POLICY")).toBeNull();
    expect(getDocumentInboxAssociationError("POLICY", "CLIENT")).toContain("no corresponde");
  });

  it("requires financial, claim and endorsement documents to match their record type", () => {
    expect(getDocumentInboxAssociationError("PAYMENT_PROOF", "RECEIPT")).toBeNull();
    expect(getDocumentInboxAssociationError("CLAIM", "CLAIM")).toBeNull();
    expect(getDocumentInboxAssociationError("ENDORSEMENT", "POLICY")).toContain("no corresponde");
  });

  it("allows general document types to be attached to supported records", () => {
    expect(getDocumentInboxAssociationError("ID", "CLIENT")).toBeNull();
    expect(getDocumentInboxAssociationError("RENEWAL", "POLICY")).toBeNull();
    expect(getDocumentInboxAssociationError("LETTER", "TASK")).toBeNull();
    expect(getDocumentInboxAssociationError("OTHER", "POLICY")).toBeNull();
  });

  it("rejects values outside existing document and association types", () => {
    expect(getDocumentInboxAssociationError("AUTOMATIC", "CLIENT")).toContain("clasificación");
    expect(getDocumentInboxAssociationError("OTHER", "QUOTE")).toContain("expediente");
  });
});
