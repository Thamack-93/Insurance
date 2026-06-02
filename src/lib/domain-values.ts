export const CLIENT_TYPES = ["PERSON", "COMPANY"] as const;
export type ClientType = (typeof CLIENT_TYPES)[number];

export const ENTITY_STATUSES = ["ACTIVE", "INACTIVE", "ARCHIVED"] as const;
export type EntityStatus = (typeof ENTITY_STATUSES)[number];

export const POLICY_TYPES = [
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
] as const;
export type PolicyType = (typeof POLICY_TYPES)[number];

export const POLICY_STATUSES = ["ACTIVE", "EXPIRED", "CANCELLED", "RENEWED", "PENDING"] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

export const PAYMENT_FREQUENCIES = [
  "MONTHLY",
  "QUARTERLY",
  "SEMIANNUAL",
  "ANNUAL",
  "SINGLE",
  "OTHER",
] as const;
export type PaymentFrequency = (typeof PAYMENT_FREQUENCIES)[number];

export const RECEIPT_STATUSES = ["PENDING", "PAID", "OVERDUE", "CANCELLED"] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export const COMMISSION_STATUSES = ["EXPECTED", "PENDING", "PAID", "OVERDUE", "CANCELLED"] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];

export const TASK_TYPES = ["GENERAL", "CLAIM", "QUOTE", "RENEWAL", "PAYMENT", "DOCUMENT", "COMMISSION", "OTHER"] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_CLIENT",
  "WAITING_INSURER",
  "WAITING_DOCUMENT",
  "SENT",
  "RESOLVED",
  "CANCELLED",
  "ARCHIVED",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const CLAIM_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_CLIENT", "WAITING_INSURER", "RESOLVED", "CANCELLED"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const QUOTE_STATUSES = ["REQUESTED", "IN_PROGRESS", "SENT", "ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const DOCUMENT_TYPES = [
  "POLICY",
  "RECEIPT",
  "ENDORSEMENT",
  "RENEWAL",
  "ID",
  "PAYMENT_PROOF",
  "QUOTE",
  "CLAIM",
  "LETTER",
  "OTHER",
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const ALERT_SEVERITIES = ["INFO", "WARNING", "CRITICAL"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_STATUSES = ["OPEN", "DISMISSED", "RESOLVED"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export const WORK_ITEM_TYPES = ["TASK", "NOTIFICATION"] as const;
export type WorkItemType = (typeof WORK_ITEM_TYPES)[number];

export const WORK_ITEM_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_CLIENT",
  "WAITING_INSURER",
  "WAITING_DOCUMENT",
  "SENT",
  "RESOLVED",
  "CANCELLED",
  "ARCHIVED",
  "DISMISSED",
] as const;
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

export const NOTIFICATION_CHANNEL_TYPES = ["TELEGRAM", "WEB", "EMAIL"] as const;
export type NotificationChannelType = (typeof NOTIFICATION_CHANNEL_TYPES)[number];

export const NOTIFICATION_EVENT_STATUSES = ["PENDING", "SENT", "FAILED", "SKIPPED"] as const;
export type NotificationEventStatus = (typeof NOTIFICATION_EVENT_STATUSES)[number];

export const USER_ROLES = ["ADMIN", "AGENT"] as const;
export type UserRole = (typeof USER_ROLES)[number];
