import "server-only";

import { getDb } from "@/lib/db";
import { logError } from "@/lib/logger";
import { safeJson, writeActivityLog } from "@/lib/activity-log";
import type {
  AssistantAiDiagnostic,
  AssistantReportKind,
  AssistantReportSeverity,
  AssistantReportSnapshot,
  AssistantReportStatus,
} from "@/lib/assistant-types";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

const ACTIVE_REPORT_STATUSES = new Set<AssistantReportStatus>(["COLLECTING", "OPEN"]);
const CLOSED_REPORT_STATUSES = new Set<AssistantReportStatus>(["RESOLVED", "ARCHIVED", "DELETED"]);
const DEFAULT_SUGGESTION_THRESHOLD = 5;
const MAX_EVIDENCE_JSON_LENGTH = 5_000;

export type AssistantReportSignalInput = {
  organizationId: string;
  kind: AssistantReportKind;
  themeKey: string;
  themeLabel: string;
  signalKind: string;
  source: string;
  title: string;
  summary: string;
  recommendation: string;
  plan: string;
  severity?: AssistantReportSeverity;
  evidence?: unknown;
  details?: unknown;
  input?: unknown;
  output?: unknown;
  diagnostic?: AssistantAiDiagnostic | null;
  threshold?: number;
  client?: DbClient;
  actorId?: string | null;
  forceOpen?: boolean;
};

export type AssistantReportListFilter = {
  organizationId: string;
  kind?: AssistantReportKind;
  status?: AssistantReportStatus;
  limit?: number;
};

function normalizeThemeKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 96);
}

function toThemeLabel(value: string) {
  const compact = value.trim().replace(/\s+/g, " ");
  if (!compact) return "Sin tema";
  return compact.charAt(0).toUpperCase() + compact.slice(1);
}

function parseEvidenceJson(value: string | null | undefined) {
  if (!value) return [] as Array<Record<string, unknown>>;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
  } catch {
    return [];
  }
}

function parseJsonValue(value: string | null | undefined) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return { raw: value };
  }
}

function summarizeDiagnostic(diagnostic: AssistantAiDiagnostic) {
  return {
    diagnosticId: diagnostic.diagnosticId,
    operation: diagnostic.operation,
    code: diagnostic.code,
    model: diagnostic.model,
    fallbackModels: diagnostic.fallbackModels.slice(0, 5),
    attempts: diagnostic.attempts?.slice(0, 5),
    durationMs: diagnostic.durationMs,
    summary: redactAssistantReportText(diagnostic.summary, 500),
    details: redactAssistantReportText(diagnostic.details, 1_200),
    createdAt: diagnostic.createdAt,
    statusCode: diagnostic.statusCode ?? null,
    finishReason: diagnostic.finishReason ?? null,
    responsePreview: diagnostic.responsePreview ? redactAssistantReportText(diagnostic.responsePreview, 600) : null,
    reportId: diagnostic.reportId ?? null,
  };
}

function buildSnapshot(report: {
  id: string;
  kind: string;
  themeKey: string;
  themeLabel: string;
  status: string;
  version: number;
  parentReportId: string | null;
  title: string;
  summary: string;
  recommendation: string;
  plan: string;
  signalCount: number;
  severity: string;
  firstSignalAt: Date;
  lastSignalAt: Date;
  openedAt: Date | null;
  resolvedAt: Date | null;
  archivedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  evidenceJson: string;
  detailsJson: string;
  signals?: Array<{
    id: string;
    signalKind: string;
    source: string;
    title: string;
    createdAt: Date;
  }>;
}): AssistantReportSnapshot {
  return {
    id: report.id,
    kind: report.kind as AssistantReportKind,
    themeKey: report.themeKey,
    themeLabel: report.themeLabel,
    status: report.status as AssistantReportStatus,
    version: report.version,
    parentReportId: report.parentReportId,
    title: report.title,
    summary: report.summary,
    recommendation: report.recommendation,
    plan: report.plan,
    signalCount: report.signalCount,
    severity: report.severity as AssistantReportSeverity,
    firstSignalAt: report.firstSignalAt.toISOString(),
    lastSignalAt: report.lastSignalAt.toISOString(),
    openedAt: report.openedAt?.toISOString() ?? null,
    resolvedAt: report.resolvedAt?.toISOString() ?? null,
    archivedAt: report.archivedAt?.toISOString() ?? null,
    deletedAt: report.deletedAt?.toISOString() ?? null,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
    details: parseJsonValue(report.detailsJson),
    evidence: parseEvidenceJson(report.evidenceJson),
    signals: (report.signals ?? []).map((signal) => ({
      ...signal,
      createdAt: signal.createdAt.toISOString(),
    })),
  };
}

