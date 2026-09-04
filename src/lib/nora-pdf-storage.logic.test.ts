import { describe, expect, it, vi } from "vitest";
import { buildNoraPolicyPdfPathname, isNoraPolicyPdfPathname } from "@/lib/nora-pdf-storage.shared";

describe("nora pdf storage", () => {
  it("builds opaque tenant-prefixed temp pdf paths", () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("opaque-upload-id");
    const pathname = buildNoraPolicyPdfPathname("org-1", "user-1", "caratula final");

    expect(pathname).toBe("temp/nora-policy-pdfs/org-1/user-1/opaque-upload-id.pdf");
    expect(isNoraPolicyPdfPathname(pathname, "user-1", "org-1")).toBe(true);
    expect(isNoraPolicyPdfPathname(pathname, "user-1", "org-2")).toBe(false);
    expect(isNoraPolicyPdfPathname(pathname, "user-2", "org-1")).toBe(false);

    vi.restoreAllMocks();
  });
});
