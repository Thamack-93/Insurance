import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError } from "@/lib/auth";
import { requireOrganizationContext } from "@/lib/organization-context";
import { resolveOrganizationCapability } from "@/lib/organization-capabilities";
import { assertSameOrigin, checkDistributedRateLimit, getRequestIp, readJsonBody } from "@/lib/request-guards";
import { rateLimitResponse } from "@/lib/api-security";
import { buildPolicyPdfCapturePreviewFromDraft } from "@/lib/policy-pdf-capture-preview";
import { buildPolicyPdfCaptureFieldConfidence } from "@/lib/policy-pdf-capture.shared";
import type {
  PolicyPdfCaptureAiReview,
  PolicyPdfCaptureDraft,
  PolicyPdfCaptureFieldConfidence,
  PolicyPdfCaptureProvenance,
  PolicyPdfCaptureRelatedDocument,
  PolicyPdfCaptureReceiptEvidence,
} from "@/lib/policy-pdf-capture.shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const text = (max: number) => z.string().trim().max(max);
const nullableText = (max: number) => text(max).nullable();
const confidenceSchema = z.record(z.string(), z.enum(["high", "medium", "low"]));
const draftSchema = z.object({
  policyNumber: text(120),
  clientName: text(500),
  clientType: z.enum(["PERSON", "COMPANY"]),
  clientEmail: nullableText(320),
  clientPhone: nullableText(80),
  clientAddress: nullableText(1_000),
  clientRfc: nullableText(80),
  clientBirthDate: nullableText(40).optional(),
  insurerName: text(500),
  policyType: text(80),
  serialNumber: nullableText(160),
  startDate: text(40),
  endDate: text(40),
  issueDate: nullableText(40),
  paymentFrequency: text(80),
  paymentPlan: nullableText(160),
  premiumAmount: z.number().finite(),
  currency: text(10),
  requestNumber: nullableText(160),
  insuredObject: nullableText(1_000),
  beneficiaryInfo: nullableText(1_000),
  notes: nullableText(1_000),
  sourcePolicyNumber: nullableText(160),
});
const aiReviewSchema = z.object({
  summary: text(1_200),
  warnings: z.array(text(500)).max(20),
  suggestions: z.array(text(500)).max(20),
  corrections: z.array(z.object({
    field: z.enum(["policyNumber", "clientName", "clientType", "clientEmail", "clientPhone", "clientAddress", "clientRfc", "clientBirthDate", "insurerName", "policyType", "serialNumber", "startDate", "endDate", "issueDate", "paymentFrequency", "premiumAmount", "sourcePolicyNumber"]),
    proposedValue: text(500),
    reason: text(700),
    confidence: z.enum(["high", "medium", "low"]),
  })).max(12),
}).nullable().optional();
const provenanceSchema = z.object({
  requestedMode: z.enum(["local", "ai"]).optional(),
  extractionSource: z.enum(["local", "ai"]),
  reviewSource: z.enum(["none", "ai"]),
  aiRunIds: z.array(text(160)).max(10),
  trackingStatus: z.enum(["recorded", "unavailable"]),
  aiAttempted: z.boolean(),
  aiFailureCode: nullableText(120).optional(),
});
const receiptEvidenceSchema = z.object({
  policyNumber: nullableText(80),
  receiptControlNumber: nullableText(80),
  dueDate: nullableText(30),
  periodLabel: nullableText(30),
  amountDue: z.number().finite().nullable(),
  depositAmount: z.number().finite().nullable(),
  currency: text(10),
  paymentMethod: nullableText(80),
  paymentConfirmed: z.literal(false),
  warnings: z.array(text(500)).max(10),
}).nullable().optional();
const relatedDocumentSchema = z.object({
  id: text(160),
  fileName: text(255),
  kind: z.enum(["policy", "receipt", "endorsement", "inciso", "unknown"]),
  source: z.enum(["local", "ai"]),
  policyNumber: nullableText(80),
  warnings: z.array(text(500)).max(10),
});

const correctionSchema = z.object({
  handoffId: text(160),
  request: text(2_000),
  capture: z.object({
    draft: draftSchema,
    fieldConfidence: confidenceSchema.optional(),
    selectedClientId: nullableText(160),
    selectedClientLabel: nullableText(300),
    selectedInsurerId: nullableText(160),
    selectedInsurerLabel: nullableText(300),
    selectedSourcePolicyId: nullableText(160),
    selectedSourcePolicyLabel: nullableText(500),
    warnings: z.array(text(500)).max(20).optional(),
    aiReview: aiReviewSchema,
    provenance: provenanceSchema,
    receiptEvidence: receiptEvidenceSchema,
    relatedDocuments: z.array(relatedDocumentSchema).max(20).optional(),
  }),
});

