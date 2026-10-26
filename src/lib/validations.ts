import { businessToday, daysBetweenBusinessDates, parseBusinessDateInput } from "@/lib/business-dates";
import { z } from "zod";
import {
  CLAIM_STATUSES,
  ENDORSEMENT_STATUSES,
  CLIENT_TYPES,
  ENTITY_STATUSES,
  PAYMENT_FREQUENCIES,
  POLICY_STATUSES,
  POLICY_TYPES,
  PRIORITIES,
  RECEIPT_STATUSES,
  TASK_STATUSES,
  TASK_TYPES,
} from "@/lib/domain-values";
import { policyRiskDetailsSchema } from "@/lib/policy-risk-details";
import { bonusEligibilityEvidenceSchema } from "@/lib/bonus-evidence";

const optionalText = z.string().max(4000).optional().or(z.literal(""));
const optionalEmail = z.string().email("Email invalido.").optional().or(z.literal(""));
const requiredDate = z.string().min(1, "Selecciona una fecha.");
const optionalDate = z.string().optional().or(z.literal(""));
const commissionMoney = z.union([z.literal(""), z.coerce.number().nonnegative("El importe no puede ser negativo.")]).optional();
const optionalPolicyMoney = commissionMoney;
const financingMoney = z.union([z.literal(""), z.coerce.number()]).optional();
export const policyPremiumBreakdownCaptureSchema = z.object({
  premiumIssuanceExpenseAmount: z.number().finite().nonnegative().nullable().optional(),
  premiumSurchargeAmount: z.number().finite().nullable().optional(),
  premiumDiscountAmount: z.number().finite().nonnegative().nullable().optional(),
});
const receiptCommissionUnitSchema = z.object({
  insuredAssetId: z.string().min(1),
  totalPremium: commissionMoney,
  vatAmount: commissionMoney,
  issuanceExpenseAmount: commissionMoney,
  surchargeAmount: financingMoney,
  discountAmount: commissionMoney,
});

function dateOnly(value: string) {
  return parseBusinessDateInput(value);
}

function daysBetweenDateInputs(startDate: string, endDate: string) {
  return daysBetweenBusinessDates(dateOnly(endDate), dateOnly(startDate));
}

function isValidDateOnly(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const [, yearRaw, monthRaw, dayRaw] = match;
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  const parsed = parseBusinessDateInput(value);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() + 1 === month &&
    parsed.getUTCDate() === day
  );
}

export const clientSchema = z.object({
  fullName: z.string().trim().min(2, "Escribe el nombre del cliente."),
  type: z.enum(CLIENT_TYPES),
  email: optionalEmail,
  phone: optionalText,
  secondaryPhone: optionalText,
  rfc: optionalText,
  address: optionalText,
  birthDate: optionalDate,
  preferredContactMethod: optionalText,
  referidorId: z.string().trim().optional().or(z.literal("")),
  notes: optionalText,
  status: z.enum(ENTITY_STATUSES),
}).superRefine((values, context) => {
  if (!values.birthDate) return;
  if (!isValidDateOnly(values.birthDate)) {
    context.addIssue({ code: "custom", path: ["birthDate"], message: "La fecha de nacimiento no es válida." });
    return;
  }
  if (parseBusinessDateInput(values.birthDate) > businessToday()) {
    context.addIssue({ code: "custom", path: ["birthDate"], message: "La fecha de nacimiento no puede ser futura." });
  }
});

