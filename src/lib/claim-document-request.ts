/**
 * Prepare a claim-document request for a HUMAN to review and send.
 * This module has no network calls, storage writes or automatic messaging.
 */
export type ClaimDocumentRequest = {
  clientName: string;
  claimReference: string;
  outstandingDocuments: readonly string[];
};

export function formatClaimDocumentRequest(input: ClaimDocumentRequest): string {
  const client = input.clientName.trim();
  const reference = input.claimReference.trim();
  const documents = [...new Set(input.outstandingDocuments.map((item) => item.trim()).filter(Boolean))];
  if (!documents.length) return "";
  const greeting = client ? `Hola ${client},` : "Hola,";
  const claim = reference ? ` para el siniestro ${reference}` : " para tu siniestro";
  return [
    greeting,
    "",
    `Para continuar con el seguimiento${claim}, necesitamos los siguientes documentos:`,
    ...documents.map((document, index) => `${index + 1}. ${document}`),
    "",
    "¿Nos puedes ayudar a compartirlos? Muchas gracias.",
  ].join("\n");
}

/** Construct a manual WhatsApp compose link; opening it never sends the message. */
export function manualClaimWhatsAppLink(phone: string, message: string): string | null {
  const digits = phone.replace(/[\s()+.-]/g, "");
  if (!/^\d{8,15}$/.test(digits) || !message.trim()) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}
