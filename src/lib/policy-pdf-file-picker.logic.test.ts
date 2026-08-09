import { describe, expect, it } from "vitest";
import { mergePolicyPdfFiles, validatePolicyPdfFile } from "@/lib/policy-pdf-file-picker.logic";

function file(name: string, type = "application/pdf", size = 100, lastModified = 1) {
  return { name, type, size, lastModified };
}

describe("policy PDF file picker", () => {
  it("accepts PDFs and rejects non-PDF files", () => {
    expect(validatePolicyPdfFile(file("caratula.pdf"))).toBeNull();
    expect(validatePolicyPdfFile(file("imagen.png", "image/png"))).toContain("Solo se aceptan");
  });

  it("merges multiple files without duplicates and preserves actionable errors", () => {
    const first = file("uno.pdf");
    const result = mergePolicyPdfFiles([first], [first, file("dos.pdf"), file("nota.txt", "text/plain")]);

    expect(result.files.map((item) => item.name)).toEqual(["uno.pdf", "dos.pdf"]);
    expect(result.error).toContain("ya está en la cola");
  });
});
