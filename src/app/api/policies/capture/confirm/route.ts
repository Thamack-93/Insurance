import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError } from "@/lib/auth";
import { writeActivityLog } from "@/lib/activity-log";
import { logError } from "@/lib/logger";
import { assertSameOrigin, checkDistributedRateLimit, getRequestIp, readJsonBody, securityFingerprint } from "@/lib/request-guards";
import { rateLimitResponse, guardErrorResponse } from "@/lib/api-security";
import { parseDateInput } from "@/lib/form-utils";
import { businessToday } from "@/lib/business-dates";
import { assertClientOrganizationAccess, assertPolicyOrganizationAccess } from "@/lib/portfolio-access";
import { assertOrganizationContextInTransaction, requireOrganizationContext, withTenantTransaction } from "@/lib/organization-context";
import { inferClientType, type PolicyPdfCaptureDraft } from "@/lib/policy-pdf-capture.shared";
import { syncAutoCaptureReceipts } from "@/lib/policy-capture-receipts";
import { closeRenewalFollowUp, closeRenewalManualFollowUp } from "@/lib/renewal-followups";
import { Prisma } from "@/generated/prisma/client";
import { convertLegacyPolicyDescription, hasPolicyRiskData, policyRiskDetailsSchema, projectPolicyRiskRelations, riskDetailsFromExisting, summarizePolicyRiskDetails } from "@/lib/policy-risk-details";
import { syncSerialRenewalSuggestionsForTarget } from "@/lib/policy-renewal-match";
import { revalidatePaths } from "@/lib/mutation-utils";
import {
  recordSecurityAccessDenied,
  recordSecurityRateLimit,
  SECURITY_EVENT_TYPES,
} from "@/lib/security-events";

export const runtime = "nodejs";

const confirmSchema = z.object({
  draft: z.object({
    policyNumber: z.string().min(1),
    clientName: z.string().min(1),
    clientType: z.enum(["PERSON", "COMPANY"]).optional(),
    clientEmail: z.string().nullable().optional(),
    clientPhone: z.string().nullable().optional(),
    clientAddress: z.string().nullable().optional(),
    clientRfc: z.string().nullable().optional(),
    clientBirthDate: z.string().nullable().optional(),
    insurerName: z.string().min(1),
    policyType: z.string().min(1),
    startDate: z.string().min(1),
    endDate: z.string().min(1),
    issueDate: z.string().nullable().optional(),
    paymentFrequency: z.string().min(1),
    paymentPlan: z.string().nullable().optional(),
    premiumAmount: z.number(),
    currency: z.string().min(1),
    requestNumber: z.string().nullable().optional(),
    insuredObject: z.string().nullable().optional(),
    riskDetails: z.unknown().optional(),
    beneficiaryInfo: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    sourcePolicyNumber: z.string().nullable().optional(),
    serialNumber: z.string().nullable().optional(),
  }),
  clientId: z.string().min(1),
  insurerId: z.string().min(1),
  sourcePolicyId: z.string().trim().min(1).nullable().optional(),
  receiptPlan: z
    .array(
      z.object({
        receiptNumber: z.string().min(1),
        amount: z.number(),
      }),
    )
    .optional(),
  receiptEvidence: z.object({
    policyNumber: z.string().nullable(),
    receiptControlNumber: z.string().nullable(),
    dueDate: z.string().nullable(),
    periodLabel: z.string().nullable(),
    amountDue: z.number().nullable(),
    depositAmount: z.number().nullable(),
    currency: z.string(),
    paymentMethod: z.string().nullable(),
    paymentConfirmed: z.literal(false),
    warnings: z.array(z.string()),
  }).nullable().optional(),
});

