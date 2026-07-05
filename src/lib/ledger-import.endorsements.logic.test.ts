import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  planLedgerEndorsements,
  summarizeLedgerEndorsementDecisions,
  type LedgerEndorsementSourceRow,
  type LedgerExistingEndorsement,
} from "@/lib/ledger-import";

const date = (value: string) => new Date(`${value}T12:00:00.000Z`);
const now = date("2026-01-15");

const row: LedgerEndorsementSourceRow = {
  rowNumber: 2,
  policyNumber: "POL-001",
  contractorName: "Cliente Uno",
  insurerName: "Aseguradora Uno",
  policyStart: date("2026-01-01"),
  policyEnd: date("2026-12-31"),
  receiptNumber: "R-1",
  periodStart: date("2026-02-01"),
  periodEnd: date("2026-03-01"),
  endorsementNumber: "E-7",
  endorsementType: "Alta",
  endorsementConcept: "Equipo adicional",
  description: "Equipo",
  currency: "MXN",
  totalAmount: 1250,
  status: "Vigente",
};

const policy = {
  id: "policy-1",
  policyNumber: "POL-001",
  startDate: date("2026-01-01"),
  endDate: date("2026-12-31"),
  clientName: "Cliente Uno",
  insurerName: "Aseguradora Uno",
};

const receipt = {
  id: "receipt-1",
  policyId: policy.id,
  receiptNumber: "R-1",
  periodStartDate: date("2026-02-01"),
  periodEndDate: date("2026-03-01"),
  endorsementId: null,
};

function plan(existingEndorsements: LedgerExistingEndorsement[] = [], receiptEndorsementId: string | null = null) {
  return planLedgerEndorsements({
    rows: [row],
    policies: [policy],
    receipts: [{ ...receipt, endorsementId: receiptEndorsementId }],
    existingEndorsements,
    now,
  });
}

describe("ledger endorsement import planning", () => {
  it("classifies a resolvable new endorsement as created and ready", () => {
    const result = plan();

    expect(result.decisions).toMatchObject([
      {
        state: "CREATED",
        action: "UPSERT_ENDORSEMENT",
        status: "READY",
        policyId: "policy-1",
        receiptId: "receipt-1",
      },
    ]);
    expect(result.metrics).toEqual({ created: 1, updated: 0, unchanged: 0, reviewRequired: 0 });
  });

  it("classifies changed and identical persisted data deterministically", () => {
    const created = plan().decisions[0];
    const persisted: LedgerExistingEndorsement = {
      id: "endorsement-1",
      policyId: policy.id,
      ...created.data!,
    };

    expect(plan([{ ...persisted, amount: 900 }], persisted.id).decisions[0].state).toBe("UPDATED");
    expect(plan([persisted], persisted.id).decisions[0]).toMatchObject({
      state: "UNCHANGED",
      action: "NOOP_ENDORSEMENT_UNCHANGED",
      status: "APPLIED",
    });
  });

  it("plans an idempotent rerun as unchanged", () => {
    const firstPlan = plan();
    const persisted: LedgerExistingEndorsement = {
      id: "endorsement-1",
      policyId: policy.id,
      ...firstPlan.decisions[0].data!,
    };

    const rerun = plan([persisted], persisted.id);

    expect(rerun.metrics).toEqual({ created: 0, updated: 0, unchanged: 1, reviewRequired: 0 });
  });

  it("sends missing, ambiguous and conflicting targets to review without an applicable action", () => {
    const missing = planLedgerEndorsements({
      rows: [row],
      policies: [],
      receipts: [receipt],
      existingEndorsements: [],
      now,
    });
    const ambiguous = planLedgerEndorsements({
      rows: [row],
      policies: [policy, { ...policy, id: "policy-2" }],
      receipts: [receipt],
      existingEndorsements: [],
      now,
    });
    const conflictingLink = plan([], "another-endorsement");

    expect(missing.decisions[0]).toMatchObject({ state: "REVIEW_REQUIRED", status: "REVIEW" });
    expect(ambiguous.decisions[0].issue?.type).toBe("ENDORSEMENT_POLICY_AMBIGUOUS");
    expect(conflictingLink.decisions[0].issue?.type).toBe("ENDORSEMENT_RECEIPT_CONFLICT");
    expect([missing, ambiguous, conflictingLink].every((result) => result.metrics.reviewRequired === 1)).toBe(true);
  });

  it("counts each endorsement metric key once even when several receipt rows share it", () => {
    const metrics = summarizeLedgerEndorsementDecisions([
      { rowNumber: 1, state: "CREATED", action: "UPSERT_ENDORSEMENT", status: "READY", metricKey: "p1|e1" },
      { rowNumber: 2, state: "CREATED", action: "UPSERT_ENDORSEMENT", status: "READY", metricKey: "p1|e1" },
      { rowNumber: 3, state: "UPDATED", action: "UPSERT_ENDORSEMENT", status: "READY", metricKey: "p1|e2" },
      { rowNumber: 4, state: "UNCHANGED", action: "NOOP_ENDORSEMENT_UNCHANGED", status: "APPLIED", metricKey: "p1|e3" },
      { rowNumber: 5, state: "REVIEW_REQUIRED", action: "REVIEW", status: "REVIEW", metricKey: "row:5" },
    ]);

    expect(metrics).toEqual({ created: 1, updated: 1, unchanged: 1, reviewRequired: 1 });
  });
});
