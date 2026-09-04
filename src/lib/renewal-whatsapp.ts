import { formatDate } from "@/lib/dates";
import { isTerminalRenewalStage, type RenewalStage } from "@/lib/renewal-board.logic";

export const WHATSAPP_RENEWAL_CONTACT_TEMPLATE = "renewal_contact_v1" as const;
export const WHATSAPP_RENEWAL_QUOTE_TEMPLATE = "renewal_quote_v1" as const;
export const MAX_RENEWAL_QUOTE_PDF_BYTES = 15 * 1024 * 1024;

type RenewalMessageInput = {
  clientName: string;
  policyNumber: string;
  insurerName: string;
  endDate: Date | string;
};

export function buildRenewalWhatsAppContactMessage(input: RenewalMessageInput): string {
  return `Hola, ${input.clientName.trim()}. Te escribo para dar seguimiento a la renovación de tu póliza ${input.policyNumber.trim()} de ${input.insurerName.trim()}, con vencimiento el ${formatDate(input.endDate)}. Si quieres, revisamos juntos la renovación.`;
}

export function buildRenewalQuoteShareMessage(input: RenewalMessageInput): string {
  return `Hola, ${input.clientName.trim()}. Te comparto la cotización para la renovación de tu póliza ${input.policyNumber.trim()} de ${input.insurerName.trim()}, con vencimiento el ${formatDate(input.endDate)}. Quedo atento para revisar contigo cualquier duda.`;
}

export function isRenewalWhatsAppEligible(input: {
  stage: RenewalStage;
  policyStatus: string;
  hasSuccessor: boolean;
  hasDecision: boolean;
  latestReceiptStatus?: string | null;
}): boolean {
  return (
    !isTerminalRenewalStage(input.stage) &&
    input.policyStatus === "ACTIVE" &&
    !input.hasSuccessor &&
    !input.hasDecision &&
    input.latestReceiptStatus !== "CANCELLED"
  );
}

export function validateRenewalQuotePdf(file: { type: string; name: string; size: number }): string | null {
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return "Selecciona un archivo PDF.";
  if (file.size > MAX_RENEWAL_QUOTE_PDF_BYTES) return "El PDF debe pesar máximo 15 MB.";
  return null;
}
