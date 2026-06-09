export type SelectOption = {
  value: string;
  label: string;
};

export const digestHourOptions: SelectOption[] = Array.from({ length: 24 }, (_, hour) => {
  const value = String(hour);
  const label = `${String(hour).padStart(2, "0")}:00`;
  return { value, label };
});

export const clientTypeOptions: SelectOption[] = [
  { value: "PERSON", label: "Persona" },
  { value: "COMPANY", label: "Empresa" },
];

export const entityStatusOptions: SelectOption[] = [
  { value: "ACTIVE", label: "Activo" },
  { value: "INACTIVE", label: "Inactivo" },
  { value: "ARCHIVED", label: "Archivado" },
];

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

export const policyStatusOptions: SelectOption[] = [
  { value: "ACTIVE", label: "Activa" },
  { value: "PENDING", label: "Pendiente" },
  { value: "RENEWED", label: "Renovada" },
  { value: "EXPIRED", label: "Vencida" },
  { value: "CANCELLED", label: "Cancelada" },
];

export const paymentFrequencyOptions: SelectOption[] = [
  { value: "MONTHLY", label: "Mensual" },
  { value: "QUARTERLY", label: "Trimestral" },
  { value: "SEMIANNUAL", label: "Semestral" },
  { value: "ANNUAL", label: "Anual" },
  { value: "SINGLE", label: "Unica" },
  { value: "OTHER", label: "Otra" },
];

export const receiptStatusOptions: SelectOption[] = [
  { value: "PENDING", label: "Pendiente" },
  { value: "PAID", label: "Pagado" },
  { value: "OVERDUE", label: "Vencido" },
  { value: "CANCELLED", label: "Cancelado" },
];

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

export const workItemStatusOptions: SelectOption[] = [
  { value: "OPEN", label: "Abierto" },
  { value: "IN_PROGRESS", label: "En proceso" },
  { value: "WAITING_CLIENT", label: "Esperando cliente" },
  { value: "WAITING_INSURER", label: "Esperando aseguradora" },
  { value: "WAITING_DOCUMENT", label: "Esperando documento" },
  { value: "SENT", label: "Enviado" },
  { value: "RESOLVED", label: "Resuelto" },
  { value: "CANCELLED", label: "Cancelado" },
  { value: "ARCHIVED", label: "Archivado" },
];

export const priorityOptions: SelectOption[] = [
  { value: "LOW", label: "Baja" },
  { value: "MEDIUM", label: "Media" },
  { value: "HIGH", label: "Alta" },
  { value: "URGENT", label: "Urgente" },
];

export const claimStatusOptions: SelectOption[] = [
  { value: "OPEN", label: "Abierto" },
  { value: "IN_PROGRESS", label: "En proceso" },
  { value: "WAITING_CLIENT", label: "Esperando cliente" },
  { value: "WAITING_INSURER", label: "Esperando aseguradora" },
  { value: "RESOLVED", label: "Resuelto" },
  { value: "CANCELLED", label: "Cancelado" },
];

export const quoteStatusOptions: SelectOption[] = [
  { value: "REQUESTED", label: "Solicitada" },
  { value: "IN_PROGRESS", label: "En proceso" },
  { value: "SENT", label: "Enviada" },
  { value: "ACCEPTED", label: "Aceptada" },
  { value: "REJECTED", label: "Rechazada" },
  { value: "EXPIRED", label: "Expirada" },
  { value: "CANCELLED", label: "Cancelada" },
];

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