export function normalizeAssistantThemeKey(value: string) {
  return normalizeThemeKey(value);
}

export function createAssistantThemeKey(parts: Array<string | null | undefined>) {
  const key = parts.filter(Boolean).join(" ");
  return normalizeThemeKey(key);
}

export async function listAssistantReports(
  filter: AssistantReportListFilter,
  client: DbClient = getDb(),
): Promise<AssistantReportSnapshot[]> {
  const where: Prisma.AssistantReportWhereInput = { organizationId: filter.organizationId };
  if (filter.kind) where.kind = filter.kind;
  if (filter.status) where.status = filter.status;

  const reports = await client.assistantReport.findMany({
    where,
    include: {
      signals: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
    orderBy: [{ lastSignalAt: "desc" }, { createdAt: "desc" }],
    take: filter.limit ?? 100,
  });

  return reports.map(buildSnapshot);
}

export async function getAssistantReport(reportId: string, organizationId: string, client: DbClient = getDb()) {
  const report = await client.assistantReport.findFirst({
    where: { id: reportId, organizationId },
    include: {
      signals: { orderBy: { createdAt: "desc" }, take: 25 },
    },
  });

  return report ? buildSnapshot(report) : null;
}

function isActiveReport(status: string) {
  return ACTIVE_REPORT_STATUSES.has(status as AssistantReportStatus);
}

export function redactAssistantReportText(value: string, maxLength = 3_000) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b[A-Z&Ñ]{3,4}\d{6}[A-Z0-9]{3}\b/gi, "[rfc]")
    .replace(/(?:\+?\d[\s().-]?){10,15}/g, "[telefono]")
    .replace(/\b\d{6,}\b/g, "[identificador]")
    .slice(0, maxLength);
}

export function serializeAssistantEvidence(
  entries: Array<Record<string, unknown>>,
  maxLength = MAX_EVIDENCE_JSON_LENGTH,
) {
  const retained: Array<Record<string, unknown>> = [];
  for (const entry of entries.slice().reverse()) {
    const candidate = [entry, ...retained];
    const serialized = JSON.stringify(candidate);
    if (serialized.length > maxLength) break;
    retained.unshift(entry);
  }
  return JSON.stringify(retained);
}

export function getNewAssistantReportStatus(input: {
  kind: AssistantReportKind;
  forceOpen?: boolean;
  threshold: number;
}): AssistantReportStatus {
  if (input.kind === "INCIDENT" || input.forceOpen) return "OPEN";
  return input.threshold <= 1 ? "OPEN" : "COLLECTING";
}

function buildEvidenceEntry(input: AssistantReportSignalInput) {
  const diagnostic = input.diagnostic ? summarizeDiagnostic(input.diagnostic) : null;
  return {
    signalKind: input.signalKind,
    source: input.source,
    title: redactAssistantReportText(input.title, 200),
    summary: redactAssistantReportText(input.summary, 1_500),
    recommendation: redactAssistantReportText(input.recommendation, 1_500),
    plan: redactAssistantReportText(input.plan, 3_000),
    severity: input.severity ?? "MEDIUM",
    diagnostic,
    createdAt: new Date().toISOString(),
  };
}

