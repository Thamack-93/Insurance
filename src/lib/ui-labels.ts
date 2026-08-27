export const ROLE_LABELS: Record<string, string> = {
  OWNER: "Propietario",
  ADMIN: "Administrador",
  AGENT: "Agente",
};

export function roleLabel(value: string | null | undefined) {
  return value ? ROLE_LABELS[value] ?? "Rol no reconocido" : "Sin rol";
}

export const SEARCH_ENTITY_LABELS: Record<string, string> = {
  client: "Cliente",
  policy: "Póliza",
  receipt: "Recibo",
  workItem: "Pendiente",
  claim: "Siniestro",
  quote: "Cotización",
  insurer: "Aseguradora",
  document: "Documento",
};

export function searchEntityLabel(value: string | null | undefined) {
  return value ? SEARCH_ENTITY_LABELS[value] ?? "Registro" : "Registro";
}

export const BACKUP_STATUS_LABELS: Record<string, string> = {
  MISSING: "Sin respaldo",
  DUE: "Pendiente",
  HEALTHY: "Al día",
  OVERDUE: "Vencido",
  NOT_CONFIGURED: "No configurado",
  CREATING: "En creación",
  DISCOVERED: "Detectado",
  VERIFIED: "Verificado",
  INVALID: "Inválido",
  BLOCKED: "Bloqueado",
  PRUNED: "Retirado",
};

export function backupStatusLabel(value: string | null | undefined) {
  return value ? BACKUP_STATUS_LABELS[value] ?? "Estado no reconocido" : "Sin estado";
}

export const BACKUP_CAPABILITY_LABELS: Record<string, string> = {
  COMPLETE: "Respaldo completo",
  DATABASE_ONLY: "Respaldo de datos sin archivos documentales",
};

export function backupCapabilityLabel(value: string | null | undefined) {
  return value ? BACKUP_CAPABILITY_LABELS[value] ?? "Capacidad no reconocida" : "Capacidad no indicada";
}

export const BACKUP_STORAGE_LABELS: Record<string, string> = {
  original: "Original",
  rekeyed: "Con nueva clave",
};

export function backupStorageLabel(value: string | null | undefined) {
  return value ? BACKUP_STORAGE_LABELS[value] ?? "Almacenamiento no reconocido" : "Almacenamiento no indicado";
}

export const ASSISTANT_REPORT_STATUS_LABELS: Record<string, string> = {
  OPEN: "Abierto",
  COLLECTING: "Recopilando",
  RESOLVED: "Resuelto",
  ARCHIVED: "Archivado",
  DELETED: "Eliminado",
};

export const ASSISTANT_REPORT_KIND_LABELS: Record<string, string> = {
  INCIDENT: "Incidente",
  SUGGESTION: "Sugerencia",
};

export const ASSISTANT_AI_STATUS_LABELS: Record<string, string> = {
  RUNNING: "En ejecución",
  SUCCEEDED: "Exitoso",
  FAILED: "Fallido",
  ABORTED: "Abortado",
  STARTED: "Iniciado",
  SKIPPED: "Omitido",
};

export const ASSISTANT_AI_TIER_LABELS: Record<string, string> = {
  deterministic: "Determinista",
  minimax: "Minimax",
  critical: "Crítico",
};

export const ASSISTANT_AI_PROFILE_LABELS: Record<string, string> = {
  "simple-read": "Lectura simple",
  "complex-read": "Lectura compleja",
  draft: "Borrador",
};

export const ASSISTANT_AI_TERMINATION_LABELS: Record<string, string> = {
  complete: "Completado",
  "step-limit": "Límite de pasos",
  "output-budget": "Límite de salida",
  timeout: "Tiempo agotado",
  length: "Longitud máxima",
  error: "Error",
};

export function assistantReportStatusLabel(value: string | null | undefined) {
  return value ? ASSISTANT_REPORT_STATUS_LABELS[value] ?? "Estado no reconocido" : "Sin estado";
}

export function assistantReportKindLabel(value: string | null | undefined) {
  return value ? ASSISTANT_REPORT_KIND_LABELS[value] ?? "Tipo no reconocido" : "Tipo no indicado";
}

