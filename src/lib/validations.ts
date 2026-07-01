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
  QUOTE_STATUSES,
  RECEIPT_STATUSES,
  TASK_STATUSES,
  TASK_TYPES,
} from "@/lib/domain-values";

const optionalText = z.string().max(4000).optional().or(z.literal(""));
const optionalEmail = z.string().email("Email invalido.").optional().or(z.literal(""));
const requiredDate = z.string().min(1, "Selecciona una fecha.");
const optionalDate = z.string().optional().or(z.literal(""));

function dateOnly(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function daysBetweenDateInputs(startDate: string, endDate: string) {
  return Math.round((dateOnly(endDate).getTime() - dateOnly(startDate).getTime()) / (1000 * 60 * 60 * 24));
}

export const clientSchema = z.object({
  fullName: z.string().trim().min(2, "Escribe el nombre del cliente."),
  type: z.enum(CLIENT_TYPES),
  email: optionalEmail,
  phone: optionalText,
  secondaryPhone: optionalText,
  rfc: optionalText,
  address: optionalText,
  preferredContactMethod: optionalText,
  referidorId: z.string().trim().optional().or(z.literal("")),
  notes: optionalText,
  status: z.enum(ENTITY_STATUSES),
});

export const policySchema = z
  .object({
    policyNumber: z.string().trim().min(2, "Escribe el numero de poliza."),
    clientId: z.string().min(1, "Selecciona un cliente."),
    insurerId: z.string().min(1, "Selecciona una aseguradora."),
    policyType: z.enum(POLICY_TYPES),
    status: z.enum(POLICY_STATUSES),
    startDate: requiredDate,
    endDate: requiredDate,
    premiumAmount: z.coerce.number().positive("La prima debe ser mayor a cero."),
    currency: z.string().trim().min(1, "Selecciona una moneda."),
    paymentFrequency: z.enum(PAYMENT_FREQUENCIES),
    paymentPlan: optionalText,
    insuredObject: optionalText,
    beneficiaryInfo: optionalText,
    notes: optionalText,
  })
  .refine((values) => values.endDate >= values.startDate, {
    message: "La fecha final debe ser posterior al inicio.",
    path: ["endDate"],
  })
  .refine((values) => daysBetweenDateInputs(values.startDate, values.endDate) <= 366, {
    message: "La vigencia no puede superar 366 días. Divide contratos multianuales por anualidades.",
    path: ["endDate"],
  });

export const receiptSchema = z
  .object({
    receiptNumber: z.string().trim().min(2, "Escribe el numero de recibo."),
    policyId: z.string().min(1, "Selecciona una poliza."),
    endorsementId: z.string().optional().or(z.literal("")),
    periodStartDate: requiredDate,
    periodEndDate: requiredDate,
    dueDate: requiredDate,
    amount: z.coerce.number().positive("El monto debe ser mayor a cero."),
    currency: z.string().trim().min(1, "Selecciona una moneda."),
    status: z.enum(RECEIPT_STATUSES),
    paidDate: optionalDate,
    paymentMethod: optionalText,
    notes: optionalText,
  })
  .refine((values) => values.periodEndDate >= values.periodStartDate, {
    message: "El fin del periodo debe ser posterior al inicio.",
    path: ["periodEndDate"],
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

export const quoteSchema = z.object({
  clientId: z.string().min(1, "Selecciona un cliente."),
  insurerId: z.string().optional().or(z.literal("")),
  policyType: z.enum(POLICY_TYPES),
  status: z.enum(QUOTE_STATUSES),
  requestedDate: requiredDate,
  sentDate: optionalDate,
  validUntil: optionalDate,
  quotedAmount: z.coerce.number().optional(),
  notes: optionalText,
});

export type ClientFormValues = z.infer<typeof clientSchema>;
export type PolicyFormValues = z.infer<typeof policySchema>;
export type ReceiptFormValues = z.infer<typeof receiptSchema>;
export type EndorsementFormValues = z.infer<typeof endorsementSchema>;
export type WorkItemFormValues = z.infer<typeof workItemSchema>;
export type InsurerFormValues = z.infer<typeof insurerSchema>;
export type ClaimFormValues = z.infer<typeof claimSchema>;
export type QuoteFormValues = z.infer<typeof quoteSchema>;
