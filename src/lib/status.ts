export type BadgeTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger"
  | "critical";

export const statusLabels: Record<string, string> = {
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
  SENT: "Enviado",
  RESOLVED: "Resuelto",
  EXPECTED: "Esperada",
  DONE: "Hecho",
  DISMISSED: "Descartada",
};

export const priorityLabels: Record<string, string> = {
  LOW: "Baja",
  MEDIUM: "Media",
  HIGH: "Alta",
  URGENT: "Urgente",
};

export function getStatusTone(status: string): BadgeTone {
  if (["ACTIVE", "PAID", "RENEWED", "RESOLVED", "DONE"].includes(status)) {
    return "success";
  }
  if (["OVERDUE", "EXPIRED", "CRITICAL"].includes(status)) return "critical";
  if (["CANCELLED", "ARCHIVED"].includes(status)) return "danger";
  if (["WAITING_CLIENT", "WAITING_INSURER", "WAITING_DOCUMENT", "HIGH"].includes(status)) {
    return "warning";
  }
  if (["IN_PROGRESS", "SENT", "EXPECTED"].includes(status)) return "info";
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

  return labels[value] ?? value;
}

