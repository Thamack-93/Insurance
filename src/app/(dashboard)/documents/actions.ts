"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { writeActivityLog } from "@/lib/activity-log";
import { AuthError } from "@/lib/auth";
import { DOCUMENT_TYPES } from "@/lib/domain-values";
import { areDocumentFilesEnabled } from "@/lib/deployment";
import { assertOrganizationContextInTransaction, requireOrganizationContext, withTenantTransaction } from "@/lib/organization-context";
import { getDocumentInboxAssociationError, DOCUMENT_INBOX_ASSOCIATION_TYPES } from "@/lib/document-inbox.logic";
import { resolveOrganizationCapability } from "@/lib/organization-capabilities";

export type DocumentInboxActionState =
  | { ok: true; message: string }
  | { ok: false; error: string };

const associationSchema = z.object({
  documentId: z.string().trim().min(1).max(100),
  documentType: z.enum(DOCUMENT_TYPES),
  associationType: z.enum(DOCUMENT_INBOX_ASSOCIATION_TYPES),
  associationId: z.string().trim().min(1).max(100),
});

function parseAssociationReference(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) return null;
  return { associationType: value.slice(0, separator), associationId: value.slice(separator + 1) };
}

type DocumentAssociationFields = {
  clientId: string | null;
  policyId: string | null;
  endorsementId: string | null;
  receiptId: string | null;
  taskId: string | null;
  claimId: string | null;
  quoteId: string | null;
};

const noAssociation: DocumentAssociationFields = {
  clientId: null,
  policyId: null,
  endorsementId: null,
  receiptId: null,
  taskId: null,
  claimId: null,
  quoteId: null,
};

