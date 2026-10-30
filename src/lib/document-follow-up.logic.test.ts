import { describe, expect, it } from "vitest";
import { documentFollowUpSchema } from "@/lib/validations";
import { documentFollowUpHref, mapDocumentFollowUpContext } from "@/lib/document-follow-up";

describe("document follow-up context", () => {
  it("reuses a document's explicit client and policy", () => {
    expect(mapDocumentFollowUpContext({
      clientId: "client-1",
      policyId: "policy-1",
      policyClientId: "client-1",
      endorsementPolicyId: null,
      endorsementClientId: null,
      receiptClientId: null,
      receiptPolicyId: null,
      claimClientId: null,
      claimPolicyId: null,
    })).toEqual({ clientId: "client-1", policyId: "policy-1" });
  });

  it("derives missing client or policy context from existing associations", () => {
    expect(mapDocumentFollowUpContext({
      clientId: null,
      policyId: null,
      policyClientId: null,
      endorsementPolicyId: "policy-2",
      endorsementClientId: "client-2",
      receiptClientId: null,
      receiptPolicyId: null,
      claimClientId: null,
      claimPolicyId: null,
    })).toEqual({ clientId: "client-2", policyId: "policy-2" });
    expect(mapDocumentFollowUpContext({
      clientId: null,
      policyId: null,
      policyClientId: null,
      endorsementPolicyId: null,
      endorsementClientId: null,
      receiptClientId: "client-3",
      receiptPolicyId: null,
      claimClientId: null,
      claimPolicyId: null,
    })).toEqual({ clientId: "client-3", policyId: null });
    expect(mapDocumentFollowUpContext({
      clientId: null,
      policyId: null,
      policyClientId: null,
      endorsementPolicyId: null,
      endorsementClientId: null,
      receiptClientId: null,
      receiptPolicyId: null,
      claimClientId: null,
      claimPolicyId: null,
    })).toEqual({ clientId: null, policyId: null });
  });

  it("validates title/date and accepts optional notes", () => {
    expect(documentFollowUpSchema.safeParse({ title: "  Revisar expediente  ", dueDate: "2026-10-30", notes: "" }).success).toBe(true);
    expect(documentFollowUpSchema.safeParse({ title: "ab", dueDate: "2026-10-30", notes: "" }).success).toBe(false);
    expect(documentFollowUpSchema.safeParse({ title: "Revisar", dueDate: "2026-02-30", notes: "" }).success).toBe(false);
    expect(documentFollowUpSchema.safeParse({ title: "Revisar", dueDate: "30/10/2026", notes: "" }).success).toBe(false);
  });

  it("builds the canonical task link", () => {
    expect(documentFollowUpHref("task/1")).toBe("/tasks/task%2F1");
  });
});
