import {
  CLAIM_STATUSES,
  COMMISSION_STATUSES,
  ENDORSEMENT_STATUSES,
  ENTITY_STATUSES,
  POLICY_STATUSES,
  QUOTE_STATUSES,
  RECEIPT_STATUSES,
  TASK_STATUSES,
} from "@/lib/domain-values";
import { statusLabel, type StatusEntity } from "@/lib/status";

export type SelectOption = {
  value: string;
  label: string;
};

/**
 * Status dropdowns are derived from the same label source the badges use, so a
 * status can never read one way in a filter and another way in a table.
 */
function statusOptions(values: readonly string[], entity: StatusEntity): SelectOption[] {
  return values.map((value) => ({ value, label: statusLabel(value, entity) }));
}

export const digestHourOptions: SelectOption[] = Array.from({ length: 24 }, (_, hour) => {
  const value = String(hour);
  const label = `${String(hour).padStart(2, "0")}:00`;
  return { value, label };
});

export const clientTypeOptions: SelectOption[] = [
  { value: "PERSON", label: "Persona" },
  { value: "COMPANY", label: "Empresa" },
];

export const entityStatusOptions: SelectOption[] = statusOptions(ENTITY_STATUSES, "client");

export const policyTypeOptions: SelectOption[] = [
  { value: "AUTO", label: "Auto" },
  { value: "GMM", label: "GMM" },
  { value: "VIDA", label: "Vida" },
  { value: "DANOS", label: "Daños" },
  { value: "FIANZAS", label: "Fianzas" },
  { value: "HOGAR", label: "Hogar" },
  { value: "RESPONSABILIDAD_CIVIL", label: "Responsabilidad Civil" },
  { value: "EMPRESARIAL", label: "Empresarial" },
  { value: "ACCIDENTES", label: "Accidentes" },
  { value: "OTRO", label: "Otro" },
];

export const policyStatusOptions: SelectOption[] = statusOptions(POLICY_STATUSES, "policy");

export const endorsementStatusOptions: SelectOption[] = statusOptions(
  ENDORSEMENT_STATUSES,
  "endorsement",
);

export const paymentFrequencyOptions: SelectOption[] = [
  { value: "MONTHLY", label: "Mensual" },
  { value: "QUARTERLY", label: "Trimestral" },
  { value: "SEMIANNUAL", label: "Semestral" },
  { value: "ANNUAL", label: "Anual" },
  { value: "SINGLE", label: "Unica" },
  { value: "OTHER", label: "Otra" },
];

export const receiptStatusOptions: SelectOption[] = statusOptions(RECEIPT_STATUSES, "receipt");

export const commissionStatusOptions: SelectOption[] = statusOptions(
  COMMISSION_STATUSES,
  "commission",
);

export const workItemTypeOptions: SelectOption[] = [
  { value: "GENERAL", label: "General" },
  { value: "CLAIM", label: "Siniestro" },
  { value: "QUOTE", label: "Cotizacion" },
  { value: "RENEWAL", label: "Renovacion" },
  { value: "PAYMENT", label: "Cobranza" },
  { value: "DOCUMENT", label: "Documento" },
  { value: "COMMISSION", label: "Comision" },
  { value: "OTHER", label: "Otro" },
];

// DISMISSED is reachable only from the notification flow, never from the form.
export const workItemStatusOptions: SelectOption[] = statusOptions(TASK_STATUSES, "workItem");

export const priorityOptions: SelectOption[] = [
  { value: "LOW", label: "Baja" },
  { value: "MEDIUM", label: "Media" },
  { value: "HIGH", label: "Alta" },
  { value: "URGENT", label: "Urgente" },
];

export const claimStatusOptions: SelectOption[] = statusOptions(CLAIM_STATUSES, "claim");

export const quoteStatusOptions: SelectOption[] = statusOptions(QUOTE_STATUSES, "quote");

export const documentTypeOptions: SelectOption[] = [
  { value: "POLICY", label: "Póliza" },
  { value: "RECEIPT", label: "Recibo" },
  { value: "ENDORSEMENT", label: "Endoso" },
  { value: "RENEWAL", label: "Renovación" },
  { value: "ID", label: "Identificación" },
  { value: "PAYMENT_PROOF", label: "Comprobante de Pago" },
  { value: "QUOTE", label: "Cotización" },
  { value: "CLAIM", label: "Siniestro" },
  { value: "LETTER", label: "Carta" },
  { value: "OTHER", label: "Otro" },
];

export const currencyOptions: SelectOption[] = [
  { value: "MXN", label: "MXN" },
  { value: "USD", label: "USD" },
];

export const paymentMethodOptions: SelectOption[] = [
  { value: "TRANSFER", label: "Transferencia bancaria" },
  { value: "CASH", label: "Efectivo" },
  { value: "CHECK", label: "Cheque" },
  { value: "CARD", label: "Tarjeta de crédito/débito" },
  { value: "OTHER", label: "Otro" },
];