const policyBaseSchema = z
  .object({
    policyNumber: z.string().trim().min(2, "Escribe el numero de poliza."),
    clientId: z.string().min(1, "Selecciona un cliente."),
    insurerId: z.string().min(1, "Selecciona una aseguradora."),
    bonusSellerId: z.string().trim().optional().or(z.literal("")),
    policyType: z.enum(POLICY_TYPES),
    status: z.enum(POLICY_STATUSES),
    startDate: requiredDate,
    endDate: requiredDate,
    premiumAmount: z.coerce.number().positive("La prima debe ser mayor a cero."),
    premiumIssuanceExpenseAmount: optionalPolicyMoney,
    premiumSurchargeAmount: financingMoney,
    premiumDiscountAmount: optionalPolicyMoney,
    commissionRateOverride: z.union([
      z.literal(""),
      z.coerce.number().min(0, "La tasa no puede ser negativa.").max(100, "La tasa no puede superar 100%.").refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7, "Usa máximo dos decimales para la tasa.")
    ]).optional(),
    currency: z.string().trim().min(1, "Selecciona una moneda."),
    paymentFrequency: z.enum(PAYMENT_FREQUENCIES),
    paymentPlan: optionalText,
    insuredObject: optionalText,
    riskDetails: policyRiskDetailsSchema.optional(),
    bonusEligibilityJson: z.string().max(4000).optional().or(z.literal("")),
    beneficiaryInfo: optionalText,
    notes: optionalText,
    renewedFromPolicyId: z.string().trim().optional().or(z.literal("")),
  })
  .refine((values) => values.endDate >= values.startDate, {
    message: "La fecha final debe ser posterior al inicio.",
    path: ["endDate"],
  })
  .superRefine((values, context) => {
    if (values.riskDetails !== undefined && values.riskDetails !== null) {
      const parsed = policyRiskDetailsSchema.safeParse(values.riskDetails);
      if (!parsed.success || parsed.data.policyType !== values.policyType) {
        context.addIssue({ code: "custom", path: ["riskDetails"], message: "Revisa que los datos del riesgo correspondan al ramo seleccionado." });
      }
    }
    if (values.bonusEligibilityJson) {
      try {
        const evidence = JSON.parse(values.bonusEligibilityJson) as unknown;
        const result = bonusEligibilityEvidenceSchema.safeParse(evidence);
        if (!result.success) throw new Error("invalid evidence");
      } catch {
        context.addIssue({ code: "custom", path: ["bonusEligibilityJson"], message: "Revisa los valores y tipos de la evidencia de incentivos." });
      }
    }
  });

function policyTermWithinLimit(startDate: string, endDate: string) {
  return daysBetweenDateInputs(startDate, endDate) <= 366;
}

const policyTermError = "La vigencia no puede superar 366 días. Divide contratos multianuales por anualidades.";

export const policySchema = policyBaseSchema.refine(
  (values) => policyTermWithinLimit(values.startDate, values.endDate),
  { message: policyTermError, path: ["endDate"] },
);

export const policyUpdateSchema = policyBaseSchema;

export function policyUpdateTermIsValid(
  original: { startDate: string; endDate: string },
  next: { startDate: string; endDate: string },
) {
  return (
    (next.startDate === original.startDate && next.endDate === original.endDate)
    || policyTermWithinLimit(next.startDate, next.endDate)
  );
}

export function policyUpdateSchemaForOriginalTerm(original: { startDate: string; endDate: string }) {
  return policyBaseSchema.refine(
    (values) => policyUpdateTermIsValid(original, values),
    { message: policyTermError, path: ["endDate"] },
  );
}

export const receiptSchema = z
  .object({
    receiptNumber: z.string().trim().min(1, "Escribe el numero de recibo."),
    policyId: z.string().min(1, "Selecciona una poliza."),
    endorsementId: z.string().optional().or(z.literal("")),
    periodStartDate: requiredDate,
    periodEndDate: requiredDate,
    dueDate: requiredDate,
    amount: z.coerce.number().positive("El monto debe ser mayor a cero."),
    vatAmount: commissionMoney,
    issuanceExpenseAmount: commissionMoney,
    surchargeAmount: financingMoney,
    discountAmount: commissionMoney,
    premiumBreakdownByUnit: z.array(receiptCommissionUnitSchema).max(100).default([]),
    currency: z.string().trim().min(1, "Selecciona una moneda."),
    status: z.enum(RECEIPT_STATUSES),
    paidDate: optionalDate,
    paymentMethod: optionalText,
    notes: optionalText,
  })
  .refine((values) => values.periodEndDate >= values.periodStartDate, {
    message: "El fin del periodo debe ser posterior al inicio.",
    path: ["periodEndDate"],
  })
  .superRefine((values, context) => {
    const seen = new Set<string>();
    for (const unit of values.premiumBreakdownByUnit) {
      if (seen.has(unit.insuredAssetId)) context.addIssue({ code: "custom", path: ["premiumBreakdownByUnit"], message: "No repitas una unidad en el desglose de prima." });
      seen.add(unit.insuredAssetId);
    }
  });