function normalizeDraft(draft: z.infer<typeof confirmSchema>["draft"]): PolicyPdfCaptureDraft {
  const parsedRiskDetails = policyRiskDetailsSchema.safeParse(draft.riskDetails);
  return {
    policyNumber: draft.policyNumber.trim(),
    clientName: draft.clientName.trim(),
    clientType: draft.clientType ?? inferClientType(draft.clientName, draft.clientRfc ?? null),
    clientEmail: draft.clientEmail?.trim() || null,
    clientPhone: draft.clientPhone?.trim() || null,
    clientAddress: draft.clientAddress?.trim() || null,
    clientRfc: draft.clientRfc?.trim() || null,
    clientBirthDate: draft.clientBirthDate?.trim() || null,
    insurerName: draft.insurerName.trim(),
    policyType: draft.policyType.trim(),
    startDate: draft.startDate.trim(),
    endDate: draft.endDate.trim(),
    issueDate: draft.issueDate ?? null,
    paymentFrequency: draft.paymentFrequency.trim().toUpperCase(),
    paymentPlan: draft.paymentPlan?.trim() || null,
    premiumAmount: draft.premiumAmount,
    currency: draft.currency.trim().toUpperCase(),
    requestNumber: draft.requestNumber?.trim() || null,
    insuredObject: draft.insuredObject?.trim() || null,
    riskDetails: parsedRiskDetails.success ? parsedRiskDetails.data : null,
    beneficiaryInfo: draft.beneficiaryInfo?.trim() || null,
    notes: draft.notes?.trim() || null,
    sourcePolicyNumber: draft.sourcePolicyNumber?.trim() || null,
    serialNumber: draft.serialNumber?.trim() || null,
  };
}