export async function associateInboxDocument(
  _previousState: DocumentInboxActionState | null,
  formData: FormData,
): Promise<DocumentInboxActionState> {
  const association = parseAssociationReference(formData.get("associationRef"));
  const parsed = associationSchema.safeParse({
    documentId: formData.get("documentId"),
    documentType: formData.get("documentType"),
    associationType: association?.associationType,
    associationId: association?.associationId,
  });

  if (!parsed.success) return { ok: false, error: "Revisa la clasificación y el expediente seleccionados." };
  const input = parsed.data;
  const compatibilityError = getDocumentInboxAssociationError(input.documentType, input.associationType);
  if (compatibilityError) return { ok: false, error: compatibilityError };

  try {
    if (!areDocumentFilesEnabled()) return { ok: false, error: "La clasificación de documentos está deshabilitada." };

    const context = await requireOrganizationContext();
    let targetPath = "/documents";
    await withTenantTransaction(context, async (tx) => {
      await assertOrganizationContextInTransaction(tx, context);

      const organization = await tx.organization.findUnique({
        where: { id: context.organizationId },
        select: { kind: true },
      });
      if (organization?.kind === "DEMO") throw new AuthError("DEMO_DOCUMENTS_DISABLED", 403);
      const capability = await resolveOrganizationCapability(context.organizationId, "DOCUMENTS", tx);
      if (!capability.enabled) throw new AuthError("DOCUMENTS_CAPABILITY_DISABLED", 403);

      const document = await tx.document.findFirst({
        where: {
          id: input.documentId,
          organizationId: context.organizationId,
          mimeType: "application/pdf",
          ...noAssociation,
          ...(context.membershipRole === "AGENT" ? { createdById: context.userId } : {}),
        },
        select: { id: true, documentType: true },
      });
      if (!document) throw new AuthError("DOCUMENT_INBOX_NOT_AVAILABLE", 404);

      const portfolioClient = context.membershipRole === "AGENT" ? { portfolioOwnerId: context.userId } : {};
      let relationFields: DocumentAssociationFields = noAssociation;

      switch (input.associationType) {
        case "CLIENT": {
          const client = await tx.client.findFirst({
            where: { id: input.associationId, organizationId: context.organizationId, ...portfolioClient },
            select: { id: true },
          });
          if (!client) throw new AuthError("DOCUMENT_INBOX_TARGET_NOT_AVAILABLE", 404);
          relationFields = { ...noAssociation, clientId: client.id };
          targetPath = `/clients/${client.id}`;
          break;
        }
        case "POLICY": {
          const policy = await tx.policy.findFirst({
            where: { id: input.associationId, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? { client: portfolioClient } : {}) },
            select: { id: true, clientId: true },
          });
          if (!policy) throw new AuthError("DOCUMENT_INBOX_TARGET_NOT_AVAILABLE", 404);
          relationFields = { ...noAssociation, clientId: policy.clientId, policyId: policy.id };
          targetPath = `/policies/${policy.id}`;
          break;
        }
        case "ENDORSEMENT": {
          const endorsement = await tx.policyEndorsement.findFirst({
            where: { id: input.associationId, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? { policy: { client: portfolioClient } } : {}) },
            select: { id: true, policyId: true, policy: { select: { clientId: true } } },
          });
          if (!endorsement) throw new AuthError("DOCUMENT_INBOX_TARGET_NOT_AVAILABLE", 404);
          relationFields = { ...noAssociation, clientId: endorsement.policy.clientId, policyId: endorsement.policyId, endorsementId: endorsement.id };
          targetPath = `/policies/${endorsement.policyId}`;
          break;
        }
        case "RECEIPT": {
          const receipt = await tx.receipt.findFirst({
            where: { id: input.associationId, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? { client: portfolioClient } : {}) },
            select: { id: true, clientId: true, policyId: true },
          });
          if (!receipt) throw new AuthError("DOCUMENT_INBOX_TARGET_NOT_AVAILABLE", 404);
          relationFields = { ...noAssociation, clientId: receipt.clientId, policyId: receipt.policyId, receiptId: receipt.id };
          targetPath = `/receipts/${receipt.id}`;
          break;
        }
        case "TASK": {
          const task = await tx.task.findFirst({
            where: {
              id: input.associationId,
              organizationId: context.organizationId,
              ...(context.membershipRole === "AGENT"
                ? { OR: [{ client: portfolioClient }, { clientId: null, createdById: context.userId }] }
                : {}),
            },
            select: { id: true, clientId: true, policyId: true, receiptId: true },
          });
          if (!task) throw new AuthError("DOCUMENT_INBOX_TARGET_NOT_AVAILABLE", 404);
          relationFields = { ...noAssociation, clientId: task.clientId, policyId: task.policyId, receiptId: task.receiptId, taskId: task.id };
          targetPath = `/tasks/${task.id}`;
          break;
        }
        case "CLAIM": {
          const claim = await tx.claim.findFirst({
            where: { id: input.associationId, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? { client: portfolioClient } : {}) },
            select: { id: true, clientId: true, policyId: true },
          });
          if (!claim) throw new AuthError("DOCUMENT_INBOX_TARGET_NOT_AVAILABLE", 404);
          relationFields = { ...noAssociation, clientId: claim.clientId, policyId: claim.policyId, claimId: claim.id };
          targetPath = `/claims/${claim.id}`;
          break;
        }
        case "QUOTE": {
          const quote = await tx.quote.findFirst({
            where: { id: input.associationId, organizationId: context.organizationId, ...(context.membershipRole === "AGENT" ? { client: portfolioClient } : {}) },
            select: { id: true, clientId: true },
          });
          if (!quote) throw new AuthError("DOCUMENT_INBOX_TARGET_NOT_AVAILABLE", 404);
          relationFields = { ...noAssociation, clientId: quote.clientId, quoteId: quote.id };
          targetPath = `/quotes/${quote.id}`;
          break;
        }
      }

      const updated = await tx.document.updateMany({
        where: {
          id: document.id,
          organizationId: context.organizationId,
          mimeType: "application/pdf",
          ...noAssociation,
          ...(context.membershipRole === "AGENT" ? { createdById: context.userId } : {}),
        },
        data: {
          ...relationFields,
          documentType: input.documentType,
          updatedById: context.userId,
        },
      });
      if (updated.count !== 1) throw new AuthError("DOCUMENT_INBOX_DOCUMENT_CHANGED", 409);
      await writeActivityLog({
        organizationId: context.organizationId,
        entityType: "Document",
        entityId: document.id,
        action: "DOCUMENT_INBOX_CLASSIFY_AND_ASSOCIATE",
        oldValue: { documentType: document.documentType },
        newValue: { documentType: input.documentType, associationType: input.associationType },
        userId: context.userId,
        db: tx,
      });
    });

    revalidatePath("/documents");
    revalidatePath(targetPath);
    return { ok: true, message: "Documento clasificado y asociado." };
  } catch (error) {
    if (error instanceof AuthError) {
      if (error.status === 403) return { ok: false, error: "La asociación no está disponible para esta organización." };
      if (error.status === 404) return { ok: false, error: "El documento o expediente ya no está disponible." };
    }
    return { ok: false, error: "No se pudo asociar el documento. Intenta de nuevo." };
  }
}

