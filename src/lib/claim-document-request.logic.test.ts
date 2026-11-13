import { describe, expect, it } from "vitest";
import { formatClaimDocumentRequest, manualClaimWhatsAppLink } from "@/lib/claim-document-request";

describe("manual claim document requests", () => {
  it("builds a reviewable Spanish request and preserves each unique missing document", () => {
    const message = formatClaimDocumentRequest({
      clientName: " Ana ", claimReference: "SIN-001",
      outstandingDocuments: ["Identificación", " Factura ", "Identificación", "", " Fotografías "],
    });
    expect(message).toContain("Hola Ana,");
    expect(message).toContain("siniestro SIN-001");
    expect(message).toContain("1. Identificación\n2. Factura\n3. Fotografías");
    expect(message.match(/Identificación/g)).toHaveLength(1);
  });
  it("does not propose sending a request when nothing is missing", () => {
    expect(formatClaimDocumentRequest({
      clientName: "Ana", claimReference: "SIN-002", outstandingDocuments: [" ", ""],
    })).toBe("");
  });
  it("only generates a WhatsApp compose link for a valid phone and nonempty message", () => {
    const link = manualClaimWhatsAppLink("+52 (55) 1234-5678", "Hola, ¿nos ayudas?");
    expect(link).toBe("https://wa.me/525512345678?text=Hola%2C%20%C2%BFnos%20ayudas%3F");
    expect(manualClaimWhatsAppLink("123", "Hola")).toBeNull();
    expect(manualClaimWhatsAppLink("+52 55 1234 5678", " ")).toBeNull();
    expect(manualClaimWhatsAppLink("5551234567;evil", "Hola")).toBeNull();
  });
});
