import { describe, expect, it } from "vitest";
import {
  BROKER_COMPARISON_DOCUMENT_METADATA_KEY,
  BROKER_COMPARISON_PILOT_LABEL,
  brokerComparisonDraftSchema,
  emptyBrokerComparisonDraft,
  parseDocumentMetadata,
  withSavedBrokerComparisonExtraction,
} from "@/lib/broker-comparison-pdf.shared";

describe("broker comparison PDF review draft", () => {
  it("starts every field as missing and preserves optionality", () => {
    const empty = emptyBrokerComparisonDraft();
    expect(empty.brokerName).toEqual({ value: null, status: "MISSING" });
    expect(empty.options).toEqual([]);
    expect(brokerComparisonDraftSchema.safeParse(empty).success).toBe(true);
  });

  it("accepts synthetic multi-insurer values without normalizing premiums or coverage", () => {
    const syntheticReview = {
      brokerName: { value: "Corredora de Prueba", status: "EXTRACTED" },
      clientName: { value: "Cliente Sintético", status: "VERIFIED" },
      policyType: { value: "Auto", status: "EXTRACTED" },
      insuredAsset: { value: "Sedán de prueba", status: "EXTRACTED" },
      validityDate: { value: null, status: "MISSING" },
      options: [
        {
          insurerName: { value: "Aseguradora Alfa", status: "EXTRACTED" },
          productPlan: { value: "Plan A", status: "EXTRACTED" },
          premium: { value: "$12,345.67", status: "EXTRACTED" },
          currency: { value: "MXN", status: "EXTRACTED" },
          paymentOptions: { value: ["Contado", "6 pagos"], status: "EXTRACTED" },
          paymentSchedules: [
            {
              frequency: { value: "Trimestral", status: "EXTRACTED" },
              totalPremium: { value: "$7,399", status: "EXTRACTED" },
              firstPayment: { value: "$2,372", status: "EXTRACTED" },
              subsequentPaymentCount: { value: "3", status: "EXTRACTED" },
              subsequentPaymentAmount: { value: "$1,676", status: "EXTRACTED" },
            },
          ],
          coverageLimits: { value: ["Responsabilidad civil: $3,000,000"], status: "EXTRACTED" },
          deductibles: { value: ["Daños materiales: 5%"], status: "UNCERTAIN" },
          exclusions: { value: [], status: "MISSING" },
        },
        {
          insurerName: { value: "Aseguradora Beta", status: "EXTRACTED" },
          productPlan: { value: null, status: "MISSING" },
          premium: { value: "$14,100", status: "EXTRACTED" },
          currency: { value: "USD", status: "UNCERTAIN" },
          paymentOptions: { value: [], status: "MISSING" },
          coverageLimits: { value: ["Cobertura amplia"], status: "UNCERTAIN" },
          deductibles: { value: [], status: "MISSING" },
          exclusions: { value: ["Uso comercial excluido"], status: "EXTRACTED" },
        },
      ],
    };
    expect(brokerComparisonDraftSchema.parse(syntheticReview).options).toHaveLength(2);
    expect(brokerComparisonDraftSchema.parse(syntheticReview).options[0]?.premium.value).toBe("$12,345.67");
    expect(brokerComparisonDraftSchema.parse(syntheticReview).options[0]?.paymentSchedules?.[0]).toMatchObject({
      frequency: { value: "Trimestral", status: "EXTRACTED" },
      totalPremium: { value: "$7,399", status: "EXTRACTED" },
      subsequentPaymentCount: { value: "3", status: "EXTRACTED" },
      subsequentPaymentAmount: { value: "$1,676", status: "EXTRACTED" },
    });
  });

  it("preserves unrelated document metadata when adding a confirmed result", () => {
    const existing = JSON.stringify({ uploadSource: "manual", retention: { label: "private" } });
    const result = withSavedBrokerComparisonExtraction(existing, {
      draft: emptyBrokerComparisonDraft(),
      warnings: ["Revisión manual requerida"],
      version: 1,
      status: "REVIEWED",
      sourceDocumentId: "doc-synthetic",
      confirmedAt: "2026-10-14T12:00:00.000Z",
      confirmedById: "user-synthetic",
      pilotLabel: BROKER_COMPARISON_PILOT_LABEL,
    });
    const metadata = parseDocumentMetadata(result);
    expect(metadata).toMatchObject({ uploadSource: "manual", retention: { label: "private" } });
    expect(metadata[BROKER_COMPARISON_DOCUMENT_METADATA_KEY]).toMatchObject({ status: "REVIEWED", sourceDocumentId: "doc-synthetic" });
  });
});