export async function recordAssistantReportSignal(input: AssistantReportSignalInput): Promise<AssistantReportSnapshot> {
  const client = input.client ?? getDb();
  const now = new Date();
  const themeKey = normalizeThemeKey(input.themeKey);
  const themeLabel = toThemeLabel(input.themeLabel || input.themeKey);
  const threshold = Math.max(1, input.threshold ?? DEFAULT_SUGGESTION_THRESHOLD);
  const title = redactAssistantReportText(input.title, 200);
  const summary = redactAssistantReportText(input.summary, 1_500);
  const recommendation = redactAssistantReportText(input.recommendation, 1_500);
  const plan = redactAssistantReportText(input.plan, 3_000);

  try {
    return await client.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${`${input.organizationId}:${input.kind}:${themeKey}`}))`);
      const reports = await tx.assistantReport.findMany({
        where: {
          organizationId: input.organizationId,
          kind: input.kind,
          themeKey,
        },
        orderBy: [{ version: "desc" }, { createdAt: "desc" }],
      });

      const activeReport = reports.find((report) => isActiveReport(report.status));
      const latestReport = reports[0] ?? null;
      const evidenceEntry = buildEvidenceEntry(input);
      const diagnosticDetails = input.diagnostic ? summarizeDiagnostic(input.diagnostic) : null;
      const statusForNewReport = getNewAssistantReportStatus({
        kind: input.kind,
        forceOpen: input.forceOpen,
        threshold,
      });

      if (activeReport) {
        const nextEvidence = [...parseEvidenceJson(activeReport.evidenceJson), evidenceEntry];
        const nextSignalCount = activeReport.signalCount + 1;
        const nextStatus: AssistantReportStatus =
          input.kind === "INCIDENT" ? "OPEN" : nextSignalCount >= threshold ? "OPEN" : (activeReport.status as AssistantReportStatus);
        const openedAt = activeReport.openedAt ?? (nextStatus === "OPEN" ? now : null);

        await tx.assistantReport.updateMany({
          where: { id: activeReport.id, organizationId: input.organizationId },
          data: {
            themeLabel,
            title,
            summary,
            recommendation,
            plan,
            severity: input.severity ?? activeReport.severity,
            signalCount: nextSignalCount,
            status: nextStatus,
            openedAt,
            lastSignalAt: now,
            evidenceJson: serializeAssistantEvidence(nextEvidence),
            detailsJson: safeJson({
              redacted: true,
              diagnostic: diagnosticDetails,
              signalKind: input.signalKind,
              source: input.source,
              themeKey,
            }),
          },
        });
        const updated = await tx.assistantReport.findFirstOrThrow({ where: { id: activeReport.id, organizationId: input.organizationId } });

        await tx.assistantReportSignal.create({
          data: {
            organizationId: input.organizationId,
            reportId: updated.id,
            signalKind: input.signalKind,
            source: input.source,
            title,
            inputJson: safeJson({
              redacted: true,
              diagnosticId: diagnosticDetails?.diagnosticId ?? null,
              operation: diagnosticDetails?.operation ?? null,
            }),
            outputJson: safeJson({
              redacted: true,
              diagnosticId: diagnosticDetails?.diagnosticId ?? null,
              code: diagnosticDetails?.code ?? null,
            }),
          },
        });

        if (input.actorId) {
          await writeActivityLog({
            entityType: "AssistantReport",
            entityId: updated.id,
            action: "ASSISTANT_REPORT_SIGNAL_RECORDED",
            newValue: {
              themeKey,
              themeLabel,
              signalKind: input.signalKind,
              source: input.source,
              status: nextStatus,
              signalCount: nextSignalCount,
            },
            userId: input.actorId,
            organizationId: input.organizationId,
            db: tx,
          });
        }

        return buildSnapshot(updated);
      }

      const nextVersion = (latestReport?.version ?? 0) + 1;
      const created = await tx.assistantReport.create({
        data: {
          organizationId: input.organizationId,
          kind: input.kind,
          themeKey,
          themeLabel,
          status: statusForNewReport,
          version: nextVersion,
          parentReportId: latestReport?.status && CLOSED_REPORT_STATUSES.has(latestReport.status as AssistantReportStatus) ? latestReport.id : latestReport?.id ?? null,
          title,
          summary,
          recommendation,
          plan,
          evidenceJson: serializeAssistantEvidence([evidenceEntry]),
          detailsJson: safeJson({
            redacted: true,
            diagnostic: diagnosticDetails,
            signalKind: input.signalKind,
            source: input.source,
            themeKey,
          }),
          signalCount: 1,
          severity: input.severity ?? "MEDIUM",
          firstSignalAt: now,
          lastSignalAt: now,
          openedAt: statusForNewReport === "OPEN" ? now : null,
        },
      });

      await tx.assistantReportSignal.create({
        data: {
          organizationId: input.organizationId,
          reportId: created.id,
          signalKind: input.signalKind,
          source: input.source,
          title,
          inputJson: safeJson({
            redacted: true,
            diagnosticId: diagnosticDetails?.diagnosticId ?? null,
            operation: diagnosticDetails?.operation ?? null,
          }),
          outputJson: safeJson({
            redacted: true,
            diagnosticId: diagnosticDetails?.diagnosticId ?? null,
            code: diagnosticDetails?.code ?? null,
          }),
        },
      });

      if (input.actorId) {
        await writeActivityLog({
          entityType: "AssistantReport",
          entityId: created.id,
          action: "ASSISTANT_REPORT_CREATED",
          newValue: {
            themeKey,
            themeLabel,
            signalKind: input.signalKind,
            source: input.source,
            status: statusForNewReport,
            signalCount: 1,
          },
          userId: input.actorId,
          organizationId: input.organizationId,
          db: tx,
        });
      }

      return buildSnapshot(created);
    });
  } catch (error) {
    logError("assistant.reports.recordSignal", error, { themeKey, themeLabel, kind: input.kind, signalKind: input.signalKind });
    throw error;
  }
}

async function setReportStatus(reportId: string, organizationId: string, status: AssistantReportStatus, actorId: string, client: DbClient = getDb()) {
  const now = new Date();
  const existing = await client.assistantReport.findFirstOrThrow({ where: { id: reportId, organizationId } });
  await client.assistantReport.updateMany({
    where: { id: reportId, organizationId },
    data: {
      status,
      archivedAt: status === "ARCHIVED" ? now : null,
      resolvedAt: status === "RESOLVED" ? now : null,
      deletedAt: status === "DELETED" ? now : null,
      openedAt: status === "OPEN" ? now : undefined,
    },
  });
  const report = { ...existing, status, archivedAt: status === "ARCHIVED" ? now : null, resolvedAt: status === "RESOLVED" ? now : null, deletedAt: status === "DELETED" ? now : null, openedAt: status === "OPEN" ? now : existing.openedAt };

  await writeActivityLog({
    entityType: "AssistantReport",
    entityId: report.id,
    action: `ASSISTANT_REPORT_${status}`,
    newValue: { status },
    userId: actorId,
    organizationId,
    db: client,
  });

  return buildSnapshot(report);
}

export async function closeAssistantReport(reportId: string, organizationId: string, actorId: string, client: DbClient = getDb()) {
  return setReportStatus(reportId, organizationId, "RESOLVED", actorId, client);
}

export async function archiveAssistantReport(reportId: string, organizationId: string, actorId: string, client: DbClient = getDb()) {
  return setReportStatus(reportId, organizationId, "ARCHIVED", actorId, client);
}

export async function reopenAssistantReport(reportId: string, organizationId: string, actorId: string, client: DbClient = getDb()) {
  const report = await client.assistantReport.findFirst({ where: { id: reportId, organizationId } });
  if (!report) throw new Error("El reporte ya no existe.");
  const active = await client.assistantReport.findFirst({
    where: {
      id: { not: reportId },
      organizationId,
      kind: report.kind,
      themeKey: report.themeKey,
      status: { in: ["OPEN", "COLLECTING"] },
    },
    select: { id: true },
  });
  if (active) throw new Error("Ya existe una versión activa de este tema.");
  return setReportStatus(reportId, organizationId, "OPEN", actorId, client);
}

export async function deleteAssistantReport(reportId: string, organizationId: string, actorId: string, client: DbClient = getDb()) {
  const report = await client.assistantReport.findFirstOrThrow({ where: { id: reportId, organizationId } });
  await client.assistantReport.deleteMany({ where: { id: reportId, organizationId } });

  await writeActivityLog({
    entityType: "AssistantReport",
    entityId: report.id,
    action: "ASSISTANT_REPORT_DELETED",
    newValue: { id: report.id, kind: report.kind, themeKey: report.themeKey },
    userId: actorId,
    organizationId,
    db: client,
  });

  return buildSnapshot({
    ...report,
    status: "DELETED",
    openedAt: report.openedAt,
    resolvedAt: report.resolvedAt,
    archivedAt: report.archivedAt,
    deletedAt: new Date(),
  });
}