export async function POST(request: NextRequest) {
  try {
    const context = await requireOrganizationContext();
    const noraCapability = await resolveOrganizationCapability(context.organizationId, "NORA");
    if (!noraCapability.enabled) return NextResponse.json({ error: "Nora no está habilitada para esta organización." }, { status: 403 });
    try {
      assertSameOrigin(request, "policy capture correction");
    } catch {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }

    const rateLimit = await checkDistributedRateLimit(`policy-capture-correction:${getRequestIp(request)}:${context.userId}`, {
      limit: 30,
      windowMs: 60 * 1000,
      requireDistributed: true,
    });
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit, "Demasiadas correcciones. Intenta de nuevo en un momento.");

    const payload = correctionSchema.parse(await readJsonBody(request, 64 * 1024));
    const capture = payload.capture;
    const provenance = capture.provenance as PolicyPdfCaptureProvenance;
    const fieldConfidence = {
      ...buildPolicyPdfCaptureFieldConfidence("", capture.draft as PolicyPdfCaptureDraft),
      ...(capture.fieldConfidence ?? {}),
    } as PolicyPdfCaptureFieldConfidence;
    const preview = await buildPolicyPdfCapturePreviewFromDraft({
      draft: capture.draft as PolicyPdfCaptureDraft,
      fieldConfidence,
      warnings: capture.warnings,
      aiReview: (capture.aiReview ?? null) as PolicyPdfCaptureAiReview | null,
      aiReviewTelemetry: {
        runId: provenance.aiRunIds[0] ?? null,
        trackingStatus: provenance.trackingStatus,
        attempted: provenance.aiAttempted,
      },
      extractionSource: provenance.extractionSource,
      requestedMode: provenance.requestedMode,
      aiRunIds: provenance.aiRunIds,
      trackingStatus: provenance.trackingStatus,
      aiFailureCode: provenance.aiFailureCode ?? null,
      skipAiReview: true,
      receiptEvidence: (capture.receiptEvidence ?? null) as PolicyPdfCaptureReceiptEvidence | null,
      relatedDocuments: capture.relatedDocuments as PolicyPdfCaptureRelatedDocument[] | undefined,
      context: {
        organizationId: context.organizationId,
        portfolioOwnerId: context.membershipRole === "AGENT" ? context.userId : undefined,
        user: { id: context.userId, role: context.membershipRole === "AGENT" ? "AGENT" : "ADMIN" },
      },
    });

    const clientOption = preview.clientOptions.find((option) => option.id === preview.suggestions.clientId);
    const insurerOption = preview.insurerOptions.find((option) => option.id === preview.suggestions.insurerId);
    const sourceOption = preview.sourcePolicyOptions.find((option) => option.id === preview.suggestions.sourcePolicyId);
    const correctedPreview = {
      ...preview,
      draft: {
        ...preview.draft,
        clientName: clientOption?.label ?? preview.draft.clientName,
        insurerName: insurerOption?.label ?? preview.draft.insurerName,
        sourcePolicyNumber: sourceOption?.policyNumber ?? preview.draft.sourcePolicyNumber,
      },
    };

    const changes = [
      preview.suggestions.clientId && preview.suggestions.clientId !== capture.selectedClientId
        ? {
            field: "client" as const,
            label: "Cliente",
            before: capture.selectedClientLabel ?? capture.draft.clientName,
            after: clientOption?.label ?? capture.draft.clientName,
            reason: "Coincidencia normalizada ignorando comas, acentos y sufijos legales.",
          }
        : null,
      preview.suggestions.insurerId && preview.suggestions.insurerId !== capture.selectedInsurerId
        ? {
            field: "insurer" as const,
            label: "Aseguradora",
            before: capture.selectedInsurerLabel ?? capture.draft.insurerName,
            after: insurerOption?.label ?? capture.draft.insurerName,
            reason: "Coincidencia de marca sin confundir aseguradoras que solo comparten palabras genéricas.",
          }
        : null,
      preview.suggestions.sourcePolicyId && preview.suggestions.sourcePolicyId !== capture.selectedSourcePolicyId
        ? {
            field: "sourcePolicy" as const,
            label: "Póliza origen",
            before: capture.selectedSourcePolicyLabel ?? capture.draft.sourcePolicyNumber,
            after: sourceOption?.label ?? capture.draft.sourcePolicyNumber ?? "Sin dato",
            reason: sourceOption?.matchReason ?? "Coincidencia por cliente, serie y vigencia anterior.",
          }
        : null,
    ].filter((change): change is NonNullable<typeof change> => Boolean(change));

    return NextResponse.json({
      success: true,
      correction: {
        handoffId: payload.handoffId,
        preview: correctedPreview,
        changes,
        summary: changes.length > 0
          ? `Encontré ${changes.length} corrección${changes.length === 1 ? "" : "es"} propuesta${changes.length === 1 ? "" : "s"}. Revísalas antes de aplicar al borrador.`
          : "No encontré una corrección inequívoca para aplicar al borrador.",
      },
    });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof z.ZodError) return NextResponse.json({ error: "La propuesta de corrección no es válida." }, { status: 400 });
    return NextResponse.json({ error: "No se pudo revisar la corrección de la captura." }, { status: 500 });
  }
}
