import "server-only";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { safeJson } from "@/lib/activity-log";
import { logError } from "@/lib/logger";
import type {
  AssistantAiAttemptStatus,
  AssistantAiOperation,
  AssistantAiRunSnapshot,
  AssistantAiRunStatus,
  AssistantAiTier,
  AssistantAiTraceEntry,
  AssistantAiUsageSnapshot,
  AssistantUser,
} from "@/lib/assistant-types";

type DbClient = PrismaClient | Prisma.TransactionClient;

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === "object" && "toNumber" in value && typeof (value as { toNumber: () => number }).toNumber === "function") {
    const parsed = (value as { toNumber: () => number }).toNumber();
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function normalizeAssistantAiUsage(value: unknown): AssistantAiUsageSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const inputTokens = toNumber(record.inputTokens ?? record.promptTokens ?? record.promptTokenCount ?? record.inputTokenCount);
  const outputTokens = toNumber(record.outputTokens ?? record.completionTokens ?? record.completionTokenCount ?? record.generatedTokens);
  const totalTokens = toNumber(record.totalTokens ?? record.totalTokenCount ?? record.totalUsage ?? record.tokenCount) ?? (inputTokens != null || outputTokens != null ? (inputTokens ?? 0) + (outputTokens ?? 0) : null);
  const cachedInputTokens = toNumber(record.cachedInputTokens ?? record.cachedTokens ?? record.inputTokensCached ?? record.promptTokensCached);
  const billedCostUsd = toNumber(record.billedCostUsd ?? record.totalCost ?? record.costUsd);
  const costSource = record.costSource === "gateway" || record.costSource === "estimated" || record.costSource === "unknown"
    ? record.costSource
    : undefined;
  const generationId = typeof record.generationId === "string" && record.generationId.trim() ? record.generationId : null;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens,
    estimatedCostUsd: null,
    billedCostUsd,
    ...(costSource ? { costSource } : {}),
    generationId,
  };
}

const DEFAULT_MODEL_COSTS: Record<string, { input: number; output: number }> = {
  "minimax/minimax-m3": { input: 0.30 / 1_000_000, output: 1.20 / 1_000_000 },
  "openai/gpt-5.4-mini": { input: 0.75 / 1_000_000, output: 4.50 / 1_000_000 },
};

export function estimateAssistantAiCostUsd(model: string, usage: AssistantAiUsageSnapshot | null | undefined) {
  if (!usage) return null;
  if (usage.inputTokens == null && usage.outputTokens == null) return null;
  const cost = DEFAULT_MODEL_COSTS[model];
  if (!cost) return null;
  const inputCost = (usage.inputTokens ?? 0) * cost.input;
  const outputCost = (usage.outputTokens ?? 0) * cost.output;
  const estimated = inputCost + outputCost;
  return Number.isFinite(estimated) ? Number(estimated.toFixed(9)) : null;
}

function toSnapshotUsage(value: unknown, model: string) {
  const usage = normalizeAssistantAiUsage(value);
  if (!usage) return null;
  const estimatedCostUsd = usage.estimatedCostUsd ?? estimateAssistantAiCostUsd(model, usage);
  return {
    ...usage,
    estimatedCostUsd,
    costSource: usage.costSource ?? (usage.billedCostUsd != null ? "gateway" : estimatedCostUsd != null ? "estimated" : "unknown"),
  };
}

function toSnapshotAttemptStatus(status: string): AssistantAiAttemptStatus {
  if (status === "SUCCEEDED" || status === "FAILED" || status === "SKIPPED" || status === "STARTED") {
    return status;
  }
  return "FAILED";
}

function toSnapshotRunStatus(status: string): AssistantAiRunStatus {
  if (status === "RUNNING" || status === "SUCCEEDED" || status === "FAILED" || status === "ABORTED") {
    return status;
  }
  return "FAILED";
}

function toSnapshotTier(value: string): AssistantAiTier {
  if (value === "deterministic" || value === "minimax" || value === "critical") return value;
  return "minimax";
}

