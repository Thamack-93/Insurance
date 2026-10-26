import { z } from "zod";

export const bonusEligibilityEvidenceSchema = z.object({
  productEligible: z.boolean().optional(),
  fleetUnder50: z.boolean().nullable().optional(),
  autoExclusionsReviewed: z.boolean().optional(),
  sellerAttributionConfirmed: z.boolean().optional(),
  businessType: z.string().trim().max(200).optional(),
  facultativeInsuranceReviewed: z.boolean().optional(),
  specialConditionsReviewed: z.boolean().optional(),
  directedBusinessReviewed: z.boolean().optional(),
  frontingReviewed: z.boolean().optional(),
  damageExclusionsReviewed: z.boolean().optional(),
  sourceReference: z.string().trim().max(500).optional(),
  evidenceAsOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  reviewedById: z.string().optional(),
  reviewedAt: z.string().datetime().optional(),
  inventoryVehicleCount: z.number().int().nonnegative().nullable().optional(),
  batchAttestation: z.string().max(100).optional(),
}).passthrough().superRefine((value, context) => {
  if (value.evidenceAsOf && !validEvidenceDate(value.evidenceAsOf)) context.addIssue({ code: "custom", path: ["evidenceAsOf"], message: "Fecha de evidencia inválida." });
});

export const damagePortfolioLossRatioEvidenceSchema = z.object({
  lossRatioPercent: z.number().finite().min(0).max(100).nullable(),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  sourceReference: z.string().trim().min(3).max(500).nullable(),
}).superRefine((value, context) => {
  if (value.asOf && !validEvidenceDate(value.asOf)) context.addIssue({ code: "custom", path: ["asOf"], message: "Fecha de corte inválida." });
});

export type DamagePortfolioLossRatioEvidence = z.infer<typeof damagePortfolioLossRatioEvidenceSchema>;

export type BonusEligibilityEvidence = z.infer<typeof bonusEligibilityEvidenceSchema>;

export function parseBonusEligibilityEvidence(value: string | null | undefined): BonusEligibilityEvidence {
  if (!value) return {};
  try {
    const parsed = bonusEligibilityEvidenceSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export function serializeBonusEligibilityEvidence(evidence: BonusEligibilityEvidence): string {
  return JSON.stringify(bonusEligibilityEvidenceSchema.parse(evidence));
}

export function recordBonusEvidenceReview(value: string | null, reviewerId: string, reviewedAt = new Date()): string | null {
  if (!value) return null;
  const parsed = bonusEligibilityEvidenceSchema.safeParse(JSON.parse(value));
  if (!parsed.success) throw new Error("BONUS_EVIDENCE_INVALID");
  return serializeBonusEligibilityEvidence({ ...parsed.data, reviewedById: reviewerId, reviewedAt: reviewedAt.toISOString() });
}

export function autoFleetEligibilityFromInventory(input: {
  insuredAssetCount: number;
  structuredVehicleCount: number;
  adminConfirmedInventoryComplete: boolean;
}) {
  const knownVehicleCount = Math.max(input.insuredAssetCount, input.structuredVehicleCount);
  if (knownVehicleCount >= 50) return { fleetUnder50: false, vehicleCount: knownVehicleCount };
  if (knownVehicleCount < 1) return { fleetUnder50: null, vehicleCount: null };
  if (!input.adminConfirmedInventoryComplete) return { fleetUnder50: null, vehicleCount: knownVehicleCount };
  return { fleetUnder50: true, vehicleCount: knownVehicleCount };
}

export function isBonusReceiptOverpaid(receiptAmount: number, totalPostedPayments: number) {
  return totalPostedPayments > receiptAmount + 0.01;
}

export function validEvidenceDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