function buildCaptureNotes(draft: PolicyPdfCaptureDraft, existingNotes: string | null) {
  const captureNotes = [
    "Capturada desde PDF.",
    draft.requestNumber ? `Solicitud ${draft.requestNumber}` : null,
    draft.issueDate ? `Emisión ${draft.issueDate}` : null,
    draft.sourcePolicyNumber ? `Renueva ${draft.sourcePolicyNumber}` : null,
    draft.serialNumber ? `Serie ${draft.serialNumber}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const baseNotes = draft.notes ? `${draft.notes}` : "";
  const nextNotes = [baseNotes, captureNotes].filter(Boolean).join(baseNotes ? "\n" : "");
  const merged = [existingNotes?.trim() ?? "", nextNotes.trim()].filter(Boolean).join(existingNotes ? "\n" : "");
  return merged || null;
}

export async function POST(request: NextRequest) {
  try {
    let context: Awaited<ReturnType<typeof requireOrganizationContext>>;
    try {
      context = await requireOrganizationContext();
    } catch (error) {
      if (error instanceof AuthError) {
        await recordSecurityAccessDenied({
          alertType: SECURITY_EVENT_TYPES.accessDenied,
          title: "Confirmación de captura sin sesión válida",
          description: "Se intentó confirmar una captura de póliza sin sesión válida.",
          severity: "WARNING",
          entityType: "SecurityEvent",
          entityId: "policy-capture-confirm:auth",
        });
        return NextResponse.json({ error: "No autorizado." }, { status: 401 });
      }
      throw error;
    }

    try {
      assertSameOrigin(request, "policy pdf capture confirm");
    } catch {
      await recordSecurityAccessDenied({
        alertType: SECURITY_EVENT_TYPES.sameOriginBlocked,
        title: "Confirmación de captura bloqueada por same-origin",
        description: "Se intentó confirmar una captura de póliza desde un origen no permitido.",
        severity: "WARNING",
        entityType: "SecurityEvent",
        entityId: "policy-capture-confirm:same-origin",
      });
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
    const rateLimit = await checkDistributedRateLimit(`policy-pdf-confirm:${securityFingerprint(`ip:${getRequestIp(request)}`)}:${context.userId}`, {
      limit: 6,
      windowMs: 15 * 60 * 1000,
      requireDistributed: true,
    });
    if (!rateLimit.allowed) {
      await recordSecurityRateLimit({
        alertType: SECURITY_EVENT_TYPES.rateLimitedRequest,
        title: "Límite de confirmaciones de captura alcanzado",
        description: "Se bloqueó una confirmación de captura por exceso de intentos.",
        severity: "WARNING",
        entityType: "SecurityEvent",
        entityId: "policy-capture-confirm:rate-limit",
      });
      return rateLimitResponse(rateLimit, "Demasiados intentos. Espera un momento e inténtalo de nuevo.");
    }

    const payload = confirmSchema.parse(await readJsonBody(request, 64 * 1024));
    const draft = normalizeDraft(payload.draft);
    const parsedBirthDate = draft.clientType === "PERSON" && draft.clientBirthDate ? parseDateInput(draft.clientBirthDate) : null;
    if (draft.clientBirthDate && (!parsedBirthDate || Number.isNaN(parsedBirthDate.getTime()) || parsedBirthDate > businessToday())) {
      return NextResponse.json({ error: "La fecha de nacimiento no es válida." }, { status: 400 });
    }
    try {
      await assertClientOrganizationAccess(payload.clientId, context);
    if (payload.sourcePolicyId) await assertPolicyOrganizationAccess(payload.sourcePolicyId, context);
    } catch (error) {
      if (error instanceof AuthError) {
        await recordSecurityAccessDenied({
          alertType: SECURITY_EVENT_TYPES.accessDenied,
          title: "Confirmación de captura sin acceso a cartera",
          description: "Se intentó confirmar una captura de póliza fuera de la cartera permitida.",
          severity: "WARNING",
          entityType: "SecurityEvent",
          entityId: `policy-capture-confirm:portfolio:${payload.sourcePolicyId ?? "unlinked"}`,
          userId: context.userId,
        });
        return NextResponse.json({ error: "No tienes acceso a esta póliza." }, { status: error.status });
      }
      throw error;
    }

    const insurer = await withTenantTransaction(context, (tx) => tx.insurer.findFirst({
      where: { id: payload.insurerId, organizationId: context.organizationId },
      select: { id: true, name: true },
    }));

    if (!insurer) {
      return NextResponse.json({ error: "La aseguradora seleccionada ya no existe." }, { status: 404 });
    }

    const sourcePolicy = payload.sourcePolicyId ? await withTenantTransaction(context, (tx) => tx.policy.findFirst({
      where: { id: payload.sourcePolicyId!, organizationId: context.organizationId },
      select: {
        id: true,
        policyNumber: true,
        familyRootId: true,
        status: true,
        clientId: true,
        insurerId: true,
        policyType: true,
        insuredObject: true,
        beneficiaryInfo: true,
        riskDetails: true,
        insuredAssets: { select: { description: true, serialNumber: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
        insuredParties: { select: { fullName: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] },
      },
    })) : null;

    if (payload.sourcePolicyId && !sourcePolicy) {
      return NextResponse.json({ error: "La póliza origen ya no existe." }, { status: 404 });
    }

    if (sourcePolicy && draft.policyNumber === sourcePolicy.policyNumber) {
      return NextResponse.json(
        { error: "La póliza nueva debe tener un número distinto a la póliza renovada." },
        { status: 400 },
      );
    }

    if (sourcePolicy && payload.clientId !== sourcePolicy.clientId) {
      return NextResponse.json(
        { error: "La póliza origen debe pertenecer al mismo cliente." },
        { status: 400 },
      );
    }
    if (sourcePolicy && payload.insurerId !== sourcePolicy.insurerId) {
      return NextResponse.json(
        { error: "Para cambiar de aseguradora, confirma una sugerencia vigente por serie/VIN desde Renovaciones." },
        { status: 400 },
      );
    }

    const targetStartDate = parseDateInput(draft.startDate);
    const targetEndDate = parseDateInput(draft.endDate);

    const result = await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);
      const [currentSource, currentInsurer] = await Promise.all([
        sourcePolicy ? tx.policy.findFirst({ where: { id: sourcePolicy.id, organizationId: context.organizationId }, select: { id: true, clientId: true, insurerId: true, status: true, renewals: { select: { id: true } } } }) : Promise.resolve(null),
        tx.insurer.findFirst({ where: { id: insurer.id, organizationId: context.organizationId }, select: { id: true } }),
      ]);
      if ((sourcePolicy && (!currentSource
        || currentSource.clientId !== payload.clientId
        || currentSource.insurerId !== payload.insurerId
        )) || !currentInsurer) {
        throw new AuthError("TENANT_RELATION_MISMATCH", 409);
      }
      const existingTarget = await tx.policy.findFirst({
        where: {
          organizationId: context.organizationId,
          policyNumber: draft.policyNumber,
          clientId: payload.clientId,
          insurerId: payload.insurerId,
          startDate: targetStartDate,
          endDate: targetEndDate,
        },
        select: { id: true, notes: true, familyRootId: true, renewedFromPolicyId: true },
      });

      if (currentSource?.status === "RENEWED"
        && !currentSource.renewals.some((renewal) => renewal.id === existingTarget?.id)) {
        throw new Error("La póliza origen ya tiene una renovación vinculada.");
      }

      if (sourcePolicy && existingTarget?.renewedFromPolicyId && existingTarget.renewedFromPolicyId !== sourcePolicy.id) {
        throw new Error("La póliza capturada ya está vinculada con otra póliza origen.");
      }

      const familyRootId = sourcePolicy
        ? sourcePolicy.familyRootId ?? sourcePolicy.id
        : existingTarget?.familyRootId ?? null;
      const captureDraft = {
        ...draft,
        sourcePolicyNumber: draft.sourcePolicyNumber ?? sourcePolicy?.policyNumber ?? null,
      } satisfies PolicyPdfCaptureDraft;
      const parsedRisk = riskDetailsFromExisting(
        captureDraft.policyType,
        captureDraft.riskDetails,
        captureDraft.insuredObject,
        [],
        [],
        captureDraft.beneficiaryInfo,
      ) ?? convertLegacyPolicyDescription(captureDraft.policyType, captureDraft.insuredObject, captureDraft.serialNumber).riskDetails;
      const sourceRiskCandidate = sourcePolicy?.policyType === captureDraft.policyType
        ? riskDetailsFromExisting(sourcePolicy.policyType, sourcePolicy.riskDetails, sourcePolicy.insuredObject, sourcePolicy.insuredAssets, sourcePolicy.insuredParties, sourcePolicy.beneficiaryInfo)
        : null;
      const riskDetails = parsedRisk && hasPolicyRiskData(parsedRisk)
        ? parsedRisk
        : sourceRiskCandidate && hasPolicyRiskData(sourceRiskCandidate)
          ? sourceRiskCandidate
          : null;
      const riskSummary = summarizePolicyRiskDetails(riskDetails);
      const notes = buildCaptureNotes(captureDraft, existingTarget?.notes ?? null);

      const selectedClient = await tx.client.findFirst({
        where: { id: payload.clientId, organizationId: context.organizationId },
        select: { id: true, type: true, birthDate: true },
      });

      if (selectedClient?.type === "PERSON" && parsedBirthDate) {
        if (!selectedClient.birthDate) {
          const updatedClient = await tx.client.update({
            where: { id: selectedClient.id, organizationId: context.organizationId },
            data: { birthDate: parsedBirthDate, updatedById: context.userId },
            select: { id: true, birthDate: true },
          });
          await writeActivityLog({
            organizationId: context.organizationId,
            entityType: "Client",
            entityId: selectedClient.id,
            action: "CLIENT_BIRTHDATE_CONFIRMED_FROM_PDF",
            oldValue: { birthDate: null },
            newValue: { birthDate: updatedClient.birthDate, source: "PDF", policyId: sourcePolicy?.id ?? null },
            userId: context.userId,
            db: tx,
          });
        } else if (selectedClient.birthDate.getTime() !== parsedBirthDate.getTime()) {
          await writeActivityLog({
            organizationId: context.organizationId,
            entityType: "Client",
            entityId: selectedClient.id,
            action: "CLIENT_BIRTHDATE_CONFLICT_FROM_PDF",
            oldValue: { birthDate: selectedClient.birthDate },
            newValue: { birthDate: parsedBirthDate, source: "PDF", policyId: sourcePolicy?.id ?? null },
            userId: context.userId,
            db: tx,
          });
        }
      }

      const policyData = {
        policyNumber: captureDraft.policyNumber,
        clientId: payload.clientId,
        insurerId: payload.insurerId,
        policyType: captureDraft.policyType,
        status: "ACTIVE" as const,
        organizationId: context.organizationId,
        startDate: targetStartDate,
        endDate: targetEndDate,
        premiumAmount: captureDraft.premiumAmount,
        currency: captureDraft.currency,
        paymentFrequency: captureDraft.paymentFrequency,
        paymentPlan: captureDraft.paymentPlan,
        insuredObject: riskSummary ?? captureDraft.insuredObject,
        riskDetails: riskDetails ? riskDetails as Prisma.InputJsonValue : Prisma.DbNull,
        riskDetailsReviewRequired: !riskDetails && Boolean(captureDraft.insuredObject?.trim()),
        beneficiaryInfo: captureDraft.beneficiaryInfo,
        notes,
        familyRootId,
        renewedFromPolicyId: sourcePolicy?.id ?? existingTarget?.renewedFromPolicyId ?? null,
        updatedById: context.userId,
      };

      const targetPolicy = existingTarget
        ? await tx.policy.update({
            where: { id: existingTarget.id, organizationId: context.organizationId },
            data: policyData,
          })
        : await tx.policy.create({
          data: {
              ...policyData,
              organizationId: context.organizationId,
              createdById: context.userId,
            },
          });

      await tx.policyInsuredParty.deleteMany({ where: { organizationId: context.organizationId, policyId: targetPolicy.id } });
      await tx.policyInsuredAsset.deleteMany({ where: { organizationId: context.organizationId, policyId: targetPolicy.id } });
      const riskRelations = projectPolicyRiskRelations(riskDetails);
      const insuredParties = riskRelations.insuredParties.length
        ? riskRelations.insuredParties
        : [{ fullName: captureDraft.clientName, isPrimary: true, sourceLabel: "Captura PDF" }];
      await tx.policyInsuredParty.createMany({
        data: insuredParties.map((party) => ({ ...party, organizationId: context.organizationId, policyId: targetPolicy.id })),
      });

      if (riskRelations.assets.length) {
        await tx.policyInsuredAsset.createMany({
          data: riskRelations.assets.map((asset) => ({ ...asset, organizationId: context.organizationId, policyId: targetPolicy.id })),
        });
      } else if (captureDraft.policyType === "AUTO" && captureDraft.serialNumber) {
        await tx.policyInsuredAsset.create({
          data: {
            organizationId: context.organizationId,
            policyId: targetPolicy.id,
            assetType: captureDraft.policyType,
            description: captureDraft.insuredObject ?? captureDraft.clientName,
            serialNumber: captureDraft.serialNumber,
            isPrimary: true,
          },
        });
      }

      const autoReceiptResults = await syncAutoCaptureReceipts(tx, {
        organizationId: context.organizationId,
        policyId: targetPolicy.id,
        clientId: payload.clientId,
        insurerId: payload.insurerId,
        draft: captureDraft,
        userId: context.userId,
        receiptPlan: payload.receiptPlan,
        receiptEvidence: payload.receiptEvidence ?? null,
      });

      for (const autoReceiptResult of autoReceiptResults) {
        await writeActivityLog({
          organizationId: context.organizationId,
          entityType: "Receipt",
          entityId: autoReceiptResult.receipt.id,
          action: autoReceiptResult.created ? "RECEIPT_CREATE_CAPTURE_PDF" : "RECEIPT_UPDATE_CAPTURE_PDF",
          newValue: autoReceiptResult.receipt,
          userId: context.userId,
          db: tx,
        });
      }

      if (sourcePolicy && sourcePolicy.status !== "RENEWED") {
        await tx.policy.update({
          where: { id: sourcePolicy.id, organizationId: context.organizationId },
          data: { status: "RENEWED", updatedById: context.userId },
        });
      }
      if (sourcePolicy) {
        await closeRenewalFollowUp(context.organizationId, sourcePolicy.id, context.userId, tx);
        const manualFollowUp = await closeRenewalManualFollowUp(context.organizationId, sourcePolicy.id, context.userId, tx);
        if (manualFollowUp) {
          await writeActivityLog({
            organizationId: context.organizationId,
            entityType: "Policy",
            entityId: sourcePolicy.id,
            action: "RENEWAL_FOLLOWUP_CLOSED_TERMINAL",
            newValue: { status: "RENEWED" },
            userId: context.userId,
            db: tx,
          });
        }
      }

      await writeActivityLog({
        organizationId: context.organizationId,
        entityType: "Policy",
        entityId: targetPolicy.id,
        action: existingTarget ? "POLICY_CAPTURE_PDF_UPDATE" : "POLICY_CAPTURE_PDF_CREATE",
        oldValue: existingTarget ?? undefined,
        newValue: {
          ...targetPolicy,
          sourcePolicyId: sourcePolicy?.id ?? null,
          sourcePolicyNumber: sourcePolicy?.policyNumber ?? null,
          serialNumber: captureDraft.serialNumber,
          capturedFromPdf: true,
        },
        userId: context.userId,
        db: tx,
      });

      if (!sourcePolicy) await syncSerialRenewalSuggestionsForTarget(tx, context.organizationId, targetPolicy.id);

      if (sourcePolicy) {
        await writeActivityLog({
          organizationId: context.organizationId,
          entityType: "Policy",
          entityId: sourcePolicy.id,
          action: "POLICY_MARK_RENEWED_FROM_PDF",
          oldValue: { status: sourcePolicy.status },
          newValue: { status: "RENEWED", renewedByPolicyId: targetPolicy.id },
          userId: context.userId,
          db: tx,
        });
      }

      return {
        targetPolicy,
        receiptId: autoReceiptResults[0]?.receipt.id ?? null,
        receiptIds: autoReceiptResults.map((result) => result.receipt.id),
      };
    });

    revalidatePaths([
      "/receipts",
      "/due-payments",
      ...result.receiptIds.map((receiptId) => `/receipts/${receiptId}`),
      `/policies/${result.targetPolicy.id}`,
      `/clients/${payload.clientId}`,
      "/dashboard",
      "/today",
      "/portfolio",
      "/renewals",
      "/operations",
      "/tasks",
      "/activity",
      "/risks",
      "/data-quality",
    ]);

    return NextResponse.json({
      success: true,
      policyId: result.targetPolicy.id,
      receiptId: result.receiptId,
      receiptIds: result.receiptIds,
      redirectTo: `/policies/${result.targetPolicy.id}`,
      message: payload.sourcePolicyId
        ? "Póliza capturada, recibos generados y renovación vinculada."
        : "Póliza capturada y recibos generados.",
    });
  } catch (error) {
    if (error instanceof Error && "status" in error) return guardErrorResponse(error);
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
    }
    logError("api.policies.capture.confirm", error);
    return NextResponse.json({ error: "No se pudo confirmar la captura." }, { status: 500 });
  }
}
