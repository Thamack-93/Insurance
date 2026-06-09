import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { SYSTEM_USER_ID } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/logger";
import { writeActivityLog } from "@/lib/activity-log";

export type SecurityEventSeverity = "INFO" | "WARNING" | "CRITICAL";

export const SECURITY_EVENT_TYPES = {
  loginFailed: "SECURITY_LOGIN_FAILED",
  loginDisabled: "SECURITY_LOGIN_DISABLED",
  rateLimitedLogin: "SECURITY_RATE_LIMITED_LOGIN",
  rateLimitedRequest: "SECURITY_RATE_LIMITED_REQUEST",
  invalidSecretTelegram: "SECURITY_INVALID_SECRET_TELEGRAM",
  invalidPayload: "SECURITY_INVALID_PAYLOAD",
  sameOriginBlocked: "SECURITY_SAME_ORIGIN_BLOCKED",
  accessDenied: "SECURITY_ACCESS_DENIED",
  documentAccessDenied: "SECURITY_ACCESS_DENIED_DOCUMENT",
  documentPathInvalid: "SECURITY_ACCESS_DENIED_FILE_PATH",
  pdfParseFailed: "SECURITY_PDF_PARSE_FAILED",
  pdfParseNoText: "SECURITY_PDF_NO_TEXT",
} as const;

export type SecurityEventInput = {
  alertType: string;
  title: string;
  description: string;
  severity?: SecurityEventSeverity;
  entityType?: string;
  entityId?: string;
  userId?: string;
  db?: PrismaClient | Prisma.TransactionClient;
};

export async function recordSecurityEvent(input: SecurityEventInput) {
  const db = input.db ?? getDb();
  const alertData = {
    alertType: input.alertType,
    severity: input.severity ?? "WARNING",
    title: input.title,
    description: input.description,
    entityType: input.entityType ?? "SecurityEvent",
    entityId: input.entityId ?? input.alertType,
  };

  try {
    const alert = await db.alert.create({ data: alertData });
    await writeActivityLog({
      entityType: alertData.entityType,
      entityId: alertData.entityId,
      action: input.alertType,
      oldValue: null,
      newValue: {
        title: alertData.title,
        description: alertData.description,
        severity: alertData.severity,
        entityType: alertData.entityType,
        entityId: alertData.entityId,
      },
      userId: input.userId ?? SYSTEM_USER_ID,
      db,
    });
    return alert;
  } catch (error) {
    logError("security-events.record", error, { alertType: input.alertType });
    return null;
  }
}

export async function recordSecurityAccessDenied(input: Omit<SecurityEventInput, "alertType" | "severity"> & {
  alertType?: string;
  severity?: SecurityEventSeverity;
}) {
  return recordSecurityEvent({
    ...input,
    alertType: input.alertType ?? SECURITY_EVENT_TYPES.accessDenied,
    severity: input.severity ?? "WARNING",
  });
}

export async function recordSecurityRateLimit(input: Omit<SecurityEventInput, "severity"> & {
  alertType?: string;
  severity?: SecurityEventSeverity;
}) {
  return recordSecurityEvent({
    ...input,
    alertType: input.alertType ?? SECURITY_EVENT_TYPES.rateLimitedRequest,
    severity: input.severity ?? "WARNING",
  });
}
