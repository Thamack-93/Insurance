import "server-only";

import { getDb } from "@/lib/db";
import { parseDateInput } from "@/lib/form-utils";
import { normalize } from "@/lib/search-utils";
import { reviewPolicyPdfWithAi } from "@/lib/assistant-ai";
import {
  extractPolicyPdfDraftFromText,
  type PolicyCaptureSourceOption,
  type PolicyPdfCaptureAiReview,
  type PolicyPdfCaptureDraft,
  type PolicyPdfCapturePreview,
} from "@/lib/policy-pdf-capture.shared";
import type { AssistantUser } from "@/lib/assistant-types";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

type DbClient = PrismaClient | Prisma.TransactionClient;

function scoreTextMatch(needle: string, candidate: string) {
  const normalizedNeedle = normalize(needle).trim();
  const normalizedCandidate = normalize(candidate).trim();
  if (!normalizedNeedle || !normalizedCandidate) return 0;
  if (normalizedNeedle === normalizedCandidate) return 100;
  if (normalizedCandidate.includes(normalizedNeedle) || normalizedNeedle.includes(normalizedCandidate)) return 80;

  const needleTokens = normalizedNeedle.split(/\s+/).filter(Boolean);
  const candidateTokens = normalizedCandidate.split(/\s+/).filter(Boolean);
  const matches = needleTokens.filter((token) =>
    candidateTokens.some((candidateToken) => candidateToken.includes(token) || token.includes(candidateToken)),
  );

  return matches.length * 10;
}

async function buildSourcePolicyCandidates(
  db: DbClient,
  draft: PolicyPdfCaptureDraft,
  clientId: string | null,
  insurerId: string | null,
) {
  const candidates: Array<PolicyCaptureSourceOption> = [];
  const exactNumber = draft.sourcePolicyNumber;

  if (draft.serialNumber && draft.policyType === "AUTO") {
    const targetStartDate = draft.startDate ? parseDateInput(draft.startDate) : null;
    const serialPolicies = await db.policy.findMany({
      where: {
        ...(clientId ? { clientId } : {}),
        ...(insurerId ? { insurerId } : {}),
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

  if (exactNumber) {
    const exact = await db.policy.findMany({
      where: {
        policyNumber: exactNumber,
        ...(clientId ? { clientId } : {}),
        ...(insurerId ? { insurerId } : {}),
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

  if (candidates.length === 0 && clientId && insurerId) {
    const fallback = await db.policy.findMany({
      where: {
        clientId,
        insurerId,
        policyType: draft.policyType,
        status: { in: ["ACTIVE", "EXPIRED", "RENEWED"] },
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

export async function buildPolicyPdfCapturePreviewFromText(
  text: string,
  db: DbClient = getDb(),
  user?: AssistantUser | null,
): Promise<PolicyPdfCapturePreview> {
  const draft = extractPolicyPdfDraftFromText(text);
  const warnings: string[] = [];
  const policyNumberSuggestion = draft.sourcePolicyNumber;

  const clientCandidates = draft.clientName
    ? (await db.client.findMany({
        where: { status: { not: "ARCHIVED" } },
        select: { id: true, fullName: true },
        orderBy: { fullName: "asc" },
      }))
        .map((client) => ({ id: client.id, label: client.fullName, score: scoreTextMatch(draft.clientName, client.fullName) }))
        .filter((client) => client.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 5)
        .map(({ id, label }) => ({ id, value: id, label }))
    : [];

  const insurerCandidates = draft.insurerName
    ? (await db.insurer.findMany({
        where: { status: { not: "ARCHIVED" } },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }))
        .map((insurer) => ({ id: insurer.id, label: insurer.name, score: scoreTextMatch(draft.insurerName, insurer.name) }))
        .filter((insurer) => insurer.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 5)
        .map(({ id, label }) => ({ id, value: id, label }))
    : [];

  const suggestedClientId = clientCandidates[0]?.id ?? null;
  const suggestedInsurerId = insurerCandidates[0]?.id ?? null;

  const sourcePolicyCandidates = await buildSourcePolicyCandidates(db, draft, suggestedClientId, suggestedInsurerId);
  const suggestedSourcePolicyId =
    sourcePolicyCandidates.find((policy) => policy.policyNumber === policyNumberSuggestion)?.id ??
    sourcePolicyCandidates[0]?.id ??
    null;

  if (!draft.policyNumber) warnings.push("No pudimos detectar el número de póliza.");
  if (!draft.clientName) warnings.push("No pudimos detectar el asegurado principal.");
  if (!draft.insurerName) warnings.push("No pudimos detectar la aseguradora.");
  if (!draft.startDate || !draft.endDate) warnings.push("No pudimos detectar la vigencia completa.");
  if (draft.policyType === "AUTO" && !draft.serialNumber) {
    warnings.push("No pudimos detectar la serie del vehículo.");
  }
  if (!sourcePolicyCandidates.length && policyNumberSuggestion) {
    warnings.push(`No encontramos una póliza origen para sugerir (${policyNumberSuggestion}).`);
  }
  if (!sourcePolicyCandidates.length && draft.serialNumber) {
    warnings.push(`No encontramos una póliza origen para sugerir con la serie ${draft.serialNumber}.`);
  }
  if (draft.paymentFrequency === "OTHER") {
    warnings.push("La frecuencia no quedó totalmente clara; revisa que sea Anual.");
  }

  const shouldRequestAiReview =
    Boolean(user) &&
    (warnings.length > 0 ||
      clientCandidates.length === 0 ||
      insurerCandidates.length === 0 ||
      sourcePolicyCandidates.length === 0 ||
      draft.paymentFrequency === "OTHER");

  let aiReview: PolicyPdfCaptureAiReview | null = null;
  if (shouldRequestAiReview && user) {
    aiReview = await reviewPolicyPdfWithAi({
      user,
      text,
      draft,
      warnings,
      themeHint: "policy-pdf-review",
    });
  }

  return {
    draft,
    suggestions: {
      clientId: suggestedClientId,
      insurerId: suggestedInsurerId,
      sourcePolicyId: suggestedSourcePolicyId,
    },
    clientOptions: clientCandidates,
    insurerOptions: insurerCandidates,
    sourcePolicyOptions: sourcePolicyCandidates,
    confidence: {
      client: clientCandidates.length > 0,
      insurer: insurerCandidates.length > 0,
      sourcePolicy: Boolean(suggestedSourcePolicyId),
    },
    warnings,
    aiReview,
  } satisfies PolicyPdfCapturePreview;
}