function toTraceEntry(attempt: {
  attemptNumber: number;
  tier: string;
  status: string;
  requestedModel: string;
  finalModel: string | null;
  fallbackReason: string | null;
  errorCode: string | null;
  durationMs: number | null;
  finishReason: string | null;
  statusCode: number | null;
  responsePreview: string | null;
  usageJson: string | null;
  totalUsageJson: string | null;
  estimatedCostUsd: Prisma.Decimal | number | string | null;
}): AssistantAiTraceEntry {
  const usage = attempt.usageJson ? normalizeAssistantAiUsage(JSON.parse(attempt.usageJson)) : null;
  const totalUsage = attempt.totalUsageJson ? normalizeAssistantAiUsage(JSON.parse(attempt.totalUsageJson)) : null;
  const effectiveUsage = totalUsage ?? usage;
  const cost = attempt.estimatedCostUsd == null ? effectiveUsage?.billedCostUsd ?? effectiveUsage?.estimatedCostUsd ?? null : toNumber(attempt.estimatedCostUsd);

  return {
    attemptNumber: attempt.attemptNumber,
    tier: toSnapshotTier(attempt.tier),
    status: toSnapshotAttemptStatus(attempt.status),
    requestedModel: attempt.requestedModel,
    finalModel: attempt.finalModel,
    fallbackReason: attempt.fallbackReason,
    code: attempt.errorCode as AssistantAiTraceEntry["code"],
    durationMs: attempt.durationMs,
    finishReason: attempt.finishReason,
    statusCode: attempt.statusCode,
    usage: effectiveUsage
      ? {
          ...effectiveUsage,
          estimatedCostUsd: cost,
          costSource: effectiveUsage.costSource ?? (effectiveUsage.billedCostUsd != null ? "gateway" : cost != null ? "estimated" : "unknown"),
        }
      : null,
    responsePreview: attempt.responsePreview,
  };
}

