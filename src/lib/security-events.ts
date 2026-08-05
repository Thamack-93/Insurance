import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { SYSTEM_USER_ID } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { logError } from "@/lib/logger";
import { writeActivityLog } from "@/lib/activity-log";
import { securityFingerprint } from "@/lib/request-guards";

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
  fingerprint?: string;
  organizationId?: string | null;
};

export async function recordSecurityEvent(input: SecurityEventInput) {
  const db = input.db ?? getDb();
  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const fingerprint = input.fingerprint ?? securityFingerprint(input.entityId ?? input.alertType);
  const alertData = {
    alertType: input.alertType,
    severity: input.severity ?? "WARNING",
    title: input.title,
    description: input.description,
    entityType: input.entityType ?? "SecurityEvent",
    entityId: fingerprint,
    ...(input.organizationId !== undefined ? { organizationId: input.organizationId } : {}),
  };

  try {
    const aggregate = await db.securityEventAggregate.upsert({
      where: {
        alertType_fingerprint_windowStart: {
          alertType: alertData.alertType,
          fingerprint,
          windowStart,
        },
      },
      create: {
        alertType: alertData.alertType,
        fingerprint,
        windowStart,
        firstSeenAt: now,
        lastSeenAt: now,
        occurrenceCount: 1,
        title: alertData.title,
        description: alertData.description,
        severity: alertData.severity,
        ...(input.organizationId !== undefined ? { organizationId: input.organizationId } : {}),
      },
      update: {
        lastSeenAt: now,
        occurrenceCount: { increment: 1 },
      },
    });

    if (aggregate.occurrenceCount > 1) return null;

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
      organizationId: input.organizationId,
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
