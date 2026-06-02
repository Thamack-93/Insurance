/**
 * Pure helpers safe to import from client components.
 * Keep this module free of server-only imports (prisma, fs, etc.).
 */

export type NotificationSeverityLabel = "INFO" | "WARNING" | "CRITICAL";

/**
 * Build an in-app link for a notification based on its entity type. Mirrors
 * the routing used in /risks so notifications navigate to the right place.
 */
export function notificationLink(entityType: string, entityId: string): string {
  switch (entityType) {
    case "Client":
      return `/clients/${entityId}`;
    case "Policy":
      return `/policies/${entityId}`;
    case "Receipt":
      return `/receipts/${entityId}`;
    case "Task":
    case "WorkItem":
      return `/tasks/${entityId}`;
    case "Claim":
      return `/claims/${entityId}`;
    case "Quote":
      return `/quotes/${entityId}`;
    case "Document":
      return `/documents`;
    case "Commission":
      return `/commissions`;
    case "Insurer":
      return `/insurers/${entityId}`;
    default:
      return "/notifications";
  }
}