export const commissionRuleSchema = z.object({
  id: z.string().optional(),
  insurerId: z.string().min(1),
  policyType: z.enum(POLICY_TYPES),
  productPlan: z.string().trim().min(1).transform((value) => value.toUpperCase()),
  policyMode: z.string().trim().min(1).transform((value) => value.toUpperCase()),
  unitClass: z.string().trim().min(1).transform((value) => value.toUpperCase()),
  paymentFrequency: z.string().trim().min(1).transform((value) => value.toUpperCase()),
  rate: z.coerce.number().gt(0).max(100),
  validFrom: requiredDate,
  validTo: optionalDate,
  active: z.boolean(),
  evidence: z.string().trim().max(1000),
  expectedVersion: z.number().int().positive(),
}).superRefine((value, context) => {
  if (value.validTo && value.validTo < value.validFrom) context.addIssue({ code: "custom", path: ["validTo"], message: "La fecha final debe ser igual o posterior al inicio." });
  if (value.active && value.evidence.length < 8) context.addIssue({ code: "custom", path: ["evidence"], message: "Agrega la fuente o evidencia antes de activar la regla." });
});

export const endorsementSchema = z
  .object({
    endorsementNumber: z.string().trim().min(1, "Escribe el numero de endoso."),
    policyId: z.string().min(1, "Selecciona una poliza."),
    status: z.enum(ENDORSEMENT_STATUSES),
    startDate: requiredDate,
    endDate: requiredDate,
    amount: z.coerce.number().positive("El importe debe ser mayor a cero."),
    currency: z.string().trim().min(1, "Selecciona una moneda."),
    reference: optionalText,
    concept: optionalText,
    notes: optionalText,
  })
  .refine((values) => values.endDate >= values.startDate, {
    message: "La fecha final debe ser posterior al inicio.",
    path: ["endDate"],
  });

export const workItemSchema = z.object({
  clientId: z.string().optional().or(z.literal("")),
  policyId: z.string().optional().or(z.literal("")),
  insurerId: z.string().optional().or(z.literal("")),
  receiptId: z.string().optional().or(z.literal("")),
  title: z.string().trim().min(3, "Escribe un titulo mas claro."),
  description: optionalText,
  taskType: z.enum(TASK_TYPES),
  status: z.enum(TASK_STATUSES),
  priority: z.enum(PRIORITIES),
  startDate: requiredDate,
  dueDate: optionalDate,
  notes: optionalText,
});

export const insurerSchema = z.object({
  name: z.string().trim().min(2, "Escribe el nombre de la aseguradora."),
  portalUrl: optionalText,
  contactName: optionalText,
  contactEmail: optionalEmail,
  contactPhone: optionalText,
  notes: optionalText,
  status: z.enum(ENTITY_STATUSES),
});

export const claimSchema = z.object({
  folio: z.string().trim().min(2, "Escribe el folio del siniestro."),
  clientId: z.string().min(1, "Selecciona un cliente."),
  policyId: z.string().min(1, "Selecciona una poliza."),
  insurerId: z.string().min(1, "Selecciona una aseguradora."),
  claimType: z.string().trim().min(2, "Escribe el tipo de siniestro."),
  description: optionalText,
  status: z.enum(CLAIM_STATUSES),
  incidentDate: requiredDate,
  reportedDate: requiredDate,
  closedDate: optionalDate,
  amountClaimed: z.coerce.number().optional(),
  amountPaid: z.coerce.number().optional(),
  notes: optionalText,
});

export type ClientFormValues = z.infer<typeof clientSchema>;
export type PolicyFormValues = z.infer<typeof policySchema>;
export type ReceiptFormValues = z.infer<typeof receiptSchema>;
export type CommissionRuleFormValues = z.infer<typeof commissionRuleSchema>;
export type EndorsementFormValues = z.infer<typeof endorsementSchema>;
export type WorkItemFormValues = z.infer<typeof workItemSchema>;
export type InsurerFormValues = z.infer<typeof insurerSchema>;
export type ClaimFormValues = z.infer<typeof claimSchema>;
