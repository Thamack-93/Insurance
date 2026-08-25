import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const extractPdfTextFromBytes = vi.hoisted(() => vi.fn());

vi.mock("@/lib/pdf-text-extraction", () => ({ extractPdfTextFromBytes }));

import { parsePolicyPdfCapture } from "./policy-pdf-capture";

describe("policy-pdf-capture parser", () => {
  beforeEach(() => {
    extractPdfTextFromBytes.mockReset();
  });

  it("uses the shared hardened PDF.js extractor", async () => {
    extractPdfTextFromBytes.mockResolvedValue({
      pageCount: 1,
      text: `
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
      `,
    });

    const draft = await parsePolicyPdfCapture(new Uint8Array([1, 2, 3]));

    expect(extractPdfTextFromBytes).toHaveBeenCalledTimes(1);
    expect(draft).toMatchObject({
      policyNumber: "19941U01",
      clientName: "ARELLANO REGINO, ADRIAN YOSEF",
      insurerName: "AXA Seguros, S.A. de C.V.",
      policyType: "GMM",
      startDate: "2026-05-28",
      endDate: "2027-05-28",
      issueDate: "2026-04-22",
      paymentFrequency: "ANNUAL",
      paymentPlan: "Flex Plus",
      requestNumber: "000013938707",
    });
    expect(draft.premiumAmount).toBeCloseTo(30266.88);
  });

  it("throws NO_TEXT when the shared extractor returns no text", async () => {
    extractPdfTextFromBytes.mockResolvedValue({ pageCount: 1, text: "" });

    await expect(parsePolicyPdfCapture(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({
      code: "NO_TEXT",
      message:
        "El PDF no tiene una capa de texto extraíble. Puede ser una imagen, un escaneo o un PDF con texto inaccesible para el parser.",
    });
  });

  it("classifies parser failures separately from no-text PDFs", async () => {
    extractPdfTextFromBytes.mockRejectedValue(new Error("Unexpected parser failure"));

    await expect(parsePolicyPdfCapture(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({
      code: "PARSE_FAILURE",
    });
  });

  it("classifies clearly invalid PDFs as INVALID_PDF", async () => {
    extractPdfTextFromBytes.mockRejectedValue(new Error("Invalid PDF structure"));

    await expect(parsePolicyPdfCapture(new Uint8Array([1, 2, 3]))).rejects.toMatchObject({
      code: "INVALID_PDF",
    });
  });
});
