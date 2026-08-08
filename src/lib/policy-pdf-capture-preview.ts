import "server-only";

import { getDb } from "@/lib/db";
import { parseDateInput } from "@/lib/form-utils";
import { reviewPolicyPdfWithAi } from "@/lib/assistant-ai";
import {
  extractPolicyPdfDraftFromText,
  extractPolicyPdfReceiptEvidence,
  buildPolicyPdfCaptureFieldConfidence,
  buildPolicyPdfCaptureReceiptPlan,
  type PolicyCaptureSourceOption,
  type PolicyPdfCaptureAiReview,
  type PolicyPdfCaptureDraft,
  type PolicyPdfCaptureFieldConfidence,
  type PolicyPdfCapturePreview,
  type PolicyPdfCaptureProvenance,
  scoreCaptureIdentity,
} from "@/lib/policy-pdf-capture.shared";
import type { AssistantUser } from "@/lib/assistant-types";
import { buildPolicyNumberSearchVariants } from "@/lib/policy-number";
import { clientOperationalWhere, policyOperationalWhere } from "@/lib/portfolio-access";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

type PolicyPdfCapturePreviewContext = {
  portfolioOwnerId?: string;
  user?: AssistantUser | null;
};

function scoreTextMatch(needle: string, candidate: string) {
  return scoreCaptureIdentity(needle, candidate);
}

