import { DOCUMENT_TYPES, type DocumentType } from "@/lib/domain-values";

export const DOCUMENT_INBOX_ASSOCIATION_TYPES = [
  "CLIENT",
  "POLICY",
  "ENDORSEMENT",
  "RECEIPT",
  "TASK",
  "CLAIM",
] as const;

export type DocumentInboxAssociationType = (typeof DOCUMENT_INBOX_ASSOCIATION_TYPES)[number];

const REQUIRED_ASSOCIATION_BY_DOCUMENT_TYPE: Partial<Record<DocumentType, DocumentInboxAssociationType>> = {
  POLICY: "POLICY",
  RECEIPT: "RECEIPT",
  PAYMENT_PROOF: "RECEIPT",
  ENDORSEMENT: "ENDORSEMENT",
  CLAIM: "CLAIM",
};

export function isDocumentType(value: string): value is DocumentType {
  return (DOCUMENT_TYPES as readonly string[]).includes(value);
}

export function isDocumentInboxAssociationType(value: string): value is DocumentInboxAssociationType {
  return (DOCUMENT_INBOX_ASSOCIATION_TYPES as readonly string[]).includes(value);
}

export function getDocumentInboxAssociationError(
  documentType: string,
  associationType: string,
): string | null {
  if (!isDocumentType(documentType)) return "Selecciona una clasificación válida.";
  if (!isDocumentInboxAssociationType(associationType)) return "Selecciona un expediente válido.";

  const requiredAssociation = REQUIRED_ASSOCIATION_BY_DOCUMENT_TYPE[documentType];
  if (requiredAssociation && requiredAssociation !== associationType) {
    return "La clasificación seleccionada no corresponde al expediente elegido.";
  }

  return null;
}

