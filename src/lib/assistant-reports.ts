import "server-only";

import { getDb } from "@/lib/db";
import { logError } from "@/lib/logger";
import { safeJson, writeActivityLog } from "@/lib/activity-log";
import type {
  AssistantReportKind,
  AssistantReportSeverity,
  AssistantReportSnapshot,
  AssistantReportStatus,
} from "@/lib/assistant-types";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

const ACTIVE_REPORT_STATUSES = new Set<AssistantReportStatus>(["COLLECTING", "OPEN"]);
const CLOSED_REPORT_STATUSES = new Set<AssistantReportStatus>(["RESOLVED", "ARCHIVED", "DELETED"]);
const DEFAULT_SUGGESTION_THRESHOLD = 5;

export type AssistantReportSignalInput = {
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
  threshold?: number;
  client?: DbClient;
  actorId?: string | null;
  forceOpen?: boolean;
};

export type AssistantReportListFilter = {
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
  filter: AssistantReportListFilter = {},
  client: DbClient = getDb(),
): Promise<AssistantReportSnapshot[]> {
  const where: Prisma.AssistantReportWhereInput = {};
  if (filter.kind) where.kind = filter.kind;
  if (filter.status) where.status = filter.status;

  const reports = await client.assistantReport.findMany({
    where,
    orderBy: [{ lastSignalAt: "desc" }, { createdAt: "desc" }],
    take: filter.limit ?? 100,
  });

  return reports.map(buildSnapshot);
}

export async function getAssistantReport(reportId: string, client: DbClient = getDb()) {
  const report = await client.assistantReport.findUnique({
    where: { id: reportId },
  });

  return report ? buildSnapshot(report) : null;
}

function isActiveReport(status: string) {
  return ACTIVE_REPORT_STATUSES.has(status as AssistantReportStatus);
}

function buildEvidenceEntry(input: AssistantReportSignalInput) {
  return {
    signalKind: input.signalKind,
    source: input.source,
    title: input.title,
    summary: input.summary,
    recommendation: input.recommendation,
    plan: input.plan,
    severity: input.severity ?? "MEDIUM",
    input: input.input ?? null,
    output: input.output ?? null,
    evidence: input.evidence ?? null,
    createdAt: new Date().toISOString(),
  };
}

export async function recordAssistantReportSignal(input: AssistantReportSignalInput): Promise<AssistantReportSnapshot> {
  const client = input.client ?? getDb();
  const now = new Date();
  const themeKey = normalizeThemeKey(input.themeKey);
  const themeLabel = toThemeLabel(input.themeLabel || input.themeKey);
  const threshold = Math.max(1, input.threshold ?? DEFAULT_SUGGESTION_THRESHOLD);

  try {
    return await client.$transaction(async (tx) => {
      const reports = await tx.assistantReport.findMany({
        where: {
          kind: input.kind,
          themeKey,
        },
        orderBy: [{ version: "desc" }, { createdAt: "desc" }],
      });

      const activeReport = reports.find((report) => isActiveReport(report.status));
      const latestReport = reports[0] ?? null;
      const evidenceEntry = buildEvidenceEntry(input);
      const statusForNewReport: AssistantReportStatus =
        input.kind === "INCIDENT" || input.forceOpen
          ? "OPEN"
          : (latestReport?.signalCount ?? 0) + 1 >= threshold
            ? "OPEN"
            : "COLLECTING";

      if (activeReport) {
        const nextEvidence = [...parseEvidenceJson(activeReport.evidenceJson), evidenceEntry];
        const nextSignalCount = activeReport.signalCount + 1;
        const nextStatus: AssistantReportStatus =
          input.kind === "INCIDENT" ? "OPEN" : nextSignalCount >= threshold ? "OPEN" : (activeReport.status as AssistantReportStatus);
        const openedAt = activeReport.openedAt ?? (nextStatus === "OPEN" ? now : null);

        const updated = await tx.assistantReport.update({
          where: { id: activeReport.id },
          data: {
            themeLabel,
            title: input.title,
            summary: input.summary,
            recommendation: input.recommendation,
            plan: input.plan,
            severity: input.severity ?? activeReport.severity,
            signalCount: nextSignalCount,
            status: nextStatus,
            openedAt,
            lastSignalAt: now,
            evidenceJson: safeJson(nextEvidence),
            detailsJson: safeJson(input.details ?? {}),
          },
        });

        await tx.assistantReportSignal.create({
          data: {
            reportId: updated.id,
            signalKind: input.signalKind,
            source: input.source,
            title: input.title,
            inputJson: safeJson(input.input ?? {}),
            outputJson: safeJson(input.output ?? {}),
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
            db: tx,
          });
        }

        return buildSnapshot(updated);
      }

      const nextVersion = (latestReport?.version ?? 0) + 1;
      const created = await tx.assistantReport.create({
        data: {
          kind: input.kind,
          themeKey,
          themeLabel,
          status: statusForNewReport,
          version: nextVersion,
          parentReportId: latestReport?.status && CLOSED_REPORT_STATUSES.has(latestReport.status as AssistantReportStatus) ? latestReport.id : latestReport?.id ?? null,
          title: input.title,
          summary: input.summary,
          recommendation: input.recommendation,
          plan: input.plan,
          evidenceJson: safeJson([evidenceEntry]),
          detailsJson: safeJson(input.details ?? {}),
          signalCount: 1,
          severity: input.severity ?? "MEDIUM",
          firstSignalAt: now,
          lastSignalAt: now,
          openedAt: statusForNewReport === "OPEN" ? now : null,
        },
      });

      await tx.assistantReportSignal.create({
        data: {
          reportId: created.id,
          signalKind: input.signalKind,
          source: input.source,
          title: input.title,
          inputJson: safeJson(input.input ?? {}),
          outputJson: safeJson(input.output ?? {}),
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

async function setReportStatus(reportId: string, status: AssistantReportStatus, actorId: string, client: DbClient = getDb()) {
  const now = new Date();
  const report = await client.assistantReport.update({
    where: { id: reportId },
    data: {
      status,
      archivedAt: status === "ARCHIVED" ? now : null,
      resolvedAt: status === "RESOLVED" ? now : null,
      deletedAt: status === "DELETED" ? now : null,
      openedAt: status === "OPEN" ? now : undefined,
    },
  });

  await writeActivityLog({
    entityType: "AssistantReport",
    entityId: report.id,
    action: `ASSISTANT_REPORT_${status}`,
    newValue: { status },
    userId: actorId,
    db: client,
  });

  return buildSnapshot(report);
}

export async function closeAssistantReport(reportId: string, actorId: string, client: DbClient = getDb()) {
  return setReportStatus(reportId, "RESOLVED", actorId, client);
}

export async function archiveAssistantReport(reportId: string, actorId: string, client: DbClient = getDb()) {
  return setReportStatus(reportId, "ARCHIVED", actorId, client);
}

export async function reopenAssistantReport(reportId: string, actorId: string, client: DbClient = getDb()) {
  return setReportStatus(reportId, "OPEN", actorId, client);
}

export async function deleteAssistantReport(reportId: string, actorId: string, client: DbClient = getDb()) {
  const report = await client.assistantReport.delete({ where: { id: reportId } });

  await writeActivityLog({
    entityType: "AssistantReport",
    entityId: report.id,
    action: "ASSISTANT_REPORT_DELETED",
    newValue: { id: report.id, kind: report.kind, themeKey: report.themeKey },
    userId: actorId,
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
