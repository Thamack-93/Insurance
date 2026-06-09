import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const pdf2jsonState = vi.hoisted(() => ({
  rawText: "",
  error: null as Error | null,
}));

const pdfParseState = vi.hoisted(() => ({
  text: "",
  error: null as Error | null,
}));

vi.mock("pdf2json", () => {
  return {
    default: class MockPdfParser {
      private readonly listeners: Record<string, Array<(payload: unknown) => void>> = {};

      on(event: string, handler: (payload: unknown) => void) {
        this.listeners[event] ??= [];
        this.listeners[event].push(handler);
        return this;
      }

      parseBuffer() {
        if (pdf2jsonState.error) {
          for (const handler of this.listeners.pdfParser_dataError ?? []) {
            handler({ parserError: pdf2jsonState.error });
          }
          return;
        }

        for (const handler of this.listeners.pdfParser_dataReady ?? []) {
          handler({});
        }
      }

      getRawTextContent() {
        return pdf2jsonState.rawText;
      }
    },
  };
});

vi.mock("pdf-parse", () => {
  return {
    PDFParse: class MockPdfParse {
      constructor() {}

      async getText() {
        if (pdfParseState.error) {
          throw pdfParseState.error;
        }

        return { text: pdfParseState.text };
      }

      async destroy() {}
    },
  };
});

import { parsePolicyPdfCapture } from "./policy-pdf-capture";

describe("policy-pdf-capture parser", () => {
  beforeEach(() => {
    pdf2jsonState.rawText = "";
    pdf2jsonState.error = null;
    pdfParseState.text = "";
    pdfParseState.error = null;
  });

  it("falls back to the alternate parser when pdf2json returns no text", async () => {
    pdfParseState.text = `
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

    const draft = await parsePolicyPdfCapture(new Uint8Array([1, 2, 3]));

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
  });

  it("throws NO_TEXT only after both parsers return empty text", async () => {
    await expect(parsePolicyPdfCapture(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({
      code: "NO_TEXT",
      message: "El PDF no tiene texto extraíble. Puede ser una imagen, un escaneo o un archivo sin capa de texto.",
    });
  });

  it("classifies parser failures separately from no-text PDFs", async () => {
    pdf2jsonState.error = new Error("PDF parsing failed");
    pdfParseState.error = new Error("Unexpected parser failure");

    await expect(parsePolicyPdfCapture(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({
      code: "PARSE_FAILURE",
    });
  });

  it("classifies clearly invalid PDFs as INVALID_PDF", async () => {
    pdf2jsonState.error = new Error("Invalid PDF structure");

    await expect(parsePolicyPdfCapture(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({
      code: "INVALID_PDF",
    });
  });
});
