import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireOrganizationContext: vi.fn(),
  getDb: vi.fn(),
  prepareContact: vi.fn(),
  prepareQuote: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/organization-context", () => ({ requireOrganizationContext: mocks.requireOrganizationContext, assertOrganizationContextInTransaction: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/renewal-whatsapp-service", () => ({ prepareRenewalWhatsAppContactForContext: mocks.prepareContact, prepareRenewalQuoteShareForContext: mocks.prepareQuote }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { prepareRenewalQuoteShare, prepareRenewalWhatsAppContact } from "@/app/(dashboard)/renewals/actions";

const context = { userId: "agent-1", organizationId: "org-a", membershipRole: "AGENT" as const };

describe("renewal WhatsApp server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOrganizationContext.mockResolvedValue(context);
    mocks.getDb.mockReturnValue({ $transaction: vi.fn(async (callback: (tx: unknown) => unknown) => callback({})) });
  });

  it("prepares a contact without changing renewal state", async () => {
    mocks.prepareContact.mockResolvedValue({ outcome: "OPEN_WHATSAPP", url: "https://wa.me/525512345678?text=x", message: "Hola", phoneSource: "PRIMARY" });
    await expect(prepareRenewalWhatsAppContact({ policyId: "policy-a" })).resolves.toMatchObject({ outcome: "OPEN_WHATSAPP" });
    expect(mocks.prepareContact).toHaveBeenCalledWith(expect.objectContaining({ policyId: "policy-a", context }));
  });

  it("returns native quote preparation and validates the handoff enum", async () => {
    mocks.prepareQuote.mockResolvedValue({ outcome: "READY_TO_SHARE", message: "Cotización" });
    await expect(prepareRenewalQuoteShare({ policyId: "policy-a", handoff: "NATIVE_SHARE" })).resolves.toEqual({ outcome: "READY_TO_SHARE", message: "Cotización" });
    await expect(prepareRenewalQuoteShare({ policyId: "policy-a", handoff: "BAD" as never })).resolves.toEqual({ outcome: "ERROR", error: "La forma de compartir no es válida." });
    expect(mocks.prepareQuote).toHaveBeenCalledTimes(1);
  });

  it("preserves a sanitized service error", async () => {
    mocks.prepareQuote.mockRejectedValue(new Error("La renovación ya no está disponible."));
    await expect(prepareRenewalQuoteShare({ policyId: "policy-a", handoff: "WHATSAPP_FALLBACK" })).resolves.toEqual({ outcome: "ERROR", error: "La renovación ya no está disponible." });
  });
});
