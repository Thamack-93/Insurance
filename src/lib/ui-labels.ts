export const ROLE_LABELS: Record<string, string> = {
  OWNER: "Propietario",
  ADMIN: "Administrador",
  AGENT: "Agente",
};

export function roleLabel(value: string | null | undefined) {
  return value ? ROLE_LABELS[value] ?? value : "Sin rol";
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
  return value ? SEARCH_ENTITY_LABELS[value] ?? value : "Registro";
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
  return value ? BACKUP_STATUS_LABELS[value] ?? value : "Sin estado";
}

export const BACKUP_CAPABILITY_LABELS: Record<string, string> = {
  COMPLETE: "Respaldo completo",
  DATABASE_ONLY: "Respaldo de datos sin archivos documentales",
};

export function backupCapabilityLabel(value: string | null | undefined) {
  return value ? BACKUP_CAPABILITY_LABELS[value] ?? value : "Capacidad no indicada";
}

export const BACKUP_STORAGE_LABELS: Record<string, string> = {
  original: "Original",
  rekeyed: "Con nueva clave",
};

export function backupStorageLabel(value: string | null | undefined) {
  return value ? BACKUP_STORAGE_LABELS[value] ?? value : "Almacenamiento no indicado";
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
  return value ? ASSISTANT_REPORT_STATUS_LABELS[value] ?? value : "Sin estado";
}

export function assistantReportKindLabel(value: string | null | undefined) {
  return value ? ASSISTANT_REPORT_KIND_LABELS[value] ?? value : "Tipo no indicado";
}

export function assistantAiStatusLabel(value: string | null | undefined) {
  return value ? ASSISTANT_AI_STATUS_LABELS[value] ?? value : "Sin estado";
}

export function assistantAiTierLabel(value: string | null | undefined) {
  return value ? ASSISTANT_AI_TIER_LABELS[value] ?? value : "Sin nivel";
}

export function assistantAiProfileLabel(value: string | null | undefined) {
  return value ? ASSISTANT_AI_PROFILE_LABELS[value] ?? value : "Sin perfil";
}

export function assistantAiTerminationLabel(value: string | null | undefined) {
  return value ? ASSISTANT_AI_TERMINATION_LABELS[value] ?? value : "Sin dato";
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
  return value ? DATA_QUALITY_STATUS_LABELS[value] ?? value : "Sin estado";
}