async function buildSourcePolicyCandidates(
  db: DbClient,
  draft: PolicyPdfCaptureDraft,
  clientId: string | null,
  _insurerId: string | null,
  portfolioOwnerId?: string,
) {
  const candidates: Array<PolicyCaptureSourceOption> = [];
  const exactNumberVariants = draft.sourcePolicyNumber ? buildPolicyNumberSearchVariants(draft.sourcePolicyNumber) : [];

  if (draft.serialNumber && draft.policyType === "AUTO") {
    const targetStartDate = draft.startDate ? parseDateInput(draft.startDate) : null;
    const serialPolicies = await db.policy.findMany({
      where: {
        ...policyOperationalWhere(portfolioOwnerId),
        ...(clientId ? { clientId } : {}),
        policyType: "AUTO",
        status: { in: ["ACTIVE", "EXPIRED", "RENEWED"] },
        ...(targetStartDate ? { endDate: { lt: targetStartDate } } : {}),
        insuredAssets: {
          some: {
            serialNumber: draft.serialNumber,
          },
        },
      },
      orderBy: [{ endDate: "desc" }, { startDate: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        policyNumber: true,
        startDate: true,
        endDate: true,
        status: true,
        insuredAssets: {
          where: { serialNumber: draft.serialNumber },
          select: {
            serialNumber: true,
          },
          take: 1,
        },
      },
      take: 5,
    });

    candidates.push(
      ...serialPolicies.map((policy) => ({
        id: policy.id,
        value: policy.id,
        label: `${policy.policyNumber} · ${policy.status} · ${policy.endDate.toISOString().slice(0, 10)} · Serie ${policy.insuredAssets[0]?.serialNumber ?? draft.serialNumber}`,
        policyNumber: policy.policyNumber,
        startDate: policy.startDate.toISOString().slice(0, 10),
        endDate: policy.endDate.toISOString().slice(0, 10),
        status: policy.status,
        serialNumber: policy.insuredAssets[0]?.serialNumber ?? null,
      })),
    );
  }

  if (exactNumberVariants.length > 0) {
    const exact = await db.policy.findMany({
      where: {
        OR: exactNumberVariants.map((variant) => ({ policyNumber: variant })),
        ...policyOperationalWhere(portfolioOwnerId),
        ...(clientId ? { clientId } : {}),
      },
      orderBy: [{ startDate: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        policyNumber: true,
        startDate: true,
        endDate: true,
        status: true,
        insuredAssets: {
          select: {
            serialNumber: true,
          },
          take: 1,
        },
      },
      take: 5,
    });

    candidates.push(
      ...exact.map((policy) => ({
        id: policy.id,
        value: policy.id,
        label: `${policy.policyNumber} · ${policy.status} · ${policy.endDate.toISOString().slice(0, 10)}${policy.insuredAssets[0]?.serialNumber ? ` · Serie ${policy.insuredAssets[0].serialNumber}` : ""}`,
        policyNumber: policy.policyNumber,
        startDate: policy.startDate.toISOString().slice(0, 10),
        endDate: policy.endDate.toISOString().slice(0, 10),
        status: policy.status,
        serialNumber: policy.insuredAssets[0]?.serialNumber ?? null,
      })),
    );
  }

  if (candidates.length === 0 && clientId) {
    const fallback = await db.policy.findMany({
      where: {
        ...policyOperationalWhere(portfolioOwnerId),
        clientId,
        policyType: draft.policyType,
        status: { in: ["ACTIVE", "EXPIRED", "RENEWED"] },
        ...(exactNumberVariants.length > 0 ? { OR: exactNumberVariants.map((variant) => ({ policyNumber: variant })) } : {}),
      },
      orderBy: [{ endDate: "desc" }, { startDate: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        policyNumber: true,
        startDate: true,
        endDate: true,
        status: true,
        insuredAssets: {
          select: {
            serialNumber: true,
          },
          take: 1,
        },
      },
      take: 5,
    });

    candidates.push(
      ...fallback.map((policy) => ({
        id: policy.id,
        value: policy.id,
        label: `${policy.policyNumber} · ${policy.status} · ${policy.endDate.toISOString().slice(0, 10)}${policy.insuredAssets[0]?.serialNumber ? ` · Serie ${policy.insuredAssets[0].serialNumber}` : ""}`,
        policyNumber: policy.policyNumber,
        startDate: policy.startDate.toISOString().slice(0, 10),
        endDate: policy.endDate.toISOString().slice(0, 10),
        status: policy.status,
        serialNumber: policy.insuredAssets[0]?.serialNumber ?? null,
      })),
    );
  }

  return candidates;
}

type PolicyPdfCapturePreviewInput = {
  draft: PolicyPdfCaptureDraft;
  fieldConfidence: PolicyPdfCaptureFieldConfidence;
  warnings?: string[];
  aiReview?: PolicyPdfCaptureAiReview | null;
  aiReviewTelemetry?: {
    runId: string | null;
    trackingStatus: "recorded" | "unavailable";
    attempted: boolean;
  } | null;
  extractionSource?: "local" | "ai";
  requestedMode?: "local" | "ai";
  aiRunIds?: string[];
  trackingStatus?: "recorded" | "unavailable";
  aiFailureCode?: string | null;
  skipAiReview?: boolean;
  extraWarnings?: string[];
  receiptEvidence?: import("@/lib/policy-pdf-capture.shared").PolicyPdfCaptureReceiptEvidence | null;
  relatedDocuments?: import("@/lib/policy-pdf-capture.shared").PolicyPdfCaptureRelatedDocument[];
  reviewText?: string | null;
  context?: PolicyPdfCapturePreviewContext;
};

export async function buildPolicyPdfCapturePreviewFromDraft(
  input: PolicyPdfCapturePreviewInput,
  db: DbClient = getDb(),
): Promise<PolicyPdfCapturePreview> {
  const { portfolioOwnerId, user } = input.context ?? {};
  const warnings = [...(input.warnings ?? []), ...(input.extraWarnings ?? [])];
  const policyNumberSuggestion = input.draft.sourcePolicyNumber;
  const policyNumberVariants = buildPolicyNumberSearchVariants(input.draft.policyNumber);
  const existingPolicyMatches = policyNumberVariants.length > 0
    ? await db.policy.findMany({
        where: {
          ...(portfolioOwnerId ? { client: { portfolioOwnerId } } : {}),
          OR: policyNumberVariants.map((variant) => ({ policyNumber: variant })),
        },
        select: {
          id: true,
          policyNumber: true,
        },
        orderBy: [{ updatedAt: "desc" }],
        take: 3,
      })
    : [];

  const clientCandidates = input.draft.clientName
    ? (await db.client.findMany({
        where: {
          status: { not: "ARCHIVED" },
          ...clientOperationalWhere(portfolioOwnerId),
        },
        select: { id: true, fullName: true },
        orderBy: { fullName: "asc" },
      }))
        .map((client) => ({ id: client.id, label: client.fullName, score: scoreTextMatch(input.draft.clientName, client.fullName) }))
        .filter((client) => client.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 5)
        .map(({ id, label }) => ({ id, value: id, label }))
    : [];

  const insurerCandidates = input.draft.insurerName
    ? (await db.insurer.findMany({
        where: { status: { not: "ARCHIVED" } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }))
        .map((insurer) => ({ id: insurer.id, label: insurer.name, score: scoreTextMatch(input.draft.insurerName, insurer.name) }))
        .filter((insurer) => insurer.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 5)
        .map(({ id, label }) => ({ id, value: id, label }))
    : [];

  const suggestedClientId = clientCandidates[0]?.id ?? null;
  const suggestedInsurerId = insurerCandidates[0]?.id ?? null;

  const sourcePolicyCandidates = await buildSourcePolicyCandidates(
    db,
    input.draft,
    suggestedClientId,
    suggestedInsurerId,
    portfolioOwnerId,
  );
  const suggestedSourcePolicyId = sourcePolicyCandidates.find((policy) => policy.policyNumber === policyNumberSuggestion)?.id ?? null;

  if (!input.draft.policyNumber) warnings.push("No pudimos detectar el número de póliza.");
  if (existingPolicyMatches.length > 0) {
    const matchLabel = existingPolicyMatches.map((policy) => policy.policyNumber).join(" | ");
    warnings.push(
      existingPolicyMatches.length === 1
        ? `Ya existe una póliza equivalente: ${matchLabel}. Revisa si esta captura debe actualizar o enlazar el registro existente.`
        : `Encontramos pólizas equivalentes o muy cercanas: ${matchLabel}. Revisa si ya está capturada.`,
    );
  }
  if (!input.draft.clientName) warnings.push("No pudimos detectar el asegurado principal.");
  if (!input.draft.insurerName) warnings.push("No pudimos detectar la aseguradora.");
  if (!input.draft.startDate || !input.draft.endDate) warnings.push("No pudimos detectar la vigencia completa.");
  if (input.draft.policyType === "AUTO" && !input.draft.serialNumber) {
    warnings.push("No pudimos detectar la serie del vehículo.");
  }
  if (!sourcePolicyCandidates.length && policyNumberSuggestion) {
    warnings.push(`No encontramos una póliza origen para sugerir (${policyNumberSuggestion}).`);
  }
  if (!sourcePolicyCandidates.length && input.draft.serialNumber) {
    warnings.push(`No encontramos una póliza origen para sugerir con la serie ${input.draft.serialNumber}.`);
  }
  if (input.draft.paymentFrequency === "OTHER") {
    warnings.push("La frecuencia no quedó totalmente clara; revisa que sea Anual.");
  }

  const fieldConfidence = input.fieldConfidence;
  const hasLowConfidence = Object.values(fieldConfidence).some((confidence) => confidence === "low");
  const shouldRequestAiReview = Boolean(
    user &&
      !input.aiReview &&
      !input.skipAiReview &&
      (warnings.length > 0 ||
        hasLowConfidence ||
        clientCandidates.length === 0 ||
        insurerCandidates.length === 0 ||
        sourcePolicyCandidates.length === 0),
  );
  const aiReviewResult = input.aiReview !== undefined
    ? {
        value: input.aiReview,
        runId: input.aiReviewTelemetry?.runId ?? null,
        trackingStatus: input.aiReviewTelemetry?.trackingStatus ?? "recorded" as const,
        attempted: input.aiReviewTelemetry?.attempted ?? false,
      }
    : shouldRequestAiReview && user
      ? await reviewPolicyPdfWithAi({
        user,
        text: input.reviewText ?? null,
        draft: input.draft,
        warnings,
        themeHint: "policy-pdf-review",
      })
      : null;
  const aiReview = aiReviewResult?.value ?? null;
  const aiRunIds = Array.from(new Set([
    ...(input.aiRunIds ?? []),
    ...(aiReviewResult?.runId ? [aiReviewResult.runId] : []),
  ]));
  const aiAttempted = Boolean(aiReviewResult?.attempted);
  const trackingStatus = aiReviewResult
    ? aiReviewResult.trackingStatus
    : input.trackingStatus ?? "recorded";
  const provenance: PolicyPdfCaptureProvenance = {
    requestedMode: input.requestedMode ?? "local",
    extractionSource: input.extractionSource ?? "local",
    reviewSource: aiReview ? "ai" : "none",
    aiRunIds,
    trackingStatus,
    aiAttempted,
    aiFailureCode: input.aiFailureCode ?? null,
  };
  if (aiAttempted && !aiReview) {
    warnings.push("No pudimos completar la revisión IA; revisa los campos marcados antes de confirmar.");
  }
  if (aiAttempted && trackingStatus === "unavailable") {
    warnings.push("La revisión IA terminó, pero no pudimos registrar su uso administrativo.");
  }
  if (aiReviewResult && !aiAttempted && trackingStatus === "unavailable") {
    warnings.push("La revisión IA no está disponible en este entorno; valida la captura manualmente.");
  }
  if (aiReview) {
    for (const warning of aiReview.warnings) {
      if (!warnings.includes(warning)) {
        warnings.push(warning);
      }
    }
  }

  return {
    draft: input.draft,
    suggestions: {
      clientId: suggestedClientId,
      insurerId: suggestedInsurerId,
      sourcePolicyId: suggestedSourcePolicyId,
    },
    receiptPlan: buildPolicyPdfCaptureReceiptPlan(input.draft),
    clientOptions: clientCandidates,
    insurerOptions: insurerCandidates,
    sourcePolicyOptions: sourcePolicyCandidates,
    fieldConfidence,
    confidence: {
      client: clientCandidates.length > 0,
      insurer: insurerCandidates.length > 0,
      sourcePolicy: Boolean(suggestedSourcePolicyId),
    },
    warnings,
    aiReview,
    provenance,
    relatedDocuments: input.relatedDocuments,
    receiptEvidence: input.receiptEvidence ?? null,
  } satisfies PolicyPdfCapturePreview;
}

export async function buildPolicyPdfCapturePreviewFromText(
  text: string,
  db: DbClient = getDb(),
  context: PolicyPdfCapturePreviewContext = {},
  options: Pick<PolicyPdfCapturePreviewInput, "requestedMode" | "skipAiReview" | "extraWarnings" | "aiFailureCode" | "relatedDocuments"> = {},
): Promise<PolicyPdfCapturePreview> {
  const draft = extractPolicyPdfDraftFromText(text);
  const fieldConfidence = buildPolicyPdfCaptureFieldConfidence(text, draft);
  const receiptEvidence = extractPolicyPdfReceiptEvidence(text);
  return buildPolicyPdfCapturePreviewFromDraft({
    draft,
    fieldConfidence,
    reviewText: text,
    ...options,
    receiptEvidence,
    context,
  }, db);
}
