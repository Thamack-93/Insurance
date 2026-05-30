import { z } from "zod";

const optionalText = z.string().max(4000).optional().or(z.literal(""));
const optionalEmail = z.string().email("Email invalido.").optional().or(z.literal(""));
const requiredDate = z.string().min(1, "Selecciona una fecha.");
const optionalDate = z.string().optional().or(z.literal(""));

export const clientSchema = z.object({
  fullName: z.string().trim().min(2, "Escribe el nombre del cliente."),
  type: z.enum(["PERSON", "COMPANY"]),
  email: optionalEmail,
  phone: optionalText,
  secondaryPhone: optionalText,
  rfc: optionalText,
  address: optionalText,
  preferredContactMethod: optionalText,
  referidorId: z.string().trim().optional().or(z.literal("")),
  notes: optionalText,
  status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]),
});

export const policySchema = z
  .object({
    policyNumber: z.string().trim().min(2, "Escribe el numero de poliza."),
    clientId: z.string().min(1, "Selecciona un cliente."),
    insurerId: z.string().min(1, "Selecciona una aseguradora."),
    policyType: z.enum([
      "AUTO",
      "GMM",
      "VIDA",
      "DANOS",
      "FIANZAS",
      "HOGAR",
      "RESPONSABILIDAD_CIVIL",
      "EMPRESARIAL",
      "ACCIDENTES",
      "OTRO",
    ]),
    status: z.enum(["ACTIVE", "EXPIRED", "CANCELLED", "RENEWED", "PENDING"]),
    startDate: requiredDate,
    endDate: requiredDate,
    premiumAmount: z.coerce.number().positive("La prima debe ser mayor a cero."),
    currency: z.string().trim().min(1, "Selecciona una moneda."),
    paymentFrequency: z.enum(["MONTHLY", "QUARTERLY", "SEMIANNUAL", "ANNUAL", "SINGLE", "OTHER"]),
    paymentPlan: optionalText,
    insuredObject: optionalText,
    beneficiaryInfo: optionalText,
    notes: optionalText,
  })
  .refine((values) => values.endDate >= values.startDate, {
    message: "La fecha final debe ser posterior al inicio.",
    path: ["endDate"],
  });

export const receiptSchema = z
  .object({
    receiptNumber: z.string().trim().min(2, "Escribe el numero de recibo."),
    policyId: z.string().min(1, "Selecciona una poliza."),
    periodStartDate: requiredDate,
    periodEndDate: requiredDate,
    dueDate: requiredDate,
    amount: z.coerce.number().positive("El monto debe ser mayor a cero."),
    currency: z.string().trim().min(1, "Selecciona una moneda."),
    status: z.enum(["PENDING", "PAID", "OVERDUE", "CANCELLED"]),
    notes: optionalText,
  })
  .refine((values) => values.periodEndDate >= values.periodStartDate, {
    message: "El fin del periodo debe ser posterior al inicio.",
    path: ["periodEndDate"],
  });

export const workItemSchema = z.object({
  clientId: z.string().optional().or(z.literal("")),
  policyId: z.string().optional().or(z.literal("")),
  insurerId: z.string().optional().or(z.literal("")),
  receiptId: z.string().optional().or(z.literal("")),
  title: z.string().trim().min(3, "Escribe un titulo mas claro."),
  description: optionalText,
  taskType: z.enum(["GENERAL", "CLAIM", "QUOTE", "RENEWAL", "PAYMENT", "DOCUMENT", "COMMISSION", "OTHER"]),
  status: z.enum([
    "OPEN",
    "IN_PROGRESS",
    "WAITING_CLIENT",
    "WAITING_INSURER",
    "WAITING_DOCUMENT",
    "SENT",
    "RESOLVED",
    "CANCELLED",
    "ARCHIVED",
  ]),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
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
  status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]),
});

export const claimSchema = z.object({
  folio: z.string().trim().min(2, "Escribe el folio del siniestro."),
  clientId: z.string().min(1, "Selecciona un cliente."),
  policyId: z.string().min(1, "Selecciona una poliza."),
  insurerId: z.string().min(1, "Selecciona una aseguradora."),
  claimType: z.string().trim().min(2, "Escribe el tipo de siniestro."),
  description: optionalText,
  status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_CLIENT", "WAITING_INSURER", "RESOLVED", "CANCELLED"]),
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
  policyType: z.enum([
    "AUTO",
    "GMM",
    "VIDA",
    "DANOS",
    "FIANZAS",
    "HOGAR",
    "RESPONSABILIDAD_CIVIL",
    "EMPRESARIAL",
    "ACCIDENTES",
    "OTRO",
  ]),
  status: z.enum(["REQUESTED", "IN_PROGRESS", "SENT", "ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"]),
  requestedDate: requiredDate,
  sentDate: optionalDate,
  validUntil: optionalDate,
  quotedAmount: z.coerce.number().optional(),
  notes: optionalText,
});

export type ClientFormValues = z.infer<typeof clientSchema>;
export type PolicyFormValues = z.infer<typeof policySchema>;
export type ReceiptFormValues = z.infer<typeof receiptSchema>;
export type WorkItemFormValues = z.infer<typeof workItemSchema>;
export type InsurerFormValues = z.infer<typeof insurerSchema>;
export type ClaimFormValues = z.infer<typeof claimSchema>;
export type QuoteFormValues = z.infer<typeof quoteSchema>;
