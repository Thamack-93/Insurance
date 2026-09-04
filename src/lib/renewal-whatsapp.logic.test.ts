import { describe, expect, it } from "vitest";
import { buildRenewalQuoteShareMessage, buildRenewalWhatsAppContactMessage, isRenewalWhatsAppEligible, MAX_RENEWAL_QUOTE_PDF_BYTES, validateRenewalQuotePdf } from "./renewal-whatsapp";

const renewal = { clientName: "Ana Pérez", policyNumber: "POL-123", insurerName: "Aseguradora Demo", endDate: "2026-12-31" };

describe("renewal WhatsApp handoff messages", () => {
  it("builds the exact contact message", () => {
    expect(buildRenewalWhatsAppContactMessage(renewal)).toBe("Hola, Ana Pérez. Te escribo para dar seguimiento a la renovación de tu póliza POL-123 de Aseguradora Demo, con vencimiento el 31/12/2026. Si quieres, revisamos juntos la renovación.");
  });

  it("builds the exact quotation message", () => {
    expect(buildRenewalQuoteShareMessage(renewal)).toBe("Hola, Ana Pérez. Te comparto la cotización para la renovación de tu póliza POL-123 de Aseguradora Demo, con vencimiento el 31/12/2026. Quedo atento para revisar contigo cualquier duda.");
  });
});

describe("renewal quotation file handoff", () => {
  it("accepts only PDFs up to 15 MB", () => {
    expect(validateRenewalQuotePdf({ type: "application/pdf", name: "quote.pdf", size: MAX_RENEWAL_QUOTE_PDF_BYTES })).toBeNull();
    expect(validateRenewalQuotePdf({ type: "text/plain", name: "quote.txt", size: 10 })).toBe("Selecciona un archivo PDF.");
    expect(validateRenewalQuotePdf({ type: "application/octet-stream", name: "quote.pdf", size: MAX_RENEWAL_QUOTE_PDF_BYTES + 1 })).toBe("El PDF debe pesar máximo 15 MB.");
  });
});

describe("renewal WhatsApp eligibility", () => {
  for (const stage of ["PENDING", "CONTACTED", "QUOTED"] as const) {
    it(`allows ${stage}`, () => expect(isRenewalWhatsAppEligible({ stage, policyStatus: "ACTIVE", hasSuccessor: false, hasDecision: false })).toBe(true));
  }

  it("rejects terminal and resolved candidates", () => {
    expect(isRenewalWhatsAppEligible({ stage: "WON", policyStatus: "RENEWED", hasSuccessor: true, hasDecision: false })).toBe(false);
    expect(isRenewalWhatsAppEligible({ stage: "LOST", policyStatus: "ACTIVE", hasSuccessor: false, hasDecision: true })).toBe(false);
    expect(isRenewalWhatsAppEligible({ stage: "PENDING", policyStatus: "ACTIVE", hasSuccessor: false, hasDecision: true })).toBe(false);
    expect(isRenewalWhatsAppEligible({ stage: "PENDING", policyStatus: "ACTIVE", hasSuccessor: false, hasDecision: false, latestReceiptStatus: "CANCELLED" })).toBe(false);
  });
});
