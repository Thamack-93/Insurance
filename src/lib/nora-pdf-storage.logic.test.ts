import { describe, expect, it, vi } from "vitest";
import { buildNoraPolicyPdfPathname, isNoraPolicyPdfPathname } from "@/lib/nora-pdf-storage.shared";

describe("nora pdf storage", () => {
  it("builds user-scoped temp pdf paths", () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const pathname = buildNoraPolicyPdfPathname("user-1", "caratula final");

    expect(pathname).toBe("temp/nora-policy-pdfs/user-1/1700000000000-caratula_final.pdf");
    expect(isNoraPolicyPdfPathname(pathname, "user-1")).toBe(true);
    expect(isNoraPolicyPdfPathname(pathname, "user-2")).toBe(false);

    vi.restoreAllMocks();
  });
});
