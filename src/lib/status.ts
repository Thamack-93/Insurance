export type BadgeTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "critical";

/**
 * Single source of truth for status labels.
 *
 * `BASE_STATUS_LABELS` holds the canonical Spanish term for every status code
 * the domain knows about, written in the masculine/neutral form. Entities whose
 * noun is feminine (póliza, cotización, comisión, alerta) only declare the
 * gender agreement in `ENTITY_STATUS_LABELS`; they never introduce a different
 * word. That is what keeps `EXPIRED` from being "Expirado" on one screen and
 * "Vencida" on another: the term is always "Expirado/Expirada", while
 * "Vencido/Vencida" stays reserved for `OVERDUE`.
 */
export const BASE_STATUS_LABELS = {
  ACTIVE: "Activo",
  INACTIVE: "Inactivo",
  ARCHIVED: "Archivado",
  PENDING: "Pendiente",
  PAID: "Pagado",
  OVERDUE: "Vencido",
  CANCELLED: "Cancelado",
  RENEWED: "Renovado",
  EXPIRED: "Expirado",
  OPEN: "Abierto",
  IN_PROGRESS: "En proceso",
  WAITING_CLIENT: "Esperando cliente",
  WAITING_INSURER: "Esperando aseguradora",
  WAITING_DOCUMENT: "Esperando documento",
  REQUESTED: "Solicitado",
  SENT: "Enviado",
  ACCEPTED: "Aceptado",
  REJECTED: "Rechazado",
  DECLINED: "Rechazado",
  FAILED: "Fallido",
  SKIPPED: "Omitido",
  RESOLVED: "Resuelto",
  EXPECTED: "Esperado",
  POSTED: "Aplicado",
  REVERSED: "Revertido",
  DONE: "Hecho",
  DISMISSED: "Descartado",
} as const satisfies Record<string, string>;

/** Entities whose status labels need their own gender agreement. */
export type StatusEntity =
  | "client"
  | "insurer"
  | "policy"
  | "endorsement"
  | "receipt"
  | "payment"
  | "commission"
  | "claim"
  | "quote"
  | "workItem"
  | "alert";

const ENTITY_STATUS_LABELS: Partial<Record<StatusEntity, Record<string, string>>> = {
  // póliza (femenino)
  policy: {
    ACTIVE: "Activa",
    PENDING: "Pendiente",
    RENEWED: "Renovada",
    EXPIRED: "Expirada",
    CANCELLED: "Cancelada",
  },
  // cotización (femenino)
  quote: {
    REQUESTED: "Solicitada",
    IN_PROGRESS: "En proceso",
    SENT: "Enviada",
    ACCEPTED: "Aceptada",
    REJECTED: "Rechazada",
    EXPIRED: "Expirada",
    CANCELLED: "Cancelada",
  },
  // comisión (femenino)
  commission: {
    EXPECTED: "Esperada",
    PENDING: "Pendiente",
    PAID: "Pagada",
    OVERDUE: "Vencida",
    CANCELLED: "Cancelada",
  },
  // alerta (femenino)
  alert: {
    OPEN: "Abierta",
    DISMISSED: "Descartada",
    RESOLVED: "Resuelta",
  },
};

/**
 * Spanish label for a status code. Pass the entity when the surrounding copy
 * refers to a specific record so the gender agrees; omit it for generic lists
 * that mix entities.
 */
export function statusLabel(status: string | null | undefined, entity?: StatusEntity): string {
  if (!status) return "Sin estado";
  const overrides = entity ? ENTITY_STATUS_LABELS[entity] : undefined;
  return (
    overrides?.[status] ??
    (BASE_STATUS_LABELS as Record<string, string>)[status] ??
    "Estado no reconocido"
  );
}

/**
 * Etapas del tablero de renovaciones. Es un vocabulario propio y no una
 * variante de los estatus del dominio: "Por vencer" describe dónde va la
 * gestión, mientras que la póliza sigue estando "Activa". Vive aquí para que
 * ninguna pantalla vuelva a inventar su propia traducción.
 */
export const renewalStageLabels: Record<string, string> = {
  PENDING: "Por vencer",
  CONTACTED: "Contactado",
  QUOTED: "Cotizado",
  WON: "Renovado",
  LOST: "Perdido",
};

export function renewalStageLabel(stage: string | null | undefined): string {
  if (!stage) return "Sin etapa";
  return renewalStageLabels[stage] ?? "Etapa no reconocida";
}

export function getRenewalStageTone(stage: string): BadgeTone {
  if (stage === "WON") return "success";
  if (stage === "LOST") return "danger";
  if (stage === "QUOTED") return "info";
  if (stage === "CONTACTED") return "warning";
  return "neutral";
}

export const priorityLabels: Record<string, string> = {
  LOW: "Baja",
  MEDIUM: "Media",
  HIGH: "Alta",
  URGENT: "Urgente",
};

export function priorityLabel(priority: string | null | undefined) {
  if (!priority) return "Sin prioridad";
  return priorityLabels[priority] ?? "Prioridad no reconocida";
}

export function getStatusTone(status: string): BadgeTone {
  if (["ACTIVE", "PAID", "RENEWED", "RESOLVED", "DONE", "ACCEPTED", "POSTED"].includes(status)) {
    return "success";
  }
  if (["OVERDUE", "EXPIRED", "CRITICAL"].includes(status)) return "critical";
  if (["FAILED", "CANCELLED", "ARCHIVED", "REJECTED", "DECLINED", "REVERSED"].includes(status)) {
    return "danger";
  }
  if (["WAITING_CLIENT", "WAITING_INSURER", "WAITING_DOCUMENT", "HIGH"].includes(status)) {
    return "warning";
  }
  if (["IN_PROGRESS", "SENT", "EXPECTED", "REQUESTED"].includes(status)) return "info";
  return "neutral";
}

export function getPriorityTone(priority: string): BadgeTone {
  if (priority === "URGENT") return "critical";
  if (priority === "HIGH") return "warning";
  if (priority === "MEDIUM") return "info";
  return "neutral";
}

export function policyTypeLabel(value: string) {
  const labels: Record<string, string> = {
    AUTO: "Auto",
    GMM: "GMM",
    VIDA: "Vida",
    DANOS: "Daños",
    FIANZAS: "Fianzas",
    HOGAR: "Hogar",
    RESPONSABILIDAD_CIVIL: "Responsabilidad Civil",
    EMPRESARIAL: "Empresarial",
    ACCIDENTES: "Accidentes",
    OTRO: "Otro",
  };

  return labels[value] ?? "Tipo no reconocido";
}
