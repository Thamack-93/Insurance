import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { AuthError, requireUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { writeActivityLog } from "@/lib/activity-log";
import { logError } from "@/lib/logger";
import { assertSameOrigin, checkRateLimit, getRequestIp } from "@/lib/request-guards";
import { parseDateInput } from "@/lib/form-utils";
import { assertClientPortfolioAccess, assertPolicyPortfolioAccess } from "@/lib/portfolio-access";
import type { PolicyPdfCaptureDraft } from "@/lib/policy-pdf-capture.shared";
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
    beneficiaryInfo: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
    sourcePolicyNumber: z.string().nullable().optional(),
    serialNumber: z.string().nullable().optional(),
  }),
  clientId: z.string().min(1),
  insurerId: z.string().min(1),
  sourcePolicyId: z.string().min(1),
});

function normalizeDraft(draft: z.infer<typeof confirmSchema>["draft"]): PolicyPdfCaptureDraft {
  return {
    policyNumber: draft.policyNumber.trim(),
    clientName: draft.clientName.trim(),
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
    let user: Awaited<ReturnType<typeof requireUser>>;
    try {
      user = await requireUser();
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
    const rateLimit = checkRateLimit(`policy-pdf-confirm:${getRequestIp(request)}`, {
      limit: 6,
      windowMs: 15 * 60 * 1000,
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
      return NextResponse.json(
        { error: "Demasiados intentos. Espera un momento e inténtalo de nuevo." },
        {
          status: 429,
          headers: { "Retry-After": String(Math.max(1, Math.ceil(rateLimit.retryAfterMs / 1000))) },
        },
      );
    }

    const payload = confirmSchema.parse(await request.json());
    const draft = normalizeDraft(payload.draft);
    const db = getDb();

    try {
      await assertClientPortfolioAccess(payload.clientId, user.id);
      await assertPolicyPortfolioAccess(payload.sourcePolicyId, user.id);
    } catch (error) {
      if (error instanceof AuthError) {
        await recordSecurityAccessDenied({
          alertType: SECURITY_EVENT_TYPES.accessDenied,
          title: "Confirmación de captura sin acceso a cartera",
          description: "Se intentó confirmar una captura de póliza fuera de la cartera permitida.",
          severity: "WARNING",
          entityType: "SecurityEvent",
          entityId: `policy-capture-confirm:portfolio:${payload.sourcePolicyId}`,
          userId: user.id,
        });
        return NextResponse.json({ error: "No tienes acceso a esta póliza." }, { status: error.status });
      }
      throw error;
    }

    const insurer = await db.insurer.findUnique({
      where: { id: payload.insurerId },
      select: { id: true, name: true },
    });

    if (!insurer) {
      return NextResponse.json({ error: "La aseguradora seleccionada ya no existe." }, { status: 404 });
    }

    const sourcePolicy = await db.policy.findUnique({
      where: { id: payload.sourcePolicyId },
      select: {
        id: true,
        policyNumber: true,
        familyRootId: true,
        status: true,
        clientId: true,
        insurerId: true,
        policyType: true,
      },
    });

    if (!sourcePolicy) {
      return NextResponse.json({ error: "La póliza origen ya no existe." }, { status: 404 });
    }

    if (draft.policyNumber === sourcePolicy.policyNumber) {
      return NextResponse.json(
        { error: "La póliza nueva debe tener un número distinto a la póliza renovada." },
        { status: 400 },
      );
    }

    if (payload.clientId !== sourcePolicy.clientId || payload.insurerId !== sourcePolicy.insurerId) {
      return NextResponse.json(
        { error: "La póliza nueva debe conservar el mismo cliente y aseguradora de la póliza renovada." },
        { status: 400 },
      );
    }

    const targetStartDate = parseDateInput(draft.startDate);
    const targetEndDate = parseDateInput(draft.endDate);

    const result = await db.$transaction(async (tx) => {
      const existingTarget = await tx.policy.findFirst({
        where: {
          policyNumber: draft.policyNumber,
          clientId: payload.clientId,
          insurerId: payload.insurerId,
          startDate: targetStartDate,
          endDate: targetEndDate,
        },
        select: { id: true, notes: true },
      });

      const familyRootId = sourcePolicy.familyRootId ?? sourcePolicy.id;
      const captureDraft = {
        ...draft,
        sourcePolicyNumber: draft.sourcePolicyNumber ?? sourcePolicy.policyNumber,
      } satisfies PolicyPdfCaptureDraft;
      const notes = buildCaptureNotes(captureDraft, existingTarget?.notes ?? null);

      const policyData = {
        policyNumber: captureDraft.policyNumber,
        clientId: payload.clientId,
        insurerId: payload.insurerId,
        policyType: captureDraft.policyType,
        status: "ACTIVE",
        startDate: targetStartDate,
        endDate: targetEndDate,
        premiumAmount: captureDraft.premiumAmount,
        currency: captureDraft.currency,
        paymentFrequency: captureDraft.paymentFrequency,
        paymentPlan: captureDraft.paymentPlan,
        insuredObject: captureDraft.insuredObject,
        beneficiaryInfo: captureDraft.beneficiaryInfo,
        notes,
        familyRootId,
        renewedFromPolicyId: sourcePolicy.id,
        updatedById: user.id,
      };

      const targetPolicy = existingTarget
        ? await tx.policy.update({
            where: { id: existingTarget.id },
            data: policyData,
          })
        : await tx.policy.create({
            data: {
              ...policyData,
              createdById: user.id,
            },
          });

      await tx.policyInsuredParty.deleteMany({ where: { policyId: targetPolicy.id } });
      await tx.policyInsuredAsset.deleteMany({ where: { policyId: targetPolicy.id } });
      await tx.policyInsuredParty.create({
        data: {
          policyId: targetPolicy.id,
          fullName: captureDraft.clientName,
          isPrimary: true,
          sourceLabel: "Captura PDF",
        },
      });

      if (captureDraft.policyType === "AUTO" && captureDraft.serialNumber) {
        await tx.policyInsuredAsset.create({
          data: {
            policyId: targetPolicy.id,
            assetType: captureDraft.policyType,
            description: captureDraft.insuredObject ?? captureDraft.clientName,
            serialNumber: captureDraft.serialNumber,
            isPrimary: true,
          },
        });
      }

      if (sourcePolicy.status !== "RENEWED") {
        await tx.policy.update({
          where: { id: sourcePolicy.id },
          data: { status: "RENEWED", updatedById: user.id },
        });
      }

      await writeActivityLog({
        entityType: "Policy",
        entityId: targetPolicy.id,
        action: existingTarget ? "POLICY_CAPTURE_PDF_UPDATE" : "POLICY_CAPTURE_PDF_CREATE",
        oldValue: existingTarget ?? undefined,
        newValue: {
          ...targetPolicy,
          sourcePolicyId: sourcePolicy.id,
          sourcePolicyNumber: sourcePolicy.policyNumber,
          serialNumber: captureDraft.serialNumber,
          capturedFromPdf: true,
        },
        userId: user.id,
        db: tx,
      });

      await writeActivityLog({
        entityType: "Policy",
        entityId: sourcePolicy.id,
        action: "POLICY_MARK_RENEWED_FROM_PDF",
        oldValue: { status: sourcePolicy.status },
        newValue: { status: "RENEWED", renewedByPolicyId: targetPolicy.id },
        userId: user.id,
        db: tx,
      });

      return targetPolicy;
    });

    return NextResponse.json({
      success: true,
      policyId: result.id,
      redirectTo: `/policies/${result.id}`,
      message: "Póliza capturada y marcada como renovada.",
    });
  } catch (error) {
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