function toRunSnapshot(run: {
  id: string;
  userId: string;
  userRole: string;
  operation: string;
  tier: string;
  requestedModel: string;
  finalModel: string | null;
  status: string;
  attemptCount: number;
  fallbackCount: number;
  fallbackReason: string | null;
  reportId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  statusCode: number | null;
  finishReason: string | null;
  usageJson: string | null;
  totalUsageJson: string | null;
  providerMetadataJson: string | null;
  responsePreview: string | null;
  estimatedCostUsd: Prisma.Decimal | number | string | null;
  durationMs: number | null;
  createdAt: Date;
  updatedAt: Date;
  attempts?: Array<{
    id: string;
    runId: string;
    attemptNumber: number;
    tier: string;
    requestedModel: string;
    finalModel: string | null;
    status: string;
    fallbackReason: string | null;
    provider: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    statusCode: number | null;
    finishReason: string | null;
    responsePreview: string | null;
    usageJson: string | null;
    totalUsageJson: string | null;
    providerMetadataJson: string | null;
    durationMs: number | null;
    estimatedCostUsd: Prisma.Decimal | number | string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
}): AssistantAiRunSnapshot {
  return {
    id: run.id,
    userId: run.userId,
    userRole: run.userRole === "ADMIN" ? "ADMIN" : "AGENT",
    operation: run.operation as AssistantAiOperation,
    tier: toSnapshotTier(run.tier),
    requestedModel: run.requestedModel,
    finalModel: run.finalModel,
    status: toSnapshotRunStatus(run.status),
    attemptCount: run.attemptCount,
    fallbackCount: run.fallbackCount,
    fallbackReason: run.fallbackReason,
    reportId: run.reportId,
    errorCode: run.errorCode as AssistantAiRunSnapshot["errorCode"],
    errorMessage: run.errorMessage,
    statusCode: run.statusCode,
    finishReason: run.finishReason,
    usage: run.usageJson ? toSnapshotUsage(JSON.parse(run.usageJson), run.requestedModel) : null,
    totalUsage: run.totalUsageJson ? toSnapshotUsage(JSON.parse(run.totalUsageJson), run.finalModel ?? run.requestedModel) : null,
    providerMetadata: run.providerMetadataJson ? JSON.parse(run.providerMetadataJson) : null,
    responsePreview: run.responsePreview,
    estimatedCostUsd: toNumber(run.estimatedCostUsd),
    durationMs: run.durationMs,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    attempts: (run.attempts ?? [])
      .slice()
      .sort((left, right) => left.attemptNumber - right.attemptNumber)
      .map((attempt) => ({
        id: attempt.id,
        runId: attempt.runId,
        attemptNumber: attempt.attemptNumber,
        tier: toSnapshotTier(attempt.tier),
        requestedModel: attempt.requestedModel,
        finalModel: attempt.finalModel,
        status: toSnapshotAttemptStatus(attempt.status),
        fallbackReason: attempt.fallbackReason,
        provider: attempt.provider,
        code: attempt.errorCode as AssistantAiTraceEntry["code"],
        errorMessage: attempt.errorMessage,
        statusCode: attempt.statusCode,
        finishReason: attempt.finishReason,
        responsePreview: attempt.responsePreview,
        usage: attempt.usageJson ? toSnapshotUsage(JSON.parse(attempt.usageJson), attempt.finalModel ?? attempt.requestedModel) : null,
        durationMs: attempt.durationMs,
        estimatedCostUsd: toNumber(attempt.estimatedCostUsd),
        createdAt: attempt.createdAt.toISOString(),
        updatedAt: attempt.updatedAt.toISOString(),
      })),
  };
}

export async function createAssistantAiRun(
  input: {
    id: string;
    user: AssistantUser;
    operation: AssistantAiOperation;
    tier: AssistantAiTier;
    requestedModel: string;
    fallbackReason?: string | null;
    reportId?: string | null;
  },
  client: DbClient = getDb(),
): Promise<AssistantAiRunSnapshot | null> {
  try {
    const run = await client.assistantAiRun.create({
      data: {
        id: input.id,
        userId: input.user.id,
        userRole: input.user.role,
        operation: input.operation,
        tier: input.tier,
        requestedModel: input.requestedModel,
        fallbackReason: input.fallbackReason ?? null,
        reportId: input.reportId ?? null,
      },
    });
    return toRunSnapshot({ ...run, attempts: [] });
  } catch (error) {
    logError("assistant.ai.createRun", error, {
      runId: input.id,
      operation: input.operation,
      requestedModel: input.requestedModel,
      tier: input.tier,
    });
    return null;
  }
}

export async function createAssistantAiAttempt(
  input: {
    id: string;
    runId: string;
    attemptNumber: number;
    tier: AssistantAiTier;
    requestedModel: string;
    status: AssistantAiAttemptStatus;
    fallbackReason?: string | null;
    provider?: string | null;
  },
  client: DbClient = getDb(),
) {
  try {
    const attempt = await client.assistantAiAttempt.create({
      data: {
        id: input.id,
        runId: input.runId,
        attemptNumber: input.attemptNumber,
        tier: input.tier,
        requestedModel: input.requestedModel,
        status: input.status,
        fallbackReason: input.fallbackReason ?? null,
        provider: input.provider ?? null,
      },
    });
    return toTraceEntry({
      attemptNumber: attempt.attemptNumber,
      tier: attempt.tier,
      status: attempt.status,
      requestedModel: attempt.requestedModel,
      finalModel: attempt.finalModel,
      fallbackReason: attempt.fallbackReason,
      errorCode: attempt.errorCode,
      durationMs: attempt.durationMs,
      finishReason: attempt.finishReason,
      statusCode: attempt.statusCode,
      responsePreview: attempt.responsePreview,
      usageJson: attempt.usageJson,
      totalUsageJson: attempt.totalUsageJson,
      estimatedCostUsd: attempt.estimatedCostUsd,
    });
  } catch (error) {
    logError("assistant.ai.createAttempt", error, {
      runId: input.runId,
      attemptNumber: input.attemptNumber,
      requestedModel: input.requestedModel,
      tier: input.tier,
    });
    return null;
  }
}

export async function finalizeAssistantAiAttempt(
  attemptId: string,
  input: {
    status: AssistantAiAttemptStatus;
    finalModel?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    statusCode?: number | null;
    finishReason?: string | null;
    responsePreview?: string | null;
    usage?: unknown;
    totalUsage?: unknown;
    providerMetadata?: unknown;
    durationMs?: number | null;
    estimatedCostUsd?: number | null;
  },
  client: DbClient = getDb(),
) {
  try {
    const attempt = await client.assistantAiAttempt.update({
      where: { id: attemptId },
      data: {
        status: input.status,
        finalModel: input.finalModel ?? undefined,
        errorCode: input.errorCode ?? undefined,
        errorMessage: input.errorMessage ?? undefined,
        statusCode: input.statusCode ?? undefined,
        finishReason: input.finishReason ?? undefined,
        responsePreview: input.responsePreview ?? undefined,
        usageJson: input.usage === undefined ? undefined : safeJson(input.usage),
        totalUsageJson: input.totalUsage === undefined ? undefined : safeJson(input.totalUsage),
        providerMetadataJson: input.providerMetadata === undefined ? undefined : safeJson(input.providerMetadata),
        durationMs: input.durationMs ?? undefined,
        estimatedCostUsd:
          input.estimatedCostUsd == null ? undefined : new Prisma.Decimal(input.estimatedCostUsd),
      },
    });
    return attempt;
  } catch (error) {
    logError("assistant.ai.finalizeAttempt", error, { attemptId, status: input.status });
    return null;
  }
}

export async function finalizeAssistantAiRun(
  runId: string,
  input: {
    status: AssistantAiRunStatus;
    finalModel?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    statusCode?: number | null;
    finishReason?: string | null;
    responsePreview?: string | null;
    usage?: unknown;
    totalUsage?: unknown;
    providerMetadata?: unknown;
    durationMs?: number | null;
    estimatedCostUsd?: number | null;
    attemptCount?: number | null;
    fallbackCount?: number | null;
  },
  client: DbClient = getDb(),
) {
  try {
    const run = await client.assistantAiRun.update({
      where: { id: runId },
      data: {
        status: input.status,
        finalModel: input.finalModel ?? undefined,
        errorCode: input.errorCode ?? undefined,
        errorMessage: input.errorMessage ?? undefined,
        statusCode: input.statusCode ?? undefined,
        finishReason: input.finishReason ?? undefined,
        responsePreview: input.responsePreview ?? undefined,
        usageJson: input.usage === undefined ? undefined : safeJson(input.usage),
        totalUsageJson: input.totalUsage === undefined ? undefined : safeJson(input.totalUsage),
        providerMetadataJson: input.providerMetadata === undefined ? undefined : safeJson(input.providerMetadata),
        durationMs: input.durationMs ?? undefined,
        estimatedCostUsd:
          input.estimatedCostUsd == null ? undefined : new Prisma.Decimal(input.estimatedCostUsd),
        attemptCount: input.attemptCount ?? undefined,
        fallbackCount: input.fallbackCount ?? undefined,
      },
      include: {
        attempts: { orderBy: { attemptNumber: "asc" } },
      },
    });
    return toRunSnapshot(run);
  } catch (error) {
    logError("assistant.ai.finalizeRun", error, { runId, status: input.status });
    return null;
  }
}

export async function linkAssistantAiRunToReport(runId: string, reportId: string, client: DbClient = getDb()) {
  try {
    await client.assistantAiRun.update({
      where: { id: runId },
      data: { reportId },
    });
  } catch (error) {
    logError("assistant.ai.linkRunReport", error, { runId, reportId });
  }
}

export async function getAssistantAiRun(runId: string, client: DbClient = getDb()) {
  const run = await client.assistantAiRun.findUnique({
    where: { id: runId },
    include: {
      attempts: { orderBy: { attemptNumber: "asc" } },
    },
  });
  return run ? toRunSnapshot(run) : null;
}

export async function listAssistantAiRuns(
  filter: {
    limit?: number;
    userId?: string;
    operation?: AssistantAiOperation;
    status?: AssistantAiRunStatus;
  } = {},
  client: DbClient = getDb(),
): Promise<AssistantAiRunSnapshot[]> {
  const runs = await client.assistantAiRun.findMany({
    where: {
      ...(filter.userId ? { userId: filter.userId } : {}),
      ...(filter.operation ? { operation: filter.operation } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    include: {
      attempts: { orderBy: { attemptNumber: "asc" } },
    },
    orderBy: [{ createdAt: "desc" }],
    take: filter.limit ?? 50,
  });

  return runs.map(toRunSnapshot);
}
