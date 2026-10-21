import { z } from "zod";

export const BROKER_COMPARISON_PILOT_LABEL = "PILOT ONLY — MANUAL REVIEW REQUIRED" as const;
export const BROKER_COMPARISON_DOCUMENT_METADATA_KEY = "brokerComparisonExtraction" as const;

export const BROKER_COMPARISON_FIELD_STATUSES = ["EXTRACTED", "VERIFIED", "MISSING", "UNCERTAIN"] as const;
export type BrokerComparisonFieldStatus = (typeof BROKER_COMPARISON_FIELD_STATUSES)[number];

const fieldSchema = (maxLength = 500) => z.object({
  value: z.string().trim().max(maxLength).nullable(),
  status: z.enum(BROKER_COMPARISON_FIELD_STATUSES),
}).superRefine((field, context) => {
  if (["EXTRACTED", "VERIFIED"].includes(field.status) && !field.value) {
    context.addIssue({ code: "custom", message: "Un campo extraído o verificado requiere un valor." });
  }
  if (field.status === "MISSING" && field.value) {
    context.addIssue({ code: "custom", message: "Un campo faltante no puede contener un valor." });
  }
});

const listFieldSchema = z.object({
  value: z.array(z.string().trim().min(1).max(500)).max(30),
  status: z.enum(BROKER_COMPARISON_FIELD_STATUSES),
}).superRefine((field, context) => {
  if (["EXTRACTED", "VERIFIED"].includes(field.status) && field.value.length === 0) {
    context.addIssue({ code: "custom", message: "Una lista extraída o verificada requiere valores." });
  }
  if (field.status === "MISSING" && field.value.length > 0) {
    context.addIssue({ code: "custom", message: "Una lista faltante no puede contener valores." });
  }
});

export const brokerComparisonOptionSchema = z.object({
  insurerName: fieldSchema(160),
  productPlan: fieldSchema(240),
  premium: fieldSchema(120),
  currency: fieldSchema(12),
  paymentOptions: listFieldSchema,
  paymentSchedules: z.array(z.object({
    frequency: fieldSchema(60),
    totalPremium: fieldSchema(120),
    firstPayment: fieldSchema(120),
    subsequentPaymentCount: fieldSchema(20),
    subsequentPaymentAmount: fieldSchema(120),
  })).max(8).optional(),
  coverageLimits: listFieldSchema,
  deductibles: listFieldSchema,
  exclusions: listFieldSchema,
});

export const brokerComparisonDraftSchema = z.object({
  brokerName: fieldSchema(160),
  clientName: fieldSchema(240),
  policyType: fieldSchema(160),
  insuredAsset: fieldSchema(300),
  validityDate: fieldSchema(120),
  options: z.array(brokerComparisonOptionSchema).max(12),
});

export const brokerComparisonExtractionSchema = z.object({
  draft: brokerComparisonDraftSchema,
  warnings: z.array(z.string().trim().min(1).max(300)).max(20),
});

export type BrokerComparisonOption = z.infer<typeof brokerComparisonOptionSchema>;
export type BrokerComparisonDraft = z.infer<typeof brokerComparisonDraftSchema>;
export type BrokerComparisonExtraction = z.infer<typeof brokerComparisonExtractionSchema>;

export type SavedBrokerComparisonExtraction = BrokerComparisonExtraction & {
  version: 1;
  status: "REVIEWED";
  sourceDocumentId: string;
  confirmedAt: string;
  confirmedById: string;
  pilotLabel: typeof BROKER_COMPARISON_PILOT_LABEL;
};

export const savedBrokerComparisonExtractionSchema = brokerComparisonExtractionSchema.extend({
  version: z.literal(1),
  status: z.literal("REVIEWED"),
  sourceDocumentId: z.string().min(1).max(100),
  confirmedAt: z.string().datetime(),
  confirmedById: z.string().min(1).max(100),
  pilotLabel: z.literal(BROKER_COMPARISON_PILOT_LABEL),
});

function field<T extends string | string[] | null>(value: T, status?: BrokerComparisonFieldStatus) {
  const empty = Array.isArray(value) ? value.length === 0 : value == null || value.trim() === "";
  return { value, status: status ?? (empty ? "MISSING" : "EXTRACTED") };
}

export function emptyBrokerComparisonDraft(): BrokerComparisonDraft {
  return {
    brokerName: field(null),
    clientName: field(null),
    policyType: field(null),
    insuredAsset: field(null),
    validityDate: field(null),
    options: [],
  };
}

export function createBrokerComparisonOption(): BrokerComparisonOption {
  return {
    insurerName: field(null),
    productPlan: field(null),
    premium: field(null),
    currency: field(null),
    paymentOptions: field([]),
    paymentSchedules: [],
    coverageLimits: field([]),
    deductibles: field([]),
    exclusions: field([]),
  };
}

export function createBrokerComparisonPaymentSchedule(): NonNullable<BrokerComparisonOption["paymentSchedules"]>[number] {
  return {
    frequency: field(null),
    totalPremium: field(null),
    firstPayment: field(null),
    subsequentPaymentCount: field(null),
    subsequentPaymentAmount: field(null),
  };
}

export function parseDocumentMetadata(metadataJson: string | null): Record<string, unknown> {
  if (!metadataJson) return {};
  try {
    const value: unknown = JSON.parse(metadataJson);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

export function parseSavedBrokerComparisonExtraction(metadataJson: string | null, sourceDocumentId: string) {
  const value = parseDocumentMetadata(metadataJson)[BROKER_COMPARISON_DOCUMENT_METADATA_KEY];
  const parsed = savedBrokerComparisonExtractionSchema.safeParse(value);
  if (!parsed.success || parsed.data.sourceDocumentId !== sourceDocumentId) return null;
  return parsed.data;
}

export function withSavedBrokerComparisonExtraction(
  metadataJson: string | null,
  extraction: SavedBrokerComparisonExtraction,
) {
  const metadata = parseDocumentMetadata(metadataJson);
  metadata[BROKER_COMPARISON_DOCUMENT_METADATA_KEY] = extraction;
  return JSON.stringify(metadata);
}

