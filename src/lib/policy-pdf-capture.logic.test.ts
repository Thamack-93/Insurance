import { describe, expect, it, vi } from "vitest";
import {
  extractPolicyPdfDraftFromText,
  normalizePdfPaymentFrequencyLabel,
  suggestPreviousPolicyNumber,
} from "@/lib/policy-pdf-capture.shared";
import { buildPolicyPdfCapturePreviewFromText } from "@/lib/policy-pdf-capture-preview";

vi.mock("server-only", () => ({}));

describe("policy-pdf-capture", () => {
  it("suggests the prior renewal policy number", () => {
    expect(suggestPreviousPolicyNumber("19941U01")).toBe("19941U00");
    expect(suggestPreviousPolicyNumber("ABC123")).toBeNull();
  });

  it("normalizes payment frequency labels to readable Spanish", () => {
    expect(normalizePdfPaymentFrequencyLabel("Anual")).toBe("Anual");
    expect(normalizePdfPaymentFrequencyLabel("ANNUAL")).toBe("Anual");
    expect(normalizePdfPaymentFrequencyLabel("Mensual")).toBe("Mensual");
  });

  it("extracts the core renewal fields from the PDF text layout", () => {
    const text = `
      AXA Seguros, S.A. de C.V.
      Póliza 19941U01
      Asegurado titular
      ARELLANO REGINO, ADRIAN YOSEF
      Vigencia 28/05/2026 al 28/05/2027
      Fecha de emisión 22/04/2026
      Frecuencia Anual
      Plan de pago Flex Plus
      Prima anual total $30,266.88
      Solicitud 000013938707
      GMM
    `;

    const draft = extractPolicyPdfDraftFromText(text);

    expect(draft.policyNumber).toBe("19941U01");
    expect(draft.clientName).toBe("ARELLANO REGINO, ADRIAN YOSEF");
    expect(draft.insurerName).toBe("AXA Seguros, S.A. de C.V.");
    expect(draft.policyType).toBe("GMM");
    expect(draft.startDate).toBe("2026-05-28");
    expect(draft.endDate).toBe("2027-05-28");
    expect(draft.issueDate).toBe("2026-04-22");
    expect(draft.paymentFrequency).toBe("ANNUAL");
    expect(draft.paymentPlan).toBe("Flex Plus");
    expect(draft.premiumAmount).toBeCloseTo(30266.88);
    expect(draft.requestNumber).toBe("000013938707");
    expect(draft.insuredObject).toBeNull();
    expect(draft.beneficiaryInfo).toBeNull();
    expect(draft.sourcePolicyNumber).toBe("19941U00");
  });

  it("normalizes plan solicitud headers to GMM", () => {
    const text = `
      AXA Seguros
      Póliza 19941U01
      Ramo DE PLAN SOLICITUD
      Asegurado titular
      ARELLANO REGINO, ADRIAN YOSEF
      Vigencia 28/05/2026 al 28/05/2027
      Prima anual total $30,266.88
    `;

    const draft = extractPolicyPdfDraftFromText(text);

    expect(draft.policyType).toBe("GMM");
  });

  it("extracts the automobile capture fields including serial number", () => {
    const text = `
      PÓLIZA DE SEGURO DE AUTOMÓVILES
      0940451814 000000 0001
      INFORMACIÓN DEL ASEGURADO
      CHARBEL SALOMON MURAD KOPPEL
      DESCRIPCIÓN DEL VEHÍCULO ASEGURADO
      09211 JEEP GRAND CHEROKEE LIMITED LUJO 5P V6 3.6L VP TPA. AUT.
      Tipo: Automoviles Importados Modelo: 2019 Ocupantes: 05
      Serie: 1C4RJEBG3KC602887 Motor: HECHO EN USA Color: Placas: SN
      Vigencia Desde las 12:00 P.M. del 27/MAY/2026 Hasta las 12:00 P.M. del 27/MAY/2027
      Forma de Pago: SEMESTRAL
      IMPORTE TOTAL. 14,324.39
    `;

    const draft = extractPolicyPdfDraftFromText(text);

    expect(draft.policyNumber).toBe("0940451814");
    expect(draft.clientName).toBe("CHARBEL SALOMON MURAD KOPPEL");
    expect(draft.policyType).toBe("AUTO");
    expect(draft.serialNumber).toBe("1C4RJEBG3KC602887");
    expect(draft.insuredObject).toContain("JEEP GRAND CHEROKEE");
    expect(draft.startDate).toBe("2026-05-27");
    expect(draft.endDate).toBe("2027-05-27");
    expect(draft.paymentFrequency).toBe("SEMIANNUAL");
    expect(draft.premiumAmount).toBeCloseTo(14324.39);
    expect(draft.requestNumber).toBeNull();
    expect(draft.sourcePolicyNumber).toBeNull();
  });

  it("builds a preview from extracted PDF text without relying on the server parser", async () => {
    const db = {
      client: {
        findMany: async () => [
          { id: "client-1", fullName: "Maria Fernanda Corral Morales" },
          { id: "client-2", fullName: "Otra Persona" },
        ],
      },
      insurer: {
        findMany: async () => [
          { id: "insurer-1", name: "Quálitas Compañía de Seguros" },
          { id: "insurer-2", name: "Aseguradora Genérica" },
        ],
      },
      policy: {
        findMany: async () => [
          {
            id: "policy-1",
            policyNumber: "50702000465",
            startDate: new Date("2025-02-01T00:00:00.000Z"),
            endDate: new Date("2026-02-01T00:00:00.000Z"),
            status: "EXPIRED",
            insuredAssets: [{ serialNumber: "ABC1234567890" }],
          },
        ],
      },
    } as never;

    const preview = await buildPolicyPdfCapturePreviewFromText(
      `
        Quálitas Compañía de Seguros
        Póliza: 50702000466
        Razón Social o Contratante: Maria Fernanda Corral Morales
        Tipo de seguro: Accidentes Personales
        Vigencia: 01/02/2026 al 01/02/2027
        Prima total $1,234.56
      `,
      db,
    );

    expect(preview.draft.policyNumber).toBe("50702000466");
    expect(preview.draft.clientName).toBe("Maria Fernanda Corral Morales");
    expect(preview.draft.insurerName).toBe("Quálitas Compañía de Seguros");
    expect(preview.draft.startDate).toBe("2026-02-01");
    expect(preview.draft.endDate).toBe("2027-02-01");
    expect(preview.draft.policyType).toBe("ACCIDENTES");
    expect(preview.draft.premiumAmount).toBeCloseTo(1234.56);
    expect(preview.suggestions.clientId).toBe("client-1");
    expect(preview.suggestions.insurerId).toBe("insurer-1");
    expect(preview.warnings).not.toContain("No pudimos detectar el número de póliza.");
  });
});
