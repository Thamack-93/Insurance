import "server-only";

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
  type PolicyPdfCaptureExistingPolicyMatch,
  scoreCaptureIdentity,
} from "@/lib/policy-pdf-capture.shared";
import type { AssistantUser } from "@/lib/assistant-types";
import { buildPolicyNumberSearchVariants } from "@/lib/policy-number";
import { clientOperationalWhere, policyOperationalWhere } from "@/lib/portfolio-access";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { requireOrganizationContext, withTenantTransaction } from "@/lib/organization-context";

type DbClient = PrismaClient | Prisma.TransactionClient;

type PolicyPdfCapturePreviewContext = {
  portfolioOwnerId?: string;
  organizationId: string;
  user?: AssistantUser | null;
};

function scoreTextMatch(needle: string, candidate: string) {
  return scoreCaptureIdentity(needle, candidate);
}

async function buildSourcePolicyCandidates(
  db: DbClient,
  draft: PolicyPdfCaptureDraft,
  clientId: string | null,
  insurerId: string | null,
  portfolioOwnerId: string | undefined,
  organizationId: string,
) : Promise<{ candidates: Array<PolicyCaptureSourceOption>; suggestedId: string | null }> {
  type SourceRow = {
    id: string;
    clientId: string;
    insurerId: string;
    policyNumber: string;
    startDate: Date;
    endDate: Date;
    status: string;
    client?: { id: string; fullName: string } | null;
    insurer?: { id: string; name: string } | null;
    insuredAssets: Array<{ serialNumber: string | null }>;
  };
  const ranked = new Map<string, { option: PolicyCaptureSourceOption; rank: number; exactNumber: boolean }>();
  const exactNumberVariants = draft.sourcePolicyNumber ? buildPolicyNumberSearchVariants(draft.sourcePolicyNumber) : [];
  const targetStartDate = draft.startDate ? parseDateInput(draft.startDate) : null;

  function addRows(rows: SourceRow[], baseRank: number, exactNumber: boolean) {
    for (const policy of rows) {
      if (policy.policyNumber === draft.policyNumber) continue;
      const clientName = policy.client?.fullName ?? null;
      const insurerName = policy.insurer?.name ?? null;
      const clientScore = policy.client?.id === clientId
        ? 100
        : clientName && draft.clientName
          ? scoreTextMatch(draft.clientName, clientName)
          : 0;
      const insurerScore = policy.insurer?.id === insurerId
        ? 100
        : insurerName && draft.insurerName
          ? scoreTextMatch(draft.insurerName, insurerName)
          : 0;

      // A source from another client is not a valid renewal candidate. If the
      // relation is unavailable (legacy test/row), keep it visible but never
      // let it win over an evidenced match.
      if (clientName && draft.clientName && clientScore === 0) continue;

      const matchReason = exactNumber
        ? "Número de póliza origen"
        : policy.insuredAssets[0]?.serialNumber === draft.serialNumber
          ? "Serie y cliente"
          : "Cliente y vigencia";
      const option: PolicyCaptureSourceOption = {
        id: policy.id,
        value: policy.id,
        label: [
          policy.policyNumber,
          policy.status,
          policy.endDate.toISOString().slice(0, 10),
          clientName,
          insurerName,
          policy.insuredAssets[0]?.serialNumber ? `Serie ${policy.insuredAssets[0].serialNumber}` : null,
        ].filter(Boolean).join(" · "),
        policyNumber: policy.policyNumber,
        startDate: policy.startDate.toISOString().slice(0, 10),
        endDate: policy.endDate.toISOString().slice(0, 10),
        status: policy.status,
        serialNumber: policy.insuredAssets[0]?.serialNumber ?? null,
        clientName,
        insurerName,
        matchReason,
      };
      const rank = baseRank + clientScore * 100 + insurerScore * 10 + policy.endDate.getTime() / 1e12;
      const current = ranked.get(policy.id);
      if (!current || rank > current.rank) ranked.set(policy.id, { option, rank, exactNumber });
    }
  }

  if (draft.serialNumber && draft.policyType === "AUTO") {
    const serialPolicies = await db.policy.findMany({
      where: {
        ...policyOperationalWhere(portfolioOwnerId, organizationId),
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
        clientId: true,
        insurerId: true,
        client: { select: { id: true, fullName: true } },
        insurer: { select: { id: true, name: true } },
        insuredAssets: {
          where: { serialNumber: draft.serialNumber },
          select: {
            serialNumber: true,
          },
          take: 1,
        },
      },
      take: 25,
    });
    addRows(serialPolicies as SourceRow[], 8_000, false);
  }

  if (exactNumberVariants.length > 0) {
    const exact = await db.policy.findMany({
      where: {
        OR: exactNumberVariants.map((variant) => ({ policyNumber: variant })),
        ...policyOperationalWhere(portfolioOwnerId, organizationId),
      },
      orderBy: [{ startDate: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        policyNumber: true,
        startDate: true,
        endDate: true,
        status: true,
        clientId: true,
        insurerId: true,
        client: { select: { id: true, fullName: true } },
        insurer: { select: { id: true, name: true } },
        insuredAssets: {
          select: {
            serialNumber: true,
          },
          take: 1,
        },
      },
      take: 5,
    });
    addRows(exact as SourceRow[], 10_000, true);
  }

  if (ranked.size === 0 && clientId) {
    const fallback = await db.policy.findMany({
      where: {
        ...policyOperationalWhere(portfolioOwnerId, organizationId),
        clientId,
        policyType: draft.policyType,
        status: { in: ["ACTIVE", "EXPIRED", "RENEWED"] },
        ...(targetStartDate ? { endDate: { lt: targetStartDate } } : {}),
      },
      orderBy: [{ endDate: "desc" }, { startDate: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        policyNumber: true,
        startDate: true,
        endDate: true,
        status: true,
        clientId: true,
        insurerId: true,
        client: { select: { id: true, fullName: true } },
        insurer: { select: { id: true, name: true } },
        insuredAssets: {
          select: {
            serialNumber: true,
          },
          take: 1,
        },
      },
      take: 5,
    });
    addRows(fallback as SourceRow[], 2_000, false);
  }

  const ordered = [...ranked.values()].sort((left, right) => right.rank - left.rank);
  const top = ordered[0];
  const second = ordered[1];
  const suggestedId = top && top.option.matchReason !== "Cliente y vigencia" && (top.exactNumber || !second || top.rank - second.rank > 500)
    ? top.option.id
    : null;
  return { candidates: ordered.slice(0, 12).map((entry) => entry.option), suggestedId };
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
  context: PolicyPdfCapturePreviewContext;
};

export async function buildPolicyPdfCapturePreviewFromDraft(
  input: PolicyPdfCapturePreviewInput,
  db?: DbClient,
): Promise<PolicyPdfCapturePreview> {
  if (!db) {
    if (process.env.NODE_ENV === "test") {
      const testDb = (await import("@/lib/db")).getDb() as DbClient;
      return buildPolicyPdfCapturePreviewFromDraft(input, testDb);
    }
    const context = await requireOrganizationContext();
    if (context.organizationId !== input.context.organizationId) throw new Error("ORGANIZATION_CONTEXT_MISMATCH");
    return withTenantTransaction(context, (tx) => buildPolicyPdfCapturePreviewFromDraft(input, tx));
  }
  const { portfolioOwnerId, organizationId, user } = input.context;
  const warnings = [...(input.warnings ?? []), ...(input.extraWarnings ?? [])];
  const policyNumberSuggestion = input.draft.sourcePolicyNumber;
  const policyNumberVariants = buildPolicyNumberSearchVariants(input.draft.policyNumber);
  const existingPolicyRows = policyNumberVariants.length > 0 || Boolean(input.draft.serialNumber)
    ? await db.policy.findMany({
        where: {
          ...policyOperationalWhere(portfolioOwnerId, organizationId),
          OR: [
            ...policyNumberVariants.map((variant) => ({ policyNumber: variant })),
            ...(input.draft.serialNumber
              ? [{ insuredAssets: { some: { serialNumber: input.draft.serialNumber } } }]
              : []),
          ],
        },
        select: {
          id: true,
          policyNumber: true,
          policyType: true,
          premiumAmount: true,
          startDate: true,
          endDate: true,
          status: true,
          client: { select: { fullName: true } },
          insurer: { select: { name: true } },
          insuredAssets: {
            where: input.draft.serialNumber ? { serialNumber: input.draft.serialNumber } : undefined,
            select: { serialNumber: true },
            take: 1,
          },
        },
        orderBy: [{ updatedAt: "desc" }],
        take: 12,
      })
    : [];
  const existingPolicyMatches: PolicyPdfCaptureExistingPolicyMatch[] = existingPolicyRows.flatMap((policy) => {
    if (!policy.client || !policy.insurer || !(policy.startDate instanceof Date) || !(policy.endDate instanceof Date)) return [];
    const differences: string[] = [];
    if (policy.policyType !== input.draft.policyType) differences.push(`tipo: cartera ${policy.policyType}, PDF ${input.draft.policyType}`);
    if (policy.startDate.toISOString().slice(0, 10) !== input.draft.startDate) differences.push(`inicio: cartera ${policy.startDate.toISOString().slice(0, 10)}, PDF ${input.draft.startDate || "sin dato"}`);
    if (policy.endDate.toISOString().slice(0, 10) !== input.draft.endDate) differences.push(`fin: cartera ${policy.endDate.toISOString().slice(0, 10)}, PDF ${input.draft.endDate || "sin dato"}`);
    if (Math.abs(Number(policy.premiumAmount) - input.draft.premiumAmount) > 0.01) differences.push(`prima: cartera ${Number(policy.premiumAmount).toFixed(2)}, PDF ${input.draft.premiumAmount.toFixed(2)}`);
    if (input.draft.clientName && scoreCaptureIdentity(input.draft.clientName, policy.client.fullName) < 100) differences.push(`cliente: cartera ${policy.client.fullName}, PDF ${input.draft.clientName}`);
    if (input.draft.insurerName && scoreCaptureIdentity(input.draft.insurerName, policy.insurer.name) < 100) differences.push(`aseguradora: cartera ${policy.insurer.name}, PDF ${input.draft.insurerName}`);
    const existingSerial = policy.insuredAssets[0]?.serialNumber ?? null;
    if (input.draft.serialNumber && existingSerial && existingSerial !== input.draft.serialNumber) differences.push(`serie: cartera ${existingSerial}, PDF ${input.draft.serialNumber}`);
    return [{
      id: policy.id,
      policyNumber: policy.policyNumber,
      clientName: policy.client.fullName,
      insurerName: policy.insurer.name,
      startDate: policy.startDate.toISOString().slice(0, 10),
      endDate: policy.endDate.toISOString().slice(0, 10),
      status: policy.status,
      serialNumber: existingSerial,
      matchReason: policyNumberVariants.includes(policy.policyNumber) ? "policyNumber" : "serialNumber",
      differences,
    } satisfies PolicyPdfCaptureExistingPolicyMatch];
  });

  const clientMatches = input.draft.clientName
    ? (await db.client.findMany({
        where: {
          status: { not: "ARCHIVED" },
          ...clientOperationalWhere(portfolioOwnerId, organizationId),
        },
        select: { id: true, fullName: true },
        orderBy: { fullName: "asc" },
      }))
        .map((client) => ({ id: client.id, label: client.fullName, score: scoreTextMatch(input.draft.clientName, client.fullName) }))
        .filter((client) => client.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 5)
        .map(({ id, label, score }) => ({ id, value: id, label, score }))
    : [];

  const insurerMatches = input.draft.insurerName
    ? (await db.insurer.findMany({
        where: { status: { not: "ARCHIVED" }, ...(organizationId ? { organizationId } : {}) },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }))
        .map((insurer) => ({ id: insurer.id, label: insurer.name, score: scoreTextMatch(input.draft.insurerName, insurer.name) }))
        .filter((insurer) => insurer.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 5)
        .map(({ id, label, score }) => ({ id, value: id, label, score }))
    : [];

  const clientCandidates = clientMatches.map(({ id, value, label }) => ({ id, value, label }));
  const insurerCandidates = insurerMatches.map(({ id, value, label }) => ({ id, value, label }));
  const suggestedClientId = clientMatches[0] && (!clientMatches[1] || clientMatches[0].score > clientMatches[1].score)
    ? clientMatches[0].id
    : null;
  const suggestedInsurerId = insurerMatches[0] && (!insurerMatches[1] || insurerMatches[0].score > insurerMatches[1].score)
    ? insurerMatches[0].id
    : null;

  const sourcePolicyResult = await buildSourcePolicyCandidates(
    db,
    input.draft,
    suggestedClientId,
    suggestedInsurerId,
    portfolioOwnerId,
    organizationId,
  );
  const sourcePolicyCandidates = sourcePolicyResult.candidates;
  const suggestedSourcePolicyId = policyNumberSuggestion
    ? sourcePolicyCandidates.find((policy) => policy.policyNumber === policyNumberSuggestion)?.id ?? sourcePolicyResult.suggestedId
    : sourcePolicyResult.suggestedId;

  if (!input.draft.policyNumber) warnings.push("No pudimos detectar el número de póliza.");
  if (existingPolicyMatches.length > 0) {
    const matchLabel = existingPolicyMatches
      .map((policy) => `${policy.policyNumber} · ${policy.clientName} · ${policy.insurerName}`)
      .join(" | ");
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
    existingPolicyMatches,
  } satisfies PolicyPdfCapturePreview;
}

export async function buildPolicyPdfCapturePreviewFromText(
  text: string,
  db: DbClient | undefined,
  context: PolicyPdfCapturePreviewContext,
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
