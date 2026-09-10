import { describe, expect, it } from "vitest";
import {
  DEMO_UPLOAD_MAX_BYTES,
  validateDemoPdf,
} from "./demo-upload-validation";

function pdf(body = "/Type /Catalog /Type /Page") {
  return new File([`%PDF-1.7\n${body}\n%%EOF\n`], "demo.pdf", { type: "application/pdf" });
}

describe("validateDemoPdf", () => {
  it("accepts a small, structurally complete PDF", async () => {
    await expect(validateDemoPdf(pdf())).resolves.toMatchObject({
      ok: true,
      detectedMimeType: "application/pdf",
      sizeBytes: expect.any(Number),
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("rejects spoofed MIME/signature and active content", async () => {
    const spoofed = new File(["not a pdf\n%%EOF"], "demo.pdf", { type: "application/pdf" });
    await expect(validateDemoPdf(spoofed)).resolves.toMatchObject({ ok: false, code: "DEMO_PDF_SIGNATURE_INVALID" });
    await expect(validateDemoPdf(new File([pdfBytes("/OpenAction 1")], "demo.pdf", { type: "application/pdf" }))).resolves.toMatchObject({ ok: false, code: "DEMO_PDF_ACTIVE_CONTENT" });
  });

  it("rejects wrong MIME and more than 100 pages", async () => {
    await expect(validateDemoPdf(new File([pdfBytes()], "demo.pdf", { type: "text/plain" }))).resolves.toMatchObject({ ok: false, code: "DEMO_MIME_INVALID" });
    const pages = Array.from({ length: 101 }, () => "/Type /Page").join(" ");
    await expect(validateDemoPdf(pdf(pages))).resolves.toMatchObject({ ok: false, code: "DEMO_PDF_PAGE_LIMIT" });
  });

  it("enforces the 15 MB limit before parsing", async () => {
    const bytes = new Uint8Array(DEMO_UPLOAD_MAX_BYTES + 1);
    bytes.set(new TextEncoder().encode("%PDF-1.7\n"));
    await expect(validateDemoPdf(new File([bytes], "large.pdf", { type: "application/pdf" }))).resolves.toMatchObject({ ok: false, code: "DEMO_FILE_SIZE_INVALID" });
  });
});

function pdfBytes(body = "") {
  return new TextEncoder().encode(`%PDF-1.7\n${body}\n%%EOF\n`);
}