export function assistantAiStatusLabel(value: string | null | undefined) {
  return value ? ASSISTANT_AI_STATUS_LABELS[value] ?? "Estado no reconocido" : "Sin estado";
}

export function assistantAiTierLabel(value: string | null | undefined) {
  return value ? ASSISTANT_AI_TIER_LABELS[value] ?? "Nivel no reconocido" : "Sin nivel";
}

export function assistantAiProfileLabel(value: string | null | undefined) {
  return value ? ASSISTANT_AI_PROFILE_LABELS[value] ?? "Perfil no reconocido" : "Sin perfil";
}

export function assistantAiTerminationLabel(value: string | null | undefined) {
  return value ? ASSISTANT_AI_TERMINATION_LABELS[value] ?? "Dato no reconocido" : "Sin dato";
}

export const DATA_QUALITY_STATUS_LABELS: Record<string, string> = {
  READY: "Listo",
  REVIEW: "En revisión",
  PREVIEW_READY: "Vista previa lista",
  APPROVED: "Aprobado",
  PARTIAL_APPLIED: "Aplicado parcialmente",
  APPLIED: "Aplicado",
  COMPLETED: "Completado",
  RUNNING: "En ejecución",
  FAILED: "Fallido",
};

export function dataQualityStatusLabel(value: string | null | undefined) {
  return value ? DATA_QUALITY_STATUS_LABELS[value] ?? "Estado no reconocido" : "Sin estado";
}

export const WORK_ITEM_TYPE_LABELS: Record<string, string> = {
  TASK: "Pendiente",
  NOTIFICATION: "Notificación",
  GENERAL: "General",
  CLAIM: "Siniestro",
  QUOTE: "Cotización",
  RENEWAL: "Renovación",
  PAYMENT: "Cobranza",
  DOCUMENT: "Documento",
  COMMISSION: "Comisión",
  OTHER: "Otro",
};

export function workItemTypeLabel(value: string | null | undefined) {
  return value ? WORK_ITEM_TYPE_LABELS[value] ?? "Tipo no reconocido" : "Sin tipo";
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  TRANSFER: "Transferencia bancaria",
  CASH: "Efectivo",
  CHECK: "Cheque",
  CARD: "Tarjeta de crédito/débito",
  OTHER: "Otro",
};

export function paymentMethodLabel(value: string | null | undefined) {
  return value ? PAYMENT_METHOD_LABELS[value] ?? "Método no reconocido" : "Sin método";
}

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  POLICY: "Póliza",
  RECEIPT: "Recibo",
  ENDORSEMENT: "Endoso",
  RENEWAL: "Renovación",
  ID: "Identificación",
  PAYMENT_PROOF: "Comprobante de pago",
  QUOTE: "Cotización",
  CLAIM: "Siniestro",
  LETTER: "Carta",
  OTHER: "Otro",
};

export function documentTypeLabel(value: string | null | undefined) {
  return value ? DOCUMENT_TYPE_LABELS[value] ?? "Tipo no reconocido" : "Tipo no indicado";
}

export const DATA_QUALITY_REASON_LABELS: Record<string, string> = {
  payment_after_due_date: "Pago después del vencimiento",
  POLICY_OBJECT_MISSING: "Objeto asegurado faltante",
  POLICY_PREMIUM_MISSING: "Prima faltante",
  POLICY_PENDING: "Póliza pendiente",
  POLICY_PAYMENT_FREQUENCY_REVIEW: "Frecuencia de pago para revisar",
  EMAIL_MISSING: "Correo faltante",
  PHONE_MISSING: "Teléfono faltante",
  ADDRESS_MISSING: "Dirección faltante",
  RFC_MISSING: "RFC faltante",
  CONTACT_METHOD_MISSING: "Método de contacto faltante",
  POLICY_WITHOUT_RECEIPTS: "Póliza sin recibos",
  RENEWAL_SUGGESTION: "Sugerencia de renovación",
};

export function dataQualityReasonLabel(value: string | null | undefined) {
  return value ? DATA_QUALITY_REASON_LABELS[value] ?? "Revisión requerida" : "Sin motivo";
}
